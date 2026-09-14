// Full server backup, and restore from one.
//
// Capt. Weera: "download ทุกอย่างที่มาจาก server เก็บไว้เครื่อง เป็น backup
// กรณี server ล่ม หรือพัง เราสามารถ upload กลับเข้าระบบได้".
//
// WHAT A BACKUP HAS TO GET RIGHT, and what most get wrong
//
// A backup is only worth what a RESTORE produces. Three things follow from
// that, and each one is a deliberate choice below rather than an accident:
//
//   1. EVERY table, or the file says so. A snapshot missing one table looks
//      complete, restores cleanly, and quietly loses a year of training
//      records. So the table list is explicit, every table is read to the last
//      row, and any table that fails to read marks the whole file INCOMPLETE
//      instead of being silently omitted.
//
//   2. Rows are stored EXACTLY as the server returned them, including uuid,
//      timestamps and deleted_at. Not a tidied-up shape. A restore has to
//      recreate what was there - including which rows were soft-deleted, or
//      deleted duty would come back to life and start counting towards FTL
//      again.
//
//   3. The file states its own row counts. A restore can then verify what it
//      read against what was written, so a truncated download is caught before
//      it is trusted as the only copy of the data.

const FORMAT = "avicore-backup";
const FORMAT_VERSION = 1;

// Every table, with the key that identifies a row for restore.
//
// `conflict` is what upsert matches on. Getting it wrong is what turns a
// restore into duplicate rows, so each one is the column the app's own writes
// already treat as the row's identity.
export const BACKUP_TABLES = [
  { table: "app_settings", conflict: "key", label: "Settings" },
  { table: "pilot_experience", conflict: "licence_key", label: "Pilot experience" },
  { table: "pilot_training", conflict: "code_key", label: "Training records" },
  { table: "pilot_duty_entries", conflict: "uuid", label: "Daily duty entries" },
  { table: "pilot_roster", conflict: null, label: "Roster" },
  { table: "pilot_weekly_plan", conflict: null, label: "Weekly plan" },
  // Login history is included for completeness but is NOT restored: it is an
  // audit trail of things that happened, and writing old events back would
  // fabricate logins at times they did not occur.
  { table: "crew_login_events", conflict: null, label: "Crew login history", restore: false }
];

const PAGE = 1000;

/**
 * Reads every row of every table into one snapshot object.
 *
 * @param sb          a Supabase client
 * @param onProgress  ({ done, total, label }) => void
 */
export async function createBackup(sb, onProgress) {
  const report = typeof onProgress === "function" ? onProgress : () => {};
  const tables = {};
  const counts = {};
  const failed = [];

  for (let i = 0; i < BACKUP_TABLES.length; i++) {
    const { table, label } = BACKUP_TABLES[i];
    report({ done: i, total: BACKUP_TABLES.length, label });
    try {
      const rows = await readAll(sb, table);
      tables[table] = rows;
      counts[table] = rows.length;
    } catch (err) {
      // Recorded, not swallowed. A table that could not be read must make the
      // file visibly incomplete - a backup you cannot trust is worse than no
      // backup, because it stops you making a real one.
      failed.push({ table, label, error: err.message });
    }
  }

  report({ done: BACKUP_TABLES.length, total: BACKUP_TABLES.length, label: "Done" });

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    complete: failed.length === 0,
    failed,
    counts,
    tables
  };
}

// Reads a table to the LAST row.
//
// PostgREST caps an unbounded select at 1000 rows and returns the first 1000
// with no error - the same silent truncation that made the imported-file list
// show only two pilots. In a backup it would mean a file that looks fine and
// is missing most of the data, so this pages until a short page ends it.
async function readAll(sb, table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Checks a parsed file before anything is written.
 *
 * Deliberately strict: a restore overwrites live data, so the moment to reject
 * a bad file is before the first row goes in, not halfway through.
 */
export function validateBackup(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["Not a readable backup file."], warnings };
  }
  if (data.format !== FORMAT) {
    errors.push("This is not an AviCore backup file.");
  }
  if (Number(data.formatVersion) > FORMAT_VERSION) {
    errors.push(`This file was made by a newer version of AviCore (format ${data.formatVersion}). Update before restoring.`);
  }
  if (!data.tables || typeof data.tables !== "object") {
    errors.push("The file contains no table data.");
  }

  if (data.complete === false) {
    // Allowed, but stated plainly. Sometimes an incomplete backup is all there
    // is, and restoring most of the data beats restoring none - the operator
    // just has to know which it is.
    warnings.push(
      "This backup is marked INCOMPLETE — one or more tables failed to download when it was made" +
      (Array.isArray(data.failed) && data.failed.length
        ? `: ${data.failed.map((f) => f.label || f.table).join(", ")}`
        : ".")
    );
  }

  // Row counts recorded at backup time vs rows actually present, so a file
  // truncated in transit is caught rather than restored.
  if (data.counts && data.tables) {
    for (const [table, expected] of Object.entries(data.counts)) {
      const actual = Array.isArray(data.tables[table]) ? data.tables[table].length : 0;
      if (actual !== Number(expected)) {
        errors.push(`${table}: file says ${expected} rows but contains ${actual} — the file is damaged or truncated.`);
      }
    }
  }

  for (const { table, label, restore } of BACKUP_TABLES) {
    if (restore === false) continue;
    if (!data.tables?.[table]) warnings.push(`No ${label.toLowerCase()} in this file.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Writes a validated backup back to the server.
 *
 * Upsert, not delete-then-insert. A restore that empties a table first has a
 * window where the data exists nowhere: if it fails mid-way - connection drops,
 * one bad row - the live data is gone AND the restore is incomplete. Upserting
 * leaves anything the backup does not mention untouched, which is the
 * conservative direction to fail in.
 *
 * `deleted_at` is carried through, so rows that were soft-deleted stay deleted
 * rather than reappearing and counting towards FTL totals again.
 */
export async function restoreBackup(sb, data, onProgress) {
  const report = typeof onProgress === "function" ? onProgress : () => {};
  const check = validateBackup(data);
  if (!check.ok) return { ok: false, errors: check.errors, restored: {} };

  const restorable = BACKUP_TABLES.filter((t) => t.restore !== false);
  const restored = {};
  const errors = [];

  for (let i = 0; i < restorable.length; i++) {
    const { table, conflict, label } = restorable[i];
    const rows = data.tables?.[table];
    if (!Array.isArray(rows) || rows.length === 0) { restored[table] = 0; continue; }

    report({ done: i, total: restorable.length, label });
    let written = 0;

    // In batches: a single request carrying tens of thousands of rows is
    // rejected or times out, and the operator is left not knowing how much
    // went in.
    for (let from = 0; from < rows.length; from += 500) {
      const batch = rows.slice(from, from + 500);
      try {
        const q = conflict
          ? sb.from(table).upsert(batch, { onConflict: conflict })
          : sb.from(table).upsert(batch);
        const { error } = await q;
        if (error) throw new Error(error.message);
        written += batch.length;
      } catch (err) {
        errors.push(`${label}: ${err.message} (rows ${from + 1}-${from + batch.length})`);
        break;   // stop this table, carry on with the others
      }
    }
    restored[table] = written;
  }

  report({ done: restorable.length, total: restorable.length, label: "Done" });
  return { ok: errors.length === 0, errors, restored, warnings: check.warnings };
}

// Filename carrying the date and time, so a folder of backups sorts
// chronologically and two taken on the same day do not collide.
export function backupFileName(at = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `AviCore_Backup_${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}` +
         `_${p(at.getHours())}${p(at.getMinutes())}.json`;
}

export function totalRows(counts) {
  return Object.values(counts || {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

// ---------------------------------------------------------------------------
// Backup reminder
// ---------------------------------------------------------------------------
//
// Capt. Weera asked for backups "ทุก ๆ 30 วัน เอง โดยอัตโนมัติ", and chose a
// REMINDER over a silent automatic download. That is the better of the two for
// a reason worth writing down: a web app only runs while a tab is open, so
// there is no background job either way - the only question is whether the file
// appears without anyone noticing.
//
// A backup nobody knows about is a backup nobody has checked. On the day the
// server is gone, what matters is that someone can say where the file is and
// that its row counts looked right. A banner that stays up until a human acts
// gives exactly that; a file quietly dropped in Downloads does not. (Browsers
// also commonly block downloads that were not started by a click.)
//
// The schedule lives in app_settings under BACKUP_STATE_KEY, so it is shared
// across every admin machine - one backup on any of them satisfies the fleet,
// rather than each PC nagging on its own clock.
export const BACKUP_STATE_KEY = "server_backup_state";
export const BACKUP_INTERVALS = [30, 60, 90];
export const DEFAULT_BACKUP_INTERVAL_DAYS = 30;

export function withBackupStateDefaults(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  const days = Number(s.intervalDays);
  return {
    // Reminders on by default. A feature meant to protect against losing
    // everything should not need switching on first.
    enabled: s.enabled !== false,
    intervalDays: BACKUP_INTERVALS.includes(days) ? days : DEFAULT_BACKUP_INTERVAL_DAYS,
    lastBackupAt: typeof s.lastBackupAt === "string" ? s.lastBackupAt : null,
    lastRowCount: Number(s.lastRowCount) || 0,
    lastComplete: s.lastComplete !== false
  };
}

/**
 * Whether a backup is due, and how the screen should say so.
 *
 * Returns { due, never, daysSince, daysUntilDue, overdueBy, text }.
 */
export function backupDueStatus(state, now = new Date()) {
  const s = withBackupStateDefaults(state);
  const interval = s.intervalDays;

  if (!s.lastBackupAt) {
    return {
      enabled: s.enabled, never: true, due: s.enabled, daysSince: null,
      daysUntilDue: 0, overdueBy: 0, intervalDays: interval,
      text: "No backup has been taken yet."
    };
  }

  const then = new Date(s.lastBackupAt);
  if (isNaN(then.getTime())) {
    return {
      enabled: s.enabled, never: true, due: s.enabled, daysSince: null,
      daysUntilDue: 0, overdueBy: 0, intervalDays: interval,
      text: "The last backup date could not be read."
    };
  }

  // Floored to whole days: "31 days ago" is what a person checks against a
  // 30-day rule, not "30.4".
  const daysSince = Math.floor((now - then) / 86400000);
  // A negative gap means the clock moved backwards. Treated as 0 rather than
  // trusted, so a clock change cannot postpone a backup indefinitely.
  const safeDays = Math.max(0, daysSince);
  const due = s.enabled && safeDays >= interval;

  return {
    enabled: s.enabled,
    never: false,
    due,
    daysSince: safeDays,
    daysUntilDue: Math.max(0, interval - safeDays),
    overdueBy: Math.max(0, safeDays - interval),
    intervalDays: interval,
    lastBackupAt: s.lastBackupAt,
    lastRowCount: s.lastRowCount,
    lastComplete: s.lastComplete,
    text: due
      ? `Backup is due — the last one was ${safeDays} day${safeDays === 1 ? "" : "s"} ago.`
      : `Last backup ${safeDays} day${safeDays === 1 ? "" : "s"} ago. Next due in ${Math.max(0, interval - safeDays)} day${interval - safeDays === 1 ? "" : "s"}.`
  };
}

// Stamped only after a backup has actually been written to a file, so a failed
// or abandoned attempt does not reset the clock and hide that one is still due.
export function stampedBackupState(state, backup, at = new Date()) {
  return {
    ...withBackupStateDefaults(state),
    lastBackupAt: at.toISOString(),
    lastRowCount: totalRows(backup?.counts),
    lastComplete: backup?.complete !== false
  };
}
