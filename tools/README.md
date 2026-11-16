# APEX tools

## `fetch-monaco-elevation.mjs`

Pre-bakes the Monaco elevation dataset into `src/data/monaco-elevation.json`
so the 3D circuit shows real relief on its very first launch, offline.

```bash
node tools/fetch-monaco-elevation.mjs                      # Copernicus DEM GLO-90
node tools/fetch-monaco-elevation.mjs --source opentopodata # SRTM 30 m
```

Requires Node 18+ (for global `fetch`) and outbound internet access.

**This step is optional.** Without it, APEX fetches the same data from the
browser the first time you open the Monaco page and caches it in IndexedDB.
Run the tool if you want the data offline from first launch, under version
control, or identical across devices.

The script refuses to write a partial dataset. If any point comes back without
a height, the run fails and no file is produced — a dataset with gaps would
silently move the 0 m datum.
