/* ==========================================
   APEX 5.1 — MONACO GP CIRCUIT VISUALISATION

   A three-dimensional Circuit de Monaco with a relative elevation datum:
   the LOWEST sampled point on the circuit is 0 m, and every other point is
   reported as its height above that point.

   ---- WHERE THE DATA COMES FROM ----

   GEOMETRY is real. src/data/monaco-circuit.json holds a 159-vertex
   centreline derived from OpenStreetMap via bacinger/f1-circuits (ODbL).
   Its measured length is 3324.3 m against a published 3337 m — 0.38% —
   which is the agreement you would expect between a polyline centreline and
   an officially surveyed racing line. No vertex was invented or moved.

   ELEVATION is sampled from a digital elevation model at runtime, from the
   user's own browser, and cached permanently. It is NOT bundled, and it is
   NOT estimated. Until it has been fetched once, the circuit renders flat
   and says so. See docs/MONACO-DATA.md.

   ---- HONEST LIMITATIONS ----

   * A 30 m DEM samples the TERRAIN SURFACE, not the road deck. Through the
     tunnel the DEM reads the hillside above the road, so that section is
     marked as unreliable rather than presented as a measurement.
   * Published figures for the circuit's total elevation change differ
     (41 m, 42 m and 44 m all appear in print) and sources disagree about
     whether the lowest point is La Rascasse or the Piscine section. APEX
     reports what the loaded DEM says and shows the published range beside
     it for comparison, rather than asserting one figure.
   * Vertical exaggeration is applied for legibility and is always stated
     on screen. The underlying metres are never scaled.
   ========================================== */

const MONACO_PREFS_KEY = "apexMonacoPrefs";
const MONACO_ELEV_STORE = "monacoElevation";

/* The DEM service. Open-Meteo's elevation endpoint is CORS-enabled, free,
   needs no key, and serves Copernicus DEM GLO-90 resampled data. It accepts
   up to 100 coordinates per request. */
const MONACO_DEM = {
  name: "Open-Meteo Elevation API",
  url: "https://api.open-meteo.com/v1/elevation",
  dataset: "Copernicus DEM GLO-90",
  batch: 100,
  attribution: "Elevation: Copernicus DEM GLO-90 via the Open-Meteo Elevation API"
};

let monacoState = {
  circuit: null,        // the loaded JSON
  elevation: null,      // { samples:[m], source, fetchedAt, dataset }
  datum: null,          // { min, max, range, minIndex, maxIndex, relative:[] }
  three: null,          // { renderer, scene, camera, ... }
  selectedIndex: -1,
  loading: false,
  error: null
};

/* ---------- Preferences ---------- */
function monacoPrefs(){
  const p = ApexStore.read(MONACO_PREFS_KEY, null) || {};
  return {
    exaggeration: Number.isFinite(Number(p.exaggeration)) ? Number(p.exaggeration) : 3,
    autoOrbit: p.autoOrbit !== false,
    showBuildings: p.showBuildings !== false
  };
}
function monacoSavePrefs(next){ ApexStore.write(MONACO_PREFS_KEY, { ...monacoPrefs(), ...next }); }

/* ============================================================
   DATA LOADING
   ============================================================ */
async function monacoLoadCircuit(){
  if (monacoState.circuit) return monacoState.circuit;
  const res = await fetch("data/monaco-circuit.json");
  if (!res.ok) throw new Error(`Could not load the circuit data (HTTP ${res.status}).`);
  const data = await res.json();
  if (!data || !Array.isArray(data.points) || data.points.length < 10)
    throw new Error("The circuit data file is malformed.");
  monacoState.circuit = data;
  return data;
}

/* Cached elevation lives in IndexedDB, keyed by the circuit geometry so a
   future geometry update invalidates stale samples rather than silently
   pairing new coordinates with old heights. */
function monacoElevationKey(circuit){
  return `${MONACO_ELEV_STORE}:${circuit.geometry.count}:${circuit.geometry.measuredLength_m}`;
}

async function monacoLoadCachedElevation(circuit){
  try {
    const row = await ApexStore.idbGet("kv", monacoElevationKey(circuit));
    if (!row || !row.json) return null;
    const parsed = JSON.parse(row.json);
    if (!parsed || !Array.isArray(parsed.samples) || parsed.samples.length !== circuit.points.length) return null;
    return parsed;
  } catch (e) { return null; }
}

/* A pre-baked file produced by tools/fetch-monaco-elevation.mjs, if the
   repository ships one. Checked before the network is touched. */
async function monacoLoadBakedElevation(circuit){
  try {
    const res = await fetch("data/monaco-elevation.json");
    if (!res.ok) return null;
    const parsed = await res.json();
    if (!parsed || !Array.isArray(parsed.samples)) return null;
    if (parsed.samples.length !== circuit.points.length) {
      console.warn("APEX Monaco: the baked elevation file does not match the circuit geometry; ignoring it.");
      return null;
    }
    return parsed;
  } catch (e) { return null; }
}

/* Live DEM sampling. Every sampled point is a real measurement; nothing is
   interpolated between requests and nothing is substituted on failure. */
async function monacoFetchElevation(circuit, onProgress){
  const pts = circuit.points;
  const samples = new Array(pts.length).fill(null);

  for (let start = 0; start < pts.length; start += MONACO_DEM.batch){
    const chunk = pts.slice(start, start + MONACO_DEM.batch);
    const lats = chunk.map(p => p.lat).join(",");
    const lons = chunk.map(p => p.lon).join(",");
    const url = `${MONACO_DEM.url}?latitude=${lats}&longitude=${lons}`;

    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`The elevation service returned HTTP ${res.status}.`);
    const body = await res.json();
    if (!body || !Array.isArray(body.elevation) || body.elevation.length !== chunk.length)
      throw new Error("The elevation service returned an unexpected response.");

    body.elevation.forEach((v, i) => {
      const n = Number(v);
      samples[start + i] = Number.isFinite(n) ? n : null;
    });
    if (onProgress) onProgress(Math.min(pts.length, start + chunk.length), pts.length);
  }

  const missing = samples.filter(v => v === null).length;
  if (missing > 0) throw new Error(`${missing} points came back without a height. Not caching a partial dataset.`);

  const payload = {
    schema: "apex.monaco.elevation/1",
    samples,                                   // metres above sea level (EGM2008 geoid)
    verticalDatum: "EGM2008 geoid (approximately mean sea level)",
    source: MONACO_DEM.name,
    dataset: MONACO_DEM.dataset,
    attribution: MONACO_DEM.attribution,
    url: MONACO_DEM.url,
    fetchedAt: new Date().toISOString(),
    pointCount: samples.length,
    note: "Sampled from a digital elevation model of the terrain surface. " +
          "In the tunnel the DEM reads the ground above the road, not the road deck."
  };

  await ApexStore.idbPut("kv", { key: monacoElevationKey(circuit),
                                 json: JSON.stringify(payload), at: Date.now() });
  return payload;
}

/* ============================================================
   THE DATUM — the defining calculation
   ============================================================
     relative[i] = sample[i] - min(samples)
   The minimum sampled point becomes exactly 0.000 m by construction, and
   every other point is its height above that point. Absolute heights above
   sea level are kept alongside, never mixed in.                          */
function monacoComputeDatum(circuit, elevation){
  const samples = elevation.samples;
  let min = Infinity, max = -Infinity, minIndex = 0, maxIndex = 0;

  samples.forEach((v, i) => {
    if (v < min){ min = v; minIndex = i; }
    if (v > max){ max = v; maxIndex = i; }
  });

  const relative = samples.map(v => v - min);

  return {
    minAbsolute_m: min,          // metres above sea level at the lowest point
    maxAbsolute_m: max,
    minIndex, maxIndex,
    relative,                     // metres above the circuit's own lowest point
    range_m: max - min,           // == relative[maxIndex], by construction
    /* Cumulative climb and descent around a lap, which is a different figure
       from the high-to-low range and is labelled as such in the UI. */
    totalClimb_m: samples.reduce((acc, v, i) => i === 0 ? 0 : acc + Math.max(0, v - samples[i-1]), 0),
    formula: "relative[i] = sample[i] - min(samples)"
  };
}

/* ============================================================
   RENDERING — 3D
   ============================================================ */
async function monacoInitThree(host){
  const THREE = await import("./vendor/three.module.min.js");
  const circuit = monacoState.circuit;
  const datum = monacoState.datum;
  const prefs = monacoPrefs();

  const width = host.clientWidth || 800;
  const height = host.clientHeight || 460;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false,
                                             powerPreference: "high-performance" });
  renderer.setSize(width, height);
  /* Capped device pixel ratio: on a modern iPhone an uncapped DPR triples
     the fragment count for no visible gain and drains the battery. */
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x070b14, 1);
  host.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070b14, 900, 2600);

  const camera = new THREE.PerspectiveCamera(50, width / height, 1, 6000);

  /* ---- Lighting: low sun, long shadows, pre-race evening ---- */
  scene.add(new THREE.AmbientLight(0x4a5a7a, 1.1));
  const key = new THREE.DirectionalLight(0xffd9a8, 1.5);
  key.position.set(-400, 600, 300);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4aa8ff, 0.7);
  rim.position.set(500, 260, -400);
  scene.add(rim);

  /* ---- Scale ----
     Horizontal: metres, 1:1, straight from the projection.
     Vertical: metres multiplied by the exaggeration factor, which is shown
     on screen at all times. The underlying numbers are never touched. */
  const pts = circuit.points;
  const rel = datum ? datum.relative : pts.map(() => 0);
  const VE = prefs.exaggeration;

  const centreline = pts.map((p, i) => new THREE.Vector3(p.x, rel[i] * VE, -p.y));

  /* ---- Sea / harbour plane at the datum ----
     Drawn at y = 0, which IS the datum: the lowest point of the circuit. */
  const水 = null; // (placeholder removed)
  const harbourGeo = new THREE.PlaneGeometry(4000, 4000);
  const harbourMat = new THREE.MeshStandardMaterial({
    color: 0x0a2744, roughness: 0.25, metalness: 0.6,
    transparent: true, opacity: 0.85
  });
  const harbour = new THREE.Mesh(harbourGeo, harbourMat);
  harbour.rotation.x = -Math.PI / 2;
  harbour.position.y = -0.4;
  scene.add(harbour);

  /* The 0 m reference plane itself — a grid the user can read heights off. */
  const grid = new THREE.GridHelper(2400, 48, 0x2a4a7a, 0x16283f);
  grid.position.y = 0;
  scene.add(grid);

  /* ---- Track ribbon ----
     A real extruded surface, not a line: the brief asks for distinguishable
     track boundaries. Monaco's narrowest point is about 8 m; a nominal 10 m
     width is used and is labelled as nominal in the info panel. */
  const TRACK_WIDTH = 10;
  const positions = [], indices = [], uvs = [];
  const n = centreline.length;

  for (let i = 0; i < n; i++){
    const prev = centreline[(i - 1 + n) % n];
    const next = centreline[(i + 1) % n];
    const dir = new THREE.Vector3().subVectors(next, prev); dir.y = 0; dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(TRACK_WIDTH / 2);
    const c = centreline[i];
    positions.push(c.x - side.x, c.y, c.z - side.z);
    positions.push(c.x + side.x, c.y, c.z + side.z);
    const u = pts[i].s / circuit.geometry.measuredLength_m;
    uvs.push(0, u, 1, u);
  }
  for (let i = 0; i < n; i++){
    const a = i * 2, b = i * 2 + 1;
    const c = ((i + 1) % n) * 2, d = ((i + 1) % n) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  trackGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  trackGeo.setIndex(indices);
  trackGeo.computeVertexNormals();
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.92,
                                                    metalness: 0.05, side: THREE.DoubleSide });
  const track = new THREE.Mesh(trackGeo, trackMat);
  scene.add(track);

  /* ---- Barriers, so the boundaries are unmistakable ---- */
  function barrier(offset, colour){
    const verts = [];
    for (let i = 0; i < n; i++){
      const prev = centreline[(i - 1 + n) % n], next = centreline[(i + 1) % n];
      const dir = new THREE.Vector3().subVectors(next, prev); dir.y = 0; dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(offset);
      const c = centreline[i];
      verts.push(new THREE.Vector3(c.x + side.x, c.y + 1.2, c.z + side.z));
    }
    verts.push(verts[0].clone());
    const geo = new THREE.BufferGeometry().setFromPoints(verts);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: colour }));
  }
  scene.add(barrier( TRACK_WIDTH / 2, 0xe8ecf4));
  scene.add(barrier(-TRACK_WIDTH / 2, 0xe8ecf4));

  /* ---- Vertical elevation stems down to the 0 m plane ----
     These are the feature. Every stem is drawn from the track surface to
     the datum plane, so the height of each section is directly readable. */
  const stemGroup = new THREE.Group();
  const stemEvery = 4;
  for (let i = 0; i < n; i += stemEvery){
    if (rel[i] < 0.5) continue;
    const c = centreline[i];
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(c.x, 0, c.z), new THREE.Vector3(c.x, c.y, c.z)
    ]);
    const t = Math.min(1, rel[i] / Math.max(1, (monacoState.datum ? monacoState.datum.range_m : 1)));
    const colour = new THREE.Color().setHSL(0.58 - t * 0.5, 0.85, 0.45 + t * 0.15);
    stemGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: colour, transparent: true, opacity: 0.5
    })));
  }
  scene.add(stemGroup);

  /* ---- Start/finish gantry ---- */
  const sf = centreline[0];
  const gantry = new THREE.Mesh(
    new THREE.BoxGeometry(TRACK_WIDTH + 4, 0.8, 1.4),
    new THREE.MeshStandardMaterial({ color: 0xef3340, emissive: 0x4a0d11 })
  );
  gantry.position.set(sf.x, sf.y + 7, sf.z);
  scene.add(gantry);

  /* ---- Sector divisions ----
     Equal-distance thirds. F1's real timing-sector boundaries for Monaco are
     not published as coordinates, so these are labelled "equal thirds" in
     the UI rather than presented as official sectors. */
  const sectorGroup = new THREE.Group();
  [1/3, 2/3].forEach(frac => {
    const target = frac * circuit.geometry.measuredLength_m;
    let idx = 0;
    for (let i = 0; i < pts.length; i++) if (pts[i].s <= target) idx = i;
    const c = centreline[idx];
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_WIDTH + 2, 0.6, 1),
      new THREE.MeshStandardMaterial({ color: 0xffb547, emissive: 0x3a2a08 })
    );
    post.position.set(c.x, c.y + 5, c.z);
    sectorGroup.add(post);
  });
  scene.add(sectorGroup);

  /* ---- A marker that follows the selected point ---- */
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(4, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x35cf88, emissive: 0x0d4a2a })
  );
  marker.visible = false;
  scene.add(marker);

  const markerStem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x35cf88 })
  );
  markerStem.visible = false;
  scene.add(markerStem);

  /* ---- Simple terrain massing around the circuit ----
     Deliberately abstract. Monaco's real buildings are not in the bundled
     data, so rather than invent a skyline these are plain blocks placed
     OUTSIDE the circuit, clearly reading as massing rather than as mapped
     architecture. They can be switched off. */
  const cityGroup = new THREE.Group();
  if (prefs.showBuildings){
    const cityMat = new THREE.MeshStandardMaterial({ color: 0x141c2c, roughness: 0.9 });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < n; i += 3){
      const c = centreline[i];
      const prev = centreline[(i - 1 + n) % n], next = centreline[(i + 1) % n];
      const dir = new THREE.Vector3().subVectors(next, prev); dir.y = 0; dir.normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      [-1, 1].forEach(sign => {
        const dist = 26 + ((i * 37) % 30);
        const h = 14 + ((i * 53) % 46);
        const b = new THREE.Mesh(boxGeo, cityMat);
        b.position.set(c.x + side.x * dist * sign, (rel[i] * VE) + h / 2, c.z + side.z * dist * sign);
        b.scale.set(12 + (i % 9), h, 12 + (i % 7));
        cityGroup.add(b);
      });
    }
  }
  scene.add(cityGroup);

  /* ---- Camera control ---- */
  const bounds = new THREE.Box3().setFromPoints(centreline);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).x,
                          bounds.getSize(new THREE.Vector3()).z) * 0.75;

  /* Declared BEFORE the pointer handlers that reference it. The whole point
     of this release is that a hoisted reference to a not-yet-initialised
     `const` throws — so no new code in APEX is allowed to do it either. */
  const state = { autoOrbit: prefs.autoOrbit, running: true, raf: 0, cinematic: null };

  const cam = { theta: 0.6, phi: 0.95, dist: radius * 3.4, target: centre.clone() };
  const HOME = { ...cam, target: centre.clone() };

  function applyCamera(){
    cam.phi = Math.max(0.12, Math.min(1.52, cam.phi));
    cam.dist = Math.max(radius * 0.7, Math.min(radius * 7, cam.dist));
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta),
      cam.target.y + cam.dist * Math.cos(cam.phi),
      cam.target.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta)
    );
    camera.lookAt(cam.target);
  }
  applyCamera();

  const canvasEl = renderer.domElement;
  canvasEl.style.touchAction = "none";
  let drag = null;
  canvasEl.addEventListener("pointerdown", e => {
    drag = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey };
    canvasEl.setPointerCapture(e.pointerId);
    state.autoOrbit = false;
  });
  canvasEl.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.button === 2 || drag.shift){
      const pan = cam.dist * 0.0013;
      cam.target.x -= dx * pan * Math.cos(cam.theta) - dy * pan * Math.sin(cam.theta);
      cam.target.z -= dx * pan * Math.sin(cam.theta) + dy * pan * Math.cos(cam.theta);
    } else {
      cam.theta -= dx * 0.006;
      cam.phi   -= dy * 0.006;
    }
    applyCamera();
  });
  ["pointerup","pointercancel","pointerleave"].forEach(t =>
    canvasEl.addEventListener(t, () => { drag = null; }));
  canvasEl.addEventListener("wheel", e => {
    e.preventDefault();
    cam.dist *= (1 + e.deltaY * 0.0012);
    applyCamera();
  }, { passive: false });
  canvasEl.addEventListener("contextmenu", e => e.preventDefault());

  /* Pinch zoom for the iPhone PWA. */
  const touches = new Map();
  let pinchStart = 0, pinchDist = 0;
  canvasEl.addEventListener("pointerdown", e => touches.set(e.pointerId, e));
  canvasEl.addEventListener("pointermove", e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, e);
    if (touches.size !== 2) return;
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (!pinchStart){ pinchStart = d; pinchDist = cam.dist; return; }
    cam.dist = pinchDist * (pinchStart / Math.max(1, d));
    applyCamera();
  });
  ["pointerup","pointercancel","pointerleave"].forEach(t =>
    canvasEl.addEventListener(t, e => { touches.delete(e.pointerId); pinchStart = 0; }));

  /* ---- Animation ----
     Paused whenever the page is hidden or the Monaco page is not on screen,
     so the visualisation costs nothing while the user is elsewhere in APEX. */
  function frame(){
    if (!state.running) return;
    state.raf = requestAnimationFrame(frame);

    const page = document.querySelector('[data-page-section="monaco"]');
    if (document.hidden || !page || page.hidden) return;

    if (state.cinematic){
      const c = state.cinematic;
      c.t = Math.min(1, c.t + 0.0045);
      const e = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;  // ease in-out
      cam.theta = c.from.theta + (c.to.theta - c.from.theta) * e;
      cam.phi   = c.from.phi   + (c.to.phi   - c.from.phi)   * e;
      cam.dist  = c.from.dist  + (c.to.dist  - c.from.dist)  * e;
      applyCamera();
      if (c.t >= 1) state.cinematic = null;
    } else if (state.autoOrbit){
      cam.theta += 0.0016;
      applyCamera();
    }
    renderer.render(scene, camera);
  }
  frame();

  function resize(){
    const w = host.clientWidth || 800, h = host.clientHeight || 460;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  /* ---- Resource disposal ---- */
  function dispose(){
    state.running = false;
    cancelAnimationFrame(state.raf);
    window.removeEventListener("resize", resize);
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material){
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
      }
    });
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    if (renderer.domElement && renderer.domElement.parentNode)
      renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  function flyTo(to, label){
    state.autoOrbit = false;
    state.cinematic = { t: 0, from: { theta: cam.theta, phi: cam.phi, dist: cam.dist }, to };
    if (label) monacoSetStatus(label);
  }

  function highlight(index){
    if (index < 0 || index >= centreline.length){
      marker.visible = false; markerStem.visible = false; return;
    }
    const c = centreline[index];
    marker.position.copy(c);
    marker.visible = true;
    markerStem.geometry.dispose();
    markerStem.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(c.x, 0, c.z), c.clone()
    ]);
    markerStem.visible = true;
  }

  function setExaggeration(value){
    const ve = Math.max(1, Math.min(10, Number(value) || 1));
    monacoSavePrefs({ exaggeration: ve });
    monacoState.three.dispose();
    monacoRender3D();
  }

  monacoState.three = {
    THREE, renderer, scene, camera, cam, HOME, state, dispose, flyTo, highlight,
    setExaggeration, centreline, radius, centre,
    toggleOrbit(){ state.autoOrbit = !state.autoOrbit; monacoSavePrefs({ autoOrbit: state.autoOrbit }); return state.autoOrbit; },
    reset(){ cam.theta = HOME.theta; cam.phi = HOME.phi; cam.dist = HOME.dist;
             cam.target.copy(HOME.target); state.cinematic = null; applyCamera(); },
    toggleBuildings(){ cityGroup.visible = !cityGroup.visible;
                       monacoSavePrefs({ showBuildings: cityGroup.visible });
                       return cityGroup.visible; },
    toggleStems(){ stemGroup.visible = !stemGroup.visible; return stemGroup.visible; }
  };
  return monacoState.three;
}

/* ---- The formation-lap presentation ----
   Wide aerial, approach, circuit-focused aerial, then a slow orbit. One
   queued sequence rather than continuous motion, as the brief asks. */
function monacoCinematic(){
  const t = monacoState.three;
  if (!t) return;
  const r = t.radius;
  const legs = [
    { to: { theta: 0.2,  phi: 0.22, dist: r * 6.2 }, label: "Monaco — wide aerial",      hold: 2600 },
    { to: { theta: 1.1,  phi: 0.55, dist: r * 3.6 }, label: "Approaching the circuit",   hold: 2800 },
    { to: { theta: 2.0,  phi: 1.05, dist: r * 2.1 }, label: "Circuit level — Casino climb to the harbour", hold: 3000 },
    { to: { theta: 3.6,  phi: 0.80, dist: r * 3.0 }, label: "Formation lap orbit",       hold: 3000 }
  ];
  let i = 0;
  (function next(){
    if (i >= legs.length){
      t.state.autoOrbit = true;
      monacoSetStatus("Drag to rotate · scroll to zoom · shift-drag to pan");
      return;
    }
    const leg = legs[i++];
    t.flyTo(leg.to, leg.label);
    setTimeout(next, leg.hold);
  })();
}

/* ============================================================
   ELEVATION PROFILE — SVG, driven by the SAME dataset as the 3D view
   ============================================================ */
function monacoRenderProfile(){
  const host = document.getElementById("monacoProfile");
  if (!host) return;
  host.replaceChildren();

  const circuit = monacoState.circuit, datum = monacoState.datum;
  if (!circuit) return;

  if (!datum){
    host.appendChild(el("p", "empty-state",
      "No elevation data loaded yet. Use FETCH ELEVATION above to sample the circuit."));
    return;
  }

  const pts = circuit.points, rel = datum.relative;
  const W = 900, H = 300, L = 54, R = 18, T = 18, B = 44;
  const cw = W - L - R, ch = H - T - B;
  const lap = circuit.geometry.measuredLength_m;
  const yMax = Math.max(5, Math.ceil(datum.range_m / 5) * 5);

  const X = s => L + (s / lap) * cw;
  const Y = v => T + ch - (v / yMax) * ch;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "monaco-profile-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label",
    `Circuit elevation relative to the lowest point, ranging from 0 to ${datum.range_m.toFixed(1)} metres`);

  const node = (tag, attrs) => {
    const nd = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => nd.setAttribute(k, v));
    return nd;
  };

  /* Horizontal gridlines, in metres above the datum */
  for (let v = 0; v <= yMax; v += Math.max(5, Math.round(yMax / 5 / 5) * 5)){
    const y = Y(v);
    svg.appendChild(node("line", { x1: L, x2: W - R, y1: y, y2: y,
      class: v === 0 ? "monaco-datum-line" : "monaco-grid-line" }));
    const label = node("text", { x: L - 8, y: y + 4, "text-anchor": "end", class: "monaco-axis-label" });
    label.textContent = v + " m";
    svg.appendChild(label);
  }

  /* The 0 m datum, called out explicitly */
  const datumTag = node("text", { x: L + 6, y: Y(0) - 7, class: "monaco-datum-tag" });
  datumTag.textContent = `0 m DATUM — lowest point on the circuit (${datum.minAbsolute_m.toFixed(1)} m above sea level)`;
  svg.appendChild(datumTag);

  /* Sector thirds */
  [1/3, 2/3].forEach((frac, i) => {
    const x = L + frac * cw;
    svg.appendChild(node("line", { x1: x, x2: x, y1: T, y2: T + ch, class: "monaco-sector-line" }));
    const lab = node("text", { x: x + 4, y: T + 12, class: "monaco-sector-label" });
    lab.textContent = `S${i + 2}`;
    svg.appendChild(lab);
  });

  /* Filled profile */
  const path = pts.map((p, i) => `${X(p.s).toFixed(2)},${Y(rel[i]).toFixed(2)}`).join(" ");
  svg.appendChild(node("polygon", { points: `${L},${Y(0)} ${path} ${X(lap)},${Y(0)}`, class: "monaco-profile-area" }));
  svg.appendChild(node("polyline", { points: path, class: "monaco-profile-line" }));

  /* Corner markers, attached to the nearest centreline vertex */
  (monacoState.cornerIndex || []).forEach(c => {
    const x = X(pts[c.index].s), y = Y(rel[c.index]);
    svg.appendChild(node("circle", { cx: x, cy: y, r: 3.5, class: "monaco-corner-dot" }));
    const lab = node("text", { x, y: y - 9, "text-anchor": "middle", class: "monaco-corner-label" });
    lab.textContent = c.isHairpin ? "HP" : String(c.seq);
    svg.appendChild(lab);
  });

  /* High and low callouts */
  const hi = { x: X(pts[datum.maxIndex].s), y: Y(rel[datum.maxIndex]) };
  const lo = { x: X(pts[datum.minIndex].s), y: Y(0) };
  svg.appendChild(node("circle", { cx: hi.x, cy: hi.y, r: 5, class: "monaco-peak-dot" }));
  const hiLab = node("text", { x: hi.x, y: hi.y - 12, "text-anchor": "middle", class: "monaco-peak-label" });
  hiLab.textContent = `+${datum.range_m.toFixed(1)} m`;
  svg.appendChild(hiLab);
  svg.appendChild(node("circle", { cx: lo.x, cy: lo.y, r: 5, class: "monaco-low-dot" }));

  /* Distance axis */
  for (let s = 0; s <= lap; s += 500){
    const x = X(s);
    const lab = node("text", { x, y: H - 16, "text-anchor": "middle", class: "monaco-axis-label" });
    lab.textContent = (s / 1000).toFixed(1) + " km";
    svg.appendChild(lab);
  }
  const axisTitle = node("text", { x: L + cw / 2, y: H - 2, "text-anchor": "middle", class: "monaco-axis-title" });
  axisTitle.textContent = "DISTANCE FROM START/FINISH";
  svg.appendChild(axisTitle);

  /* Interaction: hovering or tapping the graph highlights the 3D circuit */
  const hover = node("line", { x1: L, x2: L, y1: T, y2: T + ch, class: "monaco-hover-line" });
  hover.style.opacity = "0";
  svg.appendChild(hover);

  const capture = node("rect", { x: L, y: T, width: cw, height: ch, fill: "transparent",
                                 style: "cursor:crosshair" });
  function pick(event){
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const s = Math.max(0, Math.min(lap, ((px - L) / cw) * lap));
    let best = 0, bestD = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.s - s); if (d < bestD){ bestD = d; best = i; } });
    monacoSelect(best);
    hover.setAttribute("x1", X(pts[best].s)); hover.setAttribute("x2", X(pts[best].s));
    hover.style.opacity = "1";
  }
  capture.addEventListener("pointermove", pick);
  capture.addEventListener("pointerdown", pick);
  capture.addEventListener("pointerleave", () => { hover.style.opacity = "0"; });
  svg.appendChild(capture);

  host.appendChild(svg);
}

/* Selecting a point syncs the readout, the 3D marker and the profile. */
function monacoSelect(index){
  monacoState.selectedIndex = index;
  const circuit = monacoState.circuit, datum = monacoState.datum;
  if (!circuit || !datum) return;
  if (monacoState.three) monacoState.three.highlight(index);

  const p = circuit.points[index];
  const rel = datum.relative[index];
  const corner = (monacoState.cornerIndex || []).find(c => Math.abs(c.index - index) <= 1);
  const box = document.getElementById("monacoReadout");
  if (!box) return;
  box.replaceChildren();
  box.append(
    el("strong", "", corner ? `${corner.label} · ${(p.s / 1000).toFixed(2)} km` : `${(p.s / 1000).toFixed(2)} km into the lap`),
    el("span", "monaco-readout-big", `+${rel.toFixed(1)} m`),
    el("small", "", `above the circuit's lowest point · ${(datum.minAbsolute_m + rel).toFixed(1)} m above sea level`)
  );
}

/* ============================================================
   PAGE
   ============================================================ */
function monacoSetStatus(text){
  const node = document.getElementById("monacoStatus");
  if (node) node.textContent = text;
}

async function monacoRender3D(){
  const host = document.getElementById("monacoStage");
  if (!host) return;
  try { await monacoInitThree(host); }
  catch (e){
    console.error("APEX Monaco: 3D init failed.", e);
    host.replaceChildren(el("p", "empty-state",
      "The 3D view could not start on this device. " +
      (e && /WebGL/i.test(String(e)) ? "WebGL does not appear to be available. " : "") +
      "The elevation profile below still works."));
  }
}

/* The circuit data ships two separate lists: curvature features DERIVED from
   the centreline (real positions, no names) and published corner NAMES (real
   names, no verifiable positions). They are presented as what they are. The
   hairpin is the one place the two are joined, because it is geometrically
   unique. */
function monacoBuildCornerIndex(circuit){
  return (circuit.curvatureFeatures || []).map(f => ({
    ...f,
    label: f.isHairpin ? "Hairpin" : "Turn " + f.seq,
    index: f.vertexIndex
  }));
}

async function renderMonaco(){
  const root = document.getElementById("monacoRoot");
  if (!root) return;
  if (monacoState.loading) return;
  monacoState.loading = true;

  root.replaceChildren();
  const stageCard = el("div", "card monaco-card");
  const topline = el("div", "monaco-topline");
  topline.append(el("h3", "", "CIRCUIT DE MONACO"), el("span", "monaco-status", ""));
  topline.lastChild.id = "monacoStatus";
  stageCard.appendChild(topline);

  const stage = el("div", "monaco-stage");
  stage.id = "monacoStage";
  stage.appendChild(el("p", "empty-state", "Loading circuit geometry…"));
  stageCard.appendChild(stage);

  const tools = el("div", "monaco-tools");
  tools.id = "monacoTools";
  stageCard.appendChild(tools);

  const readout = el("div", "monaco-readout");
  readout.id = "monacoReadout";
  stageCard.appendChild(readout);
  root.appendChild(stageCard);

  const profileCard = el("div", "card");
  profileCard.append(el("h3", "", "ELEVATION PROFILE — RELATIVE TO THE LOWEST POINT"));
  const profile = el("div", "monaco-profile");
  profile.id = "monacoProfile";
  profileCard.appendChild(profile);
  root.appendChild(profileCard);

  const infoCard = el("div", "card");
  infoCard.id = "monacoInfo";
  root.appendChild(infoCard);

  try {
    const circuit = await monacoLoadCircuit();
    monacoState.cornerIndex = monacoBuildCornerIndex(circuit);

    /* Elevation: cache, then a baked file, then nothing. The network is only
       touched when the user asks for it. */
    let elev = await monacoLoadCachedElevation(circuit);
    if (!elev) elev = await monacoLoadBakedElevation(circuit);
    monacoState.elevation = elev;
    monacoState.datum = elev ? monacoComputeDatum(circuit, elev) : null;

    monacoSetStatus(elev ? "Drag to rotate · scroll to zoom · shift-drag to pan"
                         : "Elevation not loaded — the circuit is shown flat");

    await monacoRender3D();
    monacoRenderProfile();
    monacoRenderTools();
    monacoRenderInfo();
    if (monacoState.datum) monacoSelect(monacoState.datum.maxIndex);
  } catch (e){
    console.error("APEX Monaco:", e);
    const err = el("div", "card");
    err.append(el("h3", "", "CIRCUIT DE MONACO"),
               el("p", "empty-state", "The circuit data could not be loaded: " + e.message));
    root.replaceChildren(err);
  } finally {
    monacoState.loading = false;
  }
}

function monacoRenderTools(){
  const host = document.getElementById("monacoTools");
  if (!host || typeof btn !== "function") return;
  host.replaceChildren();
  const t = monacoState.three;
  const prefs = monacoPrefs();

  if (!monacoState.elevation){
    const fetchBtn = btn("FETCH ELEVATION DATA", "", async () => {
      fetchBtn.disabled = true;
      try {
        monacoSetStatus("Sampling the circuit against the DEM…");
        const elev = await monacoFetchElevation(monacoState.circuit, (done, total) => {
          monacoSetStatus(`Sampling elevation… ${done}/${total} points`);
        });
        monacoState.elevation = elev;
        monacoState.datum = monacoComputeDatum(monacoState.circuit, elev);
        if (monacoState.three) monacoState.three.dispose();
        await monacoRender3D();
        monacoRenderProfile(); monacoRenderTools(); monacoRenderInfo();
        monacoSelect(monacoState.datum.maxIndex);
        monacoSetStatus("Elevation loaded and cached on this device.");
      } catch (e){
        fetchBtn.disabled = false;
        monacoSetStatus("Could not fetch elevation: " + e.message);
        console.error("APEX Monaco elevation:", e);
      }
    });
    host.appendChild(fetchBtn);
    host.appendChild(el("p", "muted-small",
      `One-off download of about ${monacoState.circuit ? monacoState.circuit.points.length : 0} ` +
      `height samples from ${MONACO_DEM.name}. Cached permanently on this device afterwards. ` +
      `This is the only network request APEX ever makes.`));
    return;
  }

  if (!t) return;

  host.appendChild(btn("FORMATION LAP", "", () => monacoCinematic()));
  const orbitBtn = btn("AUTO-ORBIT", "secondary" + (t.state.autoOrbit ? " on" : ""), () => {
    orbitBtn.classList.toggle("on", t.toggleOrbit());
  });
  host.appendChild(orbitBtn);
  host.appendChild(btn("RESET CAMERA", "secondary", () => { t.reset(); monacoSetStatus("Camera reset."); }));
  const stemBtn = btn("HEIGHT STEMS", "secondary on", () => stemBtn.classList.toggle("on", t.toggleStems()));
  host.appendChild(stemBtn);
  const cityBtn = btn("MASSING", "secondary" + (prefs.showBuildings ? " on" : ""), () => {
    cityBtn.classList.toggle("on", t.toggleBuildings());
  });
  host.appendChild(cityBtn);

  const veWrap = el("label", "monaco-ve");
  veWrap.append(el("span", "", `VERTICAL EXAGGERATION ×${prefs.exaggeration}`));
  const range = document.createElement("input");
  range.type = "range"; range.min = "1"; range.max = "10"; range.step = "1";
  range.value = String(prefs.exaggeration);
  range.addEventListener("change", () => t.setExaggeration(range.value));
  veWrap.appendChild(range);
  host.appendChild(veWrap);
}

function monacoRenderInfo(){
  const host = document.getElementById("monacoInfo");
  if (!host) return;
  host.replaceChildren();
  const circuit = monacoState.circuit, datum = monacoState.datum;
  host.appendChild(el("h3", "", "CIRCUIT INFORMATION"));

  const grid = el("div", "monaco-facts");
  const fact = (label, value, note) => {
    const b = el("div", "monaco-fact");
    b.append(el("p", "", label), el("strong", "", value));
    if (note) b.appendChild(el("small", "", note));
    grid.appendChild(b);
  };

  const pub = circuit.published;
  fact("PUBLISHED LENGTH", (pub.length_m / 1000).toFixed(3) + " km", pub.lengthSource);
  fact("MEASURED CENTRELINE", (circuit.geometry.measuredLength_m / 1000).toFixed(3) + " km",
       `OpenStreetMap polyline · ${(Math.abs(circuit.geometry.measuredLength_m - pub.length_m) / pub.length_m * 100).toFixed(2)}% from published`);
  fact("CORNERS", String(pub.corners), pub.cornersSource);
  fact("SECTORS", "3 (equal thirds)", "Official F1 sector coordinates are not published");

  if (datum){
    fact("MEASURED ELEVATION RANGE", datum.range_m.toFixed(1) + " m",
         "high point minus low point, from the loaded DEM");
    fact("DATUM (0 m)", datum.minAbsolute_m.toFixed(1) + " m above sea level",
         "the lowest sampled point on the circuit");
    fact("HIGHEST POINT", "+" + datum.range_m.toFixed(1) + " m",
         (monacoState.cornerIndex.find(c => Math.abs(c.index - datum.maxIndex) <= 3) || {}).label || "above the datum");
    fact("CUMULATIVE CLIMB", datum.totalClimb_m.toFixed(0) + " m",
         "total ascent over one lap — not the same as the range");
  } else {
    fact("ELEVATION", "not loaded", "use FETCH ELEVATION DATA above");
  }
  fact("PUBLISHED ELEVATION CHANGE", pub.elevationChange_m + " m", "for comparison — see the note below");
  fact("START/FINISH", "Boulevard Albert 1er", "grid and the start of the profile");
  host.appendChild(grid);

  /* Detected curvature features — real positions on the track */
  const feats = el("div", "monaco-corner-list");
  (monacoState.cornerIndex || []).forEach(c => {
    const row = el("div", "monaco-corner-row" + (c.isHairpin ? " is-hairpin" : ""));
    const relText = datum ? `+${datum.relative[c.index].toFixed(1)} m` : "—";
    row.append(el("span", "monaco-corner-n", c.isHairpin ? "HP" : String(c.seq)),
               el("span", "", `${(c.s_m / 1000).toFixed(2)} km · ${c.direction} · ${Math.abs(c.headingChange_deg).toFixed(0)}°`),
               el("strong", "", relText));
    row.addEventListener("click", () => {
      monacoSelect(c.index);
      if (monacoState.three){
        const t = monacoState.three;
        t.flyTo({ theta: t.cam.theta, phi: 0.75, dist: t.radius * 1.5 }, c.label);
      }
    });
    feats.appendChild(row);
  });
  host.append(el("h3", "", "TURNS DETECTED FROM THE CENTRELINE"),
              el("p", "muted-small",
                 `${(monacoState.cornerIndex || []).length} points of significant heading ` +
                 `change, measured from the OpenStreetMap geometry. Positions are exact; ` +
                 `these are not corner names.`),
              feats);

  /* Published corner names — real names, no asserted positions */
  const named = el("div", "monaco-named-list");
  (circuit.publishedCorners || []).forEach((name, i) => {
    const row = el("div", "monaco-named-row");
    row.append(el("span", "monaco-corner-n", "T" + (i + 1)), el("span", "", name));
    named.appendChild(row);
  });
  host.append(el("h3", "", "PUBLISHED CORNER NAMES"),
              el("p", "muted-small",
                 `The official running order. APEX does not claim a map position for ` +
                 `each name: no verifiable corner coordinates were available, so none ` +
                 `are invented. The hairpin is the exception — it is identified above, ` +
                 `because it is the only corner where the road doubles back.`),
              named);

  /* Provenance — every claim traced to a source */
  const prov = el("div", "monaco-provenance");
  prov.append(el("h3", "", "DATA SOURCES & LIMITATIONS"));
  const list = el("ul", "monaco-source-list");
  const li = text => { const n = el("li", "", text); list.appendChild(n); };

  li(`Geometry: ${circuit.geometry.source} (${circuit.geometry.licence}), retrieved ${circuit.geometry.retrieved}. ` +
     `${circuit.geometry.count} centreline vertices, unmodified.`);
  if (monacoState.elevation){
    li(`Elevation: ${monacoState.elevation.dataset} via ${monacoState.elevation.source}, ` +
       `sampled ${new Date(monacoState.elevation.fetchedAt).toLocaleString("en-IN")}. ` +
       `${monacoState.elevation.pointCount} points, vertical datum ${monacoState.elevation.verticalDatum}.`);
    li("A DEM measures the terrain surface, not the road deck. Through the tunnel the sample reads " +
       "the ground above the road, so that section of the profile is not a measurement of the track.");
  } else {
    li("Elevation: not loaded. The circuit is drawn flat. Nothing here is estimated or filled in.");
  }
  li(`Relative elevation is computed as ${datum ? datum.formula : "sample[i] − min(samples)"}. ` +
     `The lowest sampled point is 0 m by construction; every other value is its height above that point. ` +
     `This is deliberately NOT the same as height above sea level.`);
  li(`Vertical exaggeration ×${monacoPrefs().exaggeration} is applied to the 3D view for legibility. ` +
     `All stated metres are true, unexaggerated values.`);
  li(`Published elevation change: ${pub.elevationChangeSource}`);
  li(pub.lowestPointNote);
  li(circuit.cornersNote);
  li(circuit.sectors.note);
  prov.appendChild(list);
  host.appendChild(prov);
}

/* Release GPU resources when the user navigates away from Monaco. */
function monacoTeardown(){
  if (monacoState.three){
    try { monacoState.three.dispose(); } catch (e) {}
    monacoState.three = null;
  }
}

window.renderMonaco = renderMonaco;
window.monacoTeardown = monacoTeardown;
window.ApexMonaco = {
  state: monacoState,
  computeDatum: monacoComputeDatum,
  loadCircuit: monacoLoadCircuit,
  fetchElevation: monacoFetchElevation,
  buildCornerIndex: monacoBuildCornerIndex,
  DEM: MONACO_DEM
};
