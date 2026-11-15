import { useEffect, useMemo, useRef, useState } from "react";
import { listRoster } from "../../services/desktopDatabase.js";
import { defaultHrPeriod, HR_MAX_DAYS, isoAddDays } from "../../utils/ftMonthlyHr.js";
import { buildDtWorkHr, dtWorkHrSheetRows, classifyDay } from "../../utils/dtWorkHr.js";
import { dayLabel, isWeekend, autoFitCols, useFitToPagePrint } from "./hrPrint.js";
import "./FtMonthlyHr.css";

// Reports → DT Work for HR. See src/utils/dtWorkHr.js. Same date picker,
// look and one-page A4 landscape print as FT Monthly for HR (the hrft-*
// classes carry the print rules).

export default function DtWorkHr({ loadRoster = listRoster }) {
  const [period, setPeriod] = useState(() => defaultHrPeriod());
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const printRef = useRef(null);
  useFitToPagePrint(printRef);

  const rangeError = !period.from || !period.to ? "Choose a start and an end date."
    : period.from > period.to ? "The start date is after the end date."
    : isoAddDays(period.from, HR_MAX_DAYS - 1) < period.to ? `Choose ${HR_MAX_DAYS} days or fewer.`
    : "";

  async function load() {
    if (rangeError) return;
    setLoading(true);
    setError("");
    try {
      setRoster((await loadRoster({ from: period.from, to: period.to })) || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [period.from, period.to]);   // eslint-disable-line react-hooks/exhaustive-deps

  const report = useMemo(() => (rangeError ? null : buildDtWorkHr(roster, period.from, period.to)), [roster, period, rangeError]);

  async function exportExcel() {
    if (!report) return;
    const XLSX = await import("xlsx");
    const aoa = dtWorkHrSheetRows(report, { dayLabel, from: period.from, to: period.to });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = autoFitCols(aoa, report.pilots.length + 3, 2);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DT Work For HR");
    XLSX.writeFile(wb, `DT Work for HR ${period.from} to ${period.to}.xlsx`);
  }

  const generated = new Date();

  return (
    <div className="hrft-page dtw-page">
      <div className="hrft-tools no-print">
        <label>From <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
        <label>To <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
        <button onClick={() => setPeriod(defaultHrPeriod())} title="16th of last month to 15th of this month">16 – 15</button>
        <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <button onClick={exportExcel} disabled={!report || loading}>Export Excel</button>
        <button className="primary" onClick={() => window.print()} disabled={!report || loading}>Print</button>
      </div>

      {rangeError && <div className="settings-msg error">{rangeError}</div>}
      {error && <div className="settings-msg error">Could not load the roster: {error}</div>}

      {report && (
        <div className="hrft-print-area" ref={printRef}>
          <div className="hrft-doc-head">
            <div>
              <div className="hrft-title">DT Work for HR</div>
              <div className="hrft-sub">{dayLabel(period.from)} – {dayLabel(period.to)} · {report.days.length} days · {report.pilots.length} pilots · from the roster (Duty Schedule)</div>
            </div>
            <div className="hrft-meta">Generated {generated.toLocaleDateString("en-GB")} {generated.toTimeString().slice(0, 5)}</div>
          </div>

          {report.pilots.length === 0 && <p className="hrft-sub">No roster codes in this period.</p>}

          <div className="hrft-wrap">
            <table className="hrft-table dtw-table">
              <thead>
                <tr>
                  <th rowSpan={2}>No.</th>
                  <th rowSpan={2} className="hrft-name">Name</th>
                  <th className="dtw-period">Start<br /><b>{dayLabel(period.from)}</b></th>
                  {report.days.map((d) => <th key={d} rowSpan={2} className={`hrft-date${isWeekend(d) ? " we" : ""}`}>{dayLabel(d)}</th>)}
                  <th rowSpan={2} className="dtw-sum">Normal<br />DAYs</th>
                  <th rowSpan={2} className="dtw-sum">OVER<br />TIME<br />DAYs</th>
                  <th rowSpan={2} className="dtw-sum">Total</th>
                </tr>
                <tr>
                  <th className="dtw-period">End<br /><b>{dayLabel(period.to)}</b></th>
                </tr>
              </thead>
              <tbody>
                {report.pilots.map((p) => (
                  <tr key={p.code}>
                    <td className="c">{p.no}</td>
                    <td className="hrft-name">{p.name}</td>
                    <td className="c">{p.code}</td>
                    {p.perDay.map((c, i) => <td key={i} className={`dtw-code dtw-${classifyDay(c)}${isWeekend(report.days[i]) ? " we" : ""}`}>{c}</td>)}
                    <td className="dtw-num">{p.normal}</td>
                    <td className="dtw-num">{p.ot}</td>
                    <td className="hrft-total">{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dtw-approve">Approved by ______________________________ (FOM)</div>
        </div>
      )}
    </div>
  );
}
