import { useEffect, useMemo, useState } from "react";
import { listExperience, loadExperience, listDutyEntriesByPilot, getSetting, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { decimalToHHMM } from "../../utils/experienceCombine.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";
import { singleMonthRange, monthRoleHoursDayNight, monthFtOnType } from "./reportUtils.js";
import "./ReportB.css";
import { todayIso } from "../../utils/dateKeys.js";

const ROLES = ["TRE", "TRI", "PIC", "PICUS", "SIC"];
const today = () => todayIso();
const thisMonth = () => today().slice(0, 7);

function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}
function withinDays(dateStr, days) {
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);
  return d >= cutoff;
}

export default function ReportB() {
  const [pilots, setPilots] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(thisMonth());
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    refresh();
    getSetting("ftl_limits").then((saved) => setLimits(withFtlDefaults(saved)));
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refresh() {
    setLoading(true);
    const list = await listExperience();
    const withEntries = await Promise.all(
      list.map(async (p) => {
        const [record, dutyEntries] = await Promise.all([
          loadExperience(p.licence),
          p.code ? listDutyEntriesByPilot(p.code) : Promise.resolve([])
        ]);
        return { ...p, position: record?.profile?.position || "", dutyEntries };
      })
    );
    setPilots(withEntries);
    setLoading(false);
  }

  const { from, to } = useMemo(() => singleMonthRange(month), [month]);

  useEffect(() => {
    const computed = pilots.map((p) => {
      const entries = p.dutyEntries || [];
      const roleSums = {};
      for (const role of ROLES) roleSums[role] = monthRoleHoursDayNight(entries, role, from, to);
      const ftAw139 = monthFtOnType(entries, "AW139", from, to);

      const flight90 = entries.filter((e) => e.dutyType === "flight" && withinDays(e.date, 90));
      const flight180 = entries.filter((e) => e.dutyType === "flight" && withinDays(e.date, 180));
      const num = (v) => Number(v) || 0;
      const toDay90 = flight90.reduce((s, e) => s + num(e.toDay), 0);
      const toNight90 = flight90.reduce((s, e) => s + num(e.toNight), 0);
      const landDay90 = flight90.reduce((s, e) => s + num(e.landDay), 0);
      const landNight90 = flight90.reduce((s, e) => s + num(e.landNight), 0);
      const iApp180 = flight180.reduce((s, e) => s + num(e.iApp), 0);
      const ifr180 = flight180.reduce((s, e) => s + hhmmToDecimal(e.ifrHours), 0);

      const noActivity = ftAw139 === 0 && ROLES.every((r) => roleSums[r].day === 0 && roleSums[r].night === 0);

      return { ...p, roleSums, ftAw139, toDay90, toNight90, landDay90, landNight90, iApp180, ifr180, noActivity };
    });
    setRows(computed);
  }, [pilots, from, to]);

  async function handleExport() {
    await exportLogbookPdf(`ReportB_Monthly_${month}.pdf`);
  }

  const min = limits.iappMin180d;
  const belowMin = (v) => (v < min ? "below-min" : "");

  return (
    <div className={`report-b${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="report-b-controls no-print">
        <label className="report-b-month">
          <span>Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => window.print()}>Print</button>
        <button className="primary" onClick={handleExport}>Export PDF</button>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <div className="report-print-area">
        <div className="report-letterhead">
          <div className="report-title">UOA Pilot Flight Time Monthly Report <small># Pilot recency #</small></div>
          <div className="report-sub">{month}</div>
        </div>

        <div className="report-b-scroll">
          <table className="report-b-table">
            <colgroup>
              <col style={{ width: "3%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "5%" }} />
              <col style={{ width: "4%" }} />
              <col style={{ width: "5%" }} />
              {ROLES.map((r) => [<col key={r + "-d"} style={{ width: "4.5%" }} />, <col key={r + "-n"} style={{ width: "4.5%" }} />])}
              <col style={{ width: "4.5%" }} />
              <col style={{ width: "4.5%" }} />
              <col style={{ width: "4.5%" }} />
              <col style={{ width: "4.5%" }} />
              <col style={{ width: "4.5%" }} />
              <col style={{ width: "4.5%" }} />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan="2">NO.</th>
                <th rowSpan="2">NAME</th>
                <th rowSpan="2">Position</th>
                <th rowSpan="2">Code</th>
                <th rowSpan="2">FT(AW139)</th>
                {ROLES.map((r) => <th colSpan="2" key={r}>{r}</th>)}
                <th colSpan="2">Instrument (180D)</th>
                <th colSpan="2">Take Off (90D)</th>
                <th colSpan="2">Landing (90D)</th>
              </tr>
              <tr>
                {ROLES.map((r) => [
                  <th key={r + "-d"}>Day</th>,
                  <th key={r + "-n"}>Night</th>
                ])}
                <th>Hrs.</th>
                <th>No.</th>
                <th>Day</th>
                <th>Night</th>
                <th>Day</th>
                <th>Night</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5 + ROLES.length * 2 + 6} className="empty">No saved pilots yet.</td></tr>
              )}
              {rows.map((p, i) => (
                <tr key={p.licence} className={p.noActivity ? "no-activity" : ""}>
                  <td>{i + 1}</td>
                  <td className="name-cell">{p.name || "-"}</td>
                  <td>{p.position || "-"}</td>
                  <td>{p.code || "-"}</td>
                  <td>{decimalToHHMM(p.ftAw139)}</td>
                  {ROLES.map((r) => [
                    <td key={r + "-d"}>{decimalToHHMM(p.roleSums[r].day)}</td>,
                    <td key={r + "-n"}>{decimalToHHMM(p.roleSums[r].night)}</td>
                  ])}
                  <td>{decimalToHHMM(p.ifr180)}</td>
                  <td className={belowMin(p.iApp180)}>{p.iApp180}</td>
                  <td className={belowMin(p.toDay90)}>{p.toDay90}</td>
                  <td className={belowMin(p.toNight90)}>{p.toNight90}</td>
                  <td className={belowMin(p.landDay90)}>{p.landDay90}</td>
                  <td className={belowMin(p.landNight90)}>{p.landNight90}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="report-b-footnote">Red row = no flight activity this month · Red cell = below minimum threshold (&lt; {min})</div>
      </div>
    </div>
  );
}
