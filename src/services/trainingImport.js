import * as XLSX from "xlsx";
import { TRAINING_ITEMS, SETTINGS_HIDDEN_TRAINING_ITEMS } from "../utils/trainingDue.js";

// I.APP (180D) is auto-rolled from Daily Duty, not the Excel workbook - skip
// storing its cell value on import (still walk past its column via the loop
// index `i` below, so every column after it stays correctly aligned).
const IMPORT_SKIPPED_ITEMS = new Set(SETTINGS_HIDDEN_TRAINING_ITEMS);

// Reads the company's "Training Track(V.3).xlsm" workbook (or any workbook
// with the same two sheets) and turns it into training records this app can
// store. Two sheets are joined by the pilot's 3-letter CODE - the same code
// already used everywhere else in AviCore (Pilot Experience, Daily Duty):
//   "INPUT DATA" rows 3+, cols A-D  -> No / Name / License No / CODE
//   "Pilot Training DUE Monitor" rows 2+, col A = CODE, cols B..AF = the
//     due-date/count items in exactly the order TRAINING_ITEMS is defined in
//     (verified against the real workbook: B=Passport ... AF=Flight Recency
//     90D). The workbook's LAST column, Flight Recency (90D), is no longer a
//     training item here and is simply not read - everything before it still
//     lines up column-for-column.
// The "Caution" row directly under the pilot rows in "Pilot Training DUE
// Monitor" (label cell reads "Caution") is also extracted, in case the
// person doing the import wants to review/apply it as the company's default
// warning windows.
const DUE_MONITOR_FIRST_DATA_COL = 1; // column B (0-based)

function cellVal(ws, r, c) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = ws[ref];
  return cell ? cell.v : null;
}

function normCode(v) {
  return String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Excel's serial-date float can carry a tiny epsilon, so a date meant to be
// exactly midnight sometimes decodes a few seconds/hours to either side of
// it - verified against this exact workbook (a passport date meant to be
// 2036-07-01 came back as 2036-06-30T16:59:56Z). Left uncorrected, that can
// round a due date to the wrong calendar day. Snapping to the nearest whole
// day (add 12h, then truncate the time) fixes it regardless of which side
// the epsilon lands on.
function cleanExcelDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return d;
  const snapped = new Date(d.getTime() + 12 * 60 * 60 * 1000);
  return new Date(Date.UTC(snapped.getUTCFullYear(), snapped.getUTCMonth(), snapped.getUTCDate()));
}

// A date cell read with cellDates:true comes back as a JS Date already; a
// text cell (e.g. "For life") comes back as a string - both are valid
// values for classifyTrainingValue in trainingDue.js, so this just passes
// through (dates get the epsilon fix above), only guarding against stray
// whitespace-only text.
function normValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return cleanExcelDate(v);
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  return v;
}

function readInputDataPilots(workbook) {
  const ws = workbook.Sheets["INPUT DATA"];
  if (!ws || !ws["!ref"]) throw new Error('Sheet "INPUT DATA" not found in this file.');
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const byCode = {};
  for (let r = 2; r <= range.e.r; r++) {
    const name = cellVal(ws, r, 1);
    const licence = cellVal(ws, r, 2);
    const code = normCode(cellVal(ws, r, 3));
    if (!code) continue; // row 26+ is legend/notes text, not a pilot row
    if (!name && !licence) continue;
    byCode[code] = { code, name: String(name || "").trim(), licence: String(licence || "").trim() };
  }
  return byCode;
}

function readDueMonitor(workbook) {
  const ws = workbook.Sheets["Pilot Training DUE Monitor"];
  if (!ws || !ws["!ref"]) throw new Error('Sheet "Pilot Training DUE Monitor" not found in this file.');
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const rows = [];
  let thresholds = null;

  for (let r = 1; r <= range.e.r; r++) {
    const codeCell = cellVal(ws, r, 0);
    const label = String(codeCell || "").trim();

    if (/^caution$/i.test(label)) {
      thresholds = {};
      TRAINING_ITEMS.forEach((item, i) => {
        if (IMPORT_SKIPPED_ITEMS.has(item.key)) return;
        const raw = cellVal(ws, r, DUE_MONITOR_FIRST_DATA_COL + i);
        const days = parseCautionCell(raw);
        if (days != null) thresholds[item.key] = days;
      });
      continue;
    }

    const code = normCode(codeCell);
    // CODE is always exactly 3 letters in this workbook - guards against
    // stray numeric/legend cells below the pilot rows (e.g. a lone "19").
    if (!/^[A-Z]{3}$/.test(code)) continue;

    const record = {};
    TRAINING_ITEMS.forEach((item, i) => {
      if (IMPORT_SKIPPED_ITEMS.has(item.key)) return;
      record[item.key] = normValue(cellVal(ws, r, DUE_MONITOR_FIRST_DATA_COL + i));
    });
    rows.push({ code, record });
  }

  return { rows, thresholds };
}

// "200 Days" / "90Days" / "60 Days" -> 90 ; "1M" -> 30 (approx.) ; "No. < 5"
// -> 5 (the iApp180 item's minimum count, not a day window). Returns null
// for anything unrecognized rather than guessing.
function parseCautionCell(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const noLess = text.match(/no\.?\s*<\s*(\d+)/i);
  if (noLess) return Number(noLess[1]);
  const months = text.match(/^(\d+)\s*M$/i);
  if (months) return Number(months[1]) * 30;
  const days = text.match(/(\d+)\s*Days?/i);
  if (days) return Number(days[1]);
  return null;
}

// Returns { pilots: [{ code, name, licence, record }], thresholds }.
// pilots only includes codes present in BOTH sheets (a code in "Pilot
// Training DUE Monitor" with no matching "INPUT DATA" row, or vice versa,
// is silently skipped rather than imported with missing/guessed fields).
export function parseTrainingWorkbook(workbook) {
  const people = readInputDataPilots(workbook);
  const { rows, thresholds } = readDueMonitor(workbook);

  const pilots = rows
    .filter((r) => people[r.code])
    .map((r) => ({ ...people[r.code], record: r.record }));

  if (!pilots.length) {
    throw new Error('No matching pilots found - check that both "INPUT DATA" and "Pilot Training DUE Monitor" sheets exist and share the same 3-letter CODE values.');
  }

  return { pilots, thresholds };
}

export async function parseTrainingExcelFile(file) {
  const buf = await file.arrayBuffer();
  const workbook = XLSX.read(buf, { type: "array", cellDates: true });
  return parseTrainingWorkbook(workbook);
}
