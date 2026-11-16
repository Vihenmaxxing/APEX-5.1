#!/usr/bin/env node
/* ==========================================
   APEX — Monaco elevation sampler

   Samples every vertex of the Circuit de Monaco centreline against a public
   digital elevation model and writes src/data/monaco-elevation.json.

   APEX does not need this file: the application can fetch the same data from
   the browser on first open and cache it in IndexedDB. Pre-baking is useful
   when you want the circuit to work offline from the very first launch, or
   when you want the data under version control so everyone sees identical
   numbers.

       node tools/fetch-monaco-elevation.mjs
       node tools/fetch-monaco-elevation.mjs --source opentopodata

   NOTHING in this script estimates, interpolates or fills in a height. If the
   service does not return a value for a point, the run fails and no file is
   written. A partial elevation dataset is worse than none, because it would
   silently shift the datum.
   ========================================== */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CIRCUIT = join(HERE, "..", "src", "data", "monaco-circuit.json");
const OUTPUT  = join(HERE, "..", "src", "data", "monaco-elevation.json");

const SOURCES = {
  "open-meteo": {
    name: "Open-Meteo Elevation API",
    dataset: "Copernicus DEM GLO-90",
    verticalDatum: "EGM2008 geoid (approximately mean sea level)",
    batch: 100,
    url: (pts) => `https://api.open-meteo.com/v1/elevation` +
      `?latitude=${pts.map(p => p.lat).join(",")}` +
      `&longitude=${pts.map(p => p.lon).join(",")}`,
    parse: (body, n) => {
      if (!body || !Array.isArray(body.elevation) || body.elevation.length !== n)
        throw new Error("unexpected response shape");
      return body.elevation.map(Number);
    },
    attribution: "Elevation: Copernicus DEM GLO-90 via the Open-Meteo Elevation API"
  },
  "opentopodata": {
    name: "OpenTopoData",
    dataset: "SRTM 30 m (srtm30m)",
    verticalDatum: "EGM96 geoid (approximately mean sea level)",
    batch: 100,
    url: (pts) => `https://api.opentopodata.org/v1/srtm30m` +
      `?locations=${pts.map(p => `${p.lat},${p.lon}`).join("|")}`,
    parse: (body, n) => {
      if (!body || body.status !== "OK" || !Array.isArray(body.results) || body.results.length !== n)
        throw new Error(`unexpected response (status ${body && body.status})`);
      return body.results.map(r => Number(r.elevation));
    },
    attribution: "Elevation: SRTM 30 m via OpenTopoData"
  }
};

const args = process.argv.slice(2);
const sourceKey = (() => {
  const i = args.indexOf("--source");
  return i >= 0 && args[i + 1] ? args[i + 1] : "open-meteo";
})();

const source = SOURCES[sourceKey];
if (!source) {
  console.error(`Unknown source "${sourceKey}". Available: ${Object.keys(SOURCES).join(", ")}`);
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const circuit = JSON.parse(await readFile(CIRCUIT, "utf8"));
  const pts = circuit.points;
  console.log(`Circuit: ${circuit.name}`);
  console.log(`  ${pts.length} centreline vertices, ${circuit.geometry.measuredLength_m} m`);
  console.log(`  Source: ${source.name} (${source.dataset})\n`);

  const samples = new Array(pts.length).fill(null);

  for (let start = 0; start < pts.length; start += source.batch) {
    const chunk = pts.slice(start, start + source.batch);
    const url = source.url(chunk);

    let values;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "APEX/5.1 elevation sampler" } });
        if (res.status === 429) { await sleep(attempt * 3000); continue; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        values = source.parse(await res.json(), chunk.length);
        break;
      } catch (err) {
        if (attempt === 4) {
          console.error(`\nFailed on points ${start}..${start + chunk.length - 1}: ${err.message}`);
          console.error("No file written. A partial dataset would shift the datum and is not acceptable.");
          process.exit(1);
        }
        await sleep(attempt * 2000);
      }
    }

    values.forEach((v, i) => { samples[start + i] = Number.isFinite(v) ? v : null; });
    process.stdout.write(`  sampled ${Math.min(pts.length, start + chunk.length)}/${pts.length}\r`);
    await sleep(1200);   // be polite to a free service
  }
  console.log("");

  const missing = samples.reduce((n, v, i) => v === null ? n.concat(i) : n, []);
  if (missing.length) {
    console.error(`\n${missing.length} points returned no height (indices ${missing.slice(0, 10).join(", ")}…).`);
    console.error("No file written — see above.");
    process.exit(1);
  }

  const min = Math.min(...samples), max = Math.max(...samples);
  const payload = {
    schema: "apex.monaco.elevation/1",
    samples,
    verticalDatum: source.verticalDatum,
    source: source.name,
    dataset: source.dataset,
    attribution: source.attribution,
    fetchedAt: new Date().toISOString(),
    pointCount: samples.length,
    circuitVertexCount: circuit.geometry.count,
    circuitLength_m: circuit.geometry.measuredLength_m,
    note: "Sampled from a digital elevation model of the TERRAIN SURFACE, not the " +
          "road deck. Through the Monaco tunnel the DEM reads the ground above the " +
          "road. Treat that section as terrain, not as a measurement of the track.",
    summary: {
      minAbsolute_m: min,
      maxAbsolute_m: max,
      range_m: Number((max - min).toFixed(2)),
      minIndex: samples.indexOf(min),
      maxIndex: samples.indexOf(max),
      datumFormula: "relative[i] = sample[i] - min(samples)"
    }
  };

  await writeFile(OUTPUT, JSON.stringify(payload), "utf8");

  console.log(`Wrote ${OUTPUT}`);
  console.log(`  lowest sampled point  : ${min.toFixed(1)} m above sea level  (index ${payload.summary.minIndex})`);
  console.log(`  highest sampled point : ${max.toFixed(1)} m above sea level  (index ${payload.summary.maxIndex})`);
  console.log(`  relative range        : ${payload.summary.range_m.toFixed(1)} m  (low point becomes 0 m)`);
  console.log(`\n  Published figures for Monaco's elevation change vary (41 m, 42 m, 44 m).`);
  console.log(`  A DEM-derived range will not match any of them exactly, and should not be`);
  console.log(`  edited to do so. The circuit's real low point may also sit in the tunnel,`);
  console.log(`  where a surface DEM cannot see the road.`);
}

main().catch(err => { console.error(err); process.exit(1); });
