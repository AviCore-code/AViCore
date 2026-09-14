import * as XLSX from "xlsx";

// Reads the company's pilot duty ROSTER workbook (e.g. "NEW Pilot Schedule
// 2026 (Include RR9).xlsx", sheet "RR 2026") and turns one sheet into a flat
// list of {pilotCode, pilotName, base, date, code} entries - one per pilot
// per calendar day. The workbook has ~90+ sheets (years of drafts/versions),
// so the caller picks which sheet to import (see RosterImportPanel.jsx);
// this module only knows how to parse whichever single sheet it's given.
//
// Layout this is built against (verified against the real file):
//   Row with per-day dates (auto-detected, not assumed to be a fixed row
//     number - the company's templates have moved it before) - date cells
//     read as JS Date via XLSX.read(..., {cellDates:true}).
//   The 4 columns immediately left of the first date column are, in order:
//     BASE (only filled on each base-group's first row) / NO. / NAME / CODE.
//   Every row below the date row where "NO." is a number is a pilot row;
//     everything else (legend/notes block further down the same sheet,
//     "Captain"/"Copilot"/"CREW PER DAY" summary rows) is skipped - it never
//     has a numeric "NO.", so no separate "where does the legend start"
//     heuristic is needed.
const MIN_YEAR = 2015;
const MAX_YEAR = 2100;

function cellVal(ws, r, c) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = ws[ref];
  return cell ? cell.v : null;
}

// Same epsilon fix as src/services/trainingImport.js's cleanExcelDate -
// Excel's serial-date float can decode a few hours to either side of true
// midnight, which (left uncorrected) can round a date to the wrong day.
function cleanExcelDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return d;
  const snapped = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.UTC(snapped.getUTCFullYear(), snapped.getUTCMonth(), snapped.getUTCDate()));
}

function toIsoDate(d) {
  const c = cleanExcelDate(d);
  if (!(c instanceof Date) || isNaN(c.getTime())) return null;
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, "0");
  const day = String(c.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Scans the first several rows for the one with the most Date-typed cells -
// that's the per-day date header row, wherever the template puts it.
function findDateRow(ws, range) {
  let best = { r: -1, count: 0 };
  const scanRows = Math.min(range.s.r + 10, range.e.r);
  for (let r = range.s.r; r <= scanRows; r++) {
    let count = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellVal(ws, r, c);
      if (v instanceof Date && v.getFullYear() >= MIN_YEAR && v.getFullYear() <= MAX_YEAR) count++;
    }
    if (count > best.count) best = { r, count };
  }
  return best.count > 0 ? best.r : -1;
}

export function listRosterSheetNames(workbook) {
  return workbook.SheetNames || [];
}

export function parseRosterWorkbook(workbook, sheetName) {
  const name = sheetName && workbook.Sheets[sheetName] ? sheetName : workbook.SheetNames[0];
  const ws = workbook.Sheets[name];
  if (!ws || !ws["!ref"]) throw new Error(`Sheet "${name}" not found or is empty.`);
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const dateRow = findDateRow(ws, range);
  if (dateRow < 0) throw new Error(`Couldn't find a row of dates in sheet "${name}" - is this a roster sheet?`);

  const dateCols = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const v = cellVal(ws, dateRow, c);
    if (v instanceof Date) {
      const iso = toIsoDate(v);
      if (iso) dateCols.push({ c, date: iso });
    }
  }
  if (!dateCols.length) throw new Error(`No date columns found in sheet "${name}".`);

  const firstDateCol = dateCols[0].c;
  const baseCol = firstDateCol - 4;
  const noCol = firstDateCol - 3;
  const nameCol = firstDateCol - 2;
  const codeCol = firstDateCol - 1;

  const entries = [];
  const pilotsByCode = new Map();
  let currentBase = "";

  for (let r = dateRow + 1; r <= range.e.r; r++) {
    if (baseCol >= 0) {
      const baseCell = cellVal(ws, r, baseCol);
      if (baseCell != null && String(baseCell).trim()) currentBase = String(baseCell).trim();
    }

    const no = noCol >= 0 ? cellVal(ws, r, noCol) : null;
    if (typeof no !== "number") continue; // legend/notes/summary rows - never numeric here

    const pilotName = String(cellVal(ws, r, nameCol) || "").trim();
    const pilotCode = String(cellVal(ws, r, codeCol) || "").trim().toUpperCase();
    if (!pilotCode) continue;

    if (!pilotsByCode.has(pilotCode)) pilotsByCode.set(pilotCode, { pilotCode, pilotName, base: currentBase });

    for (const dc of dateCols) {
      const raw = cellVal(ws, r, dc.c);
      if (raw == null) continue;
      const text = String(raw).trim();
      if (!text) continue;
      entries.push({ pilotCode, pilotName, base: currentBase, date: dc.date, code: text.toUpperCase() });
    }
  }

  if (!entries.length) {
    throw new Error(`No roster entries found in sheet "${name}" - check that its layout matches the expected template (BASE/NO./NAME/CODE columns followed by one column per day).`);
  }

  const sortedDates = dateCols.map((d) => d.date).sort();
  return {
    sheetName: name,
    pilots: [...pilotsByCode.values()],
    entries,
    dateRange: { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] }
  };
}

export async function readRosterWorkbookFile(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(buf, { type: "array", cellDates: true });
}

export async function parseRosterExcelFile(file, sheetName) {
  const workbook = await readRosterWorkbookFile(file);
  return parseRosterWorkbook(workbook, sheetName);
}
