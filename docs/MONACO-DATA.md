# Monaco circuit data — sources, derivation and limitations

Every number the Monaco page shows falls into one of three categories, and the
application keeps them visibly apart:

| Category | Meaning | Example |
|---|---|---|
| **Measured** | APEX computed it from source data | Centreline length, 3324.3 m |
| **Published** | Cited from a source, used for comparison only | Circuit length, 3337 m |
| **Derived** | Computed from measured data by a stated rule | Relative elevation |

Nothing is estimated, interpolated to look plausible, or filled in.

---

## 1. Geometry

**Source:** [`bacinger/f1-circuits`](https://github.com/bacinger/f1-circuits),
`circuits/mc-1929.geojson`, retrieved 2026-11-16.
**Upstream:** OpenStreetMap. **Licence:** ODbL 1.0, (c) OpenStreetMap contributors.

A closed 160-point `LineString`; the duplicated closing vertex is dropped,
leaving **159 unique vertices**.

### Validation

| | |
|---|---|
| Measured polyline length (haversine, R = 6 371 008.8 m) | **3324.3 m** |
| Published circuit length (Wikidata Q171400 / Wikipedia) | **3337 m** |
| Difference | **−12.7 m, 0.38%** |

0.38% is the agreement you would expect between a road centreline and an
officially surveyed racing line, which is measured around the ideal line
rather than down the middle of the road. It is good evidence the geometry is
genuine.

**No vertex was moved, added, smoothed or invented.** The only transformations
are a rotation of the point order, cumulative distance, and a projection.

### Projection

Local equirectangular about the circuit centroid (43.737143 N, 7.425289 E):

```
x = (lon − originLon) × metresPerDegLon      metres east
y = (lat − originLat) × metresPerDegLat      metres north
```

with the degree lengths evaluated at the centroid latitude. Over a 735 m ×
973 m bounding box the distortion is far below the resolution of anything
displayed.

### Start/finish

The published "circuit coordinate" (43.7347 N, 7.4206 E) is a centroid-style
reference for the circuit as a whole, **not the grid** — it lies outside the
circuit's own bounding box. An early draft used it as the lap origin and put
Sainte-Dévote a quarter of the way into the lap.

Instead, the origin is placed geometrically from a published fact: the grid is
on **Boulevard Albert 1er**, the straight along the south-west side of the
harbour. APEX finds every straight run (heading change below 30° per vertex),
keeps those whose midpoint lies south-west of the circuit centroid, and takes
the longest. The ring is rotated so that run begins at index 0.

Result: **43.73637 N, 7.42133 E.**

This is reproducible and tied to a published fact. **The exact position of the
painted start/finish line is not in the source data, and APEX does not guess
it.** Lap distances are measured from this derived origin and labelled as
such.

---

## 2. Corners

Two **separate** lists, because two different kinds of claim are involved.

### `curvatureFeatures` — derived

23 local maxima of heading change along the centreline, found with a ±2-vertex
window and non-maximum suppression. Each carries its vertex index, lap
distance, coordinates, heading change and turn direction.

Every one sits **exactly on a real centreline vertex**. The offset is zero by
construction, not "approximately right".

### `publishedCorners` — published

The 14 official corner names in running order (Wikipedia, Automobile Club de
Monaco circuit maps). **No coordinates**, because no verifiable corner
coordinates were available.

### Why they are not merged

An earlier draft hand-entered corner coordinates read off a published circuit
map and matched each to the nearest vertex. Checked against the geometry, the
offsets were:

```
T7  Mirabeau Bas          77 m
T8  Portier              177 m
T9  Tunnel               316 m
T12 Piscine (entry)      310 m
T16 La Rascasse          222 m
```

A label 316 m from the corner it names is a fabricated claim dressed as data,
on a circuit only 3.3 km round. The coordinates were deleted rather than
shipped.

Assigning published names to detected peaks by running order was also
rejected: 23 features were detected against 14 published names, so the
alignment cannot be established without a verified anchor for each.

### The one exception: the hairpin

The hairpin **is** asserted, on two independent grounds:

1. **Geometrically unique.** 328° of heading change — the only point on the
   circuit where the road doubles back. The next sharpest is 250°.
2. **Position checks out.** Detected at 43.74022 N, 7.42968 E, beside the
   Fairmont Monte Carlo, which is where the Fairmont (formerly Loews/Grand
   Hotel) Hairpin is.

It falls 34% into the lap, consistent with the published lap structure.

---

## 3. Elevation

**Not bundled with this repository.** APEX ships no elevation numbers it did
not measure.

### How it is obtained

Either:

- **In the app** — the Monaco page offers *FETCH ELEVATION DATA*, samples all
  159 vertices against a public DEM in two requests, and caches the result in
  IndexedDB permanently. This is the only network request APEX ever makes.
- **Pre-baked** — `node tools/fetch-monaco-elevation.mjs` writes
  `src/data/monaco-elevation.json`, so the circuit shows relief offline from
  first launch.

| Source | Dataset | Vertical datum |
|---|---|---|
| Open-Meteo Elevation API (default) | Copernicus DEM GLO-90 | EGM2008 geoid |
| OpenTopoData (`--source opentopodata`) | SRTM 30 m | EGM96 geoid |

Until elevation is loaded, the circuit renders **flat**, the UI says
"Elevation not loaded", and the profile says the same. Nothing is substituted.

### The datum

```
relative[i] = sample[i] − min(samples)
```

The lowest sampled point becomes exactly **0.000 m** by construction. Every
other point is its height **above that point** — not above sea level. Absolute
height is retained and displayed separately; the two are never mixed.

The 3D view draws a horizontal 0 m reference plane and vertical stems from the
track surface down to it, so section heights are directly readable.

### Verified in the test suite

With a synthetic dataset of known minimum 10 m and maximum 40 m:

- lowest point reports exactly 0 m
- no negative relative values
- highest relative value equals the range
- **every** point verified as `sample − min`
- absolute (10 m ASL) and relative (0 m) stay distinct

### Vertical exaggeration

Default ×3, user-adjustable 1–10, **always shown on screen**. It affects
rendering only. Every metre figure quoted in the readout, the profile, the
corner list and the info panel is the true, unexaggerated value.

---

## 4. Limitations — read this before trusting a number

**A DEM measures the terrain surface, not the road deck.** This matters at
Monaco more than almost anywhere:

- **The tunnel.** For roughly 380 m the circuit runs under the Fairmont. The
  DEM reads the hillside *above* the road — tens of metres too high. That
  section of the profile is terrain, not track.
- **Overhangs and built-up sections.** Monaco is dense and vertical. A 90 m
  DEM cell may be dominated by a building rather than the carriageway.
- **Resolution.** Copernicus GLO-90 is ~90 m; SRTM 30 m is ~30 m. On a circuit
  8–12 m wide, a single cell can span the track and the buildings beside it.

**Consequently the DEM-derived range will not match the published figure, and
must not be edited to.**

Published figures themselves disagree:

| Figure | Where it appears |
|---|---|
| 41 m | lapmeta |
| **42 m** | Wikipedia, F1 circuit guides, most commonly cited |
| 44 m | several circuit guides |

Sources also disagree on the **lowest point** — some name La Rascasse (T17),
others the Piscine/harbour section. APEX asserts neither. It reports whichever
sampled point is lowest in the loaded data and says so.

The app shows the published range beside the measured datum, labelled "for
comparison", and never silently reconciles the two.

---

## 5. What is deliberately absent

- **Buildings.** The surrounding massing blocks are abstract, placed from
  track geometry, and switchable off. They are not mapped architecture and are
  not presented as Monaco's skyline.
- **Official timing sectors.** F1's sector boundaries for Monaco are not
  published as coordinates. APEX divides the lap into equal-distance thirds
  and labels them "equal thirds" rather than implying official splits.
- **Track width.** Drawn at a nominal 10 m. Monaco's narrowest point is
  published as about 8 m; the real width varies and is not in the source data.
  Labelled as nominal.
- **Banking and camber.** Not in any available source. Not modelled.
