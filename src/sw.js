/* ==========================================
   APEX 5.1 — SERVICE WORKER

   Caches the application SHELL so APEX opens offline. It does NOT cache or
   manage user data: every record lives in localStorage and IndexedDB, which
   the service worker never touches.

   The cache name carries the build version. On activate, caches from older
   builds are deleted — those hold copies of HTML, CSS and JS only, never
   user data, so this is safe.

   One rule matters above all others: a cache miss must never be served as a
   successful empty response. If a request cannot be satisfied, it fails
   loudly rather than returning something the application might mistake for
   valid, empty data.
   ========================================== */

const APEX_BUILD = "apex-5.1.0";
const SHELL = `${APEX_BUILD}-shell`;

const SHELL_FILES = [
  "./", "./index.html",
  "./core.js", "./quotes.js", "./script.js", "./xp.js",
  "./stadium.js", "./monaco.js", "./platform.js",
  "./style.css", "./stadium.css", "./monaco.css", "./mobile.css",
  "./data/monaco-circuit.json",
  "./vendor/three.module.min.js",
  "./manifest.webmanifest",
  "./icons/apex-192.png", "./icons/apex-512.png", "./icons/apex-180.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => cache.addAll(SHELL_FILES))
      /* A failed precache must not install a half-populated shell. */
      .then(() => self.skipWaiting())
      .catch(err => { console.error("APEX SW: precache failed", err); throw err; })
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL && k.startsWith("apex-"))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* The elevation API is never cached here. Its results are stored by the
     application in IndexedDB, which is a deliberate, inspectable cache the
     user controls — unlike an opaque SW cache entry. */
  if (url.origin !== location.origin) return;

  /* Shell: cache first, then network. Static assets, safe to serve stale. */
  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        /* Refresh in the background so the next launch is current. */
        fetch(req).then(res => {
          if (res && res.ok) caches.open(SHELL).then(c => c.put(req, res.clone()));
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy));
        }
        return res;
      }).catch(err => {
        /* Navigation requests fall back to the cached shell so the app still
           opens offline. Everything else fails honestly. */
          if (req.mode === "navigate") return caches.match("./index.html");
          throw err;
      });
    })
  );
});

self.addEventListener("message", event => {
  if (event.data === "apex-skip-waiting") self.skipWaiting();
});
