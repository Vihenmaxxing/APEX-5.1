# APEX 5.1 — Study Command Centre

A single-page, offline-first productivity application: focus timer, study
logger and analytics, task control, fitness tracking, habit system, day
planner, XP progression, an interactive Emirates Stadium, the APEX Garage,
and a 3D Circuit de Monaco with a relative elevation datum.

Everything is stored on the device. There is no account, no server, and no
telemetry. The only network request APEX ever makes is an optional, explicit,
one-off elevation lookup for the Monaco page.

---

## What changed in 5.1

5.1 is a repair release. The headline is that **the "data disappears after
midnight" bug is fixed, and no data was ever actually deleted**.

### The midnight bug — root cause

`script.js` is one long classic script whose modules initialise at top level,
one after another, in a single pass. An exception anywhere stops the whole
file, and every module below that line never starts.

The trigger was a focus timer left running when the app was closed:

1. A timer is started in the evening; the app is closed.
2. The timer expires overnight.
3. On the next launch, `restoreTimerState()` (line ~216) sees a `running`
   timer whose `endTime` has passed and calls `finishTimer()`.
4. `finishTimer()` -> `apexNotify()` -> `toast()` -> reads `$`.
5. `$` was declared `const` at line ~274 — 58 lines further down, and
   therefore in the **temporal dead zone**.
6. `ReferenceError: Cannot access '$' before initialization`, thrown at top
   level.

Everything after line 216 never ran: the study database never opened (its
initialiser is the *last* statement in the file), the quote library never
rendered, and fitness, the calendar, habits and the garage never initialised.

`xp.js` is a separate `<script>` element, so it still ran — **which is exactly
why the XP bar kept its value while everything else looked deleted.**

`localStorage` was intact the entire time. It was a rendering failure that
looked identical to data loss.

A second, related failure made the 75 XP major targets vanish: `typeof` throws
on a `let` in the temporal dead zone, so `xpRef.studyRecords()` threw,
`xpSnapshot()` threw, `xpCheckMilestones()` threw, and the MAJOR TARGETS grid
never rendered.

### The fixes

| Area | Change |
|---|---|
| **Root cause** | `$` hoisted out of the temporal dead zone; the expired-timer path deferred until after `load` instead of running mid-declaration |
| **Blast radius** | Every top-level startup step wrapped in `ApexBoot.step()`, so one failing module can never take the others down again |
| **XP resilience** | Every cross-file accessor individually guarded — a half-initialised `script.js` degrades to "no records yet" instead of killing the XP engine |
| **Dates** | One local-timezone date system (`ApexDate`). No UTC anywhere a calendar day is meant |
| **XP "today"** | Ledger entries now carry a local `day` key. The old code read a local day out of a UTC string, which in IST filed everything before 05:30 under yesterday |
| **Midnight** | A real rollover handler re-renders date-sensitive views. It deletes nothing |
| **Storage** | `ApexStore`: verified writes, corrupt values quarantined rather than discarded, IndexedDB mirror with boot recovery, 14 rolling daily snapshots |
| **Quotes** | 110 built-in quotes; personal library kept separate; merge/replace; three library modes |
| **Backup** | Versioned, validated, checksummed; merge *or* replace; safety snapshot before every import |
| **XP transfer** | New dedicated XP/level export and import channel |
| **Monaco** | New 3D circuit module with a relative elevation datum |
| **PWA** | Manifest, icons and a shell-caching service worker added |

---

## Running it

APEX is static files. No build step, no bundler, no dependencies to install.

```bash
cd src
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works. Opening `index.html` directly from the filesystem
mostly works too, but `file://` has no service worker and `fetch()` is blocked,
so the Monaco page and offline support need `http://` or `https://`.

### Deploying

Push the repository and serve `src/` as the site root. On GitHub Pages, set
the source to the branch and `/src` folder. Everything is relative-path, so it
works from a subdirectory.

HTTPS is required for the service worker, notifications and PWA install.

### Desktop and iOS

`src-tauri/` holds the Tauri configuration for the Windows and macOS builds;
see `docs/BUILD.md`. `docs/IOS.md` covers the iOS app. On iPhone you can also
just open the site in Safari and use Share -> Add to Home Screen.

**Each platform has its own storage.** The browser, the installed PWA, the
Tauri window and the iOS app do not share data. Use the backup file to move
between them.

---

## Data storage

See `docs/STORAGE.md` for the full architecture. In short:

| Layer | Holds | Why |
|---|---|---|
| `localStorage` | tasks, habits, fitness, events, quotes, XP state and ledger, preferences | Small, synchronous — the modules read it at load time |
| **IndexedDB** `studyRecords` | study records | Unbounded growth |
| **IndexedDB** `kv` | a mirror of every `localStorage` key | Survives localStorage eviction; this is what makes data recoverable |
| **IndexedDB** `backups` | 14 rolling snapshots | Automatic safety net |

`ApexStore` verifies every write by reading it back. A write that cannot be
confirmed is queued and retried, and the caller is told it failed. A value
that will not parse is **quarantined** under `apex.corrupt.<key>.<timestamp>`
rather than discarded, because treating a read failure as "no data" is how the
original code could lose records.

### Backup and recovery

Progression page -> **APEX DATA**.

- **EXPORT ALL DATA** — one versioned, checksummed JSON file with everything.
- **IMPORT DATA** — shows you what is in the file, then asks for **merge** or
  **replace**. A safety snapshot is taken first, either way.
- **EXPORT / IMPORT XP & LEVEL** — progression on its own. The level is always
  recomputed from the XP total, so the two cannot disagree.
- **AUTOMATIC SNAPSHOTS** — restore any of the last 14 daily snapshots.
- **STORAGE HEALTH** — warns you before storage problems cost you anything.

A malformed file is refused before anything is written. There are no partial
imports.

> **GitHub does not back up your records.** It stores source code. Export a
> backup file and keep it somewhere you control.

---

## The Monaco visualisation

A 3D Circuit de Monaco where **the lowest point on the circuit is 0 m** and
every other point is reported as its height above that point:

```
relative[i] = sample[i] - min(samples)
```

Absolute height above sea level is kept and shown separately; the two are
never mixed.

**Geometry is real.** A 159-vertex centreline derived from OpenStreetMap,
measuring 3324.3 m against a published 3337 m — 0.38%, which is the agreement
you would expect between a polyline centreline and a surveyed racing line. No
vertex was invented or moved.

**Elevation is measured, not bundled.** On first open, the Monaco page offers
to sample the circuit against a public digital elevation model and caches the
result permanently. Until you do that, the circuit renders **flat and says
so** — nothing is estimated to fill the gap. You can also pre-bake the data
with `node tools/fetch-monaco-elevation.mjs`.

**What APEX does not claim.** Published corner names are listed in running
order, but APEX does not assert a map position for each one: no verifiable
corner coordinates were available, so none were invented. Detected turns are
shown separately, derived from the centreline's own curvature, so each sits
exactly on the track. The hairpin is the single exception — it is the only
corner where the road doubles back, and its detected position falls beside the
Fairmont Monte Carlo.

Full provenance, including the limitations of a surface DEM in the tunnel, is
in `docs/WINDOWS-BUILD.md  docs/MONACO-DATA.md` and is also shown in the app.

---

## Testing

`docs/TEST-REPORT-5.1.md` has the results. The suite runs 121 assertions in
headless Chromium with the timezone set to Asia/Kolkata (UTC+5:30), so
local-versus-UTC bugs actually surface. It covers the midnight crossing, XP
idempotence, storage corruption and eviction, import/export round trips and
rejection of malformed files, the quote system, and the Monaco datum maths.

All 121 pass. What was **not** tested is listed honestly in the report.

---

## Project layout

```
src/
  index.html              entry point and navigation
  core.js                 ApexDate, ApexStore, ApexBoot        (new in 5.1)
  quotes.js               built-in library, imports, modes     (new in 5.1)
  script.js               tasks, timer, study, habits, fitness, watch, calendar, garage
  xp.js                   XP, levels, ledger, major targets
  stadium.js              Emirates Stadium
  monaco.js               Monaco 3D circuit                    (new in 5.1)
  platform.js             platform detection, backup/restore, XP transfer
  style.css  stadium.css  monaco.css  mobile.css
  data/monaco-circuit.json
  vendor/three.module.min.js
  manifest.webmanifest  sw.js  icons/
tools/
  fetch-monaco-elevation.mjs
docs/
  STORAGE.md  MONACO-DATA.md  TEST-REPORT-5.1.md  CHANGELOG.md  BUILD.md  IOS.md
src-tauri/
```

---

## Credits and licences

- **Circuit geometry** — [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits),
  derived from OpenStreetMap. ODbL 1.0, (c) OpenStreetMap contributors.
- **Elevation** — Copernicus DEM GLO-90 via the Open-Meteo Elevation API, or
  SRTM 30 m via OpenTopoData. Fetched at runtime, never redistributed here.
- **three.js** r169 — MIT. Vendored at `src/vendor/`, licence alongside it.
- **Quotations** — attributions are restricted to quotations reliably
  attributed to the named person. Lines of disputed or proverbial origin are
  marked as such rather than given a false author.

No Formula 1, FIA, Automobile Club de Monaco or Arsenal FC trademark, logo or
official typeface is reproduced. The stadium and car artwork is original,
drawn in code.
