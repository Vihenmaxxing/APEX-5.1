/* ==========================================
   APEX 5.1 — CORE
   Loaded before every other script. Three jobs:

     1. ApexDate   one definition of "what day is it", in the device's local
                   timezone, with a rollover event at local midnight.
     2. ApexStore  a durable wrapper around localStorage that never reports
                   "empty" when it actually means "failed", mirrors every
                   record into IndexedDB, and keeps rolling backups.
     3. ApexBoot   module isolation, so one failing module can no longer take
                   the rest of the application down with it.

   Nothing in this file deletes user data. The only destructive operation in
   APEX is an explicit, confirmed restore, and that takes a backup first.
   ========================================== */

/* ============================================================
   1. DATES — local, not UTC
   ============================================================
   The original build mixed two date systems:
       localDateKey()            -> local calendar day  (correct)
       new Date().toISOString()  -> UTC calendar day     (wrong east of UTC)
   In Mumbai (UTC+5:30) those disagree for five and a half hours every day,
   so XP earned before 05:30 was filed under yesterday. Everything that asks
   "what day is it" now comes through here. */
const ApexDate = (() => {
  const pad = n => String(n).padStart(2, "0");

  /* The canonical key: YYYY-MM-DD in the device's own timezone. Built from
     the local getters, never from toISOString(), which is always UTC. */
  function key(date = new Date()) {
    const d = (date instanceof Date) ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return key(new Date());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* A Date at local noon on a given key. Noon, not midnight, so that adding
     or subtracting days cannot be pushed across a boundary by a daylight
     saving shift of an hour either way. */
  function fromKey(k) {
    const [y, m, d] = String(k).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
  }

  function addDays(k, n) {
    const d = fromKey(k);
    d.setDate(d.getDate() + n);
    return key(d);
  }

  /* Whole days between two keys. Noon anchoring makes this exact across DST. */
  function daysBetween(a, b) {
    return Math.round((fromKey(b) - fromKey(a)) / 86400000);
  }

  function today() { return key(); }

  /* Milliseconds until the next local midnight, recomputed each time so a
     timezone change or a DST shift is picked up rather than assumed. */
  function msUntilNextLocalMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0);
    return Math.max(1000, next.getTime() - now.getTime());
  }

  /* ---- Rollover ----
     A new day fires `apex:daychange` on window. It carries the old and new
     keys. Modules listen and re-render. NOTHING here writes to storage and
     NOTHING here deletes anything: a new day is a new day, not a new database.

     Three triggers, because a single timer is not enough:
       * a timer aimed at the next local midnight (app left open overnight)
       * tab visibility returning (phone unlocked the next morning)
       * the device clock jumping (timezone change, manual clock change) */
  let current = today();
  let timer = null;
  const listeners = new Set();

  function check(reason) {
    const now = today();
    if (now === current) return false;
    const previous = current;
    current = now;
    const detail = { previous, current: now, reason };
    listeners.forEach(fn => { try { fn(detail); } catch (e) { console.error("daychange listener:", e); } });
    try { window.dispatchEvent(new CustomEvent("apex:daychange", { detail })); } catch (e) {}
    return true;
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { check("midnight"); schedule(); }, msUntilNextLocalMidnight());
  }

  function onDayChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  if (typeof window !== "undefined") {
    schedule();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) check("visibility"); });
    window.addEventListener("focus", () => check("focus"));
    /* Clock/timezone drift guard. Cheap, and it catches a device whose clock
       was corrected or whose timezone changed mid-session. */
    setInterval(() => check("poll"), 60000);
  }

  return { key, fromKey, addDays, daysBetween, today, onDayChange, check,
           msUntilNextLocalMidnight, get currentKey(){ return current; } };
})();
window.ApexDate = ApexDate;


/* ============================================================
   2. STORAGE
   ============================================================
   The original readStorage() did this:

       try { ...JSON.parse... } catch { return fallback; }

   which turns every failure — quota, corruption, a transient DOMException,
   a half-written value — into "there is no data here". The caller then saves
   over the top with an empty array and the real record is gone for good.

   This engine instead:
     * keeps a live in-memory cache, so a read can never regress to empty
       once a value has been seen in this session;
     * verifies every write by reading it back;
     * on a parse failure, quarantines the bad value under
       apex.corrupt.<key>.<timestamp> rather than discarding it, and reports
       the failure instead of pretending the key was empty;
     * mirrors every write into IndexedDB, which survives localStorage
       eviction, and can recover from it on next launch;
     * keeps rolling daily snapshots so there is always something to go back
       to.                                                                 */

const ApexStore = (() => {
  const MEM = new Map();          // key -> parsed value (source of truth in-session)
  const SEEN = new Set();         // keys that have ever held real data
  const PENDING = new Map();      // writes that failed and still need flushing
  let lsWorks = true;
  let lastError = null;
  const subscribers = new Set();

  /* ---- IndexedDB mirror ---- */
  const DB_NAME = "APEXDB";
  const DB_VERSION = 2;           // v1 = { studyRecords }. v2 adds kv + backups.
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = ev => {
        const db = ev.target.result;
        /* Additive only. The v1 study store is never dropped or recreated:
           doing so would destroy every study record on first launch of 5.1. */
        if (!db.objectStoreNames.contains("studyRecords"))
          db.createObjectStore("studyRecords", { keyPath: "id", autoIncrement: true });
        if (!db.objectStoreNames.contains("kv"))
          db.createObjectStore("kv", { keyPath: "key" });
        if (!db.objectStoreNames.contains("backups"))
          db.createObjectStore("backups", { keyPath: "id" });
      };
      req.onsuccess = ev => resolve(ev.target.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
    return dbPromise;
  }

  function idbPut(store, value) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("aborted"));
    }));
  }

  function idbGet(store, id) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const rq = tx.objectStore(store).get(id);
      rq.onsuccess = () => resolve(rq.result || null);
      rq.onerror = () => reject(rq.error);
    }));
  }

  function idbAll(store) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const rq = tx.objectStore(store).getAll();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    }));
  }

  /* ---- Reading ----
     Order of trust: in-memory cache, then localStorage, then the fallback.
     The IndexedDB mirror is consulted asynchronously at boot (see recover()),
     because localStorage is synchronous and the modules read at load time. */
  function read(key, fallback) {
    if (MEM.has(key)) return clone(MEM.get(key));
    let raw = null;
    try { raw = localStorage.getItem(key); }
    catch (e) { lsWorks = false; lastError = e; return clone(fallback); }

    if (raw === null || raw === undefined) return clone(fallback);

    try {
      const value = JSON.parse(raw);
      if (value === null) return clone(fallback);
      MEM.set(key, value);
      SEEN.add(key);
      return clone(value);
    } catch (e) {
      /* Corrupt JSON. Do NOT silently return empty — that is how data gets
         overwritten. Quarantine it, shout about it, and hand back the
         fallback so the UI still renders. */
      quarantine(key, raw, e);
      return clone(fallback);
    }
  }

  function quarantine(key, raw, err) {
    const stamp = `apex.corrupt.${key}.${Date.now()}`;
    try { localStorage.setItem(stamp, raw); } catch (e) {}
    lastError = err;
    console.error(`APEX storage: ${key} could not be parsed. The raw value has been ` +
                  `kept at ${stamp} and has NOT been deleted.`, err);
    notify({ type: "corrupt", key, quarantinedAs: stamp });
  }

  /* ---- Writing ----
     Write, read back, confirm. A write that cannot be confirmed is kept in
     PENDING and retried, and the caller is told it failed, so a module can
     show a warning rather than carrying on as if the data were safe. */
  function write(key, value) {
    MEM.set(key, value);
    SEEN.add(key);
    let payload;
    try { payload = JSON.stringify(value); }
    catch (e) {
      lastError = e;
      console.error(`APEX storage: ${key} could not be serialised.`, e);
      notify({ type: "serialise-failed", key, error: String(e) });
      return false;
    }

    let ok = false;
    try {
      localStorage.setItem(key, payload);
      ok = localStorage.getItem(key) === payload;   // verify, do not assume
      lsWorks = true;
    } catch (e) {
      lastError = e;
      lsWorks = false;
      ok = false;
      const quota = e && (e.name === "QuotaExceededError" ||
                          e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);
      console.error(`APEX storage: writing ${key} failed${quota ? " (quota exceeded)" : ""}.`, e);
      notify({ type: quota ? "quota" : "write-failed", key, error: String(e) });
    }

    if (!ok) PENDING.set(key, payload); else PENDING.delete(key);

    /* Mirror to IndexedDB regardless. It has a far larger quota and survives
       the "clear site data on low storage" behaviour that evicts localStorage
       on iOS. This is what makes the data recoverable. */
    idbPut("kv", { key, json: payload, at: Date.now() }).catch(() => {});
    return ok;
  }

  function remove(key) {
    MEM.delete(key);
    try { localStorage.removeItem(key); } catch (e) {}
    idbPut("kv", { key, json: null, at: Date.now() }).catch(() => {});
    return true;
  }

  function flushPending() {
    if (!PENDING.size) return;
    [...PENDING.entries()].forEach(([key, payload]) => {
      try {
        localStorage.setItem(key, payload);
        if (localStorage.getItem(key) === payload) PENDING.delete(key);
      } catch (e) {}
    });
  }
  setInterval(flushPending, 15000);
  window.addEventListener("online", flushPending);

  /* ---- Recovery ----
     Runs once at boot. For every key the IndexedDB mirror knows about but
     localStorage does not, the mirrored value is restored. This is the
     answer to "I opened the app and everything was gone": if localStorage
     was evicted, the mirror brings it back.

     It only ever ADDS. A key that exists in localStorage is never replaced
     by the mirror, because localStorage is the more recent of the two in
     normal operation.                                                     */
  function recover() {
    return idbAll("kv").then(rows => {
      const restored = [];
      rows.forEach(row => {
        if (!row || !row.key || row.json === null || row.json === undefined) return;
        let present = null;
        try { present = localStorage.getItem(row.key); } catch (e) {}
        if (present !== null) return;                 // localStorage wins
        if (MEM.has(row.key)) return;
        try {
          const value = JSON.parse(row.json);
          if (value === null) return;
          MEM.set(row.key, value);
          SEEN.add(row.key);
          try { localStorage.setItem(row.key, row.json); } catch (e) {}
          restored.push(row.key);
        } catch (e) {}
      });
      if (restored.length) {
        console.warn("APEX storage: recovered from the IndexedDB mirror:", restored.join(", "));
        notify({ type: "recovered", keys: restored });
      }
      return restored;
    }).catch(() => []);
  }

  /* ---- Rolling snapshots ----
     One snapshot per local day, newest 14 kept, stored in IndexedDB. Purely
     additive: taking a snapshot never modifies live data, and pruning only
     ever removes old SNAPSHOTS, never records. */
  const SNAPSHOT_KEEP = 14;

  function snapshot(keys, reason) {
    const data = {};
    keys.forEach(k => {
      try { const raw = localStorage.getItem(k); if (raw !== null) data[k] = raw; }
      catch (e) {}
    });
    if (!Object.keys(data).length) return Promise.resolve(false);
    const id = `${ApexDate.today()}|${reason || "daily"}`;
    return idbPut("backups", { id, at: Date.now(), day: ApexDate.today(),
                               reason: reason || "daily", data })
      .then(() => pruneSnapshots())
      .then(() => true)
      .catch(() => false);
  }

  function pruneSnapshots() {
    return idbAll("backups").then(rows => {
      const sorted = rows.sort((a, b) => b.at - a.at);
      const stale = sorted.slice(SNAPSHOT_KEEP);
      if (!stale.length) return true;
      return openDB().then(db => new Promise(resolve => {
        const tx = db.transaction("backups", "readwrite");
        stale.forEach(r => tx.objectStore("backups").delete(r.id));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      }));
    }).catch(() => false);
  }

  function listSnapshots() {
    return idbAll("backups")
      .then(rows => rows.sort((a, b) => b.at - a.at)
        .map(r => ({ id: r.id, at: r.at, day: r.day, reason: r.reason,
                     keys: Object.keys(r.data || {}).length })))
      .catch(() => []);
  }

  function getSnapshot(id) { return idbGet("backups", id); }

  /* ---- Misc ---- */
  function clone(v) {
    if (v === null || typeof v !== "object") return v;
    try { return structuredClone(v); } catch (e) {}
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }
  function notify(event) {
    subscribers.forEach(fn => { try { fn(event); } catch (e) {} });
    try { window.dispatchEvent(new CustomEvent("apex:storage", { detail: event })); } catch (e) {}
  }
  function onEvent(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

  function health() {
    let used = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        used += (k || "").length + (localStorage.getItem(k) || "").length;
      }
    } catch (e) {}
    return { localStorageWorking: lsWorks, approxBytesUsed: used,
             pendingWrites: PENDING.size, knownKeys: SEEN.size,
             lastError: lastError ? String(lastError) : null };
  }

  return { read, write, remove, recover, snapshot, listSnapshots, getSnapshot,
           pruneSnapshots, onEvent, health, flushPending,
           openDB, idbPut, idbGet, idbAll,
           _mem: MEM };
})();
window.ApexStore = ApexStore;


/* ============================================================
   3. MODULE ISOLATION
   ============================================================
   THE BUG THAT CAUSED THE MIDNIGHT DATA LOSS.

   script.js is one long classic script. Its modules run at top level, one
   after another, in a single execution. An exception anywhere stops the
   whole file dead — every module below that line never initialises.

   That is exactly what happened. restoreTimerState() runs at line ~216. If
   the focus timer was started in the evening and expired while the app was
   closed, the next launch takes this path:

       restoreTimerState()  ->  finishTimer()  ->  apexNotify()  ->  toast()

   and toast() reads `$`, which is declared with `const` 58 lines further
   down and is therefore in the temporal dead zone. The result is

       ReferenceError: Cannot access '$' before initialization

   thrown at top level. Everything after line 216 never ran: the study
   database never opened, the quote library never rendered, fitness, the
   calendar, the habit tracker and the garage never initialised. xp.js is a
   separate <script> element, so it still ran — which is why the XP bar kept
   its value while everything else looked deleted.

   Nothing was ever deleted. localStorage was intact the whole time. It was
   a rendering failure that looked exactly like data loss.

   Two fixes, both applied:
     1. the declaration order and the deferred-finish bug in script.js
        (see the comments there);
     2. this: every top-level startup step is wrapped, so a future failure in
        one module can never again take the others down.                   */

const ApexBoot = (() => {
  const failures = [];

  function step(name, fn) {
    try { return fn(); }
    catch (e) {
      failures.push({ name, error: e });
      console.error(`APEX boot: module "${name}" failed to start. Other modules are ` +
                    `unaffected and your data has not been touched.`, e);
      try { window.dispatchEvent(new CustomEvent("apex:bootfail", { detail: { name, error: String(e) } })); }
      catch (err) {}
      return undefined;
    }
  }

  /* Same guarantee for anything called later: event handlers, renders. */
  function guard(name, fn) {
    return function guarded(...args) {
      try { return fn.apply(this, args); }
      catch (e) { console.error(`APEX: ${name} failed.`, e); return undefined; }
    };
  }

  return { step, guard, get failures() { return failures.slice(); } };
})();
window.ApexBoot = ApexBoot;

/* A last line of defence. An uncaught error anywhere in the application is
   logged loudly and, crucially, is never interpreted by any other code as
   "the data is gone". */
window.addEventListener("error", e => {
  console.error("APEX: uncaught error —", e && e.message);
});
window.addEventListener("unhandledrejection", e => {
  console.error("APEX: unhandled promise rejection —", e && e.reason);
});
