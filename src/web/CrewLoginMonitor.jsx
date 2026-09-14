import { useEffect, useMemo, useState } from "react";
import { listCrewLogins, deleteCrewLogins, clearAllCrewLogins } from "../services/webDatabase.js";
import "./CrewLoginMonitor.css";

// Admin Utility tab: monitors when pilots open the AviCore Crew app. Each row
// is one "picked my name + confirmed on the login screen" event (recorded by
// WebPilotLogin.jsx -> recordCrewLogin). Shows a per-pilot summary (last seen
// + open count) on top, and the raw recent-events log below - where rows can
// be selected and deleted, or the whole log cleared.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function browserOf(ua) {
  if (!ua) return "-";
  if (/edg/i.test(ua)) return "Edge";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}
function deviceOf(ua) {
  if (!ua) return "";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "Mac";
  return "";
}

export default function CrewLoginMonitor() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await listCrewLogins(500));
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const summary = useMemo(() => {
    const byCode = new Map();
    for (const r of rows) {
      const key = r.pilot_code || "-";
      if (!byCode.has(key)) byCode.set(key, { code: key, name: r.pilot_name || "", count: 0, last: r.logged_in_at });
      const s = byCode.get(key);
      s.count++;
      if (!s.last || r.logged_in_at > s.last) s.last = r.logged_in_at;
      if (!s.name && r.pilot_name) s.name = r.pilot_name;
    }
    return [...byCode.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
  }, [rows]);

  const filtered = useMemo(() => {
    const f = filter.trim().toUpperCase();
    if (!f) return rows;
    return rows.filter((r) => (r.pilot_code || "").toUpperCase().includes(f) || (r.pilot_name || "").toUpperCase().includes(f));
  }, [rows, filter]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!window.confirm(`Delete ${selected.size} selected login record(s)? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteCrewLogins([...selected]);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAll() {
    if (!rows.length) return;
    if (!window.confirm(`Delete ALL ${rows.length} login records? This clears the entire monitor log and cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      await clearAllCrewLogins();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="crewmon-page">
      <div className="module-header">
        <div>
          <h1>Utility — Crew App Monitor</h1>
          <p>Who opened the AviCore Crew app, and when (from the pilot picked on the login screen).</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <input className="crewmon-filter" lang="en" placeholder="Filter by pilot…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={load} disabled={loading || busy}>{loading ? "Loading…" : "Refresh"}</button>
          <button className="crewmon-btn-danger" onClick={deleteSelected} disabled={busy || selected.size === 0}>
            Delete selected{selected.size ? ` (${selected.size})` : ""}
          </button>
          <button className="crewmon-btn-danger-outline" onClick={deleteAll} disabled={busy || rows.length === 0}>Delete all</button>
        </div>
      </div>

      {error && <div className="crewmon-error">{error}</div>}

      {!error && (
        <>
          <h3 className="crewmon-section">By Pilot ({summary.length})</h3>
          <div className="crewmon-grid">
            {summary.length === 0 && !loading && <div className="crewmon-empty">No Crew logins recorded yet.</div>}
            {summary.map((s) => (
              <div className="crewmon-card" key={s.code}>
                <div className="crewmon-card-top">
                  <span className="crewmon-card-code">{s.code}</span>
                  <span className="crewmon-card-count">{s.count}×</span>
                </div>
                <div className="crewmon-card-name">{s.name || "—"}</div>
                <div className="crewmon-card-last">Last: {fmt(s.last)}</div>
              </div>
            ))}
          </div>

          <h3 className="crewmon-section">Recent Logins ({filtered.length})</h3>
          <div className="crewmon-table">
            <div className="crewmon-tr crewmon-th">
              <span><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title="Select all shown" /></span>
              <span>Date / Time</span><span>Pilot</span><span>Name</span><span>Device</span>
            </div>
            {filtered.map((r) => (
              <div className={`crewmon-tr${selected.has(r.id) ? " crewmon-tr-sel" : ""}`} key={r.id}>
                <span><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></span>
                <span className="crewmon-time">{fmt(r.logged_in_at)}</span>
                <span className="crewmon-code">{r.pilot_code || "-"}</span>
                <span>{r.pilot_name || "-"}</span>
                <span className="crewmon-device">{[deviceOf(r.user_agent), browserOf(r.user_agent)].filter(Boolean).join(" · ")}</span>
              </div>
            ))}
            {filtered.length === 0 && !loading && <div className="crewmon-empty">No matching logins.</div>}
          </div>
        </>
      )}
    </div>
  );
}
