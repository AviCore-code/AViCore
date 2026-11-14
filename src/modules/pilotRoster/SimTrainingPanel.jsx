import { useState } from "react";
import { decimalToHHMM } from "../../utils/statusCompute.js";
import { SIM_LOOKAHEAD_DAYS, SIM_MIN_DT_LEFT, SIM_MIN_FT_LEFT, SIM_TRIP_DAYS } from "./dutyHistory.js";

const VERDICT = { ok: "Ready", warn: "Check roster", exc: "Not ready" };
const hhmm = (h) => (h == null ? "—" : decimalToHHMM(Math.max(0, h)));

// Sim training in the next 14 days (Capt. Weera): every pilot whose roster
// has an S/T (travel to the simulator) coming up. S/T is day 1 of a ~5-day
// trip that uses about 60h of DT 7D and 12h of FT 7D, so that much must be
// left on the S/T day, and an RR must come right before it. Suggestions
// only: the scheduler changes the roster.
// items: [{ pilot, sim: simReadiness(...) }]
export default function SimTrainingPanel({ items }) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => a.sim.trip.from.localeCompare(b.sim.trip.from)
    || String(a.pilot.code).localeCompare(String(b.pilot.code)));
  const bad = sorted.filter((x) => x.sim.status !== "ok").length;
  return (
    <section className="simplan no-print-break">
      <button type="button" className="simplan-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="simplan-title">🛩 Sim training — next {SIM_LOOKAHEAD_DAYS} days</span>
        <span className="simplan-sub">
          {sorted.length} trip(s){bad ? ` · ${bad} need attention` : " · all ready"} · S/T = day 1 of ~{SIM_TRIP_DAYS} days · trip uses ~{SIM_MIN_DT_LEFT}h DT 7D and ~{SIM_MIN_FT_LEFT}h FT 7D · RR right before S/T
        </span>
        <span className="simplan-toggle">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <table className="simplan-table">
          <thead>
            <tr>
              <th>Pilot</th>
              <th>Trip (S/T = day 1)</th>
              <th>DT 7D left on S/T</th>
              <th>FT 7D left on S/T</th>
              <th>RR before S/T</th>
              <th>Status</th>
              <th>What to do</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ pilot, sim }) => (
              <tr key={`${pilot.code}-${sim.trip.from}`} className={`simplan-row ${sim.status}`}>
                <td className="simplan-pilot" title={pilot.name}>{pilot.code}</td>
                <td title={sim.trip.rosterTo !== sim.trip.from ? `Roster: S/T … ${sim.trip.rosterTo}` : undefined}>{sim.tripText}</td>
                <td className={sim.dtOk ? "ok" : "exc"}>{hhmm(sim.dtLeft)} <small>/ {SIM_MIN_DT_LEFT}:00</small></td>
                <td className={sim.ftOk ? "ok" : "exc"}>{hhmm(sim.ftLeft)} <small>/ {SIM_MIN_FT_LEFT}:00</small></td>
                <td className={sim.rrBeforeOk ? "ok" : "exc"}
                  title={sim.cycle.hoursLeft != null ? `168h cycle at the start of S/T: ${Math.max(0, Math.floor(sim.cycle.hoursLeft))}h left (trip ${sim.cycleNeedHours}h)` : undefined}>
                  {sim.rrBeforeOk ? `✓ ${sim.rrText}` : "✗ none"}
                </td>
                <td><span className={`simplan-badge ${sim.status}`}>{VERDICT[sim.status]}</span></td>
                <td className="simplan-notes">{sim.notes.length ? sim.notes.join(" · ") : "Nothing to change"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
