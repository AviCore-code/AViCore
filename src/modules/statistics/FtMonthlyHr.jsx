import { useEffect, useMemo, useState } from "react";
import { loadAllPilotStatusRows } from "../../utils/statusCompute.js";
import { buildFtMonthlyHr, defaultHrPeriod, minutesToHhmm, ftMonthlyHrSheetRows, HR_MAX_DAYS, isoAddDays } from "../../utils/ftMonthlyHr.js";
import "./FtMonthlyHr.css";

// Reports → FT Monthly for HR. See src/utils/ftMonthlyHr.js.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${String(y).slice(2)}`;
};
const isWeekend = (iso) => { const g = new Date(`${iso}T00:00:00`).getDay(); return g === 0 || g === 6; };

export default function FtMonthlyHr({ loadRows = loadAllPilotStatusRows }) {
  const [period, setPeriod] = useState(() => defaultHrPeriod());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await loadRows();
      setRows(res.rows || []);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const rangeError = !period.from || !period.to ? "Choose a start and an end date."
    : period.from > period.to ? "The start date is after the end date."
    : isoAddDays(period.from, HR_MAX_DAYS - 1) < period.to ? `Choose ${HR_MAX_DAYS} days or fewer.`
    : "";
  const report = useMemo(() => (rangeError ? null : buildFtMonthlyHr(rows, period.from, period.to)), [rows, period, rangeError]);

  async function exportExcel() {
    if (!report) return;
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(ftMonthlyHrSheetRows(report, { dayLabel }));
    ws["!cols"] = [{ wch: 4 }, { wch: 24 }, { wch: 6 }, { wch: 7 }, ...report.days.map(() => ({ wch: 6 })), { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FT Monthly For HR");
    XLSX.writeFile(wb, `FT Monthly for HR ${period.from} to ${period.to}.xlsx`);
  }

  const generated = new Date();

  return (
    <div className="hrft-page">
      <div className="hrft-tools no-print">
        <label>From <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></label>
        <label>To <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></label>
        <button onClick={() => setPeriod(defaultHrPeriod())} title="16th of last month to 15th of this month">16 – 15</button>
        <button onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        <button onClick={exportExcel} disabled={!report || loading}>Export Excel</button>
        <button className="primary" onClick={() => window.print()} disabled={!report || loading}>Print</button>
      </div>

      {rangeError && <div className="settings-msg error">{rangeError}</div>}
      {error && <div className="settings-msg error">Could not load duty records: {error}</div>}

      {report && (
        <div className="hrft-print-area">
          <div className="hrft-doc-head">
            <div>
              <div className="hrft-title">FT Monthly for HR</div>
              <div className="hrft-sub">{dayLabel(period.from)} – {dayLabel(period.to)} · {report.days.length} days · {report.pilots.length} pilots · flight time (block) from Daily Duty / FDT</div>
            </div>
            <div className="hrft-meta">Generated {generated.toLocaleDateString("en-GB")} {generated.toTimeString().slice(0, 5)}</div>
          </div>

          <div className="hrft-wrap">
            <table className="hrft-table">
              <thead>
                <tr>
                  <th rowSpan={2}>No.</th>
                  <th rowSpan={2} className="hrft-name">NAME</th>
                  <th rowSpan={2}>CODE</th>
                  <th rowSpan={2}>Hours</th>
                  {report.days.map((d, i) => <th key={d} className={isWeekend(d) ? "we" : ""}>{i + 1}</th>)}
                  <th rowSpan={2}>Total Hrs.</th>
                </tr>
                <tr>
                  {report.days.map((d) => <th key={d} className={`hrft-date${isWeekend(d) ? " we" : ""}`}>{dayLabel(d)}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.pilots.map((p) => (
                  <tr key={p.code || p.no}>
                    <td className="c">{p.no}</td>
                    <td className="hrft-name">{p.name}</td>
                    <td className="c">{p.code}</td>
                    <td className="hrft-hours">{minutesToHhmm(p.total)}</td>
                    {p.perDay.map((m, i) => <td key={i} className={`${m ? "fly" : "zero"}${isWeekend(report.days[i]) ? " we" : ""}`}>{minutesToHhmm(m)}</td>)}
                    <td className="hrft-total">{minutesToHhmm(p.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4 + report.days.length} className="hrft-foot-label">Fleet total</td>
                  <td className="hrft-total">{minutesToHhmm(report.fleetTotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4 + report.days.length} className="hrft-foot-label">Average per pilot ({report.pilots.length})</td>
                  <td className="hrft-total">{minutesToHhmm(report.average)}</td>
                </tr>
                <tr>
                  <td colSpan={4 + report.days.length} className="hrft-foot-label">Average × 2 − 10:00</td>
                  <td className="hrft-total">{minutesToHhmm(report.averageX2Less10)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
