import { useEffect, useMemo, useState } from "react";
import { listWeeklyPlan, getPairedPilotCode } from "../services/webDatabase.js";
import { WEEKLY_SECTIONS, displayTime } from "../modules/pilotRoster/weeklyPlanSections.js";
import "./MyRoster.css";

// The weekly flying programme, as pilots see it: the full board, read-only,
// with the signed-in pilot's own seats highlighted.
//
// The whole board rather than only their own line, because the question a
// pilot actually has is "who am I flying with, and what time do we go" - and
// the answer is in the row, not the cell.
//
// This deliberately shows the PLAN only. It does not repeat the FTL checks
// from the admin board: those exist to help the planner decide, and showing
// half of them here would invite a pilot to conclude something about legality
// from an incomplete picture. Anything that affects a pilot's own limits is on
// FDT Monitor, computed properly.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_START_DOW = 2; // Tuesday, matching the company's own sheet

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
function weekStartFor(iso) {
  const d = parseIso(iso);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_START_DOW + 7) % 7));
  return toIso(d);
}

export default function MyWeeklySchedule() {
  const [weekStart, setWeekStart] = useState(() => weekStartFor(toIso(new Date())));
  const [cells, setCells] = useState([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullScreen, setFullScreen] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const todayIso = toIso(new Date());

  useEffect(() => { getPairedPilotCode().then((c) => setMe(String(c || "").toUpperCase())); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    listWeeklyPlan({ from: weekStart, to: weekEnd })
      .then((list) => { if (alive) setCells(list || []); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [weekStart, weekEnd]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(weekStart, i);
      return { iso, weekday: WEEKDAY[parseIso(iso).getDay()], day: parseIso(iso).getDate() };
    }),
    [weekStart]
  );

  const byKey = useMemo(() => {
    const map = new Map();
    for (const c of cells) {
      if (!c.pilot_code) continue;
      map.set(`${c.date}|${c.section}|${c.slot}`, String(c.pilot_code).toUpperCase());
    }
    return map;
  }, [cells]);

  // The days this pilot is on, for the summary line - the one thing they came
  // for, stated in words rather than left to be found in the grid.
  const myDuties = useMemo(() => {
    const out = [];
    for (const d of days) {
      for (const section of WEEKLY_SECTIONS) {
        for (let slot = 0; slot < section.slots; slot++) {
          if (byKey.get(`${d.iso}|${section.key}|${slot}`) === me) {
            const mates = [];
            for (let s = 0; s < section.slots; s++) {
              const other = byKey.get(`${d.iso}|${section.key}|${s}`);
              if (other && other !== me) mates.push(other);
            }
            out.push({ day: d.weekday, section: section.label, time: displayTime(section.key), mates });
          }
        }
      }
    }
    return out;
  }, [days, byKey, me]);

  return (
    <div className={`myroster-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Weekly Schedule</h1>
          <p>Weekly flying programme — view only, your own seats are highlighted</p>
        </div>
        <div className="myroster-tools">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))}>‹ Prev week</button>
          <b>{weekStart} → {weekEnd}</b>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week ›</button>
          <button onClick={() => setWeekStart(weekStartFor(toIso(new Date())))}>This week</button>
          <button onClick={() => window.print()}>Print</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {me && (
        <div className="myweekly-summary">
          <b>{me} — this week</b>
          {myDuties.length === 0
            ? <span> Not rostered to a line this week.</span>
            : <ul>
                {myDuties.map((d, i) => (
                  <li key={i}>
                    {d.day} · {d.section}{d.time ? ` (${d.time})` : ""}
                    {d.mates.length ? ` · with ${d.mates.join(", ")}` : ""}
                  </li>
                ))}
              </ul>}
        </div>
      )}

      {error && <div className="myroster-error">Couldn't load the schedule: {error}</div>}
      {loading && <p className="myroster-note">Loading…</p>}

      {!loading && !error && (
        <div className="myroster-scroll">
          <table className="myroster-table myweekly-table">
            <thead>
              <tr>
                <th className="myroster-code-col">Line</th>
                {days.map((d) => (
                  <th key={d.iso} className={d.iso === todayIso ? "today" : ""}>
                    <span className="myroster-dow">{d.weekday}</span>
                    <span>{d.day}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKLY_SECTIONS.map((section) =>
                Array.from({ length: section.slots }, (_, slot) => (
                  <tr key={`${section.key}|${slot}`}>
                    {slot === 0 && (
                      <th className="myroster-code-col" rowSpan={section.slots}>
                        {section.label}
                        {displayTime(section.key) && <small>{displayTime(section.key)}</small>}
                        {section.sublabel && <small>{section.sublabel}</small>}
                      </th>
                    )}
                    {days.map((d) => {
                      const who = byKey.get(`${d.iso}|${section.key}|${slot}`) || "";
                      return (
                        <td
                          key={d.iso}
                          className={`${d.iso === todayIso ? "today " : ""}${who && who === me ? "mine-cell" : ""}`}
                        >
                          {who}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
