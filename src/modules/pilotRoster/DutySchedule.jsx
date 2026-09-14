import { useEffect, useMemo, useRef, useState } from "react";
import { listRoster, listRosterPilots, listExperience, importRosterMany, deleteRosterEntry, getSetting} from "../../services/desktopDatabase.js";
import { getCodeInfo, listRosterSymbols, listCompensateSymbols, applyRosterSymbolCustomizations } from "./rosterCodes.js";
import { isDemoPilotCode } from "../../config/demoUsers.js";
import RosterImportPanel from "./RosterImportPanel.jsx";
import GenerateTemplatePanel from "./GenerateTemplatePanel.jsx";
import PlanTrainingPanel from "./PlanTrainingPanel.jsx";
import "./PilotRoster.css";

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const normalizeCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// A day counts toward the headcount only if the pilot is actually flying/on
// standby that day (categories "duty"/"night" - codes O/N/ND) - matching the
// same definition the company's own Excel used for its "Captain"/"Copilot"
// row totals (COUNTIF(...,"O")+COUNTIF(...,"N")+COUNTIF(...,"ND")). Rest,
// leave, training, and inspection days are not counted as "available crew".
const ON_DUTY_CATEGORIES = new Set(["duty", "night"]);

function pad2(n) {
  return String(n).padStart(2, "0");
}
function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
function pendingKey(pilotCode, iso) {
  return `${pilotCode}::${iso}`;
}

// Instructor/examiner/qualification suffix codes the source Excel's NAME
// column sometimes has appended after the pilot's actual name (e.g. "GI",
// "TRI", or with a helicopter-category tag like "TRI(H)"/"TRE(H)") -
// stripped for display in this table's pilot column only; the underlying
// pilot_name value in the database is left untouched. The regex matches
// each code as a whole word, with an optional trailing "(H)"/"(A)"-style
// tag right after it (any letter in parens, not just H, to be safe).
const NAME_SUFFIX_CODES = ["GI", "FSO", "HFDM", "TRI", "TRE", "AVSEC"];
const NAME_SUFFIX_PATTERN = new RegExp(`\\b(?:${NAME_SUFFIX_CODES.join("|")})\\b(?:\\s*\\([A-Z]\\))?`, "gi");
function cleanPilotName(name) {
  if (!name) return name;
  const cleaned = name
    .replace(NAME_SUFFIX_PATTERN, " ")
    .replace(/\([^)]*\)/g, " ") // any other leftover parenthetical, e.g. a stray "()" or a tag on a code not in the list above
    .replace(/[,/]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,-]+|[\s,-]+$/g, "")
    .trim();
  return cleaned || name;
}

// Max number of 2-person flight crews that can be formed from the pilots
// on duty that day. Only rule: two Co-pilots can never crew together -
// every other pairing is fine (Captain+Captain, Captain+Co-pilot). Since
// every Co-pilot must therefore pair with a Captain, Co-pilots are the
// limiting resource once there are more of them than Captains:
//   coPilot <= captain: every pilot pairs up (captains soak up the leftover
//     captain-only pairs) -> floor((captain + coPilot) / 2)
//   coPilot >  captain: each captain takes one co-pilot, the rest of the
//     co-pilots have no one left to pair with -> captain
function maxCrewPairs(captain, coPilot) {
  if (coPilot <= captain) return Math.floor((captain + coPilot) / 2);
  return captain;
}

// "Fit to page" for Print/Export PDF - the printable table can be wider
// (many days in a month) and taller (many pilots) than one A4 landscape
// page. A CSS transform:scale() on the print area was tried first but
// Chromium's print pagination doesn't reliably shrink its *layout* box
// to match (only the visual render), which produced cut-off columns and
// overlapping text in the exported PDF. Shrinking the *real* font-size /
// padding / column widths instead makes the browser reflow the table at
// its true final size, so pagination and overlap both come out correct.
// The PAGE_* constants mirror the @page rule in PilotRoster.css (A4
// landscape, 10mm margins -> 277mm x 190mm printable area, converted to
// CSS px at 96dpi: mm * 96/25.4). The BASE_* constants are the
// approximate unscaled size (in px) of one unit of each piece at 100%
// print scale - close enough to get a good-fit multiplier without
// needing to measure the live DOM (which isn't reliably possible before
// the print stylesheet is actually applied).
// A4 landscape printable area at 96dpi with the 5mm @page margin set in
// PilotRoster.css: 287mm -> 1084px, 200mm -> 756px.
const PRINT_PAGE_WIDTH_PX = 1084;
const PRINT_PAGE_HEIGHT_PX = 756;
const BASE_PILOT_COL_WIDTH_PX = 90;
const BASE_DAY_COL_WIDTH_PX = 28;
const BASE_BRAND_HEIGHT_PX = 40; // logo/company-name row, only present when branding is set
const BASE_TITLE_HEIGHT_PX = 30;
const BASE_HEADER_ROW_HEIGHT_PX = 24;
// Calibrated up from an earlier, too-low estimate after a real export
// still overflowed by about a centimeter - Chromium's actual rendered row
// height (font-size + padding + border + line-height) at 8.5px print
// font runs closer to ~24px than the ~14px first assumed here.
const BASE_ROW_HEIGHT_PX = 24;
// Extra cushion on top of the height estimate above - the goal is "never
// overflows", so it's better to shrink a little more than strictly
// necessary than to leave a table that spills a few pixels onto page 2.
const HEIGHT_SAFETY_MARGIN = 1.08;
// Floor so the text never shrinks past legibility on a very large fleet
// or a 31-day month - beyond this point it's better to let it spill onto
// a second page than to print something unreadable.
const MIN_PRINT_FONT_SCALE = 0.35;

// The definitions/legend block (Unranked & Crews notes, the duty-code
// legend) is screen-only now - see the .no-print class on those elements
// below - so it no longer costs any of the printed page's height budget.
function computePrintFontScale(numDays, pilotCount, footerRowCount, hasBranding) {
  const naturalWidth = BASE_PILOT_COL_WIDTH_PX + numDays * BASE_DAY_COL_WIDTH_PX;
  const naturalHeight =
    (hasBranding ? BASE_BRAND_HEIGHT_PX : 0) +
    BASE_TITLE_HEIGHT_PX +
    BASE_HEADER_ROW_HEIGHT_PX +
    pilotCount * BASE_ROW_HEIGHT_PX +
    footerRowCount * BASE_ROW_HEIGHT_PX;
  const widthScale = PRINT_PAGE_WIDTH_PX / naturalWidth;
  const heightScale = PRINT_PAGE_HEIGHT_PX / (naturalHeight * HEIGHT_SAFETY_MARGIN);
  // Never scale up past 1 - a small roster should keep its normal print
  // size rather than being blown up to fill the page.
  const scale = Math.min(widthScale, heightScale, 1);
  return Math.max(scale, MIN_PRINT_FONT_SCALE);
}

// The 21-duty/7-off cycle imported from Excel (see rosterImport.js /
// rosterCodes.js) shown as a calendar grid — one row per pilot, one column
// per day of the selected month, each cell colored by duty category.
export default function DutySchedule() {
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [rows, setRows] = useState([]);
  const [pilotsMeta, setPilotsMeta] = useState([]);
  const [positionsByCode, setPositionsByCode] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showPlanTraining, setShowPlanTraining] = useState(false);
  // Which pilot to preselect when Set Work Pattern is opened by clicking a
  // name in the table, rather than the header button. Cleared once the
  // panel closes so the header button goes back to opening it with no
  // pilot forced.
  const [generatePresetCode, setGeneratePresetCode] = useState(null);
  const [editingCell, setEditingCell] = useState(null); // { pilotCode, iso }
  const [savingAll, setSavingAll] = useState(false);
  const [branding, setBranding] = useState(null);
  const [rosterSymbols, setRosterSymbols] = useState(() => [...listRosterSymbols(), ...listCompensateSymbols()]);
  const [fullScreen, setFullScreen] = useState(false);
  const rosterPageRef = useRef(null);
  // Batch edit: cells clicked/typed into aren't written to the database
  // right away - they're staged here (keyed by "pilotCode::iso") until the
  // person hits SAVE, so several edits across the grid can be made first
  // and committed together in one go. Map<key, { pilotCode, pilotName,
  // base, iso, value }> - value === "" means "clear this day" (delete).
  const [pendingEdits, setPendingEdits] = useState(new Map());
  // Excel-style cell selection / copy-paste / fill-drag. selection is a
  // rectangle described by two grid coordinates (row = pilot index in
  // `filtered`, col = day index in `dayHeaders`); anchor===current means a
  // single cell is selected. dragMode is null outside of an active mouse
  // drag - "select" while dragging out a range from a plain cell, "fill"
  // while dragging from a cell's small corner handle (see .fill-handle).
  const [selection, setSelection] = useState(null); // { anchor:{rowIdx,colIdx}, current:{rowIdx,colIdx} }
  const [dragMode, setDragMode] = useState(null); // null | "select" | "fill"
  const [fillSource, setFillSource] = useState(null); // { rowIdx, colIdx, value }
  const [clipboardValue, setClipboardValue] = useState(null);

  const [year, month] = monthKey.split("-").map(Number);
  const numDays = daysInMonth(year, month);
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${pad2(numDays)}`;
  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    refresh();
    setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKey]);

  useEffect(() => {
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
    // Settings > Roster Symbol - label/colour overrides and any admin-added
    // custom code, so this page's cells and legend match what was saved
    // there, not just the built-in defaults.
    getSetting("roster_symbol_customizations").then((saved) => {
      applyRosterSymbolCustomizations(saved || {});
      setRosterSymbols([...listRosterSymbols(), ...listCompensateSymbols()]);
    });
  }, []);

  // Keep React state aligned with the browser's native Fullscreen state.
  // Escape is handled by the browser and fires fullscreenchange here.
  useEffect(() => {
    function onFullscreenChange() {
      setFullScreen(document.fullscreenElement === rosterPageRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullScreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await rosterPageRef.current?.requestFullscreen();
      }
    } catch {
      // Fallback for browsers/PWA shells that block the native API.
      setFullScreen((value) => !value);
    }
  }

  // Same generic "print the current window to PDF" mechanism the All
  // Status page uses (see AllStatus.jsx's handleExport / logbook:exportPdf
  // in main.cjs) - it just rasterizes whatever's currently visible, so the
  // print-only .duty-print-area below is what actually ends up in the file.

  async function refresh() {
    setLoading(true);
    const [list, pilots, experiencePilots] = await Promise.all([
      listRoster({ from, to }),
      listRosterPilots(),
      listExperience()
    ]);
    setRows(list);
    setPilotsMeta(pilots);
    // Position ("Captain"/"SFO"/"FO", set on the Pilot Experience Profile
    // tab) lives in pilot_experience, keyed by the same 3-letter code the
    // roster uses - joined here by code so the headcount below doesn't need
    // its own rank field, and always reflects whatever's currently on each
    // pilot's Profile tab rather than a stale copy.
    // The flat `position` is what every data layer returns now; the
    // profile/record_json fallbacks cover an older row shape so the rank
    // headcount can't silently fall back to "Unranked" (which showed 0 for
    // both Captain and Co-pilot on duty).
    const posMap = {};
    for (const p of experiencePilots) {
      const code = normalizeCode(p.code || p.profile?.code);
      const position = p.position || p.profile?.position || p.record_json?.profile?.position;
      if (code && position) posMap[code] = position;
    }
    setPositionsByCode(posMap);
    setLoading(false);
  }

  // Row order: grouped by rank - all Captains first, then all Co-pilots
  // (SFO/FO combined), then anyone with no known Position last - name A-Z
  // within each group. Position comes from positionsByCode (Pilot
  // Experience Profile), same lookup the daily headcount below uses, so
  // the grouping always matches whatever's on each pilot's Profile tab.
  const byPilot = useMemo(() => {
    const RANK_GROUP_ORDER = { Captain: 0, SFO: 1, FO: 1 };
    const map = new Map();
    for (const p of pilotsMeta) {
      map.set(p.pilot_code, { pilotCode: p.pilot_code, pilotName: p.pilot_name, base: p.base, days: {} });
    }
    for (const r of rows) {
      if (!map.has(r.pilot_code)) map.set(r.pilot_code, { pilotCode: r.pilot_code, pilotName: r.pilot_name, base: r.base, days: {} });
      const entry = map.get(r.pilot_code);
      entry.days[r.date] = r.code;
      if (r.pilot_name) entry.pilotName = r.pilot_name;
      if (r.base) entry.base = r.base;
    }
    // The DEMO login isn't a real crew member - drop it so it never shows as
    // a roster row or gets counted in the daily headcount below.
    for (const code of [...map.keys()]) {
      if (isDemoPilotCode(code)) map.delete(code);
    }
    return [...map.values()].sort((a, b) => {
      const groupA = RANK_GROUP_ORDER[positionsByCode[normalizeCode(a.pilotCode)]] ?? 2;
      const groupB = RANK_GROUP_ORDER[positionsByCode[normalizeCode(b.pilotCode)]] ?? 2;
      if (groupA !== groupB) return groupA - groupB;
      return (a.pilotName || "").localeCompare(b.pilotName || "");
    });
  }, [rows, pilotsMeta, positionsByCode]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return byPilot;
    return byPilot.filter((p) => (p.pilotName || "").toUpperCase().includes(q) || (p.pilotCode || "").includes(q));
  }, [byPilot, search]);

  // Today's date, computed once per render so every column can just check
  // `h.iso === todayIso` - simpler and always correct across month/year
  // boundaries than comparing day numbers.
  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, []);

  const dayHeaders = useMemo(() => {
    const out = [];
    for (let d = 1; d <= numDays; d++) {
      const date = new Date(year, month - 1, d);
      const wd = date.getDay();
      const iso = `${monthKey}-${pad2(d)}`;
      out.push({ day: d, weekday: WEEKDAY_ABBR[wd], isWeekend: wd === 0 || wd === 6, iso, isToday: iso === todayIso });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, numDays, monthKey, todayIso]);

  // Switching month while edits are still staged (unsaved) would silently
  // strand them - refresh() re-fetches from the DB and pendingEdits would
  // no longer line up with what's on screen. Confirm and clear first.
  function confirmDiscardIfPending() {
    if (pendingEdits.size === 0) return true;
    return window.confirm(`You have ${pendingEdits.size} unsaved change(s). Discard them and continue?`);
  }

  function shiftMonth(delta) {
    if (!confirmDiscardIfPending()) return;
    setPendingEdits(new Map());
    const d = new Date(year, month - 1 + delta, 1);
    setMonthKey(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  function handleMonthPick(value) {
    if (!value) return;
    if (!confirmDiscardIfPending()) return;
    setPendingEdits(new Map());
    setMonthKey(value);
  }

  function handleSearchChange(value) {
    setSearch(value);
    setSelection(null); // filtered row order/length can change, indices go stale
  }

  // Stages a batch of cell changes at once (used by direct edit, paste,
  // fill-drag, and clear-selection alike) - value is compared against the
  // pilot's last-SAVED value (p.days[iso], not any other pending edit for
  // that cell) so re-typing back to the original clears its dirty flag.
  function stageMany(cells) {
    if (!cells.length) return;
    setPendingEdits((prev) => {
      const next = new Map(prev);
      for (const { pilot, iso, value } of cells) {
        const key = pendingKey(pilot.pilotCode, iso);
        const existing = (pilot.days[iso] || "").toUpperCase();
        const v = String(value || "").trim().toUpperCase();
        if (v === existing) next.delete(key);
        else next.set(key, { pilotCode: pilot.pilotCode, pilotName: pilot.pilotName, base: pilot.base, iso, value: v });
      }
      return next;
    });
  }

  // Inline cell edit: double-click a cell (or press Enter/F2 while
  // selected) -> small text input -> Enter/blur stages the change, Escape
  // cancels. Nothing is written to the database here - see handleSaveAll.
  function handleCellStage(p, iso, rawValue) {
    setEditingCell(null);
    stageMany([{ pilot: p, iso, value: rawValue }]);
  }

  function getCellValue(rowIdx, colIdx) {
    const p = filtered[rowIdx];
    const iso = dayHeaders[colIdx]?.iso;
    if (!p || !iso) return "";
    const pending = pendingEdits.get(pendingKey(p.pilotCode, iso));
    return pending ? pending.value : (p.days[iso] || "");
  }

  function collectRangeCells(sel) {
    const { anchor, current } = sel;
    const r0 = Math.min(anchor.rowIdx, current.rowIdx), r1 = Math.max(anchor.rowIdx, current.rowIdx);
    const c0 = Math.min(anchor.colIdx, current.colIdx), c1 = Math.max(anchor.colIdx, current.colIdx);
    const out = [];
    for (let r = r0; r <= r1; r++) {
      const p = filtered[r];
      if (!p) continue;
      for (let c = c0; c <= c1; c++) {
        const iso = dayHeaders[c]?.iso;
        if (!iso) continue;
        out.push({ pilot: p, iso });
      }
    }
    return out;
  }

  function copySelection() {
    if (!selection) return;
    setClipboardValue(getCellValue(selection.anchor.rowIdx, selection.anchor.colIdx));
  }

  function pasteIntoSelection() {
    if (clipboardValue == null || !selection) return;
    stageMany(collectRangeCells(selection).map((c) => ({ ...c, value: clipboardValue })));
  }

  function clearSelectionValues() {
    if (!selection) return;
    stageMany(collectRangeCells(selection).map((c) => ({ ...c, value: "" })));
  }

  // Ends a mouse drag: a plain range-drag just leaves the rectangle
  // selected (ready for Ctrl+V); a fill-handle drag (dragMode === "fill")
  // stamps the source cell's value into every cell the drag passed over -
  // the "ลากยาว" (drag-to-fill) behavior, same idea as Excel's fill handle.
  function finishDrag() {
    if (dragMode === "fill" && fillSource && selection) {
      stageMany(collectRangeCells(selection).map((c) => ({ ...c, value: fillSource.value })));
    }
    setDragMode(null);
    setFillSource(null);
  }

  useEffect(() => {
    if (!dragMode) return;
    window.addEventListener("mouseup", finishDrag);
    return () => window.removeEventListener("mouseup", finishDrag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragMode, fillSource, selection]);

  // Ctrl/Cmd+C copies the selected cell's value, Ctrl/Cmd+V pastes it
  // across the whole selection, Delete/Backspace clears the selection,
  // Enter/F2 opens the inline editor - all skipped while any real text
  // input has focus (search box, the cell editor itself, Generate
  // Template's fields, ...) so this never hijacks normal typing there.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!selection) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "c") {
        e.preventDefault();
        copySelection();
      } else if ((e.ctrlKey || e.metaKey) && key === "v") {
        if (clipboardValue == null) return;
        e.preventDefault();
        pasteIntoSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        clearSelectionValues();
      } else if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        const p = filtered[selection.anchor.rowIdx];
        const iso = dayHeaders[selection.anchor.colIdx]?.iso;
        if (p && iso) setEditingCell({ pilotCode: p.pilotCode, iso });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, clipboardValue, filtered, dayHeaders, pendingEdits]);

  // Commits every staged edit in one pass: all the non-empty ones go
  // through the same bulk upsert importRosterMany uses everywhere else in
  // this module (Import from Excel, Generate Template), the empty
  // ("cleared") ones go through deleteRosterEntry one at a time since
  // there's no bulk-delete endpoint.
  async function handleSaveAll() {
    if (pendingEdits.size === 0) return;
    setSavingAll(true);
    try {
      const toUpsert = [];
      const toDelete = [];
      for (const edit of pendingEdits.values()) {
        if (edit.value) {
          toUpsert.push({ pilotCode: edit.pilotCode, pilotName: edit.pilotName, base: edit.base, date: edit.iso, code: edit.value });
        } else {
          toDelete.push(edit);
        }
      }
      if (toUpsert.length) await importRosterMany(toUpsert);
      for (const d of toDelete) await deleteRosterEntry({ pilotCode: d.pilotCode, date: d.iso });
      setPendingEdits(new Map());
      await refresh();
    } catch (err) {
      setMsgSafe("Save failed: " + err.message);
    } finally {
      setSavingAll(false);
    }
  }

  function handleDiscardAll() {
    if (pendingEdits.size === 0) return;
    if (window.confirm(`Discard ${pendingEdits.size} unsaved change(s)?`)) {
      setPendingEdits(new Map());
    }
  }

  // No dedicated message banner for cell-save errors (keeping the grid
  // simple) - a bare alert is enough since this is a rare failure path
  // (Electron API missing, IPC error), not part of the normal flow.
  function setMsgSafe(text) {
    if (typeof window !== "undefined" && window.alert) window.alert(text);
  }

  // Daily Captain / Co-pilot headcount - one number per day, counting only
  // pilots whose code that day falls in ON_DUTY_CATEGORIES. "SFO" and "FO"
  // are both Co-pilot ranks (see PilotExperienceBuilder.jsx's POSITIONS), so
  // they're combined into one Co-pilot count. A pilot with no Pilot
  // Experience record yet (so no known position) is counted separately as
  // "Unranked" rather than silently dropped or guessed into either bucket.
  // Uses the staged (pending) value where one exists, so the headcount
  // reacts live to unsaved edits instead of only updating after Save.
  const dailyCrewCounts = useMemo(() => {
    return dayHeaders.map((h) => {
      let captain = 0, coPilot = 0, unranked = 0;
      for (const p of byPilot) {
        const pending = pendingEdits.get(pendingKey(p.pilotCode, h.iso));
        const raw = pending ? pending.value : p.days[h.iso];
        if (!raw) continue;
        const info = getCodeInfo(raw);
        if (!info || !ON_DUTY_CATEGORIES.has(info.category)) continue;
        const position = positionsByCode[normalizeCode(p.pilotCode)];
        if (position === "Captain") captain++;
        else if (position === "SFO" || position === "FO") coPilot++;
        else unranked++;
      }
      return { captain, coPilot, unranked, total: captain + coPilot + unranked, crews: maxCrewPairs(captain, coPilot) };
    });
  }, [dayHeaders, byPilot, positionsByCode, pendingEdits]);

  const hasUnranked = dailyCrewCounts.some((c) => c.unranked > 0);

  // Recomputed whenever the printed table's shape changes (month length,
  // filtered pilot count, whether the Unranked footer row is showing) -
  // see computePrintFontScale above for how this turns into a scale
  // factor. Drives --print-font-scale below, which every print-only font
  // size / padding / column-width rule in PilotRoster.css multiplies by.
  const printFontScale = useMemo(() => {
    const footerRowCount = hasUnranked ? 5 : 4; // captain, copilot, [unranked], total, crews
    const hasBranding = !!(branding?.logo || branding?.name);
    return computePrintFontScale(numDays, filtered.length, footerRowCount, hasBranding);
  }, [numDays, filtered.length, hasUnranked, branding]);

  return (
    <div ref={rosterPageRef} className={`roster-page${fullScreen ? " roster-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Duty Schedule</h1>
          <p>Pilot duty roster imported from Excel</p>
        </div>
        <div className="header-tools">
          <input
            className="roster-search"
            placeholder="Search pilot name/code..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          <button className="primary" onClick={() => setShowImport((v) => !v)}>
            {showImport ? "Hide Import" : "Import from Excel"}
          </button>
          <button onClick={() => { setGeneratePresetCode(null); setShowGenerate((v) => !v); }}>
            {showGenerate ? "Hide Work Pattern" : "Set Work Pattern"}
          </button>
          <button
            onClick={() => setShowPlanTraining((v) => !v)}
            title="Lays every course due in the next year or two onto the roster, on duty days only - simulator 1-3 months ahead, other courses 1-2 months ahead."
          >
            {showPlanTraining ? "Hide Plan Training" : "Plan Training"}
          </button>
          {/* Per-page Refresh removed - the sidebar's single Refresh (full
              page reload) now covers this. refresh() itself stays. */}
          <button onClick={() => window.print()} disabled={!filtered.length}>Print / Save PDF</button>
          <button onClick={toggleFullScreen}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
          {pendingEdits.size > 0 && (
            <button onClick={handleDiscardAll} disabled={savingAll}>Discard ({pendingEdits.size})</button>
          )}
          <button
            className="primary duty-save-btn"
            onClick={handleSaveAll}
            disabled={savingAll || pendingEdits.size === 0}
            title="Edits are staged as you click cells - nothing is written until you hit Save."
          >
            {savingAll ? "Saving..." : pendingEdits.size > 0 ? `SAVE (${pendingEdits.size})` : "SAVE"}
          </button>
        </div>
      </div>
      <p className="roster-note no-print">
        Click a cell to select it, double-click (or Enter) to edit. Drag to select a range, Ctrl+C / Ctrl+V to copy-paste, Delete to clear, or drag the small square at a selected cell's corner to fill a range with its value - like Excel. Nothing is written until you hit SAVE.
      </p>

      {showImport && (
        <div className="no-print">
          <RosterImportPanel
            onCancel={() => setShowImport(false)}
            onImported={() => { setShowImport(false); refresh(); }}
          />
        </div>
      )}

      {showGenerate && (
        <div className="no-print">
          <GenerateTemplatePanel
            // Remounts with fresh state whenever a different pilot's name is
            // clicked (or the header button is used, key -> "_header"), so
            // the panel always opens on the right pilot and its own local
            // state (pattern, dates, preview) never leaks from one pilot to
            // the next.
            key={generatePresetCode || "_header"}
            pilots={byPilot}
            initialPilotCode={generatePresetCode}
            onCancel={() => { setShowGenerate(false); setGeneratePresetCode(null); }}
            onGenerated={() => { setShowGenerate(false); setGeneratePresetCode(null); refresh(); }}
          />
        </div>
      )}

      {showPlanTraining && (
        <div className="no-print">
          <PlanTrainingPanel
            onCancel={() => setShowPlanTraining(false)}
            // Deliberately does NOT close the panel on success: the "could not
            // fit" list is the most important thing on it, and closing would
            // throw that away at the exact moment it became actionable.
            onGenerated={refresh}
            // Courses are written 1-3 months ahead, so they usually land
            // outside the month the grid is showing. Let the panel move the
            // grid to a month it actually wrote on.
            onGoToMonth={setMonthKey}
          />
        </div>
      )}

      <div className="roster-month-nav no-print">
        <button onClick={() => shiftMonth(-1)}>‹ Prev</button>
        <input type="month" value={monthKey} onChange={(e) => handleMonthPick(e.target.value)} />
        <button onClick={() => shiftMonth(1)}>Next ›</button>
      </div>

      <div
        className="duty-print-area"
        style={{ "--print-font-scale": printFontScale }}
      >
        {(branding?.logo || branding?.name) && (
          <div className="duty-print-brand">
            {branding.logo && <img src={branding.logo} alt="" />}
            {branding.name && <span>{branding.name}</span>}
          </div>
        )}
        <div className="duty-print-title">Duty Schedule — {monthLabel}</div>

      <div className="roster-scroll">
        <table className="duty-schedule-table">
          <thead>
            <tr>
              <th className="pilot-col">Pilot</th>
              {dayHeaders.map((h) => (
                <th key={h.day} className={[h.isWeekend ? "weekend" : "", h.isToday ? "today" : ""].filter(Boolean).join(" ")}>
                  <div className="day-num">{h.day}</div>
                  <div className="day-wd">{h.weekday}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={numDays + 1} className="empty">No roster data yet for this month. Use "Import from Excel" to load a schedule.</td></tr>
            )}
            {filtered.map((p, rowIdx) => (
              <tr key={p.pilotCode}>
                <td
                  className="pilot-col pilot-col-clickable"
                  title={`${cleanPilotName(p.pilotName) || ""} — click to set a work pattern (start date + 21/7, 20/10, 5/2, or custom)`}
                  onClick={() => { setGeneratePresetCode(p.pilotCode); setShowGenerate(true); }}
                >
                  {/* Code only - the 3-letter code is what the roster is read
                      by, and dropping the name frees a lot of width for the
                      day columns on a month with 31 of them. The full name is
                      still there on hover (title) and is still searchable.
                      Clicking the cell opens Set Work Pattern preselected to
                      this pilot - the day cells themselves keep their own
                      click/double-click behaviour untouched. */}
                  <div className="pilot-name">{p.pilotCode || "-"}</div>
                </td>
                {dayHeaders.map((h, colIdx) => {
                  const pending = pendingEdits.get(pendingKey(p.pilotCode, h.iso));
                  const raw = pending ? pending.value : p.days[h.iso];
                  const info = raw ? getCodeInfo(raw) : null;
                  const isEditing = editingCell && editingCell.pilotCode === p.pilotCode && editingCell.iso === h.iso;
                  const isDirty = !!pending;
                  const inSel = !!selection &&
                    rowIdx >= Math.min(selection.anchor.rowIdx, selection.current.rowIdx) &&
                    rowIdx <= Math.max(selection.anchor.rowIdx, selection.current.rowIdx) &&
                    colIdx >= Math.min(selection.anchor.colIdx, selection.current.colIdx) &&
                    colIdx <= Math.max(selection.anchor.colIdx, selection.current.colIdx);
                  const isSole = inSel && selection.anchor.rowIdx === selection.current.rowIdx && selection.anchor.colIdx === selection.current.colIdx;
                  const cls = [
                    h.isWeekend ? "weekend" : "",
                    h.isToday ? "today" : "",
                    isDirty ? "dirty" : "",
                    inSel ? (isSole ? "cell-selected" : "cell-in-range") : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <td
                      key={h.day}
                      className={cls}
                      onMouseDown={(e) => {
                        if (isEditing) return;
                        e.preventDefault();
                        setSelection({ anchor: { rowIdx, colIdx }, current: { rowIdx, colIdx } });
                        setDragMode("select");
                      }}
                      onMouseEnter={() => {
                        if (!dragMode) return;
                        setSelection((prev) => (prev ? { ...prev, current: { rowIdx, colIdx } } : { anchor: { rowIdx, colIdx }, current: { rowIdx, colIdx } }));
                      }}
                      onDoubleClick={() => !isEditing && setEditingCell({ pilotCode: p.pilotCode, iso: h.iso })}
                      title={isEditing ? "" : isDirty ? "Unsaved change - click SAVE to commit" : "Click to select, double-click to edit"}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="duty-cell-input"
                          defaultValue={raw || ""}
                          onBlur={(e) => handleCellStage(p, h.iso, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingCell(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : info ? (
                        <span className="duty-code" data-cat={info.category} style={{ background: info.style.bg, color: info.style.fg }} title={info.label}>
                          {info.code}
                        </span>
                      ) : null}
                      {isSole && raw && !isEditing && (
                        <span
                          className="fill-handle"
                          title="Drag to fill this value across a range"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            setFillSource({ rowIdx, colIdx, value: raw });
                            setSelection({ anchor: { rowIdx, colIdx }, current: { rowIdx, colIdx } });
                            setDragMode("fill");
                          }}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="crew-count-row captain">
                <td className="pilot-col">Captain on duty</td>
                {dailyCrewCounts.map((c, i) => (
                  <td key={i} className={[dayHeaders[i].isWeekend ? "weekend" : "", dayHeaders[i].isToday ? "today" : ""].filter(Boolean).join(" ")}>{c.captain || ""}</td>
                ))}
              </tr>
              <tr className="crew-count-row copilot">
                <td className="pilot-col">Co-pilot on duty</td>
                {dailyCrewCounts.map((c, i) => (
                  <td key={i} className={[dayHeaders[i].isWeekend ? "weekend" : "", dayHeaders[i].isToday ? "today" : ""].filter(Boolean).join(" ")}>{c.coPilot || ""}</td>
                ))}
              </tr>
              {hasUnranked && (
                <tr className="crew-count-row unranked">
                  <td className="pilot-col">Unranked *</td>
                  {dailyCrewCounts.map((c, i) => (
                    <td key={i} className={[dayHeaders[i].isWeekend ? "weekend" : "", dayHeaders[i].isToday ? "today" : ""].filter(Boolean).join(" ")}>{c.unranked || ""}</td>
                  ))}
                </tr>
              )}
              <tr className="crew-count-row total">
                <td className="pilot-col">Total on duty</td>
                {dailyCrewCounts.map((c, i) => (
                  <td key={i} className={[dayHeaders[i].isWeekend ? "weekend" : "", dayHeaders[i].isToday ? "today" : ""].filter(Boolean).join(" ")}>{c.total || ""}</td>
                ))}
              </tr>
              <tr className="crew-count-row crews">
                <td className="pilot-col">Crews (max pairs) †</td>
                {dailyCrewCounts.map((c, i) => (
                  <td key={i} className={[dayHeaders[i].isWeekend ? "weekend" : "", dayHeaders[i].isToday ? "today" : ""].filter(Boolean).join(" ")}>{c.crews || ""}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {hasUnranked && (
        <p className="roster-note no-print">* Unranked = pilot code found in the roster but has no Position (Captain/SFO/FO) set on their Pilot Experience Profile tab yet.</p>
      )}
      <p className="roster-note no-print">† Crews = max 2-person flight crews possible that day (Co-pilot + Co-pilot is not allowed; every other pairing is). Unranked pilots aren't counted here since their rank isn't known.</p>
      {pendingEdits.size > 0 && (
        <p className="roster-note no-print">{pendingEdits.size} unsaved change(s) - highlighted in amber. Click SAVE above to commit them.</p>
      )}

      {/* Duty-code legend - one entry per SYMBOL (code, colour, label). Uses
          gridColor, not the Settings-tab identity colour, so this always
          matches what the cells above actually show: green for O, yellow
          for X, pink for everything else, red text for a Compensate Day
          swap. Screen-only, left off Print/Export PDF per request so the
          printed page is just the roster grid without the definitions
          line. */}
      <div className="roster-legend no-print">
        {rosterSymbols.map((s) => (
          <div className="legend-item" key={s.code}>
            <span className="legend-swatch" style={{ background: s.gridColor }} />
            <strong style={s.textColor ? { color: s.textColor } : undefined}>{s.code}</strong>&nbsp;{s.label}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
