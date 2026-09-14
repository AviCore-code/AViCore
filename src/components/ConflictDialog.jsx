import { useEffect, useState } from "react";
import { heldConflicts, discardWrite, flushQueue } from "../services/offlineQueue.js";
import { describeConflict } from "../services/offlineMerge.js";
import "./OfflineBar.css";

// Shown when an offline edit to a SHARED document can't be sent because
// someone else changed the same cells in the meantime.
//
// The design rule: never present this as "your changes failed". The admin made
// a decision with the information they had; someone else made a different one
// with information the first person didn't have. What is needed is not an
// error, it is the two versions side by side and a choice per cell.
//
// Cells nobody else touched have ALREADY been sent by the time this appears -
// they are not in this list, and were never worth interrupting anyone about.

export default function ConflictDialog() {
  const [items, setItems] = useState([]);
  const [keep, setKeep] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => heldConflicts().then((list) => { if (alive) setItems(list); });
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!items.length) return null;

  // One row per clashing cell, carrying all three values. The first version
  // passed empty strings for "mine" and "theirs" and rendered two blank
  // columns - the exact two the whole dialog exists to show. The values come
  // from the queued op (what I set) and from the check that held it back
  // (what the server has now), both recorded in conflictDetail at flush time.
  const rows = items.flatMap((op) =>
    (op.conflictDetail || []).map((c) => ({ op, ...c }))
  );

  function toggle(id) {
    setKeep((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Keeping the server's version means the queued edit has nothing left to do,
  // so it is discarded. Keeping mine re-sends it - and because the cell is
  // re-read at send time, this is a deliberate, informed overwrite.
  async function apply() {
    setBusy(true);
    try {
      for (const op of items) {
        const mineChosen = Object.keys(op.before || {}).some((k) => keep.has(`${op.id}|${k}`));
        if (!mineChosen) {
          await discardWrite(op.id);
        } else {
          // Clearing the snapshot turns the next flush into a plain write:
          // the admin has now SEEN what they are replacing.
          op.before = null;
        }
      }
      await flushQueue();
      setItems(await heldConflicts());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="conflict-backdrop">
      <div className="conflict">
        <div className="conflict-head">
          <b>Someone else edited these while you were offline</b>
          <span>Only the cells that genuinely clash are listed</span>
        </div>

        <p className="conflict-note">
          Cells nobody else touched have already been sent.
          <br />
          <small>Tick a row to overwrite the server with your value. Leave it unticked to keep the server's.</small>
        </p>

        <table className="conflict-table">
          <thead>
            <tr>
              <th>Cell</th>
              <th>Was</th>
              <th>You set</th>
              <th>Server now</th>
              <th>Keep yours</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const c = describeConflict({ ...row, label: row.key.replace(/\|/g, " · ") });
              const id = `${row.op.id}|${row.key}`;
              return (
                <tr key={id}>
                  <td>{c.label}</td>
                  <td>{c.before}</td>
                  <td className="conflict-mine">{c.mine}</td>
                  <td className="conflict-theirs">{c.theirs}</td>
                  <td>
                    <input type="checkbox" checked={keep.has(id)} onChange={() => toggle(id)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="conflict-actions">
          <span className="conflict-hint">
            Unticked keeps the server's version — the safe default. Ticked overwrites it with yours.
          </span>
          <button className="primary" onClick={apply} disabled={busy}>
            {busy ? "Sending…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
