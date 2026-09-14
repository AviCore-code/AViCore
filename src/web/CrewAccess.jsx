import { useEffect, useMemo, useState } from "react";
import { fetchPilotRoster, setPilotPassword, listPilotPasswordStatus } from "../services/webDatabase.js";
import "./CrewAccess.css";

// Admin screen to manage each pilot's AviCore Crew login password. Pilots log
// into Crew with their Pilot Code + this password (see WebPilotLogin.jsx).
// Passwords are hashed server-side (sql/crew-pilot-passwords.sql); this screen
// only ever SETS a new one - it can never read an existing password back.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export default function CrewAccess() {
  const [pilots, setPilots] = useState([]);
  const [status, setStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  // Track the row being edited by its position in the filtered list, NOT by
  // pilot code: the roster can legitimately contain duplicate (or blank)
  // codes, and keying/identifying rows by code made two rows collide - which
  // crashed the page the moment an edit toggled a row (fine once a filter
  // narrowed it to a single row, which is the clue that pointed here).
  const [editingIdx, setEditingIdx] = useState(-1);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [roster, st] = await Promise.all([fetchPilotRoster(), listPilotPasswordStatus()]);
      setPilots(roster);
      setStatus(st);
      setEditingIdx(-1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    if (!f) return pilots;
    return pilots.filter((p) => (p.code || "").toUpperCase().includes(f) || (p.name || "").toUpperCase().includes(f));
  }, [pilots, filter]);

  // Filtering re-indexes the list, so close any open editor to avoid editing
  // the wrong row.
  useEffect(() => { setEditingIdx(-1); setPw(""); }, [filter]);

  function startEdit(idx) { setEditingIdx(idx); setPw(""); setMsg(""); }
  function cancelEdit() { setEditingIdx(-1); setPw(""); }

  async function save(code) {
    if (pw.trim().length < 4) { setMsg("Password must be at least 4 characters."); return; }
    setBusy(true);
    setMsg("");
    try {
      await setPilotPassword(code, pw);
      setEditingIdx(-1);
      setPw("");
      await load();
      setMsg(`Password set for ${code}.`);
    } catch (err) {
      setMsg("Failed: " + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crewacc-page">
      <div className="module-header">
        <div>
          <h1>Crew Access — Pilot Passwords</h1>
          <p>Set or reset each pilot's AviCore Crew login password. Pilots sign in with their Pilot Code + this password. You can set a new one, but never read an existing one.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input className="crewacc-filter" lang="en" placeholder="Filter by pilot…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={load} disabled={loading || busy}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error && <div className="crewacc-error">{error}</div>}
      {msg && <div className="crewacc-msg">{msg}</div>}

      {!error && (
        <div className="crewacc-table">
          <div className="crewacc-tr crewacc-th">
            <span>Pilot</span><span>Name</span><span>Password</span><span></span>
          </div>
          {filtered.map((p, idx) => {
            const codeKey = (p.code || "").toUpperCase();
            const has = !!status[codeKey];
            const isEditing = editingIdx === idx;
            return (
              <div className={`crewacc-tr${isEditing ? " crewacc-tr-edit" : ""}`} key={`${codeKey || "row"}-${idx}`}>
                <span className="crewacc-code">{p.code || "—"}</span>
                <span>{p.name || "-"}</span>
                <span>
                  {has
                    ? <span className="crewacc-has">✓ Set{status[codeKey] ? ` · ${fmt(status[codeKey])}` : ""}</span>
                    : <span className="crewacc-none">— none —</span>}
                </span>
                <span className="crewacc-actions">
                  {isEditing ? (
                    <>
                      <input
                        type={showPw ? "text" : "password"} lang="en" className="crewacc-pw" autoFocus
                        placeholder="New password (min 4)" value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !busy) save(p.code); }}
                      />
                      <button type="button" className="crewacc-eye" title={showPw ? "Hide" : "Show"} onClick={() => setShowPw((v) => !v)}>{showPw ? "🙈" : "👁"}</button>
                      <button className="crewacc-save" onClick={() => save(p.code)} disabled={busy || !p.code}>Save</button>
                      <button onClick={cancelEdit} disabled={busy}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => startEdit(idx)} disabled={!p.code}>{has ? "Reset password" : "Set password"}</button>
                  )}
                </span>
              </div>
            );
          })}
          {filtered.length === 0 && !loading && <div className="crewacc-empty">No matching pilots.</div>}
        </div>
      )}
    </div>
  );
}
