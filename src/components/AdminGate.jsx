import { useState } from "react";
import { verifyAdminPin } from "../services/desktopDatabase.js";
import "./AdminGate.css";

// Modal PIN prompt shown when a Pilot/Flight Crew user (or anyone without
// the Admin PIN) tries to open an Admin-group page. On a correct PIN it
// calls onUnlock() so App.jsx can flip adminUnlocked=true and navigate to
// the page that was originally requested.
export default function AdminGate({ onUnlock, onCancel }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!pin.trim()) return;
    setChecking(true);
    setError(null);
    const result = await verifyAdminPin(pin.trim());
    setChecking(false);
    if (result.ok) {
      onUnlock();
    } else {
      setError("Incorrect PIN.");
      setPin("");
    }
  }

  return (
    <div className="admingate-overlay" role="dialog" aria-modal="true">
      <form className="admingate-card" onSubmit={submit}>
        <h2>Admin Access</h2>
        <p>This area is restricted — enter the Admin PIN to continue.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(null); }}
          placeholder="Admin PIN"
        />
        {error && <div className="admingate-error">{error}</div>}
        <div className="admingate-actions">
          <button type="button" className="admingate-cancel" onClick={onCancel}>Cancel</button>
          <button type="submit" className="admingate-submit" disabled={checking || !pin.trim()}>
            {checking ? "Checking..." : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}
