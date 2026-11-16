/* ==========================================
   APEX 5.1 — PLATFORM & DATA PORTABILITY

   1. Detect whether APEX is running in a native Tauri window or a browser.
   2. Full application backup / restore — versioned, validated, with a
      safety backup taken before anything is replaced, and a choice between
      merging and replacing.
   3. XP and level export / import on its own channel.
   4. Access to the automatic daily snapshots kept by ApexStore.

   Nothing leaves the device. There is no account and no network call.
   ========================================== */

/* ---------- Platform detection ---------- */
const APEX_PLATFORM = (function detectPlatform(){
  const isTauri = typeof window !== "undefined" &&
    (("__TAURI__" in window) || ("__TAURI_INTERNALS__" in window) ||
     /tauri\.localhost|^tauri:/.test(location.origin));
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isWindows = /Windows NT/.test(ua);
  const isMac = /Macintosh/.test(ua) && !isIOS;
  const touch = navigator.maxTouchPoints > 0;
  const standalone = !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  return { isTauri, isIOS, isWindows, isMac, touch, standalone,
           name: isTauri ? (isIOS ? "ios" : isWindows ? "windows" : isMac ? "macos" : "native")
                         : (standalone ? "pwa" : "browser") };
})();
window.APEX_PLATFORM = APEX_PLATFORM;

document.documentElement.dataset.platform = APEX_PLATFORM.name;
if (APEX_PLATFORM.isTauri) document.body.classList.add("apex-native");
if (APEX_PLATFORM.touch) document.body.classList.add("apex-touch");

/* Ask the browser not to evict APEX's storage. This matters most in an iOS
   WKWebView, where unpersisted origins are cleared under storage pressure —
   one of the few ways a user can genuinely lose data. */
if (navigator.storage && navigator.storage.persist){
  navigator.storage.persisted()
    .then(already => already ? true : navigator.storage.persist())
    .then(granted => { window.APEX_PERSISTED = !!granted; })
    .catch(() => {});
}

if (APEX_PLATFORM.isTauri){
  document.addEventListener("contextmenu", event => {
    if (event.target.closest("input, textarea")) return;
    event.preventDefault();
  });
}

/* ---------- The keys that make up a backup ---------- */
const APEX_BACKUP_KEYS = [
  "apexTasks", "apexSessions", "apexStudyRecords", "apexTimerState",
  "apexHabits", "apexHabitLogs", "apexQuoteLibrary", "apexDailyQuote",
  "apexQuotePrefs", "apexEvents", "apexNotifyPrefs", "apexFitnessRecords",
  "apexWatch", "apexXPState", "apexXPLedger", "apexStadiumPrefs",
  "apexMonacoPrefs"
];
window.APEX_BACKUP_KEYS = APEX_BACKUP_KEYS;

/* Keys holding HISTORY, mergeable record by record. The value names the
   field that uniquely identifies a record. */
const APEX_MERGEABLE = {
  apexTasks:          "id",
  apexHabits:         "id",
  apexHabitLogs:      null,          // composite: habitId + date
  apexEvents:         "id",
  apexFitnessRecords: "id",
  apexXPLedger:       "id"
};

const APEX_SCHEMA_VERSION = 2;
const APEX_APP_VERSION = "5.1";

/* ============================================================
   BUILDING A BACKUP
   ============================================================ */
function apexChecksum(payload){
  const subject = JSON.stringify({ ls: payload.localStorage, sr: payload.studyRecords });
  let h = 2166136261;
  for (let i = 0; i < subject.length; i++){ h ^= subject.charCodeAt(i); h = Math.imul(h, 16777619); }
  return { algorithm: "fnv1a-32", value: (h >>> 0).toString(16), length: subject.length };
}

function apexBuildBackup(){
  const data = {};
  const skipped = [];
  APEX_BACKUP_KEYS.forEach(key => {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    /* Fall back to the in-memory value, so a failing localStorage cannot
       silently produce an empty backup. */
    if (raw === null && window.ApexStore && ApexStore._mem.has(key)) {
      try { raw = JSON.stringify(ApexStore._mem.get(key)); } catch (e) {}
    }
    if (raw === null) return;

    /* A value that does not parse must never go into a backup. Exporting it
       verbatim would produce a file that this application's own validator
       refuses — so the user's "backup" would be unrestorable, and they would
       only find out at the moment they needed it. The live in-memory value
       is used instead where one exists; otherwise the key is omitted and
       named in the file, so the omission is visible rather than silent.
       The corrupt bytes themselves are already quarantined by ApexStore. */
    try { JSON.parse(raw); }
    catch (e) {
      let rescued = null;
      if (window.ApexStore && ApexStore._mem.has(key)) {
        try { rescued = JSON.stringify(ApexStore._mem.get(key)); } catch (err) {}
      }
      if (rescued !== null) { data[key] = rescued; skipped.push(`${key} (recovered from memory)`); return; }
      skipped.push(`${key} (unreadable, omitted)`);
      return;
    }
    data[key] = raw;
  });

  const study = (typeof studyRecords !== "undefined" && Array.isArray(studyRecords))
    ? studyRecords.map(r => { const c = { ...r }; delete c.id; return c; })
    : [];

  const payload = {
    format: "apex-backup",
    schemaVersion: APEX_SCHEMA_VERSION,
    version: APEX_SCHEMA_VERSION,          // 5.0 compatibility
    app: "APEX",
    appVersion: APEX_APP_VERSION,
    platform: APEX_PLATFORM.name,
    createdAt: new Date().toISOString(),
    createdDay: window.ApexDate ? ApexDate.today() : null,
    timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
    counts: { localStorageKeys: Object.keys(data).length, studyRecords: study.length },
    skipped,
    localStorage: data,
    studyRecords: study
  };
  payload.integrity = apexChecksum(payload);
  return payload;
}

function apexDownload(filename, text){
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function apexExportBackup(){
  const payload = apexBuildBackup();
  const stamp = window.ApexDate ? ApexDate.today() : new Date().toISOString().slice(0,10);
  apexDownload(`apex-backup-${stamp}.json`, JSON.stringify(payload, null, 2));
  return { ...payload.counts, skipped: payload.skipped };
}

/* ============================================================
   VALIDATION — a malformed file is rejected BEFORE anything is written
   ============================================================ */
function apexValidateBackup(parsed){
  const problems = [];
  if (!parsed || typeof parsed !== "object") return { ok: false, problems: ["The file is not a JSON object."], warnings: [], decoded: {}, counts: {} };
  if (parsed.format !== "apex-backup") problems.push("This is not an APEX backup file (missing the apex-backup marker).");

  const schema = Number(parsed.schemaVersion || parsed.version || 0);
  if (!Number.isFinite(schema) || schema < 1) problems.push("The backup has no readable schema version.");
  if (schema > APEX_SCHEMA_VERSION)
    problems.push(`This backup is schema v${schema}, but this copy of APEX understands up to v${APEX_SCHEMA_VERSION}. Update APEX first.`);

  if (!parsed.localStorage || typeof parsed.localStorage !== "object")
    problems.push("The backup contains no application data block.");

  const known = parsed.localStorage
    ? Object.keys(parsed.localStorage).filter(k => APEX_BACKUP_KEYS.includes(k))
    : [];
  if (parsed.localStorage && !known.length) problems.push("The backup contains no recognisable APEX data.");

  /* Every value must parse. One unreadable key fails the whole import — a
     half-restored backup is worse than a refused one. */
  const decoded = {};
  known.forEach(key => {
    try { decoded[key] = JSON.parse(parsed.localStorage[key]); }
    catch (e) { problems.push(`The "${key}" section is corrupt and could not be read.`); }
  });

  if (parsed.studyRecords !== undefined && !Array.isArray(parsed.studyRecords))
    problems.push("The study records section is not a list.");

  /* A checksum mismatch is a warning, not a refusal: someone who hand-edited
     a file to rescue something should still be able to import it, as long as
     they are told. */
  const warnings = [];
  if (parsed.integrity && parsed.integrity.algorithm === "fnv1a-32"){
    if (apexChecksum(parsed).value !== parsed.integrity.value)
      warnings.push("The integrity check does not match — this file may have been edited or truncated.");
  } else if (schema >= 2){
    warnings.push("This backup carries no integrity check.");
  }

  const counts = {
    keys: known.length,
    studyRecords: Array.isArray(parsed.studyRecords) ? parsed.studyRecords.length : 0,
    tasks: Array.isArray(decoded.apexTasks) ? decoded.apexTasks.length : 0,
    events: Array.isArray(decoded.apexEvents) ? decoded.apexEvents.length : 0,
    fitness: Array.isArray(decoded.apexFitnessRecords) ? decoded.apexFitnessRecords.length : 0,
    habits: Array.isArray(decoded.apexHabits) ? decoded.apexHabits.length : 0,
    habitLogs: Array.isArray(decoded.apexHabitLogs) ? decoded.apexHabitLogs.length : 0,
    quotes: Array.isArray(decoded.apexQuoteLibrary) ? decoded.apexQuoteLibrary.length : 0,
    totalXP: (decoded.apexXPState && Number(decoded.apexXPState.totalXP)) || 0
  };

  return { ok: problems.length === 0, problems, warnings, decoded, counts, schema };
}

/* ============================================================
   RESTORE
   ============================================================ */
function apexSafetyBackup(reason){
  const payload = apexBuildBackup();
  if (window.ApexStore) ApexStore.snapshot(APEX_BACKUP_KEYS, reason || "pre-import");
  return payload;
}

function apexMergeArrays(key, existing, incoming){
  if (!Array.isArray(existing)) return { merged: incoming, added: incoming.length };
  if (!Array.isArray(incoming)) return { merged: existing, added: 0 };
  const idField = APEX_MERGEABLE[key];
  const fingerprint = r => {
    if (key === "apexHabitLogs") return `${r && r.habitId}|${r && r.date}`;
    if (idField && r && r[idField] !== undefined) return String(r[idField]);
    return JSON.stringify(r);
  };
  const seen = new Set(existing.map(fingerprint));
  const merged = existing.slice();
  let added = 0;
  incoming.forEach(r => {
    const fp = fingerprint(r);
    if (seen.has(fp)) return;
    seen.add(fp); merged.push(r); added++;
  });
  return { merged, added };
}

/* mode: "replace" | "merge" */
async function apexImportBackup(file, mode = "replace"){
  let text;
  try { text = await file.text(); }
  catch (e) { return { ok: false, message: "That file could not be read." }; }

  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { return { ok: false, message: "That file is not valid JSON. Nothing was changed." }; }

  const check = apexValidateBackup(parsed);
  if (!check.ok)
    return { ok: false, message: "Import refused — nothing was changed.\n\n" + check.problems.join("\n") };

  const safety = apexSafetyBackup("pre-import");
  const report = [];

  try {
    if (mode === "merge"){
      Object.entries(check.decoded).forEach(([key, incoming]) => {
        if (APEX_MERGEABLE[key] !== undefined && Array.isArray(incoming)){
          const existing = ApexStore.read(key, []);
          const result = apexMergeArrays(key, existing, incoming);
          ApexStore.write(key, result.merged);
          if (result.added) report.push(`${key.replace(/^apex/, "")} +${result.added}`);
        } else if (key === "apexXPState"){
          /* XP is never merged arithmetically — adding two totals together
             would invent progression that was never earned. Keep the higher
             total; union the awarded maps so nothing can be re-awarded. */
          const existing = ApexStore.read(key, null) || {};
          const next = { ...existing, ...incoming };
          next.totalXP = Math.max(Number(existing.totalXP) || 0, Number(incoming.totalXP) || 0);
          next.awarded = { ...(existing.awarded || {}), ...(incoming.awarded || {}) };
          next.seeded = true;
          ApexStore.write(key, next);
          report.push(`XP kept at ${next.totalXP}`);
        } else {
          /* Preferences: only fill gaps when merging. */
          if (ApexStore.read(key, null) === null) ApexStore.write(key, incoming);
        }
      });
    } else {
      Object.entries(check.decoded).forEach(([key, value]) => ApexStore.write(key, value));
      report.push(`${check.counts.keys} data sets replaced`);
    }

    if (Array.isArray(parsed.studyRecords) && parsed.studyRecords.length){
      const n = await apexRestoreStudyRecords(parsed.studyRecords, mode);
      report.push(`${n} study records ${mode === "merge" ? "merged" : "restored"}`);
    }

    const warn = check.warnings.length ? "\n\nNote: " + check.warnings.join(" ") : "";
    return { ok: true, safety,
             message: `Import complete (${mode}). ${report.join(" · ") || "no changes needed"}.${warn}\n\nReloading…` };
  } catch (e){
    console.error("APEX import failed:", e);
    return { ok: false, safety,
             message: "The import failed partway through. Your pre-import snapshot is in the " +
                      "AUTOMATIC SNAPSHOTS list below — restore it from there. Error: " + e.message };
  }
}

/* Study records live in IndexedDB. "merge" adds what is not already there. */
function apexRestoreStudyRecords(records, mode = "replace"){
  return ApexStore.openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction("studyRecords", "readwrite");
    const store = tx.objectStore("studyRecords");
    let written = 0;
    const fp = r => `${r.date}|${r.subject}|${r.chapter}|${r.minutes}|${r.createdAt || ""}`;

    if (mode === "merge"){
      const all = store.getAll();
      all.onsuccess = () => {
        const seen = new Set((all.result || []).map(fp));
        records.forEach(r => {
          const copy = { ...r }; delete copy.id;
          if (seen.has(fp(copy))) return;
          seen.add(fp(copy)); store.add(copy); written++;
        });
      };
    } else {
      store.clear();
      records.forEach(r => { const copy = { ...r }; delete copy.id; store.add(copy); written++; });
    }

    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error || new Error("study restore failed"));
    tx.onabort = () => reject(tx.error || new Error("study restore aborted"));
  }));
}

/* ============================================================
   XP AND LEVELS — SEPARATE CHANNEL
   ============================================================
   For the record: this did NOT exist in 4.7 or 5.0. Both were checked
   (backup/APEX-4.7-original.zip). This is new work built to the brief,
   not functionality recovered from the original.                       */
function apexBuildXPExport(){
  const state = ApexStore.read("apexXPState", null);
  const ledger = ApexStore.read("apexXPLedger", []);
  const progress = (window.APEXXP && APEXXP.progress) ? APEXXP.progress() : null;
  const payload = {
    format: "apex-xp",
    schemaVersion: 1,
    app: "APEX",
    appVersion: APEX_APP_VERSION,
    createdAt: new Date().toISOString(),
    createdDay: window.ApexDate ? ApexDate.today() : null,
    /* Derived values are exported for inspection but RECOMPUTED on import,
       so an edited level can never desynchronise from the XP total. */
    derived: progress ? { level: progress.level, totalXP: progress.total,
                          intoLevel: progress.into, levelNeeds: progress.need } : null,
    curve: (typeof APEX_XP !== "undefined") ? { base: APEX_XP.levels.base, step: APEX_XP.levels.step } : null,
    state, ledger,
    counts: { transactions: Array.isArray(ledger) ? ledger.length : 0,
              awardedKeys: state && state.awarded ? Object.keys(state.awarded).length : 0 }
  };
  payload.integrity = (() => {
    const s = JSON.stringify({ state, ledger });
    let h = 2166136261;
    for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return { algorithm: "fnv1a-32", value: (h >>> 0).toString(16) };
  })();
  return payload;
}

function apexExportXP(){
  const payload = apexBuildXPExport();
  const stamp = window.ApexDate ? ApexDate.today() : new Date().toISOString().slice(0,10);
  apexDownload(`apex-xp-${stamp}.json`, JSON.stringify(payload, null, 2));
  return payload.counts;
}

function apexValidateXP(parsed){
  const problems = [], warnings = [];
  if (!parsed || typeof parsed !== "object")
    return { ok: false, problems: ["Not a JSON object."], warnings, ledger: [], totalXP: 0 };
  if (parsed.format !== "apex-xp") problems.push("This is not an APEX XP export file.");
  if (Number(parsed.schemaVersion || 0) !== 1)
    problems.push(`Unsupported XP schema version: ${parsed.schemaVersion}.`);

  const state = parsed.state;
  if (!state || typeof state !== "object") problems.push("The file contains no XP state.");
  else {
    const total = Number(state.totalXP);
    if (!Number.isFinite(total)) problems.push("The XP total is not a number.");
    else if (total < 0) problems.push("The XP total is negative.");
    else if (total > 10000000) problems.push("The XP total is implausibly large — refusing to import.");
    if (state.awarded !== undefined &&
        (typeof state.awarded !== "object" || state.awarded === null || Array.isArray(state.awarded)))
      problems.push("The awarded-keys map is malformed.");
  }

  const ledger = parsed.ledger;
  if (ledger !== undefined && !Array.isArray(ledger)) problems.push("The transaction ledger is not a list.");

  let cleanLedger = [];
  if (Array.isArray(ledger)){
    cleanLedger = ledger.filter(t => t && typeof t.key === "string" && Number.isFinite(Number(t.amount)));
    if (cleanLedger.length !== ledger.length)
      warnings.push(`${ledger.length - cleanLedger.length} malformed transactions were dropped.`);
  }

  /* Does the declared level match the declared XP on this build's curve? */
  if (problems.length === 0 && parsed.derived && typeof xpProgress === "function"){
    const recomputed = xpProgress(Number(state.totalXP));
    if (parsed.derived.level !== undefined && recomputed.level !== parsed.derived.level)
      warnings.push(`The file says level ${parsed.derived.level}, but ${state.totalXP} XP is level ` +
                    `${recomputed.level} on this build's curve. The level has been recomputed from the XP.`);
  }

  return { ok: problems.length === 0, problems, warnings, state, ledger: cleanLedger,
           totalXP: state ? Number(state.totalXP) || 0 : 0 };
}

/* mode: "replace" takes the file's total; "keep-higher" never reduces. */
async function apexImportXP(file, mode = "replace"){
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (e) { return { ok: false, message: "That file is not valid JSON. Nothing was changed." }; }

  const check = apexValidateXP(parsed);
  if (!check.ok)
    return { ok: false, message: "XP import refused — your progression was not touched.\n\n" + check.problems.join("\n") };

  apexSafetyBackup("pre-xp-import");

  const existing = ApexStore.read("apexXPState", null) || { totalXP: 0, awarded: {}, settings: {} };
  const incoming = check.state;

  const next = {
    v: 1,
    totalXP: mode === "keep-higher"
      ? Math.max(Number(existing.totalXP) || 0, Number(incoming.totalXP) || 0)
      : Math.max(0, Math.round(Number(incoming.totalXP) || 0)),
    settings: (incoming.settings && typeof incoming.settings === "object")
      ? incoming.settings : (existing.settings || {}),
    /* Union of both awarded maps: this is what stops a restored backup from
       re-awarding XP for work that was already counted. */
    awarded: { ...(existing.awarded || {}), ...(incoming.awarded || {}) },
    seeded: true
  };

  const existingLedger = ApexStore.read("apexXPLedger", []);
  let ledger = check.ledger;
  if (mode === "keep-higher" && Array.isArray(existingLedger)){
    const seen = new Set(existingLedger.map(t => t.id || t.key));
    ledger = existingLedger.concat(check.ledger.filter(t => !seen.has(t.id || t.key)));
  }

  if (!ApexStore.write("apexXPState", next) || !ApexStore.write("apexXPLedger", ledger.slice(-400)))
    return { ok: false, message: "Storage refused the write. Your previous progression is still in place." };

  const level = (typeof xpProgress === "function") ? xpProgress(next.totalXP).level : null;
  const warn = check.warnings.length ? "\n\nNote: " + check.warnings.join(" ") : "";
  return { ok: true,
           message: `Progression imported: ${next.totalXP.toLocaleString("en-IN")} XP` +
                    (level ? `, level ${level}` : "") +
                    ` · ${ledger.length} transactions.${warn}\n\nReloading…` };
}

/* ============================================================
   THE APEX DATA CARD (appended to the Progression page)
   ============================================================ */
function apexFileInput(id, accept, handler){
  const input = document.createElement("input");
  input.type = "file"; input.id = id; input.accept = accept; input.hidden = true;
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try { await handler(file); }
    catch (e) { console.error("APEX import handler:", e); }
    input.value = "";
  });
  return input;
}

function apexSetMsg(text){
  const node = document.getElementById("apexDataMsg");
  if (node) node.textContent = text;
}
function apexSetXPMsg(text){
  const node = document.getElementById("apexXPDataMsg");
  if (node) node.textContent = text;
}

function renderBackupCard(){
  const root = document.getElementById("xpRoot");
  if (!root || typeof section !== "function") return;

  /* ---- 1. Full application data ---- */
  const card = section("APEX DATA — BACKUP & RESTORE");
  card.appendChild(el("p", "muted-small",
    `Running on: ${APEX_PLATFORM.name.toUpperCase()}. Everything is stored on this device only — ` +
    `there is no account and nothing is uploaded. The browser, the installed app and the iOS app each ` +
    `keep separate storage, so use a backup file to move between them. ` +
    `GitHub stores the source code, not your records.`));

  const actions = el("div", "apex-data-actions");
  actions.appendChild(btn("EXPORT ALL DATA", "secondary", () => {
    try {
      const result = apexExportBackup();
      apexSetMsg(`Backup saved: ${result.localStorageKeys} data sets, ${result.studyRecords} study records.` +
        (result.skipped && result.skipped.length
          ? `\n! Could not include: ${result.skipped.join(", ")}` : ""));
    } catch (e){ apexSetMsg("Could not create the backup file: " + e.message); }
  }));

  const importLabel = el("label", "file-import", "IMPORT DATA");
  importLabel.setAttribute("for", "apexImportFile");
  const importInput = apexFileInput("apexImportFile", ".json,application/json", async file => {
    /* Validate and SHOW the user what is in the file before anything is
       touched. Never a silent overwrite. */
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (e) { apexSetMsg("That file is not valid JSON. Nothing was changed."); return; }
    const check = apexValidateBackup(parsed);
    if (!check.ok){ apexSetMsg("Import refused — nothing was changed.\n" + check.problems.join("\n")); return; }

    const c = check.counts;
    const summary =
      `This backup contains:\n` +
      `  • ${c.studyRecords} study records\n` +
      `  • ${c.fitness} fitness records\n` +
      `  • ${c.events} calendar events\n` +
      `  • ${c.tasks} tasks\n` +
      `  • ${c.habits} habits, ${c.habitLogs} habit logs\n` +
      `  • ${c.quotes} personal quotes\n` +
      `  • ${c.totalXP.toLocaleString("en-IN")} XP\n` +
      (parsed.createdAt ? `\nCreated: ${new Date(parsed.createdAt).toLocaleString("en-IN")}\n` : "") +
      (check.warnings.length ? `\n! ${check.warnings.join("\n! ")}\n` : "") +
      `\nHow should this be applied?\n\n` +
      `OK      — MERGE: add anything missing, keep everything you already have\n` +
      `Cancel  — choose REPLACE instead`;

    let mode = confirm(summary) ? "merge" : null;
    if (mode === null){
      if (!confirm("REPLACE will overwrite the data on this device with the backup.\n\n" +
                   "A safety copy of your current data is taken first and will appear in the " +
                   "AUTOMATIC SNAPSHOTS list.\n\nContinue with REPLACE?")){
        apexSetMsg("Import cancelled. Nothing was changed."); return;
      }
      mode = "replace";
    }

    apexSetMsg(`Importing (${mode})…`);
    const result = await apexImportBackup(file, mode);
    apexSetMsg(result.message);
    if (result.ok) setTimeout(() => location.reload(), 2000);
  });
  actions.append(importLabel, importInput);
  card.appendChild(actions);

  const msg = el("p", "form-message apex-data-msg", "");
  msg.id = "apexDataMsg"; msg.setAttribute("role", "status");
  card.appendChild(msg);
  root.appendChild(card);

  /* ---- 2. XP and levels only ---- */
  const xpCard = section("XP & LEVEL TRANSFER");
  xpCard.appendChild(el("p", "muted-small",
    "Progression on its own, without your study, fitness or calendar records. " +
    "The level is always recalculated from the XP total on import, so the two can never disagree."));

  const xpActions = el("div", "apex-data-actions");
  xpActions.appendChild(btn("EXPORT XP & LEVEL", "secondary", () => {
    try {
      const counts = apexExportXP();
      apexSetXPMsg(`Exported ${counts.transactions} transactions and ${counts.awardedKeys} award keys.`);
    } catch (e){ apexSetXPMsg("Could not create the XP file: " + e.message); }
  }));

  const xpLabel = el("label", "file-import", "IMPORT XP & LEVEL");
  xpLabel.setAttribute("for", "apexXPImportFile");
  const xpInput = apexFileInput("apexXPImportFile", ".json,application/json", async file => {
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch (e) { apexSetXPMsg("That file is not valid JSON. Your progression was not touched."); return; }
    const check = apexValidateXP(parsed);
    if (!check.ok){ apexSetXPMsg("Refused — progression untouched.\n" + check.problems.join("\n")); return; }

    const current = ApexStore.read("apexXPState", null);
    const currentXP = current ? Number(current.totalXP) || 0 : 0;
    const level = (typeof xpProgress === "function") ? xpProgress(check.totalXP).level : "?";

    const mode = confirm(
      `This file holds ${check.totalXP.toLocaleString("en-IN")} XP (level ${level}) ` +
      `and ${check.ledger.length} transactions.\n` +
      `You currently have ${currentXP.toLocaleString("en-IN")} XP.\n` +
      (check.warnings.length ? `\n! ${check.warnings.join("\n! ")}\n` : "") +
      `\nOK      — KEEP THE HIGHER total and merge the transactions (safe)\n` +
      `Cancel  — REPLACE this device's progression with the file`
    ) ? "keep-higher" : "replace";

    if (mode === "replace" && check.totalXP < currentXP){
      if (!confirm(`REPLACE would reduce your XP from ${currentXP.toLocaleString("en-IN")} to ` +
                   `${check.totalXP.toLocaleString("en-IN")}.\n\nAre you sure?`)){
        apexSetXPMsg("Import cancelled. Progression unchanged."); return;
      }
    }

    apexSetXPMsg("Importing progression…");
    const result = await apexImportXP(file, mode);
    apexSetXPMsg(result.message);
    if (result.ok) setTimeout(() => location.reload(), 2000);
  });
  xpActions.append(xpLabel, xpInput);
  xpCard.appendChild(xpActions);

  const xpMsg = el("p", "form-message apex-data-msg", "");
  xpMsg.id = "apexXPDataMsg"; xpMsg.setAttribute("role", "status");
  xpCard.appendChild(xpMsg);
  root.appendChild(xpCard);

  /* ---- 3. Automatic snapshots ---- */
  const snapCard = section("AUTOMATIC SNAPSHOTS");
  snapCard.appendChild(el("p", "muted-small",
    "APEX keeps a snapshot of your data once a day, and one before every import, in this " +
    "device's IndexedDB. The most recent 14 are kept. These are a safety net, not a " +
    "substitute for exporting a backup file."));
  const snapList = el("div", "apex-snapshots");
  snapList.id = "apexSnapshots";
  snapList.appendChild(el("p", "muted-small", "Loading…"));
  snapCard.appendChild(snapList);
  root.appendChild(snapCard);
  refreshSnapshotList();

  /* ---- 4. Storage health ---- */
  const health = ApexStore.health();
  const healthCard = section("STORAGE HEALTH");
  healthCard.appendChild(el("p", "muted-small",
    `localStorage: ${health.localStorageWorking ? "working" : "NOT WRITEABLE"} · about ` +
    `${Math.round(health.approxBytesUsed / 1024)} KB used · ${health.knownKeys} data sets tracked · ` +
    `${health.pendingWrites} writes waiting to retry` +
    (window.APEX_PERSISTED ? " · storage marked persistent" : "")));
  if (!health.localStorageWorking || health.pendingWrites > 0){
    healthCard.appendChild(el("p", "form-message",
      "! Some writes could not be saved. Export a backup now. If storage is full, removing a " +
      "watch photo usually frees the most space."));
  }
  if (health.lastError) healthCard.appendChild(el("p", "muted-small", "Last error: " + health.lastError));
  root.appendChild(healthCard);
}

function refreshSnapshotList(){
  const host = document.getElementById("apexSnapshots");
  if (!host) return;
  ApexStore.listSnapshots().then(list => {
    host.replaceChildren();
    if (!list.length){ host.appendChild(el("p", "muted-small", "No snapshots yet. The first is taken today.")); return; }
    list.forEach(s => {
      const row = el("div", "apex-snapshot-row");
      const when = new Date(s.at).toLocaleString("en-IN", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" });
      row.append(el("span", "", `${when} · ${s.reason} · ${s.keys} data sets`));
      row.appendChild(btn("RESTORE", "secondary", () => {
        if (!confirm(`Restore the snapshot from ${when}?\n\nThis replaces the data currently on this ` +
                     `device. A safety copy of the current data is taken first.`)) return;
        ApexStore.getSnapshot(s.id).then(snap => {
          if (!snap || !snap.data){ apexSetMsg("That snapshot could not be read."); return; }
          apexSafetyBackup("pre-snapshot-restore");
          Object.entries(snap.data).forEach(([key, raw]) => {
            try { ApexStore.write(key, JSON.parse(raw)); } catch (e) {}
          });
          apexSetMsg("Snapshot restored. Reloading…");
          setTimeout(() => location.reload(), 1500);
        });
      }));
      host.appendChild(row);
    });
  });
}

/* The Progression page rebuilds itself on every open, so re-append after it. */
(function hookBackupCard(){
  if (typeof renderXPPage !== "function") return;
  const original = renderXPPage;
  window.renderXPPage = function patchedRenderXPPage(){
    original.apply(this, arguments);
    try { if (typeof renderQuoteSettings === "function") renderQuoteSettings(); }
    catch (error){ console.error("Quote settings card:", error); }
    try { renderBackupCard(); } catch (error){ console.error("Backup card:", error); }
  };
})();

window.apexExportBackup   = apexExportBackup;
window.apexImportBackup   = apexImportBackup;
window.apexBuildBackup    = apexBuildBackup;
window.apexValidateBackup = apexValidateBackup;
window.apexExportXP       = apexExportXP;
window.apexImportXP       = apexImportXP;
window.apexValidateXP     = apexValidateXP;
window.apexBuildXPExport  = apexBuildXPExport;
