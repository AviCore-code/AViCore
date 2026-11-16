// Auto Import - the shared core (Capt. Weera, 16 Nov 2026).
//
// The office PC keeps the FDT, roster and training Excel files. A small sync
// job on that PC (scripts/pc-sync) copies changed files to the VPS, and the
// AviCore Auto Import service on the VPS (scripts/vps-autoimport) imports them
// to the server 24 hours a day. The settings - where the files are on the PC,
// the roster sheet, when to import - live on the server (Admin_app_settings),
// so every admin who signs in sees and edits the same values on the Auto
// Import page; the VPS writes its status and log back there.
//
// The imports are the same parsers and the same save calls as the manual
// Import screens:
//   FDT       - "All": the pilot's Daily Duty is replaced by the whole file
//   Roster    - from today to the end of the sheet (past days left alone)
//   Training  - Pilot Training Due workbook, and Staff Training workbooks

import { parseAllFdtFiles } from "./fdtImport.js";
import { readRosterWorkbookFile, parseRosterWorkbook, listRosterSheetNames, guessRosterSheet } from "./rosterImport.js";
import { parseTrainingExcelFile } from "./trainingImport.js";
import { parseStaffTrainingExcelFile } from "../modules/staffTraining/excelImport.js";
import { staffTrainingRepository } from "../modules/staffTraining/repository.js";
import { replaceDutyEntriesFromFile, replaceRosterRange, importTrainingMany, getSetting, saveSetting } from "./desktopDatabase.js";

export const CONFIG_KEY = "auto_import_config";      // written by admins (web)
export const STATUS_KEY = "auto_import_status";      // written by the VPS service
export const REQUEST_KEY = "auto_import_request";    // "Run now" from the web

export const SOURCES = [
  { key: "fdt", label: "FDT files (folder)", hint: "C:\\FDT  PILOT", many: true },
  { key: "roster", label: "Roster file", hint: "C:\\UOA Flight Planner\\NEW Pilot Schedule 2026.xlsx" },
  { key: "training", label: "Pilot Training Due file", hint: "C:\\...\\Training Tracker.xlsx" },
  { key: "staff", label: "Staff Training files (one per line)", hint: "C:\\...\\FOO.xlsx", many: true }
];

export const DEFAULT_CONFIG = {
  enabled: false,
  checkMinutes: 15,
  times: ["06:00", "18:00"],
  rosterSheet: "",
  paths: { fdt: "", roster: "", training: "", staff: [] }
};

export function withConfigDefaults(saved) {
  const s = saved && typeof saved === "object" ? saved : {};
  return {
    ...DEFAULT_CONFIG,
    ...s,
    times: Array.isArray(s.times) ? s.times : DEFAULT_CONFIG.times,
    paths: { ...DEFAULT_CONFIG.paths, ...(s.paths || {}), staff: Array.isArray(s.paths?.staff) ? s.paths.staff : [] }
  };
}

export const isFdtFileName = (name) => /_FDT\.xlsx?$/i.test(String(name || "")) && !String(name).startsWith("~$");

const pad = (n) => String(n).padStart(2, "0");

// Bangkok date and time, whatever the server's own time zone.
export function bangkokNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// The set times that are due now and have not run today: "HH:MM" <= now.
export function dueSlots(times, now, ranSlots = {}) {
  return (times || []).filter((s) => /^\d{2}:\d{2}$/.test(s) && s <= now.time && ranSlots[s] !== now.date);
}

// Roster: from today (or the sheet's first day, if later) to the sheet's end.
export function rosterRangeFromToday(dateRange, todayIso) {
  if (!dateRange?.from || !dateRange?.to) return null;
  const from = dateRange.from > todayIso ? dateRange.from : todayIso;
  return from <= dateRange.to ? { from, to: dateRange.to } : null;
}

export const normaliseTimes = (text) => {
  const out = String(text || "").split(/[\s,]+/).filter(Boolean).map((t) => {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(t);
    return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : null;
  });
  return out.some((t) => !t) ? null : [...new Set(out)].sort();
};

// ---- the imports. `files` are File-like: { name, lastModified, arrayBuffer() }.

export async function importFdtFiles(files) {
  const logs = [];
  const done = [];
  for (const r of await parseAllFdtFiles(files)) {
    if (r.error) { logs.push({ source: "FDT", file: r.filename, ok: false, text: r.error }); continue; }
    try {
      const res = await replaceDutyEntriesFromFile(r.code, r.entries, null);
      logs.push({ source: "FDT", file: r.filename, ok: true, text: `${r.code}: ${r.entries.length} entries written, ${res?.removed ?? 0} old removed (All)` });
      done.push(r.filename);
    } catch (err) {
      logs.push({ source: "FDT", file: r.filename, ok: false, text: err.message || String(err) });
    }
  }
  return { logs, done };
}

export async function importRosterFile(file, wantedSheet, todayIso) {
  const wb = await readRosterWorkbookFile(file);
  const names = listRosterSheetNames(wb);
  const wanted = String(wantedSheet || "").trim();
  if (wanted && !names.includes(wanted)) throw new Error(`Sheet "${wanted}" not found in ${file.name}`);
  const sheet = wanted || guessRosterSheet(names);
  const parsed = parseRosterWorkbook(wb, sheet);
  const range = rosterRangeFromToday(parsed.dateRange, todayIso);
  if (!range) return `Sheet "${sheet}" has no days from today on - nothing to import`;
  const selected = parsed.entries.filter((e) => e.date >= range.from && e.date <= range.to);
  const res = await replaceRosterRange(selected, range);
  if (res?.queued) throw new Error("The server could not be reached - not saved");
  const filled = selected.filter((e) => !e.clearExisting).length;
  return `Sheet "${sheet}": ${range.from} → ${range.to} replaced, ${res?.removed ?? 0} old cell(s) removed, ${filled} written (${parsed.pilots.length} pilots)`;
}

export async function importTrainingFile(file) {
  const parsed = await parseTrainingExcelFile(file);
  await importTrainingMany(parsed.pilots.map((p) => ({ code: p.code, name: p.name, record: p.record })));
  if (parsed.thresholds) {
    const current = (await getSetting("training_thresholds")) || {};
    await saveSetting("training_thresholds", { ...current, ...parsed.thresholds });
  }
  return `${parsed.pilots.length} pilot(s) imported`;
}

export async function importStaffFile(file) {
  const parsed = await parseStaffTrainingExcelFile(file);
  const res = await staffTrainingRepository.importData(parsed);
  return `${res.addedPeople} personnel, ${res.addedRecords} records (${parsed.recognised.join(", ")})`;
}
