import React, { useState } from "react";
import { decimalToHHMM } from "../../utils/statusCompute.js";
import TimeField from "../../components/TimeField.jsx";
import { calcFromStart, calcStandby } from "./dutyCalculator.js";

// Duty Time Calculator tab - enter a start time, see the limits as hours
// and clock times (see dutyCalculator.js). Nothing here is saved.

const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// Another day than the start shows its date, e.g. "04:30 (18/11)".
const at = (d, ref) => (d.toDateString() !== ref.toDateString() ? `${hm(d)} (${d.getDate()}/${d.getMonth() + 1})` : hm(d));

// 24-hour HH:MM, same time box as the Daily Duty form (no AM/PM).
function StartTime({ label, value, onChange }) {
  return (
    <label className="duty-field dcalc-start">
      <span>{label}</span>
      <TimeField value={value} onChange={onChange} placeholder="HH:MM (24h)" />
    </label>
  );
}

function Row({ k, hours, time, sub }) {
  return (
    <div className="dcalc-row">
      <span className="dcalc-k">{k}</span>
      <span className="dcalc-h">{hours}</span>
      <span className="dcalc-t">{time}</span>
      {sub && <span className="dcalc-sub">{sub}</span>}
    </div>
  );
}

function Result({ r, dp }) {
  if (!r) return <div className="ddm-empty">Enter the start time.</div>;
  const ref = r.start;
  return (
    <div className="dcalc-result">
      <Row k="Report" hours={hm(r.report)} time="" sub={r.report.getTime() !== r.start.getTime() ? "ground duty start −1:00" : ""} />
      <Row k="Max FDP" hours={`${decimalToHHMM(r.maxFdp)} hrs`} time={<>engine stop by <b>{at(r.fdpEnd, ref)}</b></>}
        sub={`+${decimalToHHMM(r.extHours)} unforeseen → ${at(r.extEnd, ref)}`} />
      {/* Post-flight shown on its own line (Capt. Weera, 19 Nov 2026): engine stop + 0:30. */}
      <Row k="Post-flight" hours={`${decimalToHHMM(r.postHours)} hrs`}
        time={<>engine stop <b>{at(r.fdpEnd, ref)}</b> + {decimalToHHMM(r.postHours)} → <b>{at(r.dutyEnd, ref)}</b></>} />
      <Row k="Duty period" hours={`${decimalToHHMM(r.maxFdp + r.postHours)} hrs`} time={<><b>{at(r.report, ref)}</b> – <b>{at(r.dutyEnd, ref)}</b></>}
        sub={`report ${at(r.report, ref)} → engine stop ${at(r.fdpEnd, ref)} + ${decimalToHHMM(r.postHours)} post-flight`} />
      {dp && <Row k="Max Duty (DP)" hours={`${decimalToHHMM(r.maxFdp)} hrs`} time={<>duty ends by <b>{at(r.fdpEnd, ref)}</b></>} sub="flight + ground, same as Max FDP" />}
      <Row k="Max flight time" hours={r.maxFt != null ? `${decimalToHHMM(r.maxFt)} hrs` : "—"} time="" />
    </div>
  );
}

function Section({ kind, n, title, hint, children }) {
  return (
    <section className={`dcalc-sec ${kind}`} aria-label={title}>
      <div className="dcalc-head"><span className="dcalc-n">{n}</span><div><h3>{title}</h3><p>{hint}</p></div></div>
      {children}
    </section>
  );
}

export default function DutyCalculator({ limits }) {
  const [fl, setFl] = useState("");
  const [order, setOrder] = useState("ground-flight");
  const [mx, setMx] = useState("");
  const [sb, setSb] = useState("");
  const stby = calcStandby(sb, limits);

  return (
    <div className="dcalc">
      <p className="dcalc-intro">Enter the start time — limits show in hours and as clock times. Nothing here is saved. A time on another day shows its date (day/month).</p>

      <Section kind="flight" n="1" title="FDP + Flight Time" hint="Flying only">
        <StartTime label="Duty start (report)" value={fl} onChange={setFl} />
        <Result r={calcFromStart("flight", fl, limits)} />
      </Section>

      <Section kind="mixed" n="2" title="Mixed Duty" hint="Ground + Flight or Flight + Ground">
        <div className="dcalc-seg" role="radiogroup" aria-label="Mixed order">
          {[["ground-flight", "Ground → Flight"], ["flight-ground", "Flight → Ground"]].map(([k, t]) => (
            <button key={k} type="button" role="radio" aria-checked={order === k} className={order === k ? "active" : ""} onClick={() => setOrder(k)}>{t}</button>
          ))}
        </div>
        <StartTime label={order === "ground-flight" ? "Ground duty start" : "Duty start (report)"} value={mx} onChange={setMx} />
        <Result r={calcFromStart(order, mx, limits)} dp />
      </Section>

      <Section kind="standby" n="3" title="Standby + Flight" hint="Called out from standby to fly">
        <StartTime label="Standby start" value={sb} onChange={setSb} />
        {!stby ? <div className="ddm-empty">Enter the start time.</div> : (
          <>
            <div className="dcalc-result">
              <Row k="Standby max" hours={`${decimalToHHMM(limits.standbyMaxHours)} hrs`} time={<>until <b>{at(stby.standbyEnd, stby.start)}</b></>} />
              <Row k="Standby + FDP" hours={`${decimalToHHMM(limits.standbyPlusFdpMaxAwakeHours)} hrs`} time={<>engine stop by <b>{at(stby.awakeEnd, stby.start)}</b></>} />
              <Row k="Call-out limit" hours={at(stby.latestCallout, stby.start)}
                time={<>report by <b>{at(stby.latestReport, stby.start)}</b></>} sub={`latest call-out · ${decimalToHHMM(stby.responseHours)} response time before report`} />
              <Row k="Call-out, no FDP cut" hours={at(stby.freeCallout, stby.start)}
                time={<>report by <b>{at(stby.freeReport, stby.start)}</b></>} sub={`first ${decimalToHHMM(stby.freeHours)} hrs of standby don't reduce Max FDP; later reduces it hour for hour (−)`} />
            </div>
            <div className="dcalc-tablewrap">
              <table className="dcalc-table" aria-label="Call-out times">
                <thead><tr><th>Call-out</th><th>Report</th><th>Standby</th><th>Max FDP</th><th>Engine stop by</th><th>Duty period (+{decimalToHHMM((limits.dutyPostFlightOffsetMinutes ?? 30) / 60)} post-flight)</th><th>Max FT</th></tr></thead>
                <tbody>
                  {stby.rows.map((r) => (
                    <tr key={r.standbyHours}>
                      <td>{at(r.callout, stby.start)}</td>
                      <td>{at(r.report, stby.start)}</td>
                      <td>{decimalToHHMM(r.standbyHours)}</td>
                      <td>{decimalToHHMM(r.maxFdp)}{r.reduction > 0 && <span className="dcalc-red"> (−{decimalToHHMM(r.reduction)})</span>}</td>
                      <td><b>{at(r.latestStop, stby.start)}</b>{r.cappedByAwake && <span className="dcalc-red"> 18h</span>}</td>
                      <td className="dcalc-dp">{at(r.report, stby.start)} – {at(r.dutyEnd, stby.start)} <span className="dcalc-dph">{decimalToHHMM((r.dutyEnd - r.report) / 3600000)}</span></td>
                      <td>{r.maxFt != null ? decimalToHHMM(r.maxFt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
