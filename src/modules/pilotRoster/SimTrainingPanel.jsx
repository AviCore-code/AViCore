import { useState } from "react";
import { decimalToHHMM } from "../../utils/statusCompute.js";
import { SIM_LOOKAHEAD_DAYS, SIM_MIN_DT_LEFT, SIM_MIN_FT_LEFT } from "./dutyHistory.js";

const VERDICT = { ok: "Ready", warn: "Check roster", exc: "Not ready" };
const hhmm = (h) => (h == null ? "—" : decimalToHHMM(Math.max(0, h)));

// Sim training in the next 14 days (Capt. Weera): every pilot whose roster
// has an S/T (travel to the simulator) coming up, checked for what the trip
// needs on the travel day - DT left >= 60h, FT left >= 12h, and a 168h cycle
// that lasts the whole trip. Suggestions only: the scheduler changes the
// roster.
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
          {sorted.length} trip(s){bad ? ` · ${bad} need attention` : " · all ready"} · on the S/T day: DT left ≥ {SIM_MIN_DT_LEFT}h, FT left ≥ {SIM_MIN_FT_LEFT}h, 168h lasts the whole trip
        </span>
        <span className="simplan-toggle">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <table className="simplan-table">
          <thead>
            <tr>
              <th>Pilot</th>
              <th>Trip (roster)</th>
              <th>DT left on S/T</th>
              <th>FT left on S/T</th>
              <th>168h at S/T</th>
              <th>Status</th>
              <th>What to do</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ pilot, sim }) => (
              <tr key={`${pilot.code}-${sim.trip.from}`} className={`simplan-row ${sim.status}`}>
                <td className="simplan-pilot" title={pilot.name}>{pilot.code}</td>
                <td>{sim.tripText}</td>
                <td className={sim.dtOk ? "ok" : "exc"}>{hhmm(sim.dtLeft)} <small>/ {SIM_MIN_DT_LEFT}:00</small></td>
                <td className={sim.ftOk ? "ok" : "exc"}>{hhmm(sim.ftLeft)} <small>/ {SIM_MIN_FT_LEFT}:00</small></td>
                <td className={sim.cycleOk ? "ok" : "exc"}>
                  {sim.cycle.hoursLeft == null ? (sim.cycle.label || "—") : `${Math.max(0, Math.floor(sim.cycle.hoursLeft))}h`}
                  {" "}<small>/ {sim.cycleNeedHours}h</small>
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
