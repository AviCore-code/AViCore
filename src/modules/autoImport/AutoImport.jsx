import { useEffect, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import { getAdminSession } from "../../services/webDatabase.js";
import { CONFIG_KEY, STATUS_KEY, REQUEST_KEY, SOURCES, withConfigDefaults, normaliseTimes } from "../../services/autoImportCore.js";
import "./AutoImport.css";

// Administration → Auto Import. The settings are saved on the server, so
// every admin sees and edits the same ones; the AviCore Auto Import service on
// the VPS reads them every minute, imports the files the office PC sends it,
// and writes its status and log back here. See src/services/autoImportCore.js.

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d.toTimeString().slice(0, 5)}`;
};
const ago = (iso) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
// "Run now" result (Capt. Weera, 19 Nov 2026 - pressing it gave no sign it
// had finished). The VPS logs every file of one run with the same `at` and
// reason "Run now by <who>"; find the newest such batch that started after
// the request (a minute's slack for clock differences). null = not done yet.
export function findRunResult(log, requestedAt) {
  const since = Date.parse(requestedAt) - 60_000;
  const rows = (log || []).filter((l) => /^Run now/i.test(l.reason || "") && Date.parse(l.at) >= since);
  if (!rows.length) return null;
  const at = rows.reduce((m, l) => (l.at > m ? l.at : m), rows[0].at);
  const batch = rows.filter((l) => l.at === at);
  return { at, rows: batch, ok: batch.filter((l) => l.ok).length, failed: batch.filter((l) => !l.ok).length };
}
const RUN_POLL_MS = 10_000;
const RUN_TIMEOUT_MS = 6 * 60_000;

// The AviCore Sync helper on the office PC (scripts/pc-sync/avicore-pc-helper.ps1).
const HELPER = "http://127.0.0.1:47811";
const kb = (n) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function AutoImport({ loadSetting = getSetting, storeSetting = saveSetting }) {
  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [timesText, setTimesText] = useState("");
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Run now in progress / finished: { requestedAt, result, timedOut }.
  const [run, setRun] = useState(null);

  async function loadStatus() {
    try { setStatus(await loadSetting(STATUS_KEY)); } catch { /* keep the last one */ }
  }
  async function load() {
    try {
      const c = withConfigDefaults(await loadSetting(CONFIG_KEY));
      setCfg(c);
      setTimesText(c.times.join(", "));
      setDirty(false);
    } catch (err) {
      setMsg({ ok: false, text: "Could not load the settings: " + (err.message || err) });
    }
    loadStatus();
  }
  useEffect(() => {
    load();
    const t = setInterval(loadStatus, 30000);
    return () => clearInterval(t);
  }, []);

  // While a Run now is waiting: check the VPS status every 10 s until its
  // batch shows up in the log (or give up after 6 minutes).
  const waiting = !!run && !run.result && !run.timedOut;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(loadStatus, RUN_POLL_MS);
    const stop = setTimeout(() => setRun((r) => (r && !r.result ? { ...r, timedOut: true } : r)), RUN_TIMEOUT_MS);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [waiting]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run || run.result) return;
    const result = findRunResult(status?.log, run.requestedAt);
    if (result) setRun((r) => ({ ...r, result }));
  }, [status]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg) return <div className="autoimp-page"><h1>Auto Import</h1><p>Loading…</p>{msg && <div className="settings-msg error">{msg.text}</div>}</div>;

  const edit = (patch) => { setCfg({ ...cfg, ...patch }); setDirty(true); };
  const editPath = (key, value) => edit({ paths: { ...cfg.paths, [key]: value } });

  async function who() {
    try { return (await getAdminSession())?.user?.email || "admin"; } catch { return "admin"; }
  }

  async function save() {
    const times = normaliseTimes(timesText);
    if (!times) { setMsg({ ok: false, text: "Times must be HH:MM, e.g. 06:00, 18:00" }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const next = {
        ...cfg,
        times,
        checkMinutes: Number(cfg.checkMinutes) || 15,
        paths: { ...cfg.paths, staff: (cfg.paths.staff || []).map((s) => String(s).trim()).filter(Boolean) },
        updatedBy: await who(),
        updatedAt: new Date().toISOString()
      };
      await storeSetting(CONFIG_KEY, next);
      setCfg(next);
      setTimesText(times.join(", "));
      setDirty(false);
      setMsg({ ok: true, text: "Saved. The PC sync and the VPS pick it up within a few minutes." });
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + (err.message || err) });
    } finally {
      setSaving(false);
    }
  }

  // "Browse…": opens Windows Explorer on the office PC through the AviCore
  // Sync helper (avicore-sync:// link, scripts/pc-sync). A browser cannot hand
  // a web page the real path of a picked file, so the PC sends its choice to
  // the VPS, which saves it here; the page reloads the settings to show it.
  async function browse(key) {
    // 1st choice: the AviCore Sync helper on this PC (127.0.0.1:47811) opens
    // Explorer and hands the path straight back into the field.
    setMsg({ ok: true, text: "Opening Windows Explorer on this PC… (if Chrome asks to allow access to this device / local network, choose Allow)" });
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const ping = await fetch(`${HELPER}/ping`, { signal: ctl.signal });
      clearTimeout(t);
      if (ping.ok) {
        const res = await (await fetch(`${HELPER}/browse?key=${key}`)).json();
        if (res.cancelled || res.value == null) { setMsg(null); return; }
        if (key === "fdt" && res.value && typeof res.value === "object" && !Array.isArray(res.value)) {
          // { folder, files }: one file picked = the whole folder, several = only those.
          edit({ paths: { ...cfg.paths, fdt: String(res.value.folder || ""), fdtFiles: [].concat(res.value.files || []).map(String) } });
        } else if (key === "fdt") {
          edit({ paths: { ...cfg.paths, fdt: String(res.value), fdtFiles: [] } });
        } else {
          editPath(key, key === "staff" ? [].concat(res.value) : String(res.value));
        }
        setMsg({ ok: true, text: "Path filled in - press Save settings to keep it." });
        return;
      }
    } catch { /* helper not running here - fall back below */ }
    // Fallback: the avicore-sync:// link (the PC sends its choice via the VPS).
    setMsg({ ok: true, text: "Windows Explorer opens on this PC if AviCore Sync is installed here. The chosen path appears here within about a minute." });
    window.location.href = `avicore-sync://browse/${key}`;
    for (const ms of [20000, 45000, 75000, 110000]) {
      setTimeout(async () => {
        try {
          const c = withConfigDefaults(await loadSetting(CONFIG_KEY));
          setCfg((cur) => (cur && JSON.stringify(cur.paths) !== JSON.stringify(c.paths) ? { ...cur, paths: c.paths, updatedBy: c.updatedBy, updatedAt: c.updatedAt } : cur));
        } catch { /* try again on the next round */ }
        loadStatus();
      }, ms);
    }
  }

  async function runNow() {
    setMsg(null);
    const requestedAt = new Date().toISOString();
    try {
      await storeSetting(REQUEST_KEY, { at: requestedAt, by: await who(), force: true });
      setRun({ requestedAt, result: null, timedOut: false });
    } catch (err) {
      setRun(null);
      setMsg({ ok: false, text: "Could not send the request: " + (err.message || err) });
    }
  }

  const vpsAge = status?.heartbeat ? (Date.now() - Date.parse(status.heartbeat)) / 60000 : null;
  const vpsOk = vpsAge != null && vpsAge < 12;
  const pcAge = status?.pcLastSync ? (Date.now() - Date.parse(status.pcLastSync)) / 60000 : null;
  const pcOk = pcAge != null && pcAge < 20;

  return (
    <div className="autoimp-page">
      <div className="module-header">
        <div>
          <h1>Auto Import</h1>
          <p>The office PC sends changed FDT, roster and training Excel files to the AviCore server (VPS), which imports them <b>24 hours a day</b> — when a file changes and at the set times. These settings are shared: every admin sees and edits the same ones.</p>
        </div>
      </div>

      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      <section className="autoimp-card">
        <h2>Status</h2>
        <div className="autoimp-status">
          <div><span className={`autoimp-access ${vpsOk ? "ok" : "bad"}`}>{vpsOk ? "VPS online" : "VPS not reporting"}</span> <small>{status?.heartbeat ? `last report ${ago(status.heartbeat)}` : "no report yet"}{status?.account ? ` · signed in as ${status.account}` : ""}</small></div>
          <div><span className={`autoimp-access ${pcOk ? "ok" : "warn"}`}>{pcOk ? "PC sync running" : "PC sync not seen"}</span> <small>{status?.pcLastSync ? `last sync ${ago(status.pcLastSync)}` : "the office PC has not sent anything yet"}</small></div>
          <div><small>Last check {fmt(status?.lastCheck)} · last import run {fmt(status?.lastRun)}</small></div>
        </div>
      </section>

      <section className="autoimp-card">
        <h2>1 · Files on the office PC</h2>
        <table className="autoimp-table">
          <thead><tr><th>Import</th><th>Location on the PC</th><th>On the VPS now</th></tr></thead>
          <tbody>
            {SOURCES.map((src) => {
              const files = status?.files?.[src.key] || [];
              return (
                <tr key={src.key}>
                  <th>{src.label}</th>
                  <td>
                    <div className="autoimp-pathrow">
                      {src.key === "staff"
                        ? <textarea rows={3} value={(cfg.paths.staff || []).join("\n")} placeholder={src.hint} onChange={(e) => editPath("staff", e.target.value.split(/\r?\n/))} />
                        : <input value={cfg.paths[src.key] || ""} placeholder={src.hint} onChange={(e) => editPath(src.key, e.target.value)} />}
                      <button type="button" className="autoimp-browse" onClick={() => browse(src.key)} title="Open Windows Explorer on the office PC to pick it">📂 Browse…</button>
                    </div>
                    {src.key === "fdt" && (
                      (cfg.paths.fdtFiles || []).length ? (
                        <div className="autoimp-note">
                          <b>Only these {cfg.paths.fdtFiles.length} file(s):</b> {cfg.paths.fdtFiles.join(", ")}{" "}
                          <button type="button" className="autoimp-linkbtn" onClick={() => editPath("fdtFiles", [])}>use every file in the folder</button>
                        </div>
                      ) : (
                        <div className="autoimp-note">Every *_FDT.xlsx in the folder. Browse: pick one file = the whole folder; pick several (Ctrl / Shift) = only those. Each pilot's Daily Duty is replaced by the whole file.</div>
                      )
                    )}
                    {src.key === "roster" && <div className="autoimp-note">From today to the end of the sheet; past days are not touched.</div>}
                  </td>
                  <td className="autoimp-files">
                    {files.length === 0 ? <span className="autoimp-note">none yet</span> : files.map((f) => (
                      <div key={f.name} title={`${kb(f.size)} · modified ${fmt(f.mtime)}`}>
                        <span className={`autoimp-dot ${f.imported ? "ok" : "warn"}`} />{f.name} <small>{fmt(f.mtime)}{f.imported ? "" : " · waiting"}</small>
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="autoimp-field">
          <span>Roster sheet name</span>
          <input value={cfg.rosterSheet || ""} placeholder="Blank = pick the roster sheet automatically" onChange={(e) => edit({ rosterSheet: e.target.value })} />
        </label>
      </section>

      <section className="autoimp-card">
        <h2>2 · When to import</h2>
        <label className="autoimp-switch">
          <input type="checkbox" checked={!!cfg.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
          <b>Auto Import on</b>
        </label>
        <div className="autoimp-grid">
          <label className="autoimp-field">
            <span>When a file changes — check every</span>
            <select value={cfg.checkMinutes} onChange={(e) => edit({ checkMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </select>
          </label>
          <label className="autoimp-field">
            <span>Every day at (Bangkok, all files)</span>
            <input value={timesText} onChange={(e) => { setTimesText(e.target.value); setDirty(true); }} placeholder="06:00, 18:00" />
          </label>
        </div>
        <div className="autoimp-runbar">
          <button className="primary" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save settings"}</button>
          <button onClick={runNow} disabled={!vpsOk || waiting}>{waiting ? "Importing…" : "Run now (all files)"}</button>
          <button onClick={load}>Reload</button>
          {cfg.updatedBy && <span className="autoimp-last">Last changed by {cfg.updatedBy} · {fmt(cfg.updatedAt)}</span>}
        </div>
        {run && <RunResult run={run} onClose={() => setRun(null)} />}
      </section>

      <section className="autoimp-card">
        <h2>3 · Import log (from the VPS)</h2>
        {!status?.log?.length ? <p className="autoimp-note">No imports yet.</p> : (
          <div className="autoimp-logwrap">
            <table className="autoimp-table autoimp-log">
              <thead><tr><th>Time</th><th>Why</th><th>Import</th><th>File</th><th>Result</th></tr></thead>
              <tbody>
                {status.log.map((l, i) => (
                  <tr key={i} className={`${l.ok ? "" : "bad"}${run?.result && l.at === run.result.at && /^Run now/i.test(l.reason || "") ? " justran" : ""}`}>
                    <td>{fmt(l.at)}</td><td>{l.reason || ""}</td><td>{l.source}</td><td>{l.file || ""}</td><td>{l.ok ? "✓ " : "✗ "}{l.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// Under the Run now button: waiting, then "Update completed" with what each
// file did (the same rows as the log, for this run only).
function RunResult({ run, onClose }) {
  const r = run.result;
  if (!r) {
    return (
      <div className={`autoimp-run ${run.timedOut ? "warn" : "wait"}`} role="status">
        {run.timedOut
          ? <>No result from the VPS yet (asked {fmt(run.requestedAt)}). It may still be importing. Press Reload in a minute, or check that the VPS status above is green.</>
          : <><span className="autoimp-spin" aria-hidden="true" /> Importing all files… asked {fmt(run.requestedAt)}. The VPS picks it up within a minute; a full import takes 1–2 minutes.</>}
        <button className="autoimp-run-x" onClick={onClose} aria-label="Close">×</button>
      </div>
    );
  }
  return (
    <div className={`autoimp-run ${r.failed ? "warn" : "done"}`} role="status">
      <div className="autoimp-run-head">
        <b>{r.failed ? "⚠ Update completed with errors" : "✓ Update completed"}</b>
        <span>{fmt(r.at)} · {r.rows.length} file{r.rows.length === 1 ? "" : "s"} · {r.ok} OK{r.failed ? ` · ${r.failed} failed` : ""}</span>
        <button className="autoimp-run-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="autoimp-logwrap autoimp-run-list">
        <table className="autoimp-table autoimp-log">
          <thead><tr><th>Import</th><th>File</th><th>Result</th></tr></thead>
          <tbody>
            {r.rows.map((l, i) => (
              <tr key={i} className={l.ok ? "" : "bad"}><td>{l.source}</td><td>{l.file || ""}</td><td>{l.ok ? "✓ " : "✗ "}{l.text}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
