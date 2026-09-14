import { Fragment, useEffect, useMemo, useState } from "react";
import { listExperience, loadExperience, listDutyEntriesByPilot, exportLogbookPdf, getPreferredPilotCode, isSinglePilotDevice, isDemoSession } from "../../services/desktopDatabase.js";
import { combineExperience, combineSpecialty, combineAircraftRows } from "../../utils/experienceCombine.js";
import { normalizeAircraftRow } from "../../utils/timeMath.js";
import DateField, { isoToDisplay } from "../../components/DateField.jsx";
import "./MyLogbook.css";
import { todayIso } from "../../utils/dateKeys.js";
import {
  rangeForMonths, clampMonths, logbookFileName, RANGE_PRESETS,
  MAX_EXPORT_MONTHS, DEFAULT_EXPORT_MONTHS
} from "./logbookRange.js";

const ROLE_COLS = ["PIC", "PICUS", "SIC", "TRI", "TRE"];
const today = () => todayIso();
// Default "From date" - 28 days back from today, so opening the Logbook
// shows a useful recent window instead of a single empty day. Still fully
// editable via the DateField's own d/m/y picker (or typing), same as
// before - this only changes the starting value.
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// The last N WHOLE months up to and including the current one - what a licence
// renewal or an audit asks for ("export pdf หรือ print 1 year ย้อนหลัง", plus
// 3M and 6M on request). Anchored to month boundaries rather than "N x 30 days
// back", so the first and last pages are complete months and the monthly
// subtotals mean something.


const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Date, Type, Reg., Route - the identifying columns before the figures begin.
// Named because three colSpans depend on it; "Dep" and "Stop" were removed at
// Capt. Weera's instruction ("ตัด column DEP กับ Stop ออกเลย"), and a hardcoded
// 6 left behind would silently misalign every subtotal row.
const LEAD_COLS = 4;

function monthLabel(iso) {
  const [y, m] = String(iso).split("-");
  return `${MONTH_NAMES[(parseInt(m, 10) || 1) - 1]} ${y}`;
}

function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}
function decimalToHHMM(dec) {
  const totalMin = Math.round((dec || 0) * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
// combineAircraftRows returns rows carrying totalDecimal; a group total is one
// decimal-hours number. (Same helper as WeeklySchedule's, kept local for the
// same reason - it is two lines and not worth a shared import.)
function sumRowsDecimal(rows) {
  return (rows || []).reduce((s, r) => s + (r.totalDecimal || 0), 0);
}

function roleHours(entry, role) {
  return (entry.roles || [])
    .filter((r) => r.role === role)
    .reduce((sum, r) => sum + hhmmToDecimal(r.dayHours) + hhmmToDecimal(r.nightHours), 0);
}

export default function MyLogbook() {
  const [pilots, setPilots] = useState([]);
  const [pilotCode, setPilotCode] = useState("");
  const [entries, setEntries] = useState([]);
  const [fromDate, setFromDate] = useState(daysAgo(28));
  const [toDate, setToDate] = useState(today());
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  // How many whole months Print / Export cover. Follows whichever preset was
  // last pressed, so "3M" then "Print" gives a 3-month extract - the buttons
  // say which, so the file can't quietly be a different span than intended.
  const [exportMonths, setExportMonths] = useState(DEFAULT_EXPORT_MONTHS);
  // true  = whole calendar months (1 Jan - 31 Mar), the audit/renewal form
  // false = counted back from today (30 Jan - 29 Apr)
  const [wholeMonths, setWholeMonths] = useState(true);

  useEffect(() => {
    Promise.all([listExperience(), getPreferredPilotCode()]).then(([list, preferred]) => {
      setPilots(list);
      if (list.length && !pilotCode) setPilotCode(preferred || list[0].code);
    });
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
    if (pilotCode) listDutyEntriesByPilot(pilotCode).then(setEntries);
    else setEntries([]);
  }, [pilotCode]);

  // Career totals for the summary block, from the pilot's Pilot Experience
  // record. Deliberately the SAME source and the same combine functions the
  // Experience page and the Weekly Schedule use, rather than summing the
  // logbook rows: the record carries a baseline from before this app existed
  // (the PES figures), and Daily Duty entries since are added on top. Summing
  // only what is in the app would report a fraction of a real career.
  const [career, setCareer] = useState(null);
  useEffect(() => {
    if (!pilotCode) { setCareer(null); return; }
    let cancelled = false;
    (async () => {
      const p = pilots.find((x) => x.code === pilotCode);
      const record = await loadExperience(p?.licence || pilotCode).catch(() => null);
      if (cancelled) return;
      if (!record) { setCareer(null); return; }
      const duty = await listDutyEntriesByPilot(pilotCode).catch(() => []);
      if (cancelled) return;
      const combined = combineExperience(record, duty);
      const specialty = combineSpecialty(record, duty, combined.updateDate) || [];
      const byLabel = {};
      for (const s of specialty) byLabel[s.label] = s.current;

      // Rotor wing and fixed wing are shown separately as well as combined.
      // Capt. Weera: "Total ที่รวม ทั้ง fix wing กับ rotor wing และ ก้อ toal
      // rotor wing" - the grand total answers "how many hours have you flown",
      // but rotor-wing hours are what qualify someone for this operation, so a
      // single combined figure hides the number that actually matters.
      //
      // Summed from the record's own aircraft groups (each row carries its type
      // and baseline hours, with Daily Duty entries since the PES update date
      // added on top by combineAircraftRows) - the same path the Experience
      // page uses.
      const groupHours = (keys) => sumRowsDecimal(
        combineAircraftRows(
          keys.flatMap((k) => (record.experienceBase?.[k] || []).map(normalizeAircraftRow)),
          duty,
          combined.updateDate
        )
      );
      const rotor = groupHours(["rotarySingle", "rotaryMulti"]);
      const fixed = groupHours(["fixedSingle", "fixedMulti"]);

      setCareer({
        total: combined.current?.grand ?? 0,
        rotor,
        fixed,
        pic: combined.current?.pic ?? 0,
        picus: combined.current?.picus ?? 0,
        sic: combined.current?.sic ?? 0,
        tri: byLabel.TRI ?? 0,
        tre: byLabel.TRE ?? 0,
        offshore: byLabel.Offshore ?? 0,
        night: byLabel.Night ?? 0,
        ifr: byLabel["IFR(IMC)"] ?? 0
      });
    })();
    return () => { cancelled = true; };
  }, [pilotCode, pilots]);

  const from = fromDate;
  const to = toDate;

  const rows = useMemo(() => {
    return entries
      .filter((e) => e.dutyType === "flight" && e.date >= from && e.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [entries, from, to]);

  const totals = useMemo(() => {
    const t = { ft: 0, ifr: 0, onshore: 0, offshore: 0, toDay: 0, toNight: 0, landDay: 0, landNight: 0, iApp: 0 };
    ROLE_COLS.forEach((r) => { t[r] = 0; });
    for (const e of rows) {
      t.ft += hhmmToDecimal(e.totalFlightTime);
      t.ifr += hhmmToDecimal(e.ifrHours);
      t.onshore += hhmmToDecimal(e.onshoreHours);
      t.offshore += hhmmToDecimal(e.offshoreHours);
      t.toDay += Number(e.toDay) || 0;
      t.toNight += Number(e.toNight) || 0;
      t.landDay += Number(e.landDay) || 0;
      t.landNight += Number(e.landNight) || 0;
      t.iApp += Number(e.iApp) || 0;
      ROLE_COLS.forEach((r) => { t[r] += roleHours(e, r); });
    }
    return t;
  }, [rows]);

  // Rows grouped by month, each with its own subtotal - the equivalent of the
  // workbook's per-month "TOTAL THIS PAGE" line, but inline in one continuous
  // table rather than forcing a page break every month.
  const months = useMemo(() => {
    const blank = () => {
      const t = { ft: 0, ifr: 0, onshore: 0, offshore: 0, toDay: 0, toNight: 0, landDay: 0, landNight: 0, iApp: 0 };
      ROLE_COLS.forEach((r) => { t[r] = 0; });
      return t;
    };
    const byMonth = new Map();
    for (const e of rows) {
      const key = String(e.date).slice(0, 7);
      if (!byMonth.has(key)) byMonth.set(key, { key, rows: [], subtotal: blank() });
      const bucket = byMonth.get(key);
      bucket.rows.push(e);
      const t = bucket.subtotal;
      t.ft += hhmmToDecimal(e.totalFlightTime);
      t.ifr += hhmmToDecimal(e.ifrHours);
      t.onshore += hhmmToDecimal(e.onshoreHours);
      t.offshore += hhmmToDecimal(e.offshoreHours);
      t.toDay += Number(e.toDay) || 0;
      t.toNight += Number(e.toNight) || 0;
      t.landDay += Number(e.landDay) || 0;
      t.landNight += Number(e.landNight) || 0;
      t.iApp += Number(e.iApp) || 0;
      ROLE_COLS.forEach((r) => { t[r] += roleHours(e, r); });
    }
    return [...byMonth.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }, [rows]);

  // Only worth breaking the table into month blocks when the range actually
  // spans several months; a two-week range shouldn't grow a subtotal row.
  const showMonthlySubtotals = months.length > 1;

  // Columns that are ZERO for every row in the range are dropped.
  //
  // Capt. Weera, on a 12-month extract running off the side of A4 landscape:
  // "ตัดคอลัมน์ที่เป็น 0 หมดออก". Nineteen columns of figures cannot fit a page
  // width and stay legible, and most pilots never log PICUS, TRI or TRE at all -
  // so those columns were costing width to say "0:00" a hundred times.
  //
  // Only ever hides a column that is empty across the WHOLE range: if a pilot
  // flew one TRI hour in the year, the TRI column stays. So nothing is ever
  // silently omitted from the record - an absent column means a zero total,
  // which the grand-total row would have shown anyway.
  const activeRoles = useMemo(
    () => ROLE_COLS.filter((r) => totals[r] > 0),
    [totals]
  );
  const showIfr = totals.ifr > 0;
  const showOnshore = totals.onshore > 0;
  const showOffshore = totals.offshore > 0;
  const showToNight = totals.toNight > 0;
  const showLandNight = totals.landNight > 0;
  const showIApp = totals.iApp > 0;

  // Kept in sync with the header/body/footer below - a colSpan that disagrees
  // with the real column count silently breaks the "no records" row and the
  // month headings.
  const colCount =
    LEAD_COLS + activeRoles.length + 1 +
    (showIfr ? 1 : 0) + (showOnshore ? 1 : 0) + (showOffshore ? 1 : 0) +
    1 + (showToNight ? 1 : 0) +
    1 + (showLandNight ? 1 : 0) +
    (showIApp ? 1 : 0);

  const pilot = pilots.find((p) => p.code === pilotCode);

  // Print and Export produce a WHOLE-MONTH range, not whatever happens to be on
  // screen. Capt. Weera: "print หรือ export รวมทั้ง 12 เดือน ใน ไฟล์ ที่ print
  // หรือ export", later extended with 3M and 6M.
  //
  // The on-screen range stays a browsing convenience (open on the last 28 days,
  // narrow it to check one tour), but the FILE is the record - and a logbook
  // extract that happened to cover whatever was last on screen is a footgun: it
  // looks complete and isn't. So both actions set the range to the selected
  // number of whole months first, wait for React to render that, then print.
  //
  // The range is put back afterwards so the screen doesn't silently change under
  // the reader - print/export shouldn't be a navigation action.
  // One place that changes the range, so the preset buttons, the months box and
  // the End-of-month tick can never leave the screen showing one span while
  // Print/Export produce another.
  function applyMonths(n, whole) {
    const r = rangeForMonths(n, whole);
    setExportMonths(n);
    setWholeMonths(whole);
    setFromDate(r.from);
    setToDate(r.to);
  }

  // Offered in the Print button's tooltip only.
  //
  // The browser cannot be told what to call the file: Chrome keeps the name it
  // derived when the page loaded, and several ways of overriding it were tried
  // and none worked. A canvas-rendered PDF could set the name, but rasterising
  // a 12-month logbook is a ~35-megapixel job and the wait was not worth it
  // ("เอาแบบเดิม พิมพ์ชื่อ เอง ของเดิมไวดี"). So this is a suggestion, not a
  // setting - the typed name is the user's.
  const suggestedFileName = useMemo(
    () => logbookFileName(pilotCode, exportMonths, wholeMonths, rangeForMonths(exportMonths, wholeMonths)),
    [pilotCode, exportMonths, wholeMonths]
  );

  // Spells out the exact dates the file will cover. The buttons only have room
  // for "12M", which does not say whether that ends today or at a month end -
  // and the two produce different documents.
  const rangeHint = (() => {
    const r = rangeForMonths(exportMonths, wholeMonths);
    return `${r.from} to ${r.to} — ${exportMonths} month${exportMonths === 1 ? "" : "s"}, `
      + `${wholeMonths ? "whole calendar months" : "counted back from today"}. `
      + `Uses this span whatever range is shown on screen.`;
  })();

  async function withWholeMonthRange(run) {
    const prev = { from: fromDate, to: toDate };
    const wide = rangeForMonths(exportMonths, wholeMonths);
    const alreadyWide = prev.from === wide.from && prev.to === wide.to;

    if (!alreadyWide) {
      setFromDate(wide.from);
      setToDate(wide.to);
      // Two frames: one for React to commit the new rows, one for layout to
      // settle before the print dialog snapshots the page.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    try {
      await run(wide);
    } finally {
      if (!alreadyWide) {
        setFromDate(prev.from);
        setToDate(prev.to);
      }
    }
  }

  // Plain browser print. The page's own print stylesheet does the layout, which
  // is what makes this the version to hand to a regulator.
  //
  // It does NOT control the Save-as-PDF filename - Chrome keeps the name it
  // derived when the page loaded, and three attempts to override it all failed.
  // Rather than keep bending Print out of shape for a filename it cannot set,
  // naming is handled by "Download PDF" beside it, which builds a real file.
  function handlePrint() {
    if (isDemoSession()) { alert("Demo account — printing is disabled."); return; }
    withWholeMonthRange(async () => { window.print(); });
  }


  // Plain browser print. The page's own print stylesheet does the layout, which
  // is what makes this the version to hand to a regulator.
  //
  // It does NOT control the Save-as-PDF filename - Chrome keeps the name it
  // derived when the page loaded, and three attempts to override it all failed.
  // Rather than keep bending Print out of shape for a filename it cannot set,
  // naming is handled by "Download PDF" beside it, which builds a real file.
  function handlePrint() {
    if (isDemoSession()) { alert("Demo account — printing is disabled."); return; }
    withWholeMonthRange(async () => { window.print(); });
  }

  // PC build only. Electron has a real Save dialog and renders the page to a
  // proper VECTOR PDF (electron/main: printToPDF with defaultPath), so it is
  // both fast and correctly named - no reason to hide that behind the browser's
  // print sheet.
  //
  // There is deliberately NO canvas-rasterised equivalent on the web builds.
  // One was tried and removed: html2canvas has to draw the whole table at 2x
  // before paginating, which for a 12-month logbook is a ~35-megapixel canvas
  // (~134 MB) and for 36 months ~102 megapixels. Capt. Weera: "งั้น เอาแบบเดิม
  // พิมพ์ชื่อ เอง ของเดิมไวดี" - the browser's own print is near-instant, and
  // typing the filename is a smaller cost than waiting.
  async function handleExportPc() {
    if (isDemoSession()) { alert("Demo account — export is disabled."); return; }
    setExporting(true);
    setMsg("");
    try {
      await withWholeMonthRange(async (wide) => {
        const result = await exportLogbookPdf(logbookFileName(pilotCode, exportMonths, wholeMonths, wide));
        if (result?.ok && result.filePath) setMsg(`Saved: ${result.filePath}`);
        else if (result && !result.ok && result.error) setMsg("Export failed: " + result.error);
      });
    } catch (err) {
      setMsg("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  }


  return (
    <div className={`logbook-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="logbook-controls no-print">
        <div className="module-header">
          <div>
            <h1>Pilot Logbook</h1>
            <p>
              Flight logbook — browse any date range on screen; Print and Export produce{" "}
              {exportMonths} month{exportMonths === 1 ? "" : "s"}{" "}
              ({wholeMonths ? "whole calendar months" : "counted back from today"})
            </p>
          </div>
          <div className="logbook-actions">
            <button className="primary" onClick={handlePrint} title={`${rangeHint}\n\nSuggested filename: ${suggestedFileName}`}>
              Print / Save PDF ({exportMonths}M)
            </button>
            {/* PC only: Electron's Save dialog fills the filename in for you. */}
            {typeof window !== "undefined" && window.aviCoreAPI && (
              <button onClick={handleExportPc} disabled={exporting} title={rangeHint}>
                {exporting ? "Exporting…" : `Export PDF (${exportMonths}M)`}
              </button>
            )}
            <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
          </div>
        </div>

        <div className="logbook-filters">
          <label className="logbook-field">
            <span>Pilot</span>
            {isSinglePilotDevice() && !isDemoSession() ? (
              <span className="logbook-pilot-name">
                {(() => { const p = pilots.find((x) => x.code === pilotCode); return p ? `${p.code} — ${p.name}` : pilotCode; })()}
              </span>
            ) : (
              <select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)}>
                <option value="">— Select pilot —</option>
                {pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            )}
          </label>

          <label className="logbook-field"><span>From date</span><DateField value={fromDate} onChange={setFromDate} /></label>
          <label className="logbook-field"><span>To date</span><DateField value={toDate} onChange={setToDate} /></label>
          <label className="logbook-field">
            <span>Quick range (sets Print / Export too)</span>
            <div className="logbook-presets">
              {RANGE_PRESETS.map((p) => (
                <button
                  key={p.months}
                  type="button"
                  className={exportMonths === p.months ? "active" : undefined}
                  onClick={() => applyMonths(p.months, wholeMonths)}
                  title={`The last ${p.months} months. Print and Export will use this span.`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </label>

          <label className="logbook-field">
            <span>Or type months (1–{MAX_EXPORT_MONTHS})</span>
            <input
              type="number"
              className="logbook-months"
              min={1}
              max={MAX_EXPORT_MONTHS}
              value={exportMonths}
              onChange={(e) => {
                // Clamped rather than validated-on-submit: 36 months is the
                // agreed ceiling, and a silently-accepted 120 would produce a
                // document that looks official and covers a span nobody asked
                // for.
                applyMonths(clampMonths(e.target.value), wholeMonths);
              }}
            />
          </label>

          <label className="logbook-field logbook-eom">
            <span>Month boundaries</span>
            <label className="logbook-check">
              <input
                type="checkbox"
                checked={wholeMonths}
                onChange={(e) => applyMonths(exportMonths, e.target.checked)}
              />
              <span>
                End of month
                <small>
                  {wholeMonths
                    ? "Whole calendar months — monthly subtotals are complete months."
                    : "Counted back from today — the first month is a part-month."}
                </small>
              </span>
            </label>
          </label>
        </div>
        {msg && <div className="logbook-msg">{msg}</div>}
      </div>

      <div className="logbook-print-area">
        <div className="logbook-letterhead">
          <div className="logbook-title">✦ AviCore Flight Logbook</div>
          <div className="logbook-sub">
            {from} to {to}
            {months.length > 0 && ` (${months.length} month${months.length === 1 ? "" : "s"})`}
            &nbsp;|&nbsp; Generated {today()}
          </div>
          {/* The identity block a logbook page is expected to carry, the same
              fields the company workbook prints at the top of every month:
              name, licence number, and type. Blank rather than invented when a
              field isn't on the pilot's record. */}
          <div className="logbook-idblock">
            <span><b>Name:</b> {pilot?.name || "-"}</span>
            <span><b>Code:</b> {pilot?.code || "-"}</span>
            <span><b>Licence No.:</b> {pilot?.licence || "-"}</span>
            {pilot?.position && <span><b>Position:</b> {pilot.position}</span>}
          </div>
        </div>

        <div className="logbook-scroll">
          <table className="logbook-table">
            <thead>
              <tr>
                <th rowSpan="2">Date</th>
                <th rowSpan="2">Type</th>
                <th rowSpan="2">Reg.</th>
                <th rowSpan="2">Route</th>
                {/* Flight Time sits BEFORE the role breakdown (Capt. Weera:
                    "column flight time อยู่ก่อน role") - it is the figure read
                    first, and the roles are the breakdown of it. */}
                <th rowSpan="2">Flight Time</th>
                {activeRoles.length > 0 && <th colSpan={activeRoles.length}>Role Hours</th>}
                {/* IMC, not IFR: this column sums ifrHours, which is time in
                    cloud (FDT Logbook column W) and feeds the PES report's
                    "IFR(IMC)" specialty figure. The career summary below already
                    labels it "IFR (IMC)"; the header said plain "IFR", which
                    read as IFR-rules time and does not match the numbers. */}
                {showIfr && <th rowSpan="2">IMC</th>}
                {showOnshore && <th rowSpan="2">Onshore</th>}
                {showOffshore && <th rowSpan="2">Offshore</th>}
                <th colSpan={showToNight ? 2 : 1}>T/O</th>
                <th colSpan={showLandNight ? 2 : 1}>Landing</th>
                {showIApp && <th rowSpan="2">I.App</th>}
              </tr>
              <tr>
                {activeRoles.map((r) => <th key={r}>{r}</th>)}
                <th>Day</th>{showToNight && <th>Night</th>}
                <th>Day</th>{showLandNight && <th>Night</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={colCount} className="logbook-empty">No flight records in the selected range</td></tr>}
              {months.map((m) => (
                <Fragment key={m.key}>
                  {showMonthlySubtotals && (
                    <tr className="logbook-monthhead">
                      <td colSpan={colCount}>{monthLabel(m.key)}</td>
                    </tr>
                  )}
                  {m.rows.map((e) => (
                    <tr key={e.id}>
                      <td>{isoToDisplay(e.date)}</td>
                      <td>{e.flightType}</td>
                      <td>{e.registration || "-"}</td>
                      <td className="logbook-route">{e.route || "-"}</td>
                      <td className="logbook-strong">{e.totalFlightTime || "0:00"}</td>
                      {activeRoles.map((r) => <td key={r}>{decimalToHHMM(roleHours(e, r))}</td>)}
                      {showIfr && <td>{e.ifrHours || "0:00"}</td>}
                      {showOnshore && <td>{e.onshoreHours || "0:00"}</td>}
                      {showOffshore && <td>{e.offshoreHours || "0:00"}</td>}
                      <td>{e.toDay || 0}</td>
                      {showToNight && <td>{e.toNight || 0}</td>}
                      <td>{e.landDay || 0}</td>
                      {showLandNight && <td>{e.landNight || 0}</td>}
                      {showIApp && <td>{e.iApp || 0}</td>}
                    </tr>
                  ))}
                  {showMonthlySubtotals && (
                    <tr className="logbook-subtotal">
                      <td colSpan={LEAD_COLS}>Total {monthLabel(m.key)}</td>
                      <td className="logbook-strong">{decimalToHHMM(m.subtotal.ft)}</td>
                      {activeRoles.map((r) => <td key={r}>{decimalToHHMM(m.subtotal[r])}</td>)}
                      {showIfr && <td>{decimalToHHMM(m.subtotal.ifr)}</td>}
                      {showOnshore && <td>{decimalToHHMM(m.subtotal.onshore)}</td>}
                      {showOffshore && <td>{decimalToHHMM(m.subtotal.offshore)}</td>}
                      <td>{m.subtotal.toDay}</td>
                      {showToNight && <td>{m.subtotal.toNight}</td>}
                      <td>{m.subtotal.landDay}</td>
                      {showLandNight && <td>{m.subtotal.landNight}</td>}
                      {showIApp && <td>{m.subtotal.iApp}</td>}
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  {/* Labelled with the span actually covered, counted from the
                      rows present - NOT from exportMonths, which is only what
                      Print/Export will use. A hardcoded "(12M)" would have lied
                      on a 3M extract, or on any hand-picked date range. */}
                  <td colSpan={LEAD_COLS}>
                    {showMonthlySubtotals ? `GRAND TOTAL (${months.length}M)` : "Total"}
                  </td>
                  <td className="logbook-strong">{decimalToHHMM(totals.ft)}</td>
                  {activeRoles.map((r) => <td key={r}>{decimalToHHMM(totals[r])}</td>)}
                  {showIfr && <td>{decimalToHHMM(totals.ifr)}</td>}
                  {showOnshore && <td>{decimalToHHMM(totals.onshore)}</td>}
                  {showOffshore && <td>{decimalToHHMM(totals.offshore)}</td>}
                  <td>{totals.toDay}</td>
                  {showToNight && <td>{totals.toNight}</td>}
                  <td>{totals.landDay}</td>
                  {showLandNight && <td>{totals.landNight}</td>}
                  {showIApp && <td>{totals.iApp}</td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Career experience summary. The table above is the 12-month extract;
            this is the standing total behind it - the equivalent of the
            workbook's "TOTALS TO DATE" block.
            Read from the Pilot Experience record (baseline + Daily Duty since),
            NOT summed from the rows above, so it reports a real career rather
            than only what this app has seen. */}
        {career && (() => {
          // Built as a real <table> rather than a CSS grid. A grid has to be
          // re-declared as display:table for print, and print engines disagree
          // about that override - one of them stacked all eleven figures into a
          // vertical column. A table is a table in both.
          const cells = [
            { label: "Total (RW + FW)", value: career.total, lead: true },
            { label: "Total Rotor Wing", value: career.rotor, lead: true },
            ...(career.fixed > 0 ? [{ label: "Fixed Wing", value: career.fixed }] : []),
            { label: "TRE", value: career.tre },
            { label: "TRI", value: career.tri },
            { label: "PIC", value: career.pic },
            { label: "PICUS", value: career.picus },
            { label: "SIC", value: career.sic },
            { label: "Offshore", value: career.offshore },
            { label: "Night", value: career.night },
            { label: "IFR (IMC)", value: career.ifr }
          ];
          return (
            <div className="logbook-summary">
              <div className="logbook-summary-title">Pilot Experience — Total Hours to Date</div>
              <table className="logbook-summary-table">
                <thead>
                  <tr>{cells.map((c) => (
                    <th key={c.label} className={c.lead ? "logbook-summary-lead" : undefined}>{c.label}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  <tr>{cells.map((c) => (
                    <td key={c.label} className={c.lead ? "logbook-summary-lead" : undefined}>
                      {decimalToHHMM(c.value)}
                    </td>
                  ))}</tr>
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Certification block. A logbook extract is only worth anything as a
            record if it says who certified it, so this prints (screen-hidden)
            rather than leaving a blank space someone has to draw lines on. */}
        {rows.length > 0 && (
          <div className="logbook-certify print-only">
            <div className="logbook-certify-text">
              I certify that the entries in this extract are true and correct.
            </div>
            <div className="logbook-certify-sigs">
              <div>
                <div className="logbook-sigline" />
                <span>Pilot — {pilot?.name || ""}</span>
              </div>
              <div>
                <div className="logbook-sigline" />
                <span>Chief Pilot / Authorised Signatory</span>
              </div>
              <div>
                <div className="logbook-sigline" />
                <span>Date</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
