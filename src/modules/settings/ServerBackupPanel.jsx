import { useEffect, useState } from "react";
import {
  BACKUP_TABLES, validateBackup, backupFileName, totalRows,
  BACKUP_STATE_KEY, BACKUP_INTERVALS, withBackupStateDefaults,
  backupDueStatus, stampedBackupState
} from "../../services/serverBackup.js";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import "./Settings.css";

// Download everything on the server to a file, and put it back.
//
// Capt. Weera: "download ทุกอย่างที่มาจาก server เก็บไว้เครื่อง เป็น backup
// กรณี server ล่ม หรือพัง เราสามารถ upload กลับเข้าระบบได้".
//
// The screen is built around one idea: a backup is only worth what a RESTORE
// produces, so both directions are made verifiable rather than quick.
//
//   Download shows the row count per table. A file whose figures look wrong is
//   caught now, on a working system, instead of on the day the server is gone.
//
//   Restore is checked, then CONFIRMED BY TYPING. It writes over live data, and
//   this is the one screen in the app where a mis-click cannot simply be undone.
//
// Restore uses upsert rather than wipe-and-load: if it fails halfway the live
// data is still there. See serverBackup.js for the rest of the reasoning.

export default function ServerBackupPanel() {
  const [busy, setBusy] = useState("");            // "download" | "restore" | ""
  const [progress, setProgress] = useState(null);  // { done, total, label }
  const [result, setResult] = useState(null);      // last download summary
  const [msg, setMsg] = useState(null);
  const [pending, setPending] = useState(null);    // parsed file awaiting confirmation
  const [confirmText, setConfirmText] = useState("");
  // Reminder schedule, shared across admin machines via app_settings.
  const [state, setState] = useState(withBackupStateDefaults(null));
  const [stateLoaded, setStateLoaded] = useState(false);

  const CONFIRM_WORD = "RESTORE";
  const due = backupDueStatus(state);

  useEffect(() => {
    getSetting(BACKUP_STATE_KEY)
      .then((saved) => setState(withBackupStateDefaults(saved)))
      .catch(() => {})
      .finally(() => setStateLoaded(true));
  }, []);

  async function persist(next) {
    setState(next);
    try { await saveSetting(BACKUP_STATE_KEY, next); } catch { /* shown by the caller */ }
  }

  async function handleDownload() {
    setBusy("download");
    setMsg(null);
    setResult(null);
    setProgress(null);
    try {
      const { downloadServerBackup } = await import("../../services/webDatabase.js");
      const backup = await downloadServerBackup((p) => setProgress(p));

      const name = backupFileName();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Revoked on a timer, not immediately: some browsers have not started
      // reading the blob by the time click() returns, and revoking early
      // produces a zero-byte file.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      // Stamped only now, AFTER the file has been written. Stamping when the
      // download starts would reset the 30-day clock on a backup that failed
      // or was cancelled, hiding that one is still due.
      await persist(stampedBackupState(state, backup));

      setResult({ ...backup, fileName: name, sizeKb: Math.round(blob.size / 1024) });
      setMsg(backup.complete
        ? { ok: true, text: `Saved ${name} — ${totalRows(backup.counts)} rows, ${Math.round(blob.size / 1024)} KB.` }
        : { ok: false, text: `Saved ${name}, but the backup is INCOMPLETE — see below. Fix the errors and take another one.` });
    } catch (err) {
      setMsg({ ok: false, text: "Backup failed: " + err.message });
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  // Reads and CHECKS the file, but writes nothing yet.
  async function handleFile(file) {
    setMsg(null);
    setPending(null);
    setConfirmText("");
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const check = validateBackup(data);
      setPending({ file, data, check });
      if (!check.ok) setMsg({ ok: false, text: `This file cannot be restored — ${check.errors.length} problem(s) below.` });
    } catch (err) {
      setMsg({ ok: false, text: "Could not read that file: " + err.message });
    }
  }

  async function handleRestore() {
    if (!pending?.check?.ok) return;
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy("restore");
    setMsg(null);
    setProgress(null);
    try {
      const { uploadServerBackup } = await import("../../services/webDatabase.js");
      const out = await uploadServerBackup(pending.data, (p) => setProgress(p));
      const written = totalRows(out.restored);
      setMsg(out.ok
        ? { ok: true, text: `Restored ${written} rows. Reload any open pages to see the restored data.` }
        : { ok: false, text: `Restored ${written} rows, but ${out.errors.length} table(s) failed — see below.` });
      if (!out.ok) setPending((p) => ({ ...p, restoreErrors: out.errors }));
      else { setPending(null); setConfirmText(""); }
    } catch (err) {
      setMsg({ ok: false, text: "Restore failed: " + err.message });
    } finally {
      setBusy("");
      setProgress(null);
    }
  }

  const canRestore = pending?.check?.ok && confirmText.trim().toUpperCase() === CONFIRM_WORD && !busy;

  return (
    <div className="settings-section">
      <h2>Server Backup</h2>

      <p className="settings-note">
        Downloads everything on the server — pilots, duty records, roster, weekly
        plan, training and settings — into one file kept on this computer, so the
        data survives the server being lost. The same file can be uploaded back.
      </p>

      {/* THE REMINDER.
          A web app runs only while a tab is open, so there is no background job
          that could take a backup on its own. Capt. Weera chose a reminder over
          a silent automatic download, which is the safer of the two: a file that
          appears in Downloads unnoticed is a file nobody has checked, and on the
          day the server is gone what matters is that someone can say where it is
          and that its row counts looked right. */}
      {stateLoaded && (
        <div className={due.due ? "bk-due bk-due-now" : "bk-due"}>
          <div className="bk-due-text">
            {due.never
              ? <><b>No backup has been taken yet.</b> Take one now so there is a copy of the data off the server.</>
              : due.due
                ? <><b>Backup is due.</b> The last one was {due.daysSince} day{due.daysSince === 1 ? "" : "s"} ago
                    {due.overdueBy > 0 && <> — {due.overdueBy} day{due.overdueBy === 1 ? "" : "s"} past the {due.intervalDays}-day schedule</>}.</>
                : <>Last backup <b>{new Date(due.lastBackupAt).toLocaleDateString()}</b> ({due.daysSince} day{due.daysSince === 1 ? "" : "s"} ago,
                    {" "}{due.lastRowCount} rows{due.lastComplete === false && <b> — that backup was INCOMPLETE</b>}).
                    {due.enabled ? <> Next due in {due.daysUntilDue} day{due.daysUntilDue === 1 ? "" : "s"}.</> : <> Reminders are off.</>}</>}
          </div>
          <div className="bk-due-controls">
            <label>
              Remind every{" "}
              <select
                value={state.intervalDays}
                disabled={!!busy}
                onChange={(e) => persist({ ...state, intervalDays: Number(e.target.value) })}
              >
                {BACKUP_INTERVALS.map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <label className="bk-due-toggle">
              <input
                type="checkbox"
                checked={state.enabled}
                disabled={!!busy}
                onChange={(e) => persist({ ...state, enabled: e.target.checked })}
              />
              <span>Remind me</span>
            </label>
          </div>
        </div>
      )}

      <div className="bk-actions">
        <button className="primary" onClick={handleDownload} disabled={!!busy}>
          {busy === "download" ? "Downloading…" : "Download backup"}
        </button>
        <label className={`bk-file${busy ? " disabled" : ""}`}>
          Choose a backup file to restore…
          <input
            type="file"
            accept=".json,application/json"
            disabled={!!busy}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {progress && (
        <div className="bk-progress">
          <div className="bk-progress-bar">
            <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          <span>{progress.label} — {progress.done} of {progress.total}</span>
        </div>
      )}

      {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {/* What was actually downloaded, table by table. The point of showing this
          is that a wrong figure is only useful BEFORE the server is lost. */}
      {result && (
        <div className="bk-report">
          <h3>{result.fileName}</h3>
          <table className="bk-table">
            <thead><tr><th>Table</th><th>Rows</th></tr></thead>
            <tbody>
              {BACKUP_TABLES.map(({ table, label, restore }) => {
                const n = result.counts?.[table];
                const failed = (result.failed || []).find((f) => f.table === table);
                return (
                  <tr key={table} className={failed ? "bk-row-fail" : undefined}>
                    <td>
                      {label}
                      {restore === false && <span className="bk-tag">not restored</span>}
                    </td>
                    <td>{failed ? `FAILED — ${failed.error}` : (n ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td>Total</td><td>{totalRows(result.counts)} rows · {result.sizeKb} KB</td></tr>
            </tfoot>
          </table>
          {/* Login history is deliberately not written back - see
              serverBackup.js. Said here so its absence after a restore does not
              look like data loss. */}
          <p className="settings-note" style={{ marginTop: 8 }}>
            Crew login history is saved in the file for reference but is not written
            back on restore: it records when people signed in, and re-inserting old
            events would fabricate logins that never happened.
          </p>
        </div>
      )}

      {/* ---- Restore, gated ---- */}
      {pending && (
        <div className="bk-restore">
          <h3>Restore from {pending.file.name}</h3>

          <div className="bk-meta">
            {pending.data?.createdAt && <span>Taken {new Date(pending.data.createdAt).toLocaleString()}</span>}
            <span>{totalRows(pending.data?.counts)} rows</span>
            <span>{pending.data?.complete === false ? "INCOMPLETE backup" : "Complete backup"}</span>
          </div>

          {pending.check.errors.length > 0 && (
            <ul className="bk-errors">
              {pending.check.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
          {pending.check.warnings.length > 0 && (
            <ul className="bk-warnings">
              {pending.check.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {pending.restoreErrors?.length > 0 && (
            <ul className="bk-errors">
              {pending.restoreErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          {pending.check.ok && (
            <>
              <div className="bk-danger">
                <b>This writes over live data on the server.</b> Rows in the file replace
                the matching rows on the server; anything the file does not mention is
                left alone. Nothing is deleted first, so a failure part-way through
                leaves the current data in place — but a completed restore cannot be
                undone. Take a fresh backup first if the server still works.
              </div>

              <label className="bk-confirm">
                Type <b>{CONFIRM_WORD}</b> to enable the button:
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  disabled={!!busy}
                />
              </label>

              <div className="bk-actions">
                <button className="danger" onClick={handleRestore} disabled={!canRestore}>
                  {busy === "restore" ? "Restoring…" : "Restore to server"}
                </button>
                <button onClick={() => { setPending(null); setConfirmText(""); setMsg(null); }} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
