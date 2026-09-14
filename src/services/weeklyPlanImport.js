import * as XLSX from "xlsx";
import { WEEKLY_SECTIONS, parsePlanCell } from "../modules/pilotRoster/weeklyPlanSections.js";

// Reads the company's weekly PLANNING workbook ("SKL WeeklySchedulePlan 2026
// (V3).xlsm", sheet "SKL Weekly Plan") into a flat list of
// {date, section, slot, pilotCode, level} cells - the same shape the
// pilot_weekly_plan table stores (sql/weekly-plan-setup.sql).
//
// LAYOUT this is built against (verified against the real file):
//   * One row of weekday names, one row of DATES, one column per day. The
//     sheet runs for years across the columns (the copy checked had 1,870
//     day columns), so the caller normally imports a slice of it.
//   * Down the left, column A carries a label at the FIRST row of each row
//     group: "Crew 1 ", "OPC Training", "Night Standby/Duty Crew",
//     "OFF CREW", "NIGHT TRAINING", ... Each group then occupies a fixed
//     number of rows below that label (its "slots" - see
//     modules/pilotRoster/weeklyPlanSections.js).
//   * A cell is "WJU(3)": pilot code + experience level in brackets.
//
// Row numbers are NOT hard-coded. The labels are located by text, because
// the company's own copies of this sheet have shifted rows between versions
// (the file has 14 sheets including several older cuts). Labels are matched
// loosely - trimmed, case-insensitive, punctuation-insensitive - since they
// carry stray trailing spaces ("Crew 1 ") and inconsistent slashes.

const MIN_YEAR = 2015;
const MAX_YEAR = 2100;

function cellVal(ws, r, c) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : null;
}

// Excel's serial-date float can decode a few hours either side of midnight;
// snapping by 12h before taking the date parts avoids landing on the wrong
// day. Same fix as rosterImport.js / trainingImport.js.
function cleanExcelDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return d;
  const snapped = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.UTC(snapped.getUTCFullYear(), snapped.getUTCMonth(), snapped.getUTCDate()));
}

function toIsoDate(d) {
  const c = cleanExcelDate(d);
  if (!(c instanceof Date) || isNaN(c.getTime())) return null;
  return `${c.getUTCFullYear()}-${String(c.getUTCMonth() + 1).padStart(2, "0")}-${String(c.getUTCDate()).padStart(2, "0")}`;
}

function normalizeLabel(v) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The date row is whichever of the first ~10 rows holds the most real dates.
function findDateRow(ws, range) {
  let best = { r: -1, count: 0 };
  const scanTo = Math.min(range.s.r + 10, range.e.r);
  for (let r = range.s.r; r <= scanTo; r++) {
    let count = 0;
    for (let c = range.s.c + 1; c <= range.e.c; c++) {
      const v = cellVal(ws, r, c);
      if (v instanceof Date && v.getFullYear() >= MIN_YEAR && v.getFullYear() <= MAX_YEAR) count++;
    }
    if (count > best.count) best = { r, count };
  }
  return best.count > 0 ? best.r : -1;
}

// Maps each section to the row range it occupies, by finding its label in
// column A and taking `slots` rows from there.
function findSectionRows(ws, range, dateRow) {
  const labelRows = new Map();
  const labelCol = range.s.c;
  for (let r = dateRow; r <= range.e.r; r++) {
    const key = normalizeLabel(cellVal(ws, r, labelCol));
    if (key && !labelRows.has(key)) labelRows.set(key, r);
  }

  const found = [];
  const missing = [];
  for (const section of WEEKLY_SECTIONS) {
    const row = labelRows.get(normalizeLabel(section.excelLabel));
    if (row == null) { missing.push(section.label); continue; }
    found.push({ section, firstRow: row });
  }

  // Clamp each group so it can never read into the NEXT labelled group.
  // Without this, a section whose slot count is set higher than its real
  // block in the sheet silently absorbs the rows below it - e.g. OFF CREW
  // reaching down into NIGHT TRAINING and importing trainees as "off".
  // A group's own second line is sometimes a caption rather than a blank -
  // "Night Standby/Duty Crew" is followed by "17:30-05:00/ 19:30-05:30",
  // which is the DUTY WINDOW for that same group, not the start of a new
  // one. Those rows are declared as `excelSublabels` in weeklyPlanSections.js
  // (every wording the sheet has used) and are skipped here, otherwise the night crews
  // would be clamped to a single pilot each and every Co-pilot on night
  // standby would be dropped on import.
  const labelRowsSorted = [...labelRows.entries()]
    .map(([key, row]) => ({ key, row }))
    .sort((a, b) => a.row - b.row);
  for (const entry of found) {
    const ownSubs = new Set(
      [...(entry.section.excelSublabels || []), entry.section.sublabel]
        .filter(Boolean)
        .map(normalizeLabel)
    );
    const next = labelRowsSorted.find((l) => l.row > entry.firstRow && !ownSubs.has(l.key));
    const available = next == null ? entry.section.slots : next.row - entry.firstRow;
    entry.rowCount = Math.max(0, Math.min(entry.section.slots, available));
  }

  return { found, missing };
}

export function listWeeklyPlanSheetNames(workbook) {
  return workbook.SheetNames || [];
}

// The sheet we want is normally called "SKL Weekly Plan" (note the trailing
// space in the real file). Anything with "weekly" and "plan" in the name is
// a candidate; "SKL" wins if present.
export function guessWeeklyPlanSheet(names) {
  const weekly = (names || []).filter((n) => /weekly/i.test(n) && /plan/i.test(n));
  if (!weekly.length) return (names || [])[0];
  return weekly.find((n) => /skl/i.test(n)) || weekly[0];
}

export function parseWeeklyPlanWorkbook(workbook, sheetName, options = {}) {
  const name = sheetName && workbook.Sheets[sheetName] ? sheetName : guessWeeklyPlanSheet(workbook.SheetNames);
  const ws = workbook.Sheets[name];
  if (!ws || !ws["!ref"]) throw new Error(`Sheet "${name}" not found or is empty.`);
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const dateRow = findDateRow(ws, range);
  if (dateRow < 0) throw new Error(`Couldn't find a row of dates in sheet "${name}" - is this a weekly plan sheet?`);

  const dateCols = [];
  for (let c = range.s.c + 1; c <= range.e.c; c++) {
    const v = cellVal(ws, dateRow, c);
    if (v instanceof Date) {
      const iso = toIsoDate(v);
      // The caller can limit the import to one period; the sheet itself
      // spans years, and importing all of it would be both slow and mostly
      // historical noise.
      if (iso && (!options.from || iso >= options.from) && (!options.to || iso <= options.to)) {
        dateCols.push({ c, date: iso });
      }
    }
  }
  if (!dateCols.length) {
    throw new Error(options.from
      ? `No dates between ${options.from} and ${options.to} were found in sheet "${name}".`
      : `No date columns found in sheet "${name}".`);
  }

  const { found, missing } = findSectionRows(ws, range, dateRow);
  if (!found.length) {
    throw new Error(`Sheet "${name}" doesn't have any of the expected row labels (Crew 1, OFF CREW, ...) in its first column.`);
  }

  const cells = [];
  const unrecognized = new Set();
  const codes = new Set();

  for (const { section, firstRow, rowCount } of found) {
    for (let slot = 0; slot < rowCount; slot++) {
      const r = firstRow + slot;
      if (r > range.e.r) break;
      for (const dc of dateCols) {
        const parsed = parsePlanCell(cellVal(ws, r, dc.c));
        if (!parsed) continue;
        if (parsed.unrecognized) { unrecognized.add(parsed.code); continue; }
        codes.add(parsed.code);
        cells.push({ date: dc.date, section: section.key, slot, pilotCode: parsed.code, level: parsed.level });
      }
    }
  }

  if (!cells.length) {
    throw new Error(`No assignments found in sheet "${name}" for the selected dates.`);
  }

  const sortedDates = dateCols.map((d) => d.date).sort();
  return {
    sheetName: name,
    cells,
    sections: found.map((f) => f.section.label),
    missingSections: missing,
    pilotCodes: [...codes].sort(),
    unrecognized: [...unrecognized].sort(),
    dateRange: { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] }
  };
}

export async function readWeeklyPlanWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  // .xlsm is a normal zipped xlsx with macros; SheetJS reads it the same way
  // and the macros are simply ignored.
  return XLSX.read(buf, { type: "array", cellDates: true });
}
