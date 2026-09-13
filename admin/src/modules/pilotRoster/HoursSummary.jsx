import { useEffect, useMemo, useState } from "react";
import { listExperience, loadExperience, listDutyEntriesByPilot, getSetting} from "../../services/desktopDatabase.js";
import { combineExperience, combineAircraftRows, combineSpecialty, sumCombinedTotal, decimalToHHMM } from "../../utils/experienceCombine.js";
import { normalizeAircraftRow } from "../../utils/timeMath.js";
import { isDemoPilotCode } from "../../config/demoUsers.js";
import "./PilotRoster.css";

// Formerly the entire "Pilot Roster" page - moved here unchanged when Pilot
// Roster became the Duty Schedule calendar (see DutySchedule.jsx) and this
// experience-hours table became its own sub-tab instead, so the compliance
// data it shows (PIC/PICUS/SIC/Grand Total hours) isn't lost in the switch.
// Columns mirror the "Pilot Experience Summary" PDF each pilot is imported
// from (see PilotExperienceBuilder). Specialty Hours, PIC/PICUS/SIC/Grand
// Total, and Total of Helicopter/Fixed-wing are all the baseline PES value
// PLUS everything logged in Daily Duty since the PES "Update" date (matched
// by Aircraft Type for the Helicopter/Fixed-wing split) - see
// src/utils/experienceCombine.js.
const PLACEHOLDER = "-";
const HELI_GROUPS = ["rotarySingle", "rotaryMulti"];
const FIXED_GROUPS = ["fixedSingle", "fixedMulti"];

// "Fit to page" for Print/Export PDF - this table has 14 fixed columns
// (NO/NAME/Lic.No + 5 specialty + 3 PIC-PICUS-SIC + Heli/Fixed/Grand) that
// are wider, in total, than one A4 landscape page at their normal on-screen
// size - without shrinking, the rightmost columns (Total of Fixed-wing,
// Grand Total) print off the edge of the page and the exported PDF looks
// like data is missing. Shrinking the real font-size/padding (not a CSS
// transform:scale, which Chromium's print pagination doesn't reliably
// respect - see the long comment on this same technique in
// DutySchedule.jsx) makes the browser reflow the table at its true final,
// smaller size so every column and every pilot row actually fits on one
// page. Same PAGE_*/BASE_* approach and constants as DutySchedule.jsx.
// Printable area of A4 landscape (297 x 210mm) at 96dpi, minus the 5mm page
// margin set in PilotRoster.css's @page: 287mm -> 1084px, 200mm -> 756px.
// Keep these in step with that margin, or fit-to-page will size the table
// for the wrong amount of paper.
const PRINT_PAGE_WIDTH_PX = 1084;
const PRINT_PAGE_HEIGHT_PX = 756;
const HOURS_TABLE_COLUMNS = 14;
const BASE_COL_WIDTH_PX = 80;
const BASE_BRAND_HEIGHT_PX = 40;
const BASE_TITLE_HEIGHT_PX = 30;
const BASE_HEADER_ROWS_HEIGHT_PX = 44; // two stacked header rows
const BASE_ROW_HEIGHT_PX = 24;
const HEIGHT_SAFETY_MARGIN = 1.08;
const MIN_PRINT_FONT_SCALE = 0.35;

function computeHoursPrintFontScale(pilotCount, hasBranding) {
  const naturalWidth = HOURS_TABLE_COLUMNS * BASE_COL_WIDTH_PX;
  const naturalHeight =
    (hasBranding ? BASE_BRAND_HEIGHT_PX : 0) +
    BASE_TITLE_HEIGHT_PX +
    BASE_HEADER_ROWS_HEIGHT_PX +
    pilotCount * BASE_ROW_HEIGHT_PX;
  const widthScale = PRINT_PAGE_WIDTH_PX / naturalWidth;
  const heightScale = PRINT_PAGE_HEIGHT_PX / (naturalHeight * HEIGHT_SAFETY_MARGIN);
  const scale = Math.min(widthScale, heightScale, 1);
  return Math.max(scale, MIN_PRINT_FONT_SCALE);
}

export default function HoursSummary() {
  const [pilots, setPilots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [branding, setBranding] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    refresh();
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  // Esc exits Full Screen (in addition to the toggle button) - same pattern
  // as Duty Schedule / All Status.
  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const printFontScale = useMemo(() => {
    const hasBranding = !!(branding?.logo || branding?.name);
    return computeHoursPrintFontScale(pilots.length, hasBranding);
  }, [pilots.length, branding]);

  async function refresh() {
    setLoading(true);
    // The DEMO login is a view-only account, not a real crew member - keep it
    // out of the experience-hours table entirely.
    const list = (await listExperience()).filter((p) => !isDemoPilotCode(p.code));
    const withRecords = await Promise.all(
      list.map(async (p) => {
        const [record, dutyEntries] = await Promise.all([
          loadExperience(p.licence),
          p.code ? listDutyEntriesByPilot(p.code) : Promise.resolve([])
        ]);
        const combined = combineExperience(record, dutyEntries);
        const heliRows = HELI_GROUPS.flatMap((k) => (record?.experienceBase?.[k] || []).map(normalizeAircraftRow));
        const fixedRows = FIXED_GROUPS.flatMap((k) => (record?.experienceBase?.[k] || []).map(normalizeAircraftRow));
        const helicopter = sumCombinedTotal(combineAircraftRows(heliRows, dutyEntries, combined.updateDate));
        const fixed = sumCombinedTotal(combineAircraftRows(fixedRows, dutyEntries, combined.updateDate));
        const specialty = combineSpecialty(record, dutyEntries, combined.updateDate);
        return { ...p, record, combined, helicopter, fixed, specialty };
      })
    );
    setPilots(withRecords);
    setLoading(false);
  }

  return (
    <div className={`roster-page${fullScreen ? " roster-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Hours Summary</h1>
          <p>Experience summary for all pilots — PIC/PICUS/SIC/Grand Total include Daily Duty logged since each pilot's PES Update date</p>
        </div>
        <div className="header-tools">
          {/* Per-page Refresh removed - the sidebar's single Refresh (full
              page reload) now covers this. refresh() itself stays. */}
          <button onClick={() => window.print()} disabled={!pilots.length}>Print / Save PDF</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      <div className="hours-print-area" style={{ "--print-font-scale": printFontScale }}>
        {(branding?.logo || branding?.name) && (
          <div className="hours-print-brand">
            {branding.logo && <img src={branding.logo} alt="" />}
            {branding.name && <span>{branding.name}</span>}
          </div>
        )}
        <div className="hours-print-title">Hours Summary — Pilot Experience</div>

      <div className="roster-scroll">
        <table className="roster-table">
          <thead>
            <tr>
              <th rowSpan="2">NO.</th>
              <th rowSpan="2">NAME</th>
              <th rowSpan="2">Lic.No.</th>
              <th colSpan="5">Specialty Hours (Current)</th>
              <th colSpan="3">Total (Current)</th>
              <th rowSpan="2">Total of Helicopter (Current)</th>
              <th rowSpan="2">Total of Fixed-wing (Current)</th>
              <th rowSpan="2">Grand Total (Current)</th>
            </tr>
            <tr>
              <th>IFR(IMC)</th>
              <th>Night</th>
              <th>Offshore</th>
              <th>TRI</th>
              <th>TRE</th>
              <th>PIC</th>
              <th>PICUS</th>
              <th>SIC</th>
            </tr>
          </thead>
          <tbody>
            {!loading && pilots.length === 0 && (
              <tr><td colSpan="13" className="empty">No saved pilots yet. Save a record in Pilot Experience first.</td></tr>
            )}
            {pilots.map((p, i) => {
              const totals = p.record?.experienceBase?.totals;
              const c = p.combined;
              return (
                <tr key={p.licence}>
                  <td>{i + 1}</td>
                  <td className="name-cell">{p.name || PLACEHOLDER}</td>
                  <td>{p.licence || PLACEHOLDER}</td>
                  {p.specialty.map((s) => (
                    <td key={s.label} title={s.added > 0 ? `baseline ${decimalToHHMM(s.baseline)} + ${decimalToHHMM(s.added)} from Daily Duty` : ""}>
                      {c.hasBaseline ? decimalToHHMM(s.current) : PLACEHOLDER}
                    </td>
                  ))}
                  <td title={c.added.pic > 0 ? `baseline ${decimalToHHMM(c.baseline.pic)} + ${decimalToHHMM(c.added.pic)} from Daily Duty` : ""}>{c.hasBaseline ? decimalToHHMM(c.current.pic) : PLACEHOLDER}</td>
                  <td title={c.added.picus > 0 ? `baseline ${decimalToHHMM(c.baseline.picus)} + ${decimalToHHMM(c.added.picus)} from Daily Duty` : ""}>{c.hasBaseline ? decimalToHHMM(c.current.picus) : PLACEHOLDER}</td>
                  <td title={c.added.sic > 0 ? `baseline ${decimalToHHMM(c.baseline.sic)} + ${decimalToHHMM(c.added.sic)} from Daily Duty` : ""}>{c.hasBaseline ? decimalToHHMM(c.current.sic) : PLACEHOLDER}</td>
                  <td title={`baseline ${totals?.helicopter ?? "0:00"}`}>{c.hasBaseline ? p.helicopter : PLACEHOLDER}</td>
                  <td title={`baseline ${totals?.fixed ?? "0:00"}`}>{c.hasBaseline ? p.fixed : PLACEHOLDER}</td>
                  <td className="grand-cell" title={c.added.grand > 0 ? `baseline ${decimalToHHMM(c.baseline.grand)} + ${decimalToHHMM(c.added.grand)} from Daily Duty (${c.sinceCount} flights)` : ""}>{c.hasBaseline ? decimalToHHMM(c.current.grand) : PLACEHOLDER}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
