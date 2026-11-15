import { useEffect, useState } from "react";
import { SOURCES, isSupported, subscribe, loadState, saveConfig, setHandle, refreshAccess, refreshAccount, runAll, clearLog, startScheduler } from "./runner.js";
import { importerSignIn, importerSignOut } from "../../services/webDatabase.js";
import "./AutoImport.css";

// Administration → Auto Import: point AviCore Admin at the FDT folder, the
// roster file and the training files on this PC, and set when to import them.
// Works in Chrome / Edge on a computer (File System Access API); the page
// must stay open (a tab in the background is fine) for the timer to run.

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d.toTimeString().slice(0, 5)}`;
};

const handleText = (h) => {
  if (!h) return "Not set";
  if (Array.isArray(h)) return h.map((x) => x.name).join(", ") || "Not set";
  return h.kind === "directory" ? `📁 ${h.name}` : `📄 ${h.name}`;
};

const ACCESS = {
  granted: ["ok", "Access OK"],
  prompt: ["warn", "Press Allow access"],
  denied: ["bad", "Access blocked"],
  none: ["none", "Not set"]
};

const XLSX_TYPES = [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel": [".xls"] } }];

export default function AutoImport() {
  const [s, setS] = useState(null);
  const [timesText, setTimesText] = useState("");
  const [msg, setMsg] = useState("");
  const [login, setLogin] = useState({ email: "", password: "", busy: false, error: "" });

  useEffect(() => {
    if (!isSupported()) return undefined;
    const off = subscribe(setS);
    loadState().then((st) => setTimesText((st.config.times || []).join(", "))).catch((e) => setMsg(e.message));
    startScheduler();
    return off;
  }, []);

  if (!isSupported()) {
    return (
      <div className="autoimp-page">
        <h1>Auto Import</h1>
        <div className="settings-msg error">Auto Import needs Google Chrome or Microsoft Edge on a computer (Windows / Mac). Open AviCore Admin in Chrome or Edge on the PC that holds the files.</div>
      </div>
    );
  }
  if (!s) return <div className="autoimp-page"><h1>Auto Import</h1><p>Loading…</p></div>;

  async function pick(src) {
    setMsg("");
    try {
      let h;
      if (src.kind === "dir") h = await window.showDirectoryPicker({ id: `avicore-${src.key}`, mode: "read" });
      else if (src.kind === "file") [h] = await window.showOpenFilePicker({ id: `avicore-${src.key}`, types: XLSX_TYPES, multiple: false });
      else h = await window.showOpenFilePicker({ id: `avicore-${src.key}`, types: XLSX_TYPES, multiple: true });
      await setHandle(src.key, h);
    } catch (err) {
      if (err?.name !== "AbortError") setMsg(err.message || String(err));
    }
  }

  async function signIn(e) {
    e.preventDefault();
    setLogin((l) => ({ ...l, busy: true, error: "" }));
    const res = await importerSignIn(login.email, login.password);
    setLogin((l) => ({ ...l, busy: false, password: "", error: res.ok ? "" : res.error }));
    await refreshAccount();
  }

  async function signOut() {
    await importerSignOut();
    await refreshAccount();
  }

  async function saveTimes() {
    const times = timesText.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)
      .map((t) => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(t); return m && +m[1] < 24 && +m[2] < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : null; });
    if (times.some((t) => !t)) { setMsg("Times must be HH:MM, e.g. 06:00, 18:00"); return; }
    const uniq = [...new Set(times)].sort();
    await saveConfig({ times: uniq });
    setTimesText(uniq.join(", "));
    setMsg("Saved.");
  }

  const needsAccess = Object.values(s.access).some((a) => a === "prompt" || a === "denied");
  const nothingSet = SOURCES.every((src) => !s.handles[src.key]);

  return (
    <div className="autoimp-page">
      <div className="module-header">
        <div>
          <h1>Auto Import</h1>
          <p>AviCore Admin imports the FDT, roster and training Excel files from folders on <b>this computer</b> and saves them to the server — when a file changes, and at the set times. The settings stay on this PC only. Keep the AviCore Admin tab open in Chrome / Edge (a background tab is fine) — it keeps importing after you sign out.</p>
        </div>
      </div>

      {msg && <div className={`settings-msg ${/saved/i.test(msg) ? "" : "error"}`}>{msg}</div>}
      {needsAccess && (
        <div className="autoimp-banner">
          The browser needs your OK to read the files again (it asks after Chrome / Edge restarts).
          <button className="primary" onClick={() => refreshAccess(true)}>Allow access</button>
        </div>
      )}

      <section className="autoimp-card">
        <h2>1 · Auto Import account</h2>
        {s.account ? (
          <div className="autoimp-account">
            <span className="autoimp-access ok">Signed in</span> <b>{s.account}</b>
            <button onClick={signOut}>Sign out Auto Import</button>
            <p className="autoimp-note">Auto Import keeps this sign-in on this PC, apart from the page. Signing out of AviCore Admin does not stop it — imports go on while this tab stays open. Use an admin account that may write Daily Duty, roster and training.</p>
          </div>
        ) : (
          <form className="autoimp-login" onSubmit={signIn}>
            <input type="email" autoComplete="username" placeholder="Admin email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} required />
            <input type="password" autoComplete="current-password" placeholder="Password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} required />
            <button className="primary" disabled={login.busy}>{login.busy ? "Signing in…" : "Sign in Auto Import"}</button>
            {login.error && <span className="autoimp-err">{login.error}</span>}
            <p className="autoimp-note">Auto Import signs in on its own so it keeps importing after you sign out of AviCore Admin.</p>
          </form>
        )}
      </section>

      <section className="autoimp-card">
        <h2>2 · Files on this computer</h2>
        <table className="autoimp-table">
          <thead><tr><th>Import</th><th>Location</th><th>Access</th><th>What it replaces</th><th /></tr></thead>
          <tbody>
            {SOURCES.map((src) => {
              const [cls, text] = ACCESS[s.access[src.key] || "none"];
              return (
                <tr key={src.key}>
                  <th>{src.label}</th>
                  <td className="autoimp-path">{handleText(s.handles[src.key])}</td>
                  <td><span className={`autoimp-access ${cls}`}>{text}</span></td>
                  <td className="autoimp-note">{NOTES[src.key]}</td>
                  <td className="autoimp-actions">
                    <button onClick={() => pick(src)}>{s.handles[src.key] ? "Change" : "Choose"}</button>
                    {s.handles[src.key] && <button onClick={() => setHandle(src.key, null)} title="Stop importing this">✕</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="autoimp-field">
          <span>Roster sheet name</span>
          <input value={s.config.rosterSheet} placeholder="Blank = pick the roster sheet automatically" onChange={(e) => saveConfig({ rosterSheet: e.target.value })} />
        </label>
      </section>

      <section className="autoimp-card">
        <h2>3 · When to import</h2>
        <label className="autoimp-switch">
          <input type="checkbox" checked={!!s.config.enabled} onChange={(e) => saveConfig({ enabled: e.target.checked })} />
          <b>Auto Import on</b>
        </label>
        <div className="autoimp-grid">
          <label className="autoimp-field">
            <span>When a file changes — check every</span>
            <select value={s.config.checkMinutes} onChange={(e) => saveConfig({ checkMinutes: Number(e.target.value) })}>
              {[5, 10, 15, 30, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
            </select>
          </label>
          <label className="autoimp-field">
            <span>Every day at (all files)</span>
            <span className="autoimp-inline">
              <input value={timesText} onChange={(e) => setTimesText(e.target.value)} placeholder="06:00, 18:00" />
              <button onClick={saveTimes}>Save times</button>
            </span>
          </label>
        </div>
        <div className="autoimp-runbar">
          <button className="primary" disabled={s.running || nothingSet} onClick={() => runAll({ force: true, reason: "Run now" })}>{s.running ? "Importing…" : "Run now (all files)"}</button>
          <button disabled={s.running || nothingSet} onClick={() => runAll({ force: false, reason: "Check now" })}>Import changed files</button>
          <span className="autoimp-last">Last check: {fmt(s.lastCheck)}</span>
        </div>
      </section>

      <section className="autoimp-card">
        <div className="autoimp-loghead">
          <h2>4 · Import log</h2>
          {s.log.length > 0 && <button onClick={clearLog}>Clear</button>}
        </div>
        {s.log.length === 0 ? <p className="autoimp-note">No imports yet.</p> : (
          <div className="autoimp-logwrap">
            <table className="autoimp-table autoimp-log">
              <thead><tr><th>Time</th><th>Why</th><th>Import</th><th>File</th><th>Result</th></tr></thead>
              <tbody>
                {s.log.map((l, i) => (
                  <tr key={i} className={l.ok ? "" : "bad"}>
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

const NOTES = {
  fdt: "Every *_FDT.xlsx in the folder. All: the pilot's Daily Duty is replaced by the whole file.",
  roster: "From today to the end of the sheet. Past days are not touched.",
  training: "Training Tracker workbook → Pilot Training Due.",
  staff: "FOO / Check-In, Helpers, GOO workbooks → Staff Training."
};
