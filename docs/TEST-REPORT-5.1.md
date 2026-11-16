# APEX 5.1 — test report

Run on 16 November 2026 against the built application in headless Chromium
(Playwright), **timezone `Asia/Kolkata` (UTC+5:30)** so that local-versus-UTC
date bugs actually surface rather than hiding behind a UTC-aligned clock.

The application was served over HTTP, not `file://`, because `fetch()` and
service workers do not work on the filesystem protocol.

Result: **121 of 121 checks passed, 0 failed**

Source: `t/suite.py` in the working tree used to produce this build.

---

## Results

```
=== A. CLEAN LAUNCH ===
  [PASS] Built-in quotes present on a fresh install  — 110 quotes
  [PASS] A quote displays immediately, no import needed  — “The man who moves a mountain begins by carrying away small 
  [PASS] Quote has an attribution  — — Confucius
  [PASS] All modules present incl. Monaco  — study,tasks,fitness,calendar,habits,progression,stadium,monaco
  [PASS] No boot failures
  [PASS] No page errors on launch
  [PASS] Local date key is local, not UTC
=== B. DATA PERSISTENCE ACROSS REFRESH ===
  [PASS] Study record survives refresh  — 1 record(s), Physics
  [PASS] Fitness record survives refresh
  [PASS] Calendar event survives refresh
  [PASS] Task survives refresh
=== C. 75 XP MAJOR TASKS + IDEMPOTENCE ===
  [PASS] Major task reward is 75 XP  — 75 XP
  [PASS] First award grants 75 XP
  [PASS] Repeat clicks award nothing  — 2nd=0, 3rd=0
  [PASS] Total rose by exactly 75  — 0 -> 75
  [PASS] Completing a task awards XP once
  [PASS] Re-ticking a task awards nothing more  — 90 -> 90
  [PASS] XP survives refresh without re-awarding  — 90 -> 90
=== D. MIDNIGHT CROSSING (the original bug) ===
  [PASS] Study history survives midnight  — 1 -> 1
  [PASS] Fitness history survives midnight
  [PASS] Calendar survives midnight
  [PASS] Task definitions survive midnight
  [PASS] XP survives midnight (never decreases)  — 90 -> 100
  [PASS] ...and the rise is exactly the overnight focus session, nothing else  — +10 XP (focusSession = 10)
  [PASS] Quotes still display after midnight  — “Success is where preparation and opportunity meet.”
  [PASS] Fitness module still initialises after midnight
  [PASS] Calendar module still initialises after midnight
  [PASS] No boot failures after midnight
  [PASS] Expired overnight timer handled without crashing  — Session complete. Well done. Duration pre-filled i
  [PASS] ORIGINAL BUG FIXED: no '$ before initialization' error
=== E. XP 'TODAY' USES THE LOCAL DAY (IST) ===
  [PASS] A 01:00 IST entry has a UTC date of the previous day (bug precondition)  — UTC slice 2026-11-16 vs local 2026-11-17
  [PASS] ...but APEX files it under the correct LOCAL day
  [PASS] ...and it counts towards XP TODAY  — +52 today
=== F. QUOTES: IMPORT, PERSISTENCE, MODES ===
  [PASS] Import parses 'Quote | Author'  — Jim Rohn
  [PASS] Import parses a trailing dash author  — Ryan Holiday
  [PASS] Blank lines and # comments ignored, duplicates skipped  — 3 added from 4 quote lines (1 was a duplicate)
  [PASS] Re-importing the same file adds nothing  — 4 duplicates skipped
  [PASS] Built-in library untouched by import
  [PASS] Personal quotes survive a refresh  — 3 quotes
  [PASS] BUILT-IN mode pool  — 110
  [PASS] PERSONAL mode pool  — 3
  [PASS] BOTH mode pool is the sum  — 113
  [PASS] Empty personal library falls back to built-ins, never blank  — 110
  [PASS] Same day gives the same quote on repeat calls  — We suffer more often in imagination than in r
  [PASS] A new day can give a different quote
=== G. STORAGE INTEGRITY ===
  [PASS] Corrupt value is quarantined, not discarded
  [PASS] The original raw bytes are preserved  — {{{not json
  [PASS] Caller gets the fallback so the UI still renders
  [PASS] Write is verified by read-back
  [PASS] Storage health reports correctly  — 2 KB used, 0 pending
  [PASS] Writes are mirrored into IndexedDB  — 12 keys mirrored
  [PASS] Daily snapshot taken  — 2 snapshot(s)
  [PASS] Evicted localStorage key recovered from the IndexedDB mirror  — 1 events lost then recovered: ['apexEvents']
=== H. IMPORT / EXPORT ===
  [PASS] Export is versioned  — schema v2, app 5.1
  [PASS] Export carries a timestamp
  [PASS] Export carries an integrity checksum  — 424f0603
  [PASS] Its own export validates
  [PASS] Export contains the real records  — {"keys": 11, "studyRecords": 1, "tasks": 1, "events": 1, "fitness": 1, "habits": 0, "habitLogs": 0, "quotes": 3, "totalXP": 100}
  [PASS] Non-APEX file rejected
  [PASS] Future schema version rejected
  [PASS] Corrupt section rejected (no partial import)  — The "apexTasks" section is corrupt and could not be read.
  [PASS] Edited file is flagged by the checksum  — The integrity check does not match — this file may have been edited or truncated.
  [PASS] XP export is a separate versioned channel
  [PASS] XP export carries level and transactions  — level 2, 3 txns, 100 XP
  [PASS] Valid XP file accepted
  [PASS] Negative XP rejected
  [PASS] Implausible XP rejected
  [PASS] Non-numeric XP rejected
  [PASS] Level/XP mismatch detected and recomputed  — The file says level 99, but 100 XP is level 2 on this build's curve. The level has been recomputed from the XP.
  [PASS] Malformed backup import refused
  [PASS] Malformed XP import refused
  [PASS] Failed imports left existing data untouched  — {'tasks': 1, 'xp': 100} -> {'tasks': 1, 'xp': 100}
  [PASS] Clean environment starts empty  — {"study": 0, "events": 0}
  [PASS] Import into a clean environment succeeded  — Import complete (replace). 11 data sets replaced · 1 study records res
  [PASS] Round-trip restored study  — 1 -> 1
  [PASS] Round-trip restored fitness  — 1 -> 1
  [PASS] Round-trip restored events  — 1 -> 1
  [PASS] Round-trip restored tasks  — 1 -> 1
  [PASS] Round-trip restored quotes  — 3 -> 3
  [PASS] Round-trip restored XP  — 100 -> 100
  [PASS] Merge adds only new records, keeps existing  — 1 -> 2
=== I. MONACO VISUALISATION ===
  [PASS] Circuit geometry loads  — 159 vertices
  [PASS] Measured length matches published within 1%  — 3324.3 m vs 3337 m (0.38%)
  [PASS] Geometry carries its licence  — ODbL 1.0 - (c) OpenStreetMap contributors
  [PASS] Distance starts at 0 at start/finish and increases
  [PASS] Derived turns sit exactly on the centreline (zero offset)  — 23 turns detected
  [PASS] Published corner names listed separately  — 14 published names
  [PASS] Hairpin identified: only corner that doubles back  — 328 deg of heading change
  [PASS] Hairpin located beside the Fairmont Monte Carlo  — 43.7402N 7.4297E
  [PASS] Hairpin falls about a third into the lap (published structure)  — 34% of the lap
  [PASS] Datum: lowest point is exactly 0 m  — 0 m
  [PASS] Datum: no negative relative heights
  [PASS] Datum: highest point equals the range  — +30 m == range 30 m
  [PASS] Datum: every point verified as sample − min  — relative[i] = sample[i] - min(samples)
  [PASS] Datum: absolute and relative kept distinct  — lowest is 10 m ASL but 0 m relative
  [PASS] 3D canvas renders  — canvas present
  [PASS] Circuit info panel populated  — 7 facts
  [PASS] Turn list populated  — 23 turns
  [PASS] Published names shown separately
  [PASS] Data provenance shown to the user  — 8 source notes
  [PASS] No-elevation state is stated honestly, not faked  — Elevation not loaded — the circuit is shown flat
  [PASS] Fetch-elevation control offered  — FETCH ELEVATION DATA
  [PASS] Monaco does not disturb other modules' data  — study 1, events 1
  [PASS] Monaco tears down its WebGL context on leave
  [PASS] No boot failures after visiting Monaco
=== J. PRESERVED MODULES + RESPONSIVENESS ===
  [PASS] Module 'home' renders  — 112 nodes
  [PASS] Module 'study' renders  — 352 nodes
  [PASS] Module 'tasks' renders  — 23 nodes
  [PASS] Module 'fitness' renders  — 120 nodes
  [PASS] Module 'calendar' renders  — 182 nodes
  [PASS] Module 'habits' renders  — 116 nodes
  [PASS] Module 'progression' renders  — 197 nodes
  [PASS] Module 'stadium' renders  — 235 nodes
  [PASS] Module 'monaco' renders  — 17 nodes
  [PASS] APEX Garage preserved
  [PASS] Watch feature preserved
  [PASS] XP home strip preserved
  [PASS] No horizontal overflow at 390px (iPhone)  — scrollWidth vs 390
  [PASS] Monaco renders on mobile  — stage 318px tall
  [PASS] No boot failures on mobile
  [PASS] No page errors on mobile
======================================================================
======================================================================
```

---

## What each section proves

### A — Clean launch
A fresh install shows a real quote with an attribution immediately, from the
110 built-in quotes. No import required, no empty state. All nine modules
present. Zero boot failures, zero page errors.

### B — Persistence across refresh
Study, fitness, calendar and task records written through the real save paths
(IndexedDB for study, localStorage for the rest) all survive a reload.

### C — 75 XP major tasks and idempotence
`APEX_XP.values.milestone` is confirmed at **75 XP**. Awarding the same
milestone key three times grants 75, then 0, then 0, and the total rises by
exactly 75. Completing a task awards once; untick-and-retick awards nothing
more. XP survives a refresh without re-awarding.

### D — The midnight crossing
This reproduces the **original failure** exactly: a focus timer set running,
the app closed, the timer expiring overnight, and the app reopened on the next
local calendar day.

Before 5.1 this threw `Cannot access '$' before initialization` at top level
and silently killed every module below line 216. The suite asserts that error
is gone, that study, fitness, calendar, task and XP data all survive, that the
quote still displays, that the fitness and calendar modules still initialise,
and that there are zero boot failures.

XP is asserted never to *decrease*. It legitimately rises by exactly 10 — the
overnight focus session really did complete and is credited after `load`
rather than mid-declaration.

### E — XP "today" uses the local day
Constructs a transaction at 01:00 IST, whose UTC date is the *previous* day,
and proves APEX files it under the correct local day and counts it towards
"XP TODAY". This is the bug that made real work show as `+0 TODAY`.

### F — Quotes
Both author formats parse. Blank lines and `#` comments are ignored,
duplicates skipped, re-importing the same file adds nothing. The built-in
library is untouched by imports. Personal quotes survive a refresh. All three
library modes produce the right pool sizes, and an empty personal library in
PERSONAL mode falls back to the built-ins rather than showing nothing. The
same day yields the same quote on repeat calls; a different day can differ.

### G — Storage integrity
A corrupt value is quarantined with its original bytes intact, and the caller
gets a fallback so the UI still renders. Writes are verified by read-back and
mirrored to IndexedDB. A localStorage key deleted to simulate iOS eviction is
recovered from the mirror.

### H — Import and export
Export is versioned, timestamped and checksummed, and validates against its
own validator. Non-APEX files, future schema versions and corrupt sections are
all refused. An edited file is caught by the checksum. The XP channel rejects
negative, implausible and non-numeric totals, and recomputes a mismatched
level from the XP. **Failed imports leave existing data byte-identical.** A
full round trip into a clean environment restores study, fitness, events,
tasks, quotes and XP. Merge adds only new records.

### I — Monaco
Geometry loads and measures within 0.38% of the published length. Derived
turns sit exactly on centreline vertices. The hairpin is identified by its 328
degrees of heading change, located beside the Fairmont Monte Carlo, 34% into
the lap. Datum maths verified against a synthetic dataset of known minimum and
maximum: lowest point exactly 0 m, no negatives, range equals the highest
relative value, every point verified as `sample - min`, absolute and relative
kept distinct. The no-elevation state is confirmed to state itself honestly
rather than render fake relief. Monaco disturbs no other module's data and
tears down its WebGL context on leave.

### J — Preserved modules and responsiveness
All nine pages render. The Garage, watch and XP strip are intact. At 390 px
(iPhone 14/15 width, touch, DPR 3) there is no horizontal overflow, Monaco
renders, and there are no errors.

---

## NOT TESTED — stated honestly

These were **not** verified and should not be assumed to work:

1. **Live DEM elevation fetch.** The sandbox blocks every elevation host
   (Open-Meteo, OpenTopoData, open-elevation). The request-building, batching,
   retry and failure paths were exercised — `tools/fetch-monaco-elevation.mjs`
   ran, built its request, retried four times, failed on the network and
   correctly refused to write a partial file. But **no real elevation data was
   ever retrieved**, so the end-to-end fetch, the datum against real Monaco
   heights, and the rendered relief are unverified. Run it on a connected
   machine before relying on it.

2. **Real WebGL rendering quality.** Headless Chromium uses SwiftShader. The
   canvas is confirmed to exist and the scene graph builds without error, but
   **nobody has looked at the picture.** Visual quality, framerate, camera
   feel and the cinematic sequence are unverified.

3. **Actual iPhone / iOS Safari.** Tested with Playwright's emulated viewport
   and touch, not on hardware. iOS-specific behaviour — PWA install, storage
   eviction, WKWebView quirks, pinch zoom, safe-area insets — is unverified.

4. **The Tauri desktop builds.** No Rust toolchain in the sandbox.
   `src-tauri/` is carried forward unchanged from 5.0 and was not rebuilt.

5. **Service worker lifecycle.** `sw.js` parses and the registration is
   guarded, but install, activate, offline serving and version-to-version
   cache cleanup were **not** exercised.

6. **Notifications and audio.** Browser notifications need permission and the
   chime needs an audio context after a user gesture. Neither was triggered.

7. **Long-run and large-dataset behaviour.** Tested with single-digit record
   counts over seconds. Behaviour with thousands of records across months,
   and localStorage quota exhaustion from a large watch photo, is reasoned
   about in the code but not measured.

8. **A real DST transition.** `ApexDate` anchors at local noon specifically to
   survive one, and India does not observe DST, so the path was never
   exercised.

9. **Migration from a real 5.0 installation.** Tested with synthetic data in
   the original key names. No genuine user profile was migrated.
