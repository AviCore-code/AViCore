import { useEffect, useMemo, useRef, useState } from "react";
import { loadAllPilotStatusRows } from "../../utils/statusCompute.js";
import { defaultHrPeriod, HR_MAX_DAYS, isoAddDays, minutesToHhmm } from "../../utils/ftMonthlyHr.js";
import { buildPairCheck } from "../../utils/pairCheck.js";
import { dayLabel, useFitToPagePrint } from "./hrPrint.js";
import "./FtMonthlyHr.css";

// Reports → Pair Check. See src/utils/pairCheck.js. Same date picker and
// one-page A4 landscape print as the HR reports.

const STATUS = { exc: "Check", warn: "Swap / note", info: "Info", ok: "OK" };
const SOURCE = { exact: "", derived: " (derived)", unknown: "" };

export default function PairCheck({ loadRows = loadAllPilotStatusRows }) {
  const [period, setPeriod] = useState(() => defaultHrPeriod());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(true);
  const printRef = useRef(null);
  useFitToPagePrint(printRef, { fitHeight: false });

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows((await loadRows()).rows || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const rangeError = !period.from || !period.to ? "Choose a start and an end date."
    : period.from > period.to ? "The start date is after the end date."
    : isoAddDays(period.from, HR_MAX_DAYS - 1) < period.to ? `Choose ${HR_MAX_DAYS} days or fewer.`
    : "";
  const report = useMemo(() => (rangeError ? null : buildPairCheck(rows, period.from, period.to)), [rows, period, rangeError]);
  const shown = report ? report.items.filter((i) => !onlyProblems || i.status !== "ok") : [];
  const counts = report ? report.items.reduce((c, i) => ({ ...c, [i.status]: (c[i.status] || 0) + 1 }), {}) : {};
  const generated = new Date();

  return (
    <div className="hrft-page pair-page">
      <div className="hrft-tools no-print">
        <label>From <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
        <label>To <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
        <button onClick={() => setPeriod(defaultHrPeriod())} title="16th of last month to 15th of this month">16 – 15</button>
        <label className="pair-toggle"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only swaps &amp; differences</label>
        <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <button className="primary" onClick={() => window.print()} disabled={!report || loading}>Print</button>
      </div>

      {rangeError && <div className="settings-msg error">{rangeError}</div>}
      {error && <div className="settings-msg error">Could not load duty records: {error}</div>}
      {report?.noCrewDays > 0 && (
        <div className="settings-msg error no-print">
          {report.noCrewDays} flying day(s) in this period have no pilot names: either that pilot's Logbook row has no names, or the FDT file was imported before AviCore read them
          (Import FDT / Auto Import again to fix that).
        </div>
      )}

      {report && (
        <div className="hrft-print-area" ref={printRef}>
          <div className="hrft-doc-head">
            <div>
              <div className="hrft-title">Pair Check — who flew together</div>
              <div className="hrft-sub">
                {dayLabel(period.from)} – {dayLabel(period.to)} · {counts.ok || 0} pair-days OK · {counts.exc || 0} to check · {counts.warn || 0} swaps / notes · {counts.info || 0} info
                {" · "}from the FDT Logbook (pilot names per flight) and Daily Duty FT
              </div>
            </div>
            <div className="hrft-meta">Generated {generated.toLocaleDateString("en-GB")} {generated.toTimeString().slice(0, 5)}</div>
          </div>

          {shown.length === 0 ? <p className="hrft-sub">{report.items.length ? "Every pair flew together all day with the same FT." : "No flights with crew names in this period."}</p> : (
            <div className="hrft-wrap">
              <table className="hrft-table pair-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Pilots</th>
                    <th>Flights (partner per flight)</th>
                    <th>FT</th>
                    <th>Hours with each partner</th>
                    <th>Status</th>
                    <th className="pair-note">What it means</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i, n) => (
                    <tr key={n} className={`pair-${i.status}`}>
                      <td className="c">{dayLabel(i.date)}</td>
                      <td className="c"><b>{i.pilots[0]}</b>{i.kind === "pair" && i.pilots[1] ? <> + <b>{i.pilots[1]}</b></> : null}</td>
                      <td className="pair-flights">{i.flights}</td>
                      <td className="c">{i.kind === "pair" ? `${minutesToHhmm(i.ft[0])} / ${i.ft[1] == null ? "—" : minutesToHhmm(i.ft[1])}` : minutesToHhmm(i.ft[0])}</td>
                      <td className="pair-split">
                        {i.kind === "swap"
                          ? i.split.map((s) => `${s.partner} ${s.minutes == null ? "?" : minutesToHhmm(s.minutes)}${SOURCE[s.source]}`).join(" · ")
                          : i.kind === "pair" && i.status === "ok" ? `together ${minutesToHhmm(i.ft[0])}` : ""}
                      </td>
                      <td className="c"><span className={`pair-badge ${i.status}`}>{STATUS[i.status]}</span></td>
                      <td className="pair-note">{i.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pair-foot">Pilot names per flight are exact (FDT Logbook). Hours per partner on a swap day: "exact" = the partner flew only with this pilot that day (their own FT); "(derived)" = this pilot's FT minus the exact ones; "?" = cannot be split from daily totals.</p>
        </div>
      )}
    </div>
  );
}
