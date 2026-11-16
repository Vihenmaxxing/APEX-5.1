# APEX data storage architecture

> Short version: `localStorage` is the working store, IndexedDB is the
> durable mirror, and nothing is ever treated as "empty" just because a read
> failed.

---

## 1. Why the old architecture lost data

Three separate weaknesses, all of which 5.1 removes.

### 1.1 A read failure looked identical to no data

```js
function readStorage(key, fallback) {
    try { ... JSON.parse ... } catch { return fallback; }
}
```

Every possible failure — a quota error, a half-written value, corrupt JSON, a
transient `DOMException` — came back as the fallback, usually `[]`. The module
then rendered an empty list and **saved that empty list over the real one** on
the next write. One bad read, and the records were gone for good.

### 1.2 Failed writes were silent

`writeStorage()` returned `false` on failure, and `saveTasks()`, `saveFit()`
and `saveEvents()` all ignored the return value. The watch-photo feature
stores a base64 image in `localStorage`; once that pushes the origin past the
~5 MB quota, **every subsequent write fails silently**. The UI shows the new
record, the user believes it is saved, and it vanishes on refresh.

### 1.3 Nothing survived localStorage eviction

iOS clears `localStorage` for origins that are not marked persistent when the
device is under storage pressure. There was no second copy of anything.

---

## 2. The 5.1 layers

| Layer | Contents | Rationale |
|---|---|---|
| `localStorage` | tasks, habits + logs, fitness, events, quotes, XP state + ledger, timer, watch, preferences | Small and synchronous. The modules read it during initialisation, so it cannot be async |
| IndexedDB `APEXDB.studyRecords` | study records | Grows without bound; wrong shape for localStorage |
| IndexedDB `APEXDB.kv` | a mirror of every localStorage key | Much larger quota, survives eviction. **This is the recovery path** |
| IndexedDB `APEXDB.backups` | 14 rolling snapshots | Automatic, non-destructive safety net |

`APEXDB` moved from version 1 to version 2. The upgrade is **purely additive**:
the existing `studyRecords` store is never dropped, cleared or recreated.

### Keys

```
apexTasks            apexSessions          apexStudyRecords (fallback only)
apexTimerState       apexHabits            apexHabitLogs
apexQuoteLibrary     apexDailyQuote        apexQuotePrefs      (new)
apexEvents           apexNotifyPrefs       apexFitnessRecords
apexWatch            apexXPState           apexXPLedger
apexStadiumPrefs     apexMonacoPrefs       (new)

apex.corrupt.<key>.<timestamp>    quarantined values, never auto-deleted
```

Every original key name is unchanged, so upgrading from 5.0 preserves
everything in place with no migration step.

---

## 3. Guarantees

**Reads cannot regress to empty.** A live in-memory cache sits in front of
`localStorage`. Once a value has been seen in a session, a later failed read
returns the cached value, not `[]`.

**Writes are verified.** `ApexStore.write()` writes, reads back, and compares.
An unconfirmed write is queued in `PENDING`, retried every 15 seconds and on
`online`, and reported to the caller. The Progression page surfaces this as
STORAGE HEALTH before it costs anything.

**Corrupt values are quarantined, not discarded.** A value that will not parse
is copied to `apex.corrupt.<key>.<timestamp>` and left there. The caller gets
the fallback so the UI still renders, but the original bytes survive for
manual recovery.

**Everything is mirrored.** Every write also goes to `APEXDB.kv`. At boot,
`ApexStore.recover()` restores any key the mirror knows about and
`localStorage` does not. It only ever *adds* — a key present in `localStorage`
is never overwritten by the mirror.

**Failure is never silent.** Storage problems dispatch `apex:storage` on
`window` and are logged.

---

## 4. Dates

One definition, in `core.js`:

```js
ApexDate.key(date)   // YYYY-MM-DD in the device's LOCAL timezone
```

Built from `getFullYear()` / `getMonth()` / `getDate()` — never from
`toISOString()`, which is always UTC. East of UTC the two disagree for part of
every day; in IST (UTC+5:30), by a full calendar day between 00:00 and 05:30.

`ApexDate.fromKey()` returns a Date at **local noon**, so adding or
subtracting days cannot be pushed across a boundary by a daylight-saving shift.

`createdAt` fields remain UTC ISO strings. They record an *instant*, which is
the correct use of UTC. XP ledger entries now carry **both**: `at` (the UTC
instant) and `day` (the local calendar day). Anything asking "which day does
this belong to" uses `day`. Entries written by 5.0 have only `at`, so they are
converted back through a real `Date`, which resolves to the correct local day.

### Day rollover

`ApexDate` fires `apex:daychange` at local midnight. Three triggers, because
one is not enough: a timer aimed at the next local midnight, tab visibility
returning, and a 60-second clock-drift poll that catches a timezone change or
a corrected clock.

**A new day is a new day, not a new database.** The handler re-renders
date-sensitive views and takes a snapshot. It deletes nothing. Study history,
fitness history, calendar entries, task definitions, habit logs, XP and levels
are historical records and are never touched by a rollover.

---

## 5. Backup and recovery

### Manual — Progression page, APEX DATA

The export is a versioned JSON document:

```jsonc
{
  "format": "apex-backup",
  "schemaVersion": 2,
  "appVersion": "5.1",
  "platform": "browser",
  "createdAt": "2026-11-16T09:12:44.102Z",
  "createdDay": "2026-11-16",
  "timezone": "Asia/Kolkata",
  "counts":   { "localStorageKeys": 11, "studyRecords": 42 },
  "skipped":  [],
  "integrity":{ "algorithm": "fnv1a-32", "value": "2116be6c", "length": 18422 },
  "localStorage": { "apexTasks": "[...]" },
  "studyRecords": [ ... ]
}
```

Import validation, in order:

1. Parses as JSON.
2. Carries the `apex-backup` marker.
3. Schema version is understood (refuses anything newer than this build).
4. Contains at least one recognised APEX key.
5. **Every** value parses — one bad section fails the whole import. There are
   no partial restores.
6. Checksum is recomputed; a mismatch is a *warning*, not a refusal, so a
   hand-edited rescue file can still be used — but you are told.

Then: a **safety snapshot is taken**, the counts are shown, and you choose
merge or replace.

- **Merge** adds records not already present, matched on `id` (or
  `habitId` + `date` for habit logs). XP is never summed — that would invent
  progression — the higher total is kept and the `awarded` maps are unioned so
  nothing can be re-awarded.
- **Replace** overwrites, after a second confirmation.

A corrupt value is **never written into a backup**. If a key cannot be parsed,
the live in-memory value is used, or the key is omitted and named in
`skipped`. Exporting corrupt bytes verbatim would produce a file this
application's own validator refuses — an unrestorable "backup" that only
reveals itself at the moment it is needed.

### XP and level transfer

A separate `apex-xp` channel. Validation rejects negative, non-numeric and
implausible totals (>10,000,000). The **level is always recomputed from the XP
total** on this build's curve; a level recorded in the file is treated as a
claim to check, not a value to trust, and a mismatch is reported.

> For the record: no XP import/export existed in 4.7 or 5.0 — both were
> checked. This is new work built to the brief, not functionality recovered
> from the original.

### Automatic snapshots

One per local day, one before every import, kept in `APEXDB.backups`, newest
14 retained. Restorable from the Progression page. Pruning only ever removes
old *snapshots*, never records.

**These are a safety net, not a backup.** They live in the same browser
profile as the data they protect. Export a file as well.

---

## 6. What still is not protected

Stated plainly, because a false sense of safety is worse than none:

- Clearing site data in browser settings removes **everything**, including the
  IndexedDB mirror and snapshots. No application-side code can prevent this.
- Private/incognito windows discard all storage on close.
- `navigator.storage.persist()` is requested at startup, but the browser can
  decline. Grant status is shown in STORAGE HEALTH.
- There is no cloud sync and no cross-device automatic backup, by design.
  Moving data between devices means exporting a file.
