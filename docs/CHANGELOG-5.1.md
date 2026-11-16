# APEX 5.1

Repair release. Fixes the "data disappears after midnight" bug at its root,
hardens storage, restores and extends import/export, overhauls the quote
system, and adds the Monaco GP 3D circuit.

**No data was ever deleted by the bug.** It was a rendering failure caused by
a crash during initialisation. See the README for the full diagnosis.

## Fixed

- **Midnight data loss.** `$` was declared `const` at line ~274 of
  `script.js` but reached from top-level code at line ~216 via
  `restoreTimerState() -> finishTimer() -> apexNotify() -> toast()`. The
  temporal-dead-zone `ReferenceError` aborted the file, so every module below
  — study database, quotes, fitness, calendar, habits, garage — never
  initialised. Trigger: a focus timer that expired while the app was closed.
- **The 75 XP major targets vanishing.** `typeof` throws on a `let` in the
  temporal dead zone, so `xpRef.studyRecords()` threw when `script.js` had
  aborted, taking `xpSnapshot()`, `xpCheckMilestones()` and `xpBoot()` with
  it. Each accessor is now individually guarded.
- **XP "today" counted the wrong day.** Ledger entries were bucketed by
  `at.toISOString().slice(0,10)` (UTC) against a local "today". In IST,
  everything earned before 05:30 was filed under yesterday.
- **Silent write failures.** `writeStorage()` return values were ignored by
  `saveTasks()`, `saveFit()` and `saveEvents()`.
- **Read failures looked like empty data.** Every storage failure returned the
  fallback, which callers then saved over the real records.
- **Snapshot timing.** The daily snapshot ran before `platform.js` defined the
  key list, capturing nothing. Now deferred to `load`.
- **Corrupt values could poison a backup.** Export wrote unparseable values
  verbatim, producing a file this application's own validator refuses.

## Added

- `core.js` — `ApexDate` (one local-timezone date system, DST-safe noon
  anchoring, midnight rollover via timer + visibility + clock-drift poll),
  `ApexStore` (verified writes, corrupt-value quarantine, IndexedDB mirror
  with boot recovery, 14 rolling daily snapshots), `ApexBoot` (module
  isolation).
- `quotes.js` — 110 built-in quotes, personal library kept separate, merge or
  replace imports, duplicate detection, built-in / personal / both modes,
  deterministic per-day selection keyed on the date rather than a stored index.
- Versioned, checksummed backup with merge-or-replace and a safety snapshot
  before every import.
- Dedicated XP and level export/import. (Did not exist in 4.7 or 5.0 — both
  were checked. New work, not a restoration.)
- `monaco.js` + `monaco.css` — 3D Circuit de Monaco with a relative elevation
  datum, synchronised elevation profile, cinematic camera and full provenance.
- `tools/fetch-monaco-elevation.mjs` — optional DEM pre-baking.
- PWA: `manifest.webmanifest`, `sw.js`, icons.
- `docs/MONACO-DATA.md`, rewritten `docs/STORAGE.md`, `docs/TEST-REPORT-5.1.md`.

## Changed

- `APEXDB` v1 -> v2. **Additive only**: `studyRecords` is never dropped,
  cleared or recreated. Adds `kv` and `backups` stores.
- All original localStorage key names unchanged. Upgrading from 5.0 preserves
  everything in place with no migration step.
- `readStorage` / `writeStorage` / `localDateKey` keep their signatures and
  delegate to the core engine, so every existing caller works unmodified.

## Removed

- `backup/APEX-4.7-original.zip` — an old build artefact, not source. It was
  inspected during the audit (and is where the "XP import/export existed
  before" question was settled) but does not belong in a clean repository.
- Hand-entered Monaco corner coordinates. Checked against the geometry, some
  sat over 300 m from the corner they named. Deleted rather than shipped.

## Preserved

Every 5.0 module is intact and verified rendering: study (timer, logger,
analytics, heat map), tasks, fitness, habits, calendar with alerts,
progression, Emirates Stadium, APEX Garage, the watch face, toasts and
notifications. No redesign; the existing palette, typography and layout
conventions are unchanged.
