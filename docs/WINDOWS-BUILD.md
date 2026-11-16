# Building the APEX Windows application

Two routes. **Route A needs nothing installed on your PC** — GitHub builds it
for you. Use that unless you want to iterate locally.

---

## Route A — build it on GitHub (recommended)

The repository already contains `.github/workflows/windows.yml`, which builds
APEX on a GitHub-hosted Windows runner.

1. Go to your repository → **Actions** tab.
2. If you see a banner asking you to enable workflows, click
   **I understand my workflows, go ahead and enable them**.
3. Pick **Build Windows** in the left-hand list.
4. Click **Run workflow** → **Run workflow**.

First run takes roughly 10–15 minutes, because Rust compiles Tauri from
scratch. Later runs are 2–4 minutes thanks to the build cache.

When it finishes, open the completed run and scroll to **Artifacts**. You get
three downloads:

| Artifact | What it is |
|---|---|
| `APEX-Windows-Setup` | `.exe` installer (NSIS). **This is the one you want.** Installs for the current user, no admin rights needed |
| `APEX-Windows-MSI` | `.msi` installer, for Group Policy or managed deployment |
| `APEX-Windows-Portable` | Bare `APEX.exe`. Runs without installing, but needs WebView2 already present |

Artifacts are kept for 90 days.

### SmartScreen

The installers are **not code-signed**, so on first run Windows will show
*"Windows protected your PC"*. Click **More info** → **Run anyway**.

This is expected, not a sign of a problem. Signing requires a code-signing
certificate from a commercial CA (roughly £200–400/year). Without one, every
unsigned installer gets this warning.

---

## Route B — build on your own PC

Only worth it if you want to change the app and see results quickly.

### Prerequisites

1. **Microsoft C++ Build Tools** —
   [download](https://visualstudio.microsoft.com/visual-cpp-build-tools/),
   then tick **Desktop development with C++** in the installer.
2. **Rust** — [rustup.rs](https://rustup.rs), take the defaults.
3. **WebView2** — already present on Windows 10 (recent) and Windows 11. If
   not, the installer pulls it in automatically.

Restart your terminal afterwards so `cargo` is on the PATH.

### Build

```powershell
cargo install tauri-cli --version "^2.0.0" --locked
cd path\to\your\repo
cargo tauri build
```

Output lands in:

```
src-tauri\target\release\bundle\nsis\APEX_5.1.0_x64-setup.exe
src-tauri\target\release\bundle\msi\APEX_5.1.0_x64_en-GB.msi
src-tauri\target\release\APEX.exe
```

### Live development

```powershell
cargo tauri dev
```

Opens the app in a native window against `src/` directly. Edit a file, hit
refresh in the window, see the change — no rebuild.

---

## Things worth knowing

**Storage is separate from your browser.** The Tauri window is its own origin.
Data in Safari, Chrome, the iPhone PWA and this Windows app do **not** sync.
To move your records: in the old one, Progression → APEX DATA →
**EXPORT ALL DATA**; in the new one, **IMPORT DATA**.

**No build step for the frontend.** `frontendDist` points at `../src`, so
every file there — including `core.js`, `quotes.js`, `monaco.js`, the circuit
data and the vendored three.js — is bundled automatically. There is no
bundler to configure and nothing to keep in sync.

**The service worker does not run** under Tauri's custom protocol. That is
fine: the app is already local, so there is nothing to cache for offline use.

**Monaco elevation needs internet once.** 5.1 widened the Tauri CSP
(`connect-src`) to permit `api.open-meteo.com` and `api.opentopodata.org`.
Without that the lookup is blocked in the native window and the circuit stays
flat forever. If you would rather the app never touch the network at all, run
`node tools/fetch-monaco-elevation.mjs` before building — the data is then
baked into `src/data/monaco-elevation.json` and you can narrow `connect-src`
back to `'self' ipc: http://ipc.localhost`.

**Version numbers** live in `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`. Both say `5.1.0`. Keep them in step.

---

## Not verified

I could not build this. There is no Rust toolchain or Windows runner in the
environment I worked in, so:

- `cargo tauri build` has **not** been run against 5.1
- the installers have **not** been produced or tested
- the widened CSP has **not** been confirmed to let the elevation fetch through
  in a real WebView2 window

The configuration is carried forward from the 5.0 build, which did produce
working installers, and the only changes are the version bump and the
`connect-src` entries. But treat the first Actions run as the real test. If it
fails, the log in the Actions tab will say where.
