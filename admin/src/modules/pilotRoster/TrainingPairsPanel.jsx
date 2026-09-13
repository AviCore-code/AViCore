import { useEffect, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import { TRAINING_PAIRS_SETTING_KEY, ANY_INSTRUCTOR, normalizePair } from "./weeklyPlanTrainingPairs.js";
import "./PilotRoster.css";
import { todayIso } from "../../utils/dateKeys.js";

// Editor for the temporary "must fly with" instructions - line training, a
// return to line, post-OPC consolidation. Each one carries an end date and
// expires by itself, so nobody has to remember to remove it.
//
// Stored in app_settings (see weeklyPlanTrainingPairs.js), which means it
// syncs to every device the same way the FTL limits do and needs no schema
// change.
export default function TrainingPairsPanel({ pilots, instructors, onSaved, onCancel }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getSetting(TRAINING_PAIRS_SETTING_KEY)
      .then((saved) => setPairs(Array.isArray(saved) ? saved : []))
      .catch(() => setPairs([]))
      .finally(() => setLoading(false));
  }, []);

  function update(index, patch) {
    setPairs((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addRow() {
    const today = todayIso();
    setPairs((prev) => [...prev, { pilotCode: "", withCode: ANY_INSTRUCTOR, from: today, to: "", note: "" }]);
  }

  function removeRow(index) {
    setPairs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const clean = pairs.map(normalizePair).filter((p) => p && p.pilotCode);
      await saveSetting(TRAINING_PAIRS_SETTING_KEY, clean);
      setMsg({ ok: true, text: `Saved ${clean.length} training pairing${clean.length === 1 ? "" : "s"}.` });
      onSaved?.(clean);
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  const today = todayIso();

  return (
    <div className="roster-import-panel no-print">
      <div className="roster-import-head">
        <h2>Training Pairings</h2>
        <button onClick={onCancel}>Close</button>
      </div>

      <p className="roster-note">
        “This pilot must fly with this instructor until this date.” The planner enforces it while the
        dates are current, then stops on its own — nothing to remember to delete.
        An <b>instructor</b> is any pilot holding TRI or TRE hours on their Pilot Experience record
        {instructors?.size ? <> — currently {[...instructors].sort().join(" · ")}</> : <> — <b>none recorded yet</b>, so “any instructor” can’t be satisfied</>}.
      </p>

      {loading ? <div className="roster-note">Loading…</div> : (
        <>
          <table className="weekly-pairs-table">
            <thead>
              <tr>
                <th>Pilot</th><th>Must fly with</th><th>From</th><th>Until</th><th>Reason</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pairs.length === 0 && (
                <tr><td colSpan={6} className="weekly-pairs-empty">No training pairings. Everyone is planned normally.</td></tr>
              )}
              {pairs.map((p, i) => {
                const expired = p.to && p.to < today;
                return (
                  <tr key={i} className={expired ? "weekly-pairs-expired" : ""}>
                    <td>
                      <input list="weekly-pair-pilots" lang="en" value={p.pilotCode || ""}
                        placeholder="CODE"
                        onChange={(e) => update(i, { pilotCode: e.target.value.toUpperCase() })} />
                    </td>
                    <td>
                      <input list="weekly-pair-instructors" lang="en"
                        value={p.withCode === ANY_INSTRUCTOR ? "" : (p.withCode || "")}
                        placeholder="any instructor"
                        onChange={(e) => update(i, { withCode: e.target.value.toUpperCase() || ANY_INSTRUCTOR })} />
                    </td>
                    <td><input type="date" lang="en" value={p.from || ""} onChange={(e) => update(i, { from: e.target.value })} /></td>
                    <td><input type="date" lang="en" value={p.to || ""} onChange={(e) => update(i, { to: e.target.value })} /></td>
                    <td><input lang="en" value={p.note || ""} placeholder="Line training" onChange={(e) => update(i, { note: e.target.value })} /></td>
                    <td>
                      <button className="weekly-pairs-remove" onClick={() => removeRow(i)} title="Remove">✕</button>
                      {expired && <span className="weekly-pairs-tag">expired</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <datalist id="weekly-pair-pilots">
            {(pilots || []).map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="weekly-pair-instructors">
            {[...(instructors || [])].sort().map((c) => <option key={c} value={c} />)}
          </datalist>

          <div className="settings-actions">
            <button onClick={addRow}>+ Add pairing</button>
            <button className="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}

      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}
