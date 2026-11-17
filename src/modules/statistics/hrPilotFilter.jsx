import { useEffect, useRef, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";

// Reports → FT Monthly for HR / DT Work for HR: untick pilots who shouldn't
// be on the HR sheets (Capt. Weera, 17 Nov 2026). One list for both tables,
// kept in the shared settings so every Admin machine prints the same sheet.
// Excluded pilots are left out of the table, the print and the Excel file,
// and the rest are renumbered 1, 2, 3...

export const HR_EXCLUDED_KEY = "hr_excluded_pilots";
const up = (c) => String(c || "").trim().toUpperCase();

// The report with excluded pilots removed and No. renumbered.
export function withoutExcluded(report, excluded) {
  if (!report) return report;
  const out = report.pilots.filter((p) => !excluded.has(up(p.code))).map((p, i) => ({ ...p, no: i + 1 }));
  return { ...report, pilots: out };
}

export function useHrExcluded({ load = getSetting, save = saveSetting } = {}) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    load(HR_EXCLUDED_KEY)
      .then((v) => { if (alive && Array.isArray(v)) setExcluded(new Set(v.map(up))); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const update = (next) => {
    setExcluded(next);
    setError("");
    Promise.resolve(save(HR_EXCLUDED_KEY, [...next].sort())).catch((err) => setError(`Pilot selection not saved: ${err.message || err}`));
  };
  return { excluded, update, error };
}

// "Pilots 20 / 22" button with a tick list; `pilots` = the full report's
// pilots ({ code, name }).
export function HrPilotPicker({ pilots, excluded, update, error }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = pilots.filter((p) => !excluded.has(up(p.code))).length;
  const toggle = (code) => {
    const next = new Set(excluded);
    if (next.has(up(code))) next.delete(up(code)); else next.add(up(code));
    update(next);
  };
  const setAll = (on) => {
    const next = new Set(excluded);
    for (const p of pilots) { if (on) next.delete(up(p.code)); else next.add(up(p.code)); }
    update(next);
  };
  return (
    <div className="hrpick" ref={boxRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose which pilots are on the sheet">
        Pilots {shown} / {pilots.length} ▾
      </button>
      {open && (
        <div className="hrpick-pop" role="dialog" aria-label="Choose pilots">
          <div className="hrpick-head">
            <span>Untick pilots to leave them off the sheet</span>
            <button type="button" onClick={() => setAll(true)}>All</button>
            <button type="button" onClick={() => setAll(false)}>None</button>
          </div>
          <div className="hrpick-list">
            {pilots.map((p) => (
              <label key={p.code} className={excluded.has(up(p.code)) ? "off" : ""}>
                <input type="checkbox" aria-label={`Include ${p.code}`} checked={!excluded.has(up(p.code))} onChange={() => toggle(p.code)} />
                <b>{p.code}</b> <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      {error && <span className="hrpick-err">{error}</span>}
    </div>
  );
}
