# Files added, modified and removed in 5.1

## Added
```
src/core.js                      ApexDate, ApexStore, ApexBoot
src/quotes.js                    built-in library, imports, modes, settings card
src/monaco.js                    Monaco 3D circuit + elevation datum
src/monaco.css                   Monaco styles (existing design language)
src/data/monaco-circuit.json     159-vertex OSM centreline + provenance
src/vendor/three.module.min.js   three.js r169 (MIT)
src/vendor/THREE-LICENSE.txt
src/manifest.webmanifest         PWA manifest
src/sw.js                        shell-caching service worker
src/icons/apex-180.png           PWA / apple-touch icons
src/icons/apex-192.png
src/icons/apex-512.png
tools/fetch-monaco-elevation.mjs optional DEM pre-baking
tools/README.md
tests/suite.py                   121-assertion verification suite
tests/README.md
docs/MONACO-DATA.md              circuit data provenance and limitations
docs/TEST-REPORT-5.1.md          test results + what was NOT tested
docs/CHANGELOG-5.1.md
docs/FILES-CHANGED.md            this file
```

## Modified
```
src/index.html      core.js + quotes.js load FIRST (script.js delegates to
                    them at init); monaco.js before platform.js; Monaco tile
                    and page; PWA meta + manifest + SW registration; Monaco
                    teardown on navigation; v5.1 tags; quote placeholder copy

src/script.js       FIX 1  `$` hoisted out of the temporal dead zone
                    FIX 2  expired-timer finish deferred to after `load`
                    FIX 3  startup wrapped in ApexBoot.step()
                    readStorage/writeStorage delegate to ApexStore
                    localDateKey delegates to ApexDate
                    quotes section rewritten against the quotes engine
                    day-rollover handler, storage recovery, daily snapshot
                    (signatures unchanged; all existing callers unmodified)

src/xp.js           ledger entries carry a local `day` key
                    xpEntryDay() for "today"/ledger grouping, 5.0-compatible
                    xpRef accessors individually TDZ-guarded
                    xpBoot stages isolated
                    legacy seed will not run against an incomplete load

src/platform.js     rewritten: versioned + checksummed backup, validation
                    before any write, merge vs replace, safety snapshot,
                    XP/level channel, snapshot browser, storage health.
                    Corrupt values never enter a backup.

README.md           rewritten: diagnosis, architecture, run/deploy, sources
docs/STORAGE.md     rewritten: why data was lost, the 5.1 layers, guarantees
```

## Removed
```
backup/APEX-4.7-original.zip   old build artefact, not source
```

## Untouched
```
src/style.css  src/stadium.css  src/mobile.css  src/stadium.js
src-tauri/**   .github/workflows/**   .gitignore  .gitattributes
docs/BUILD.md  docs/IOS.md  docs/CHANGELOG.md  docs/CHANGELOG-4.7.md
docs/TEST-REPORT.md  docs/tests/**
```
