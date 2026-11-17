import React from "react";
import { decimalToHHMM } from "../../utils/statusCompute.js";

// Daily Duty Monitor - live limits for every Duty Period on the date being
// entered (see dailyMonitor.js). E.g. Night Standby called out to fly:
// Standby vs 12h, FDP vs Max FDP (reduced by the standby), Flight time vs
// the report-time cap, Standby + FDP vs 18h.

const STATUS_TEXT = { ok: "Within limits", warn: "Near limit", exc: "Exceeded", info: "" };
const KIND_TEXT = { mixed: "Mixed Duty (Flight + Ground)", flight: "Flight Duty", standby: "Standby", duty: "Duty" };
const hm = (d) => (d ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "--:--");
const dm = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
const at = (d, ref) => (d && ref && d.toDateString() !== ref.toDateString() ? `${hm(d)} (${dm(d)})` : hm(d));

function Bar({ b, refDate }) {
  const max = b.extLimit ?? b.limit;
  const pct = max ? Math.min(100, (b.used / max) * 100) : 100;
  const limitPct = b.extLimit && b.limit ? (b.limit / b.extLimit) * 100 : null;
  return (
    <div className={`ddm-bar ${b.status}`} role="group" aria-label={`${b.label} ${decimalToHHMM(b.used)}${b.limit != null ? ` of ${decimalToHHMM(b.limit)}` : ""}`}>
      <div className="ddm-bar-head">
        <span className="ddm-bar-label">{b.label}</span>
        <span className="ddm-bar-val">
          <b>{decimalToHHMM(b.used)}</b>
          {b.limit != null && <> / {decimalToHHMM(b.limit)}</>}
        </span>
      </div>
      {b.limit != null && <div className="ddm-track">
        <div className="ddm-fill" style={{ width: `${pct}%` }} />
        {limitPct != null && <div className="ddm-mark" style={{ left: `${limitPct}%` }} title={`Max ${decimalToHHMM(b.limit)} · +${decimalToHHMM(b.extLimit - b.limit)} unforeseen`} />}
      </div>}
      <div className="ddm-bar-foot">
        {b.limit == null ? (b.note || "No flight — no FDP limit")
          : b.remaining >= 0 ? <>Remaining <b>{decimalToHHMM(b.remaining)}</b>{b.endsAt && <> · {b.endsLabel} <b className="ddm-at">{at(b.endsAt, refDate)}</b></>}{b.note ? ` · ${b.note}` : ""}</>
          : <>Over by <b>{decimalToHHMM(-b.remaining)}</b>{b.endsAt && <> · max was <b className="ddm-at">{at(b.endsAt, refDate)}</b></>}{b.extLimit != null && b.used <= b.extLimit ? " · within unforeseen extension" : ""}</>}
        {b.extAt && <div className="ddm-ext">+{decimalToHHMM(b.extLimit - b.limit)} unforeseen → {at(b.extAt, refDate)}</div>}
      </div>
    </div>
  );
}

export default function DailyDutyMonitor({ cards }) {
  return (
    <section className="ddm" aria-label="Daily Duty Monitor">
      <div className="ddm-title">Daily Duty Monitor</div>
      {!cards.length ? (
        <div className="ddm-empty">Enter the start and end time of each duty — limits show here as you type.</div>
      ) : cards.map((c, i) => (
        <div key={i} className={`ddm-card ${c.status}`}>
          <div className="ddm-card-head">
            <span className="ddm-kind">{c.kind !== "standby" && c.kind !== "duty" && c.bars.some((b) => b.key === "stby") ? "Standby → Flight Duty" : KIND_TEXT[c.kind]}</span>
            <span className="ddm-span">{at(c.from, c.end)} – {at(c.end, c.from)}</span>
            <span className={`ddm-badge ${c.status}`}>{STATUS_TEXT[c.status]}</span>
          </div>
          {(c.kind !== "standby") && (
            <div className="ddm-sub">
              Report {hm(c.start)} · Max FDP {decimalToHHMM(c.maxFdp)} → <b className="ddm-at">{at(c.maxFdpAt, c.start)}</b>
              {c.reducedBy > 0 && <> (reduced {decimalToHHMM(c.reducedBy)} by standby over 6:00)</>}
              {c.maxFt != null && <> · Max flight time {decimalToHHMM(c.maxFt)}</>}
            </div>
          )}
          <div className="ddm-bars">{c.bars.map((b) => <Bar key={b.key} b={b} refDate={c.from} />)}</div>
          {c.notes.map((n) => (
            <div key={n.key} className="ddm-note">{n.label} <b>{at(n.at, c.start)}</b></div>
          ))}
        </div>
      ))}
    </section>
  );
}
