import { useEffect, useState } from "react";
import { fetchPilotRoster } from "../services/mobileSync.js";
import { setPairedPilotCode } from "../services/mobileDatabase.js";
import "./MobileApp.css";

// First-launch screen: which pilot does this phone belong to. Fetches the
// fleet roster (code + name only, never cached locally - see
// fetchPilotRoster in mobileSync.js) so the pilot can pick themselves from a
// list rather than typing a code from memory. Requires internet the very
// first time a phone is set up; after pairing, everything works offline.
export default function PilotLogin({ onPaired }) {
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPilotRoster();
      setRoster(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    await setPairedPilotCode(selected);
    onPaired(selected);
  }

  return (
    <div className="pilot-login">
      <div className="pilot-login-card">
        <h1>AviCore Crew</h1>
        <p>Which pilot is this phone for? This only needs to be set once.</p>

        {loading && <div className="pilot-login-status">Loading pilot list — needs internet the first time...</div>}

        {!loading && error && (
          <>
            <div className="pilot-login-status error">Could not load the pilot list: {error}</div>
            <button onClick={load}>Try Again</button>
          </>
        )}

        {!loading && !error && roster.length === 0 && (
          <div className="pilot-login-status error">No pilots found yet — ask your Admin to add your Pilot Experience record first.</div>
        )}

        {!loading && !error && roster.length > 0 && (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">-- Select your name --</option>
              {roster.map((p) => (
                <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
              ))}
            </select>
            <button className="primary" disabled={!selected || saving} onClick={handleConfirm}>
              {saving ? "Setting up..." : "This is me"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
