import { useEffect, useState } from "react";
import { listExperience, loadExperience, listDutyEntriesByPilot, getSetting, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { combineExperience, combineAircraftRows, parseHbdDate, formatAgeYM, decimalToHHMM } from "../../utils/experienceCombine.js";
import { normalizeAircraftRow } from "../../utils/timeMath.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";
import "./ReportA.css";

const PLACEHOLDER = "-";
const MULTI_ENGINE_GROUPS = ["rotaryMulti", "fixedMulti"];
const ALL_GROUPS = ["rotarySingle", "fixedSingle", "rotaryMulti", "fixedMulti"];

function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}

// PIC hours specifically on Multi-Engine aircraft (rotary + fixed), summed
// across their combined rows - excludes single-engine baseline/added hours.
function mEngPicHours(record, dutyEntries, updateDate) {
  const combined = MULTI_ENGINE_GROUPS.flatMap((g) =>
    combineAircraftRows((record?.experienceBase?.[g] || []).map(normalizeAircraftRow), dutyEntries, updateDate)
  );
  return combined.reduce((sum, r) => sum + hhmmToDecimal(r.row[1]), 0);
}

function aw139TotalHours(record, dutyEntries, updateDate) {
  const combined = ALL_GROUPS.flatMap((g) =>
    combineAircraftRows((record?.experienceBase?.[g] || []).map(normalizeAircraftRow), dutyEntries, updateDate)
  );
  // Whitespace-insensitive match - a baseline row can be spelled "AW 139"
  // (with a space, as some PES PDFs have it) - see normalizeType in
  // experienceCombine.js for why this can't be a plain exact match.
  const row = combined.find((r) => (r.row[0] || "").replace(/\s+/g, "").toUpperCase() === "AW139");
  return row ? row.totalDecimal : 0;
}

export default function ReportA() {
  const [pilots, setPilots] = useState([]);
  const [loading, setLoading] = useState(true);
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
    const withRecords = await Promise.all(
      list.map(async (p) => {
        const [record, dutyEntries] = await Promise.all([
          loadExperience(p.licence),
          p.code ? listDutyEntriesByPilot(p.code) : Promise.resolve([])
        ]);
        const combined = combineExperience(record, dutyEntries);
        const totalTime = combined.current.grand;
        const picTotal = combined.current.pic;
        const mEngPic = mEngPicHours(record, dutyEntries, combined.updateDate);
        const aw139 = aw139TotalHours(record, dutyEntries, combined.updateDate);
        const hbd = parseHbdDate(record?.profile?.hbd);
        return {
          ...p,
          hasBaseline: combined.hasBaseline,
          hbdRaw: record?.profile?.hbd || "",
          ages: hbd ? formatAgeYM(hbd) : "",
          position: record?.profile?.position || "",
          totalTime, picTotal, mEngPic, aw139
        };
      })
    );
    setPilots(withRecords);
    setLoading(false);
  }

  async function handleExport() {
    await exportLogbookPdf("ReportA_Pilot_Qualification_Summary.pdf");
  }

  return (
    <div className={`report-a${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="report-a-controls no-print">
        <button onClick={refresh}>Refresh</button>
        <button onClick={() => window.print()}>Print</button>
        <button className="primary" onClick={handleExport}>Export PDF</button>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <div className="report-print-area">
        <div className="report-letterhead">
          <div className="report-title">Pilot Experience / Qualification Summary</div>
        </div>

        <div className="report-a-scroll">
          <table className="report-a-table">
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12.5%" }} />
              <col style={{ width: "12.5%" }} />
              <col style={{ width: "6%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>NO.</th>
                <th>NAME</th>
                <th>Code</th>
                <th>HBD</th>
                <th>Ages</th>
                <th>Lic.No.</th>
                <th>Position</th>
                <th>Total Time ({limits.reportTotalTimeMin})</th>
                <th>M-Eng.(PIC {limits.reportMEngPicMin})</th>
                <th>PIC ({limits.reportPicMin})</th>
                <th>AW-139 (Cap {limits.reportAw139Min} / Co {limits.reportAw139SecondaryMin})</th>
              </tr>
            </thead>
            <tbody>
              {!loading && pilots.length === 0 && (
                <tr><td colSpan="11" className="empty">No saved pilots yet.</td></tr>
              )}
              {pilots.map((p, i) => (
                <tr key={p.licence}>
                  <td>{i + 1}</td>
                  <td className="name-cell">{p.name || PLACEHOLDER}</td>
                  <td>{p.code || PLACEHOLDER}</td>
                  <td>{p.hbdRaw || PLACEHOLDER}</td>
                  <td>{p.ages || PLACEHOLDER}</td>
                  <td>{p.licence || PLACEHOLDER}</td>
                  <td>{p.position || PLACEHOLDER}</td>
                  <td className={p.hasBaseline && p.totalTime < limits.reportTotalTimeMin ? "below-min" : ""}>{p.hasBaseline ? decimalToHHMM(p.totalTime) : PLACEHOLDER}</td>
                  <td className={p.hasBaseline && p.mEngPic < limits.reportMEngPicMin ? "below-min" : ""}>{p.hasBaseline ? decimalToHHMM(p.mEngPic) : PLACEHOLDER}</td>
                  <td className={p.hasBaseline && p.picTotal < limits.reportPicMin ? "below-min" : ""}>{p.hasBaseline ? decimalToHHMM(p.picTotal) : PLACEHOLDER}</td>
                  <td className={p.hasBaseline && p.aw139 < ((p.position || "").toLowerCase() === "captain" ? limits.reportAw139Min : limits.reportAw139SecondaryMin) ? "below-min" : ""}>{p.hasBaseline ? decimalToHHMM(p.aw139) : PLACEHOLDER}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
