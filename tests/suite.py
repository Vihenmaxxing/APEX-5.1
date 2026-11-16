"""APEX 5.1 verification suite. Every assertion runs in a real headless
Chromium against the built application, with the timezone set to the user's
(Asia/Kolkata, UTC+5:30) so local-vs-UTC bugs actually surface."""
import sys, pathlib, json
from playwright.sync_api import sync_playwright

SRC = "/home/claude/build/apex/src"
URL = "http://localhost:8777/index.html"   # served over HTTP: fetch() and service workers do not work on file://

RESULTS = []
def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))

def new_page(ctx):
    p = ctx.new_page()
    p._errs = []
    p.on("pageerror", lambda e: p._errs.append(str(e).split("\n")[0]))
    return p

with sync_playwright() as pw:
    b = pw.chromium.launch()

    # ===================================================================
    print("\n=== A. CLEAN LAUNCH ===")
    ctx = b.new_context(timezone_id="Asia/Kolkata")
    page = new_page(ctx); page.goto(URL); page.wait_for_timeout(1800)

    st = page.evaluate("""() => ({
      quote: document.getElementById('dailyQuote').textContent.trim(),
      author: document.getElementById('quoteAuthor').textContent.trim(),
      builtins: ApexQuotes.BUILTIN.length,
      pool: ApexQuotes.pool().length,
      modules: [...document.querySelectorAll('.module-button')].map(b=>b.dataset.openPage),
      today: ApexDate.today(),
      studyInit: typeof studyRecords,
      bootFailures: ApexBoot.failures.length,
    })""")
    check("Built-in quotes present on a fresh install", st["builtins"] >= 100, f"{st['builtins']} quotes")
    check("A quote displays immediately, no import needed",
          len(st["quote"]) > 10 and "Import" not in st["quote"], st["quote"][:60])
    check("Quote has an attribution", len(st["author"]) > 3, st["author"])
    check("All modules present incl. Monaco", "monaco" in st["modules"], ",".join(st["modules"]))
    check("No boot failures", st["bootFailures"] == 0)
    check("No page errors on launch", not page._errs, "; ".join(page._errs[:2]))
    check("Local date key is local, not UTC", st["today"] == page.evaluate(
        "()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}"))

    # ===================================================================
    print("\n=== B. DATA PERSISTENCE ACROSS REFRESH ===")
    page.evaluate("""async () => {
      // study record through the real save path (IndexedDB)
      await saveStudyRecord({subject:'Physics',chapter:'Laws of Motion',minutes:90,
        date:localDateKey(),type:'Learning',notes:'test',createdAt:new Date().toISOString()});
      // fitness
      fit.push({id:'fitness-t1',kind:'strength',exercise:'Squat',date:localDateKey(),
        sets:[5,5,5],totalReps:15,notes:'',createdAt:new Date().toISOString()});
      saveFit();
      // calendar
      events.push({id:'ev-t1',title:'Physics tuition',date:localDateKey(),start:'18:00',
        end:'19:00',category:'study',remind:10,createdAt:new Date().toISOString()});
      saveEvents();
      // task
      tasks.push({id:'task-t1',text:'Revise motion',completed:false,day:localDateKey()});
      saveTasks();
    }""")
    page.wait_for_timeout(600)
    page.reload(); page.wait_for_timeout(1800)
    st = page.evaluate("""() => ({
      study: studyRecords.length, fitness: fit.length,
      events: events.length, tasks: tasks.length,
      studySubject: studyRecords[0] && studyRecords[0].subject,
    })""")
    check("Study record survives refresh", st["study"] == 1, f"{st['study']} record(s), {st['studySubject']}")
    check("Fitness record survives refresh", st["fitness"] == 1)
    check("Calendar event survives refresh", st["events"] == 1)
    check("Task survives refresh", st["tasks"] == 1)

    # ===================================================================
    print("\n=== C. 75 XP MAJOR TASKS + IDEMPOTENCE ===")
    st = page.evaluate("""() => {
      const before = APEXXP.progress().total;
      const milestoneValue = APEX_XP.values.milestone;
      // force a milestone: award the same key three times
      const a = xpAward('milestone:test-target', milestoneValue, 'Target reached: test', 'milestone');
      const b = xpAward('milestone:test-target', milestoneValue, 'Target reached: test', 'milestone');
      const c = xpAward('milestone:test-target', milestoneValue, 'Target reached: test', 'milestone');
      return { milestoneValue, before, a, b, c, after: APEXXP.progress().total };
    }""")
    check("Major task reward is 75 XP", st["milestoneValue"] == 75, f"{st['milestoneValue']} XP")
    check("First award grants 75 XP", st["a"] == 75)
    check("Repeat clicks award nothing", st["b"] == 0 and st["c"] == 0, f"2nd={st['b']}, 3rd={st['c']}")
    check("Total rose by exactly 75", st["after"] - st["before"] == 75,
          f"{st['before']} -> {st['after']}")

    st = page.evaluate("""() => {
      const before = APEXXP.progress().total;
      const t = tasks[0];
      setTaskCompleted(0, true);   // first completion
      const mid = APEXXP.progress().total;
      setTaskCompleted(0, false);  // untick
      setTaskCompleted(0, true);   // re-tick
      return { before, mid, after: APEXXP.progress().total, taskXP: APEX_XP.values.task };
    }""")
    check("Completing a task awards XP once", st["mid"] - st["before"] == st["taskXP"])
    check("Re-ticking a task awards nothing more", st["after"] == st["mid"],
          f"{st['mid']} -> {st['after']}")

    page.reload(); page.wait_for_timeout(1500)
    xp_after_reload = page.evaluate("() => APEXXP.progress().total")
    check("XP survives refresh without re-awarding", xp_after_reload == st["after"],
          f"{st['after']} -> {xp_after_reload}")

    # ===================================================================
    print("\n=== D. MIDNIGHT CROSSING (the original bug) ===")
    # Arm the exact trigger: a running timer that expires while the app is shut
    page.evaluate("""() => {
      localStorage.setItem('apexTimerState', JSON.stringify({
        running:true, remainingTime:2700000, totalDuration:2700000,
        endTime: Date.now()+2700000, selectedHours:0, selectedMinutes:45, selectedSeconds:0 }));
    }""")
    snapshot_before = page.evaluate("""() => ({
      study: studyRecords.length, fitness: fit.length, events: events.length,
      tasks: tasks.length, xp: APEXXP.progress().total,
      quote: document.getElementById('dailyQuote').textContent.trim(),
    })""")

    page.clock.install()
    page.clock.set_system_time("2026-11-17T03:30:00")   # 09:00 IST, NEXT local day
    page2 = new_page(ctx)
    page2.clock.install()
    page2.clock.set_system_time("2026-11-17T03:30:00")
    page2.goto(URL); page2.wait_for_timeout(2500)

    st = page2.evaluate("""() => ({
      study: studyRecords.length, fitness: fit.length, events: events.length,
      tasks: tasks.length, xp: APEXXP.progress().total,
      quote: document.getElementById('dailyQuote').textContent.trim(),
      quotesWork: typeof showDailyQuote,
      fitRendered: document.getElementById('fitRoot').childElementCount,
      calRendered: document.getElementById('calGrid').childElementCount,
      bootFailures: ApexBoot.failures.length,
      timerMsg: document.getElementById('timerMessage').textContent,
    })""")
    check("Study history survives midnight", st["study"] == snapshot_before["study"],
          f"{snapshot_before['study']} -> {st['study']}")
    check("Fitness history survives midnight", st["fitness"] == snapshot_before["fitness"])
    check("Calendar survives midnight", st["events"] == snapshot_before["events"])
    check("Task definitions survive midnight", st["tasks"] == snapshot_before["tasks"])
    check("XP survives midnight (never decreases)", st["xp"] >= snapshot_before["xp"],
          f"{snapshot_before['xp']} -> {st['xp']}")
    check("...and the rise is exactly the overnight focus session, nothing else",
          st["xp"] - snapshot_before["xp"] in (0, 10),
          f"+{st['xp'] - snapshot_before['xp']} XP (focusSession = 10)")
    check("Quotes still display after midnight",
          len(st["quote"]) > 10 and "Import" not in st["quote"], st["quote"][:55])
    check("Fitness module still initialises after midnight", st["fitRendered"] > 0)
    check("Calendar module still initialises after midnight", st["calRendered"] > 0)
    check("No boot failures after midnight", st["bootFailures"] == 0)
    check("Expired overnight timer handled without crashing", not page2._errs,
          "; ".join(page2._errs[:2]) or st["timerMsg"][:50])

    # the ORIGINAL symptom, explicitly
    check("ORIGINAL BUG FIXED: no '$ before initialization' error",
          not any("before initialization" in e for e in page2._errs))

    # ===================================================================
    print("\n=== E. XP 'TODAY' USES THE LOCAL DAY (IST) ===")
    st = page2.evaluate("""() => {
      // A transaction stamped at 01:00 IST = 19:30 UTC the PREVIOUS day.
      const localNow = new Date();
      const todayKey = ApexDate.today();
      const earlyLocal = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate(), 1, 0, 0);
      xpLedger.push({id:'xp-tztest', key:'tz:test', amount:42, reason:'TZ probe',
                     source:'study', at: earlyLocal.toISOString(), day: ApexDate.key(earlyLocal)});
      return { todayKey, utcSliceOfEntry: earlyLocal.toISOString().slice(0,10),
               localDayOfEntry: ApexDate.key(earlyLocal), todayTotalIncludes: xpTodayTotal() };
    }""")
    check("A 01:00 IST entry has a UTC date of the previous day (bug precondition)",
          st["utcSliceOfEntry"] != st["todayKey"],
          f"UTC slice {st['utcSliceOfEntry']} vs local {st['todayKey']}")
    check("...but APEX files it under the correct LOCAL day",
          st["localDayOfEntry"] == st["todayKey"])
    check("...and it counts towards XP TODAY", st["todayTotalIncludes"] >= 42,
          f"+{st['todayTotalIncludes']} today")

    # ===================================================================
    print("\n=== F. QUOTES: IMPORT, PERSISTENCE, MODES ===")
    st = page2.evaluate("""() => {
      const txt = `# my quotes
Discipline is the bridge between goals and accomplishment. | Jim Rohn

Hard choices, easy life. Easy choices, hard life. | Jerzy Gregorek
Discipline is the bridge between goals and accomplishment. | Jim Rohn
   
The obstacle is the way — Ryan Holiday
`;
      const r1 = ApexQuotes.import(txt, 'merge');
      const builtinsIntact = ApexQuotes.BUILTIN.length;
      const r2 = ApexQuotes.import(txt, 'merge');   // same file again
      return { added: r1.added, dupes: r1.dupes, total: r1.total, msg: r1.message,
               secondAdded: r2.added, secondDupes: r2.duplicates,
               builtinsIntact, personal: ApexQuotes.loadPersonal().length,
               parsedAuthor: ApexQuotes.parse(txt)[0].author,
               dashAuthor: ApexQuotes.parse(txt).slice(-1)[0].author };
    }""")
    check("Import parses 'Quote | Author'", st["parsedAuthor"] == "Jim Rohn", st["parsedAuthor"])
    check("Import parses a trailing dash author", st["dashAuthor"] == "Ryan Holiday", st["dashAuthor"])
    check("Blank lines and # comments ignored, duplicates skipped",
          st["added"] == 3, f"{st['added']} added from 4 quote lines (1 was a duplicate)")
    check("Re-importing the same file adds nothing", st["secondAdded"] == 0,
          f"{st['secondDupes']} duplicates skipped")
    check("Built-in library untouched by import", st["builtinsIntact"] >= 100)

    page2.reload(); page2.wait_for_timeout(1800)
    st = page2.evaluate("""() => ({
      personal: ApexQuotes.loadPersonal().length,
      pool: ApexQuotes.pool().length,
      builtinOnly: (()=>{const p=ApexQuotes.loadPrefs();p.mode='builtin';ApexQuotes.savePrefs(p);
                         return ApexQuotes.pool().length})(),
      personalOnly:(()=>{const p=ApexQuotes.loadPrefs();p.mode='personal';ApexQuotes.savePrefs(p);
                         return ApexQuotes.pool().length})(),
      both:        (()=>{const p=ApexQuotes.loadPrefs();p.mode='both';ApexQuotes.savePrefs(p);
                         return ApexQuotes.pool().length})(),
      emptyPersonalFallback: (()=>{
        const keep = ApexQuotes.loadPersonal();
        ApexQuotes.clearPersonal();
        const p=ApexQuotes.loadPrefs(); p.mode='personal'; ApexQuotes.savePrefs(p);
        const n = ApexQuotes.pool().length;
        ApexStore.write('apexQuoteLibrary', keep);
        p.mode='both'; ApexQuotes.savePrefs(p);
        return n; })(),
    })""")
    check("Personal quotes survive a refresh", st["personal"] == 3, f"{st['personal']} quotes")
    check("BUILT-IN mode pool", st["builtinOnly"] >= 100, f"{st['builtinOnly']}")
    check("PERSONAL mode pool", st["personalOnly"] == 3, f"{st['personalOnly']}")
    check("BOTH mode pool is the sum", st["both"] == st["builtinOnly"] + 3, f"{st['both']}")
    check("Empty personal library falls back to built-ins, never blank",
          st["emptyPersonalFallback"] >= 100, f"{st['emptyPersonalFallback']}")

    st = page2.evaluate("""() => {
      const d1 = ApexQuotes.ofTheDay('2026-11-17');
      const d2 = ApexQuotes.ofTheDay('2026-11-17');
      const d3 = ApexQuotes.ofTheDay('2026-11-18');
      return { same: d1.text === d2.text, differentDay: d1.text !== d3.text, t: d1.text };
    }""")
    check("Same day gives the same quote on repeat calls", st["same"], st["t"][:45])
    check("A new day can give a different quote", st["differentDay"])

    # ===================================================================
    print("\n=== G. STORAGE INTEGRITY ===")
    st = page2.evaluate("""() => {
      // corrupt a key and make sure it is quarantined, not silently emptied
      localStorage.setItem('apexFitnessRecords', '{{{not json');
      ApexStore._mem.delete('apexFitnessRecords');
      const got = ApexStore.read('apexFitnessRecords', []);
      const quarantined = Object.keys(localStorage).filter(k=>k.startsWith('apex.corrupt.apexFitnessRecords'));
      return { returned: Array.isArray(got) ? got.length : 'not-array',
               quarantinedCount: quarantined.length,
               rawKept: quarantined.length ? localStorage.getItem(quarantined[0]) : null };
    }""")
    check("Corrupt value is quarantined, not discarded", st["quarantinedCount"] == 1)
    check("The original raw bytes are preserved", st["rawKept"] == "{{{not json", str(st["rawKept"]))
    check("Caller gets the fallback so the UI still renders", st["returned"] == 0)

    st = page2.evaluate("""() => {
      const ok = ApexStore.write('apexTestKey', {a:1,b:[1,2,3]});
      const back = ApexStore.read('apexTestKey', null);
      return { ok, roundTrip: JSON.stringify(back) === JSON.stringify({a:1,b:[1,2,3]}),
               health: ApexStore.health() };
    }""")
    check("Write is verified by read-back", st["ok"] and st["roundTrip"])
    check("Storage health reports correctly", st["health"]["localStorageWorking"],
          f"{st['health']['approxBytesUsed']//1024} KB used, {st['health']['pendingWrites']} pending")

    page2.evaluate("""() => {
      // Put the deliberately corrupted key back before testing export/import,
      // otherwise we would be measuring the corruption test, not the round trip.
      ApexStore.write('apexFitnessRecords', [{id:'fitness-t1',kind:'strength',
        exercise:'Squat',date:localDateKey(),sets:[5,5,5],totalReps:15}]);
    }""")

    idb = page2.evaluate("""async () => {
      const rows = await ApexStore.idbAll('kv');
      const snaps = await ApexStore.listSnapshots();
      return { mirrored: rows.length, snapshots: snaps.length };
    }""")
    check("Writes are mirrored into IndexedDB", idb["mirrored"] > 5, f"{idb['mirrored']} keys mirrored")
    check("Daily snapshot taken", idb["snapshots"] >= 1, f"{idb['snapshots']} snapshot(s)")

    # localStorage eviction recovery
    st = page2.evaluate("""async () => {
      const before = JSON.parse(localStorage.getItem('apexEvents')||'[]').length;
      localStorage.removeItem('apexEvents');          // simulate iOS eviction
      ApexStore._mem.delete('apexEvents');
      const restored = await ApexStore.recover();
      const after = JSON.parse(localStorage.getItem('apexEvents')||'[]').length;
      return { before, after, restored };
    }""")
    check("Evicted localStorage key recovered from the IndexedDB mirror",
          st["after"] == st["before"] and st["before"] > 0,
          f"{st['before']} events lost then recovered: {st['restored']}")

    # ===================================================================
    print("\n=== H. IMPORT / EXPORT ===")
    st = page2.evaluate("""() => {
      const backup = apexBuildBackup();
      const v = apexValidateBackup(backup);
      return { schema: backup.schemaVersion, app: backup.appVersion,
               hasTimestamp: !!backup.createdAt, integrity: backup.integrity.value,
               valid: v.ok, counts: v.counts, problems: v.problems };
    }""")
    check("Export is versioned", st["schema"] == 2 and st["app"] == "5.1", f"schema v{st['schema']}, app {st['app']}")
    check("Export carries a timestamp", st["hasTimestamp"])
    check("Export carries an integrity checksum", len(st["integrity"]) > 3, st["integrity"])
    check("Its own export validates", st["valid"], "; ".join(st["problems"]))
    check("Export contains the real records",
          st["counts"]["studyRecords"] >= 1 and st["counts"]["events"] >= 1,
          json.dumps(st["counts"]))

    st = page2.evaluate("""() => {
      const good = apexBuildBackup();
      const tampered = JSON.parse(JSON.stringify(good));
      tampered.localStorage.apexTasks = '[{"id":"x","text":"injected"}]';   // edited
      const notApex   = apexValidateBackup({format:'something-else'});
      const badSchema = apexValidateBackup({...good, schemaVersion: 99});
      const corrupt   = apexValidateBackup({...good,
                          localStorage: {...good.localStorage, apexTasks:'{{{bad'}});
      const edited    = apexValidateBackup(tampered);
      return { notApex: notApex.ok, badSchema: badSchema.ok, corrupt: corrupt.ok,
               editedOk: edited.ok, editedWarns: edited.warnings,
               corruptProblems: corrupt.problems };
    }""")
    check("Non-APEX file rejected", not st["notApex"])
    check("Future schema version rejected", not st["badSchema"])
    check("Corrupt section rejected (no partial import)", not st["corrupt"],
          "; ".join(st["corruptProblems"]))
    check("Edited file is flagged by the checksum",
          any("integrity" in w for w in st["editedWarns"]), "; ".join(st["editedWarns"]))

    # XP export/import
    st = page2.evaluate("""() => {
      const xp = apexBuildXPExport();
      const v  = apexValidateXP(xp);
      const neg  = apexValidateXP({...xp, state:{...xp.state, totalXP:-5}});
      const huge = apexValidateXP({...xp, state:{...xp.state, totalXP:99999999}});
      const nan  = apexValidateXP({...xp, state:{...xp.state, totalXP:'banana'}});
      const wrongLevel = apexValidateXP({...xp, derived:{...xp.derived, level: 99}});
      return { format: xp.format, schema: xp.schemaVersion, total: xp.derived.totalXP,
               level: xp.derived.level, txns: xp.counts.transactions,
               valid: v.ok, neg: neg.ok, huge: huge.ok, nan: nan.ok,
               wrongLevelOk: wrongLevel.ok, wrongLevelWarns: wrongLevel.warnings };
    }""")
    check("XP export is a separate versioned channel",
          st["format"] == "apex-xp" and st["schema"] == 1)
    check("XP export carries level and transactions",
          st["level"] >= 1 and st["txns"] > 0, f"level {st['level']}, {st['txns']} txns, {st['total']} XP")
    check("Valid XP file accepted", st["valid"])
    check("Negative XP rejected", not st["neg"])
    check("Implausible XP rejected", not st["huge"])
    check("Non-numeric XP rejected", not st["nan"])
    check("Level/XP mismatch detected and recomputed",
          st["wrongLevelOk"] and any("recomputed" in w for w in st["wrongLevelWarns"]),
          "; ".join(st["wrongLevelWarns"]))

    # failed import leaves data intact
    st = page2.evaluate("""async () => {
      const before = { tasks: ApexStore.read('apexTasks',[]).length,
                       xp: ApexStore.read('apexXPState',{}).totalXP };
      const bad = new File(['not json at all'], 'bad.json', {type:'application/json'});
      const r1 = await apexImportBackup(bad, 'replace');
      const r2 = await apexImportXP(bad, 'replace');
      const after = { tasks: ApexStore.read('apexTasks',[]).length,
                      xp: ApexStore.read('apexXPState',{}).totalXP };
      return { r1ok: r1.ok, r2ok: r2.ok, before, after };
    }""")
    check("Malformed backup import refused", not st["r1ok"])
    check("Malformed XP import refused", not st["r2ok"])
    check("Failed imports left existing data untouched",
          st["before"] == st["after"], f"{st['before']} -> {st['after']}")

    # round-trip into a CLEAN environment
    export_json = page2.evaluate("() => JSON.stringify(apexBuildBackup())")
    expected = page2.evaluate("""() => ({
      study: studyRecords.length, fitness: fit.length, events: events.length,
      tasks: tasks.length, xp: APEXXP.progress().total,
      quotes: ApexQuotes.loadPersonal().length })""")

    ctx2 = b.new_context(timezone_id="Asia/Kolkata")
    clean = new_page(ctx2); clean.goto(URL); clean.wait_for_timeout(1800)
    fresh_counts = clean.evaluate("() => ({study: studyRecords.length, events: events.length})")
    check("Clean environment starts empty",
          fresh_counts["study"] == 0 and fresh_counts["events"] == 0, json.dumps(fresh_counts))

    clean.evaluate("""async (payload) => {
      const file = new File([payload], 'apex-backup.json', {type:'application/json'});
      window.__r = await apexImportBackup(file, 'replace');
    }""", export_json)
    clean.wait_for_timeout(700)
    res = clean.evaluate("() => window.__r")
    clean.reload(); clean.wait_for_timeout(2000)
    got = clean.evaluate("""() => ({
      study: studyRecords.length, fitness: fit.length, events: events.length,
      tasks: tasks.length, xp: APEXXP.progress().total,
      quotes: ApexQuotes.loadPersonal().length })""")
    check("Import into a clean environment succeeded", res["ok"], res["message"][:70])
    for k in ("study","fitness","events","tasks","quotes"):
        check(f"Round-trip restored {k}", got[k] == expected[k], f"{expected[k]} -> {got[k]}")
    check("Round-trip restored XP", got["xp"] == expected["xp"], f"{expected['xp']} -> {got['xp']}")

    # merge mode
    st = clean.evaluate("""async (payload) => {
      const before = ApexStore.read('apexEvents',[]).length;
      const parsed = JSON.parse(payload);
      const extra = JSON.parse(parsed.localStorage.apexEvents);
      extra.push({id:'ev-merge-new', title:'Merged event', date:localDateKey(),
                  start:'20:00', category:'other', remind:0});
      parsed.localStorage.apexEvents = JSON.stringify(extra);
      delete parsed.integrity;
      const file = new File([JSON.stringify(parsed)], 'm.json', {type:'application/json'});
      const r = await apexImportBackup(file, 'merge');
      return { ok:r.ok, before, after: ApexStore.read('apexEvents',[]).length, msg:r.message };
    }""", export_json)
    check("Merge adds only new records, keeps existing",
          st["ok"] and st["after"] == st["before"] + 1,
          f"{st['before']} -> {st['after']}")

    # ===================================================================
    print("\n=== I. MONACO VISUALISATION ===")
    mon = clean.evaluate("""async () => {
      const c = await ApexMonaco.loadCircuit();
      const idx = ApexMonaco.buildCornerIndex(c);
      const hp = idx.find(x=>x.isHairpin);
      return { points: c.points.length, closedLen: c.geometry.measuredLength_m,
               published: c.published.length_m, corners: c.published.corners,
               features: idx.length, publishedNames: c.publishedCorners.length,
               // every derived feature must sit exactly on a real vertex
               allOnTrack: idx.every(f => c.points[f.vertexIndex] &&
                                     c.points[f.vertexIndex].lon === f.lon &&
                                     c.points[f.vertexIndex].lat === f.lat),
               hairpinTurn: hp ? Math.abs(hp.headingChange_deg) : 0,
               hairpinLat: hp ? hp.lat : 0, hairpinLon: hp ? hp.lon : 0,
               hairpinFrac: hp ? hp.s_m / c.geometry.measuredLength_m : 0,
               licence: c.geometry.licence, startS: c.points[0].s,
               monotonic: c.points.every((p,i)=> i===0 || p.s > c.points[i-1].s) };
    }""")
    check("Circuit geometry loads", mon["points"] == 159, f"{mon['points']} vertices")
    check("Measured length matches published within 1%",
          abs(mon["closedLen"] - mon["published"]) / mon["published"] < 0.01,
          f"{mon['closedLen']} m vs {mon['published']} m "
          f"({abs(mon['closedLen']-mon['published'])/mon['published']*100:.2f}%)")
    check("Geometry carries its licence", "ODbL" in mon["licence"], mon["licence"])
    check("Distance starts at 0 at start/finish and increases", mon["startS"] == 0 and mon["monotonic"])
    check("Derived turns sit exactly on the centreline (zero offset)",
          mon["allOnTrack"] and mon["features"] > 15, f"{mon['features']} turns detected")
    check("Published corner names listed separately", mon["publishedNames"] >= 14,
          f"{mon['publishedNames']} published names")
    check("Hairpin identified: only corner that doubles back",
          mon["hairpinTurn"] > 300, f"{mon['hairpinTurn']:.0f} deg of heading change")
    check("Hairpin located beside the Fairmont Monte Carlo",
          abs(mon["hairpinLat"] - 43.7402) < 0.001 and abs(mon["hairpinLon"] - 7.4297) < 0.001,
          f"{mon['hairpinLat']:.4f}N {mon['hairpinLon']:.4f}E")
    check("Hairpin falls about a third into the lap (published structure)",
          0.25 < mon["hairpinFrac"] < 0.45, f"{mon['hairpinFrac']*100:.0f}% of the lap")

    # The datum maths, with a controlled synthetic elevation set
    dat = clean.evaluate("""async () => {
      const c = await ApexMonaco.loadCircuit();
      const samples = c.points.map((p,i)=> 10 + (i % 7) * 5);   // known min 10, max 40
      const d = ApexMonaco.computeDatum(c, {samples});
      return { min: d.minAbsolute_m, max: d.maxAbsolute_m, range: d.range_m,
               relAtMin: d.relative[d.minIndex], relAtMax: d.relative[d.maxIndex],
               allNonNegative: d.relative.every(v=>v>=0),
               spotCheck: d.relative.map((v,i)=> v === samples[i]-10).every(Boolean),
               formula: d.formula };
    }""")
    check("Datum: lowest point is exactly 0 m", dat["relAtMin"] == 0, f"{dat['relAtMin']} m")
    check("Datum: no negative relative heights", dat["allNonNegative"])
    check("Datum: highest point equals the range", dat["relAtMax"] == dat["range"],
          f"+{dat['relAtMax']} m == range {dat['range']} m")
    check("Datum: every point verified as sample − min",
          dat["spotCheck"], dat["formula"])
    check("Datum: absolute and relative kept distinct",
          dat["min"] == 10 and dat["relAtMin"] == 0,
          f"lowest is {dat['min']} m ASL but 0 m relative")

    # render the page
    clean.evaluate("() => window.apexOpenPage('monaco')")
    clean.wait_for_timeout(3500)
    ui = clean.evaluate("""() => ({
      canvas: !!document.querySelector('#monacoStage canvas'),
      stageMsg: (document.querySelector('#monacoStage .empty-state')||{}).textContent || '',
      profile: !!document.querySelector('#monacoProfile svg'),
      facts: document.querySelectorAll('.monaco-fact').length,
      cornerRows: document.querySelectorAll('.monaco-corner-row').length,
      sources: document.querySelectorAll('.monaco-source-list li').length,
      status: (document.getElementById('monacoStatus')||{}).textContent,
      tools: [...document.querySelectorAll('#monacoTools button')].map(b=>b.textContent),
    })""")
    check("3D canvas renders", ui["canvas"], ui["stageMsg"][:70] or "canvas present")
    check("Circuit info panel populated", ui["facts"] >= 7, f"{ui['facts']} facts")
    check("Turn list populated", ui["cornerRows"] > 15, f"{ui['cornerRows']} turns")
    check("Published names shown separately",
          clean.evaluate("()=>document.querySelectorAll('.monaco-named-row').length") >= 14)
    check("Data provenance shown to the user", ui["sources"] >= 6, f"{ui['sources']} source notes")
    check("No-elevation state is stated honestly, not faked",
          "not loaded" in (ui["status"] or "").lower(), ui["status"])
    check("Fetch-elevation control offered", any("FETCH" in t for t in ui["tools"]),
          ", ".join(ui["tools"]))

    # Monaco must not disturb other modules
    other = clean.evaluate("""() => {
      window.apexOpenPage('study');
      const s = studyRecords.length;
      window.apexOpenPage('calendar');
      const e = events.length;
      window.apexOpenPage('home');
      return { study: s, events: e, errs: ApexBoot.failures.length,
               canvasGone: !document.querySelector('#monacoStage canvas') };
    }""")
    clean.wait_for_timeout(500)
    check("Monaco does not disturb other modules' data",
          other["study"] == got["study"] and other["events"] >= 1,
          f"study {other['study']}, events {other['events']}")
    check("Monaco tears down its WebGL context on leave", other["canvasGone"])
    check("No boot failures after visiting Monaco", other["errs"] == 0)

    # ===================================================================
    print("\n=== J. PRESERVED MODULES + RESPONSIVENESS ===")
    pages = clean.evaluate("""() => {
      const out = {};
      ['home','study','tasks','fitness','calendar','habits','progression','stadium','monaco'].forEach(n=>{
        window.apexOpenPage(n);
        const sec = document.querySelector(`[data-page-section="${n}"]`);
        out[n] = sec ? sec.querySelectorAll('*').length : -1;
      });
      window.apexOpenPage('home');
      return out;
    }""")
    for name, n in pages.items():
        check(f"Module '{name}' renders", n > 10, f"{n} nodes")

    garage = clean.evaluate("""() => ({
      canvas: !!document.getElementById('garageCanvas'),
      parts: document.getElementById('garageParts').childElementCount,
      watch: !!document.getElementById('watchSlot'),
      xpStrip: document.getElementById('xpHomeStrip').childElementCount })""")
    check("APEX Garage preserved", garage["canvas"] and garage["parts"] > 0)
    check("Watch feature preserved", garage["watch"])
    check("XP home strip preserved", garage["xpStrip"] > 0)

    ioph = b.new_context(timezone_id="Asia/Kolkata",
                         viewport={"width":390,"height":844}, is_mobile=True,
                         has_touch=True, device_scale_factor=3)
    mp = new_page(ioph); mp.goto(URL); mp.wait_for_timeout(1800)
    mp.evaluate("() => window.apexOpenPage('monaco')")
    mp.wait_for_timeout(3000)
    mob = mp.evaluate("""() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      canvas: !!document.querySelector('#monacoStage canvas'),
      stageH: (document.querySelector('.monaco-stage')||{}).clientHeight,
      errs: ApexBoot.failures.length })""")
    check("No horizontal overflow at 390px (iPhone)", not mob["overflow"],
          f"scrollWidth vs 390")
    check("Monaco renders on mobile", mob["canvas"], f"stage {mob['stageH']}px tall")
    check("No boot failures on mobile", mob["errs"] == 0)
    check("No page errors on mobile", not mp._errs, "; ".join(mp._errs[:2]))

    b.close()

# ===================================================================
passed = sum(1 for _,ok,_ in RESULTS if ok)
total = len(RESULTS)
print("\n" + "="*70)
print(f"  {passed}/{total} checks passed, {total-passed} failed")
print("="*70)
if total - passed:
    print("\nFAILURES:")
    for n, ok, d in RESULTS:
        if not ok: print(f"  - {n}  ({d})")
sys.exit(0 if passed == total else 1)
