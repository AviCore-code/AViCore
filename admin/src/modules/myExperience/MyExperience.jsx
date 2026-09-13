import { useEffect, useRef, useState } from "react";
import { listExperience, loadExperience, listDutyEntriesByPilot, getSetting, getPreferredPilotCode, isDemoSession, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { combineExperience, combineAircraftRows, combineSpecialty, sumCombinedTotal, decimalToHHMM, getEffectiveUpdateDate, formatUpdateDate } from "../../utils/experienceCombine.js";
import { normalizeAircraftRow } from "../../utils/timeMath.js";
import usePrintFit from "../../hooks/usePrintFit.js";
import "./MyExperience.css";

const AIRCRAFT_GROUPS = [
  ["rotarySingle", "Rotary-Wing (S-Engine)"],
  ["fixedSingle", "Fixed-Wing (S-Engine)"],
  ["rotaryMulti", "Rotary-Wing (Multi-Engine)"],
  ["fixedMulti", "Fixed-Wing (Multi-Engine)"]
];
const HELI_GROUPS = ["rotarySingle", "rotaryMulti"];
const FIXED_GROUPS = ["fixedSingle", "fixedMulti"];
const IS_ADMIN_BUILD = import.meta.env.MODE === "admin";

// html2canvas can lose a colon when it touches the adjacent digits after A4
// scaling. Keep the value as ONE text run (nested inline/flex spans made the
// digits disappear in Chromium) and give the separator breathing room.
function TimeText({ value }) {
  const text = String(value ?? "-");
  return <span className="myexp-time">{text}</span>;
}

export default function MyExperience() {
  const [pilots, setPilots] = useState([]);
  const [pilotCode, setPilotCode] = useState("");
  const [record, setRecord] = useState(null);
  const [combined, setCombined] = useState(null);
  const [combinedRows, setCombinedRows] = useState({});
  const [specialty, setSpecialty] = useState([]);
  const [effectiveUpdate, setEffectiveUpdate] = useState("");

  const [msg, setMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [branding, setBranding] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  const printRef = useRef(null);
  // A4 landscape, 2mm margin - matches the @page rule in MyExperience.css.
  const printFitVars = usePrintFit(
    printRef, { widthMm: 297, heightMm: 210, marginMm: 2, allowUpscale: true },
    [record, combined, combinedRows, specialty]
  );

  useEffect(() => {
    Promise.all([listExperience(), getPreferredPilotCode()]).then(([list, preferred]) => {
      setPilots(list);
      if (list.length && !pilotCode) setPilotCode(preferred || list[0].code);
    });
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  useEffect(() => {
    const pilot = pilots.find((p) => p.code === pilotCode);
    if (!pilot) { setRecord(null); setCombined(null); setCombinedRows({}); setSpecialty([]); setEffectiveUpdate(""); return; }
    Promise.all([loadExperience(pilot.licence), listDutyEntriesByPilot(pilotCode)]).then(([rec, entries]) => {
      setRecord(rec);
      const c = combineExperience(rec, entries);
      setCombined(c);
      setSpecialty(combineSpecialty(rec, entries, c.updateDate));
      setEffectiveUpdate(formatUpdateDate(getEffectiveUpdateDate(rec, entries)));
      const byGroup = {};
      for (const [key] of AIRCRAFT_GROUPS) {
        const rows = (rec?.experienceBase?.[key] || []).map(normalizeAircraftRow);
        byGroup[key] = combineAircraftRows(rows, entries, c.updateDate);
      }
      setCombinedRows(byGroup);
    });
  }, [pilotCode, pilots]);

  const profile = record?.profile;
  const totalHelicopter = sumCombinedTotal(HELI_GROUPS.flatMap((k) => combinedRows[k] || []));
  const totalFixed = sumCombinedTotal(FIXED_GROUPS.flatMap((k) => combinedRows[k] || []));

  async function handleExportPdf() {
    if (isDemoSession()) { alert("Demo account — export is disabled."); return; }
    setExporting(true);
    setMsg("");
    try {
      const filename = `PES(${pilotCode || profile?.code || "Pilot"}).pdf`;
      const result = await exportLogbookPdf(filename);
      if (result?.ok) setMsg(result.message || `Saved: ${result.filePath || filename}`);
      else setMsg(`Export failed: ${result?.error || "Unknown error"}`);
    } catch (err) {
      setMsg(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`myexp-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>My Experience</h1>
          <p>Your cumulative flight hours (read-only — editable only by Admin under Pilot Experience). The Current total also includes Daily Duty records flown after the Update date.</p>
        </div>
        <div className="myexp-header-actions">
          <div className="myexp-controls">
            {/* Same direct PDF download used by Experience Admin. */}
            <button className="primary" onClick={handleExportPdf} disabled={!record || exporting}>
              {exporting ? "Exporting PDF…" : "Export PDF"}
            </button>
            <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
          </div>
          <label className="myexp-pilot">
            <span>Pilot</span>
            {!IS_ADMIN_BUILD ? (
              <span className="myexp-pilot-name">
                {(() => { const p = pilots.find((x) => x.code === pilotCode); return p ? `${p.code} — ${p.name}` : pilotCode; })()}
              </span>
            ) : (
              <select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)}>
                <option value="">— Select pilot —</option>
                {pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            )}
          </label>
        </div>
        {msg && <div className="myexp-msg">{msg}</div>}
      </div>

      {!record && <div className="myexp-empty">{pilotCode ? "No Pilot Experience data yet for this pilot." : "Select a pilot to view their data."}</div>}

      {record && (
        <div className="myexp-card myexp-print-area" ref={printRef} style={printFitVars}>
          {(branding?.logo || branding?.name) && (
            <div className="myexp-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="myexp-head">
            <div><b>Code:</b> {profile?.code || "-"}</div>
            <div><b>Name:</b> {profile?.name || "-"}</div>
            <div><b>Licence No.:</b> {profile?.licence || "-"}</div>
            <div><b>Update:</b> {effectiveUpdate || profile?.update || "-"}</div>
          </div>

          <table className="myexp-table">
            <thead><tr><th>Specialty</th><th>Hours (Current)</th></tr></thead>
            <tbody>
              {specialty.map((s) => (
                <tr key={s.label} className={s.added > 0 ? "myexp-row-updated" : ""} title={s.added > 0 ? `baseline ${decimalToHHMM(s.baseline)} + ${decimalToHHMM(s.added)} from Daily Duty` : ""}>
                  <td>{s.label}</td>
                  <td><TimeText value={decimalToHHMM(s.current)} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="myexp-aircraft-grid">
            {AIRCRAFT_GROUPS.map(([key, title]) => (
              <table className="myexp-table" key={key}>
                <thead><tr><th colSpan="5">{title} (Current)</th></tr><tr><th>Type</th><th>PIC</th><th>PICUS</th><th>SIC</th><th>Total</th></tr></thead>
                <tbody>
                  {(combinedRows[key] || []).length === 0 && <tr><td colSpan="5" className="myexp-none">-</td></tr>}
                  {(combinedRows[key] || []).map((c, i) => (
                    <tr key={i} className={c.addedCount > 0 ? "myexp-row-updated" : ""} title={c.addedCount > 0 ? `+${c.addedCount} flights from Daily Duty` : ""}>
                      {c.row.map((cell, ci) => <td key={ci}>{ci === 0 ? cell : <TimeText value={cell} />}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>

          {combined && (
            <>
              {/* Two fixed rows rather than one auto-fitting grid.
                  Capt. Weera: "PIC PICUS SIC อยู่ row เดียว ที่เหลือก้อ row
                  เดียวกัน" - the three CREW-ROLE totals belong together, and
                  the three AIRCRAFT/GRAND totals belong together. The old
                  auto-fit grid reflowed them into whatever fitted the width,
                  which mixed the two kinds and, on a narrow page, stacked them
                  into six rows - the extra height was what pushed the export
                  onto a second page. */}
              <div className="myexp-current myexp-row-roles">
                <div><span>PIC (Current)</span><b><TimeText value={decimalToHHMM(combined.current.pic)} /></b></div>
                <div><span>PICUS (Current)</span><b><TimeText value={decimalToHHMM(combined.current.picus)} /></b></div>
                <div><span>SIC (Current)</span><b><TimeText value={decimalToHHMM(combined.current.sic)} /></b></div>
              </div>
              <div className="myexp-current myexp-row-totals">
                <div><span>Helicopter (Current)</span><b><TimeText value={totalHelicopter} /></b></div>
                <div><span>Fixed-wing (Current)</span><b><TimeText value={totalFixed} /></b></div>
                <div className="myexp-grand"><span>Grand Total (Current)</span><b><TimeText value={decimalToHHMM(combined.current.grand)} /></b></div>
              </div>
            </>
          )}

          {/* Certification block — print only, same shape as the Logbook's so
              the two documents read as a set. An experience summary is only
              worth anything as a record if it says who certified it, so this
              prints ruled lines rather than leaving a blank space for someone
              to draw their own. */}
          <div className="myexp-certify print-only">
            <div className="myexp-certify-text">
              I certify that the experience recorded in this summary is true and correct.
              {(effectiveUpdate || profile?.update)
                ? <> Figures updated: <b>{effectiveUpdate || profile?.update}</b>.</>
                : null}
            </div>
            <div className="myexp-certify-sigs">
              <div>
                <div className="myexp-sigline" />
                <span>Pilot — {profile?.name || ""}</span>
              </div>
              <div>
                <div className="myexp-sigline" />
                <span>Chief Pilot / Authorised Signatory</span>
              </div>
              <div>
                <div className="myexp-sigline" />
                <span>Date</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
