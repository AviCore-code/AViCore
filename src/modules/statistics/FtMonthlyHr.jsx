import { useEffect, useMemo, useRef, useState } from "react";
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

// A4 landscape less the 6 mm print margins (FtMonthlyHr.css @page), in CSS px.
const PAGE_W = Math.floor(((297 - 12) / 25.4) * 96);
const PAGE_H = Math.floor(((210 - 12) / 25.4) * 96) - 8;

// Capt. Weera: "print A4 แนวนอน แผ่นเดียว". At 10 pt a 31-day table is wider
// than the sheet, so just before printing the report is zoomed to fit one
// page (never enlarged), and set back afterwards.
function fitToPage(area) {
  if (!area) return;
  area.style.zoom = "";
  const table = area.querySelector("table");
  const width = Math.max(area.scrollWidth, table?.scrollWidth || 0);
  const parts = [...area.children].reduce((h, el) => h + (el.classList.contains("hrft-wrap") ? (table?.offsetHeight || 0) : el.offsetHeight), 0);
  const zoom = Math.min(1, PAGE_W / Math.max(1, width), PAGE_H / Math.max(1, parts + 40));
  area.style.zoom = String(Math.floor(zoom * 1000) / 1000);
}

// Excel: each column as wide as its longest value ("fit to cell").
function autoFitCols(aoa, upToRow) {
  const widths = [];
  aoa.slice(0, upToRow).forEach((row) => row.forEach((v, c) => {
    widths[c] = Math.max(widths[c] || 2, String(v ?? "").length + 1);
  }));
  return widths.map((wch) => ({ wch }));
}

export default function FtMonthlyHr({ loadRows = loadAllPilotStatusRows }) {
  const [period, setPeriod] = useState(() => defaultHrPeriod());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const printRef = useRef(null);

  useEffect(() => {
    const before = () => fitToPage(printRef.current);
    const after = () => { if (printRef.current) printRef.current.style.zoom = ""; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, []);

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
    const aoa = ftMonthlyHrSheetRows(report, { dayLabel });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Fit to the table only - the signature lines under it would widen column B.
    ws["!cols"] = autoFitCols(aoa, report.pilots.length + 2);
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
        <div className="hrft-print-area" ref={printRef}>
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
            </table>
          </div>

          {/* Sign-off: the FOM / CP signs the printed sheet before it goes to HR. */}
          <div className="hrft-sign">
            <div className="hrft-sign-box">
              <div className="hrft-sign-space" />
              <div className="hrft-sign-line">Signature</div>
              <div className="hrft-sign-name">( ................................................ )</div>
              <div className="hrft-sign-pos">Position&nbsp; <b>FOM / CP</b></div>
              <div className="hrft-sign-date">Date ......... / ......... / ...............</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
