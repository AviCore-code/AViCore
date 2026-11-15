import { kvGet, kvSet } from "./store.js";
import { parseAllFdtFiles } from "../../services/fdtImport.js";
import { readRosterWorkbookFile, parseRosterWorkbook, listRosterSheetNames, guessRosterSheet } from "../../services/rosterImport.js";
import { parseTrainingExcelFile } from "../../services/trainingImport.js";
import { parseStaffTrainingExcelFile } from "../staffTraining/excelImport.js";
import { staffTrainingRepository } from "../staffTraining/repository.js";
import { getImporterSession, withImporterClient } from "../../services/webDatabase.js";
import { replaceDutyEntriesFromFile, replaceRosterRange, importTrainingMany, getSetting, saveSetting } from "../../services/desktopDatabase.js";

// Auto Import (Capt. Weera): the admin PC keeps the FDT, roster and training
// Excel files in its own folders. The admin points this page at them once;
// while AviCore Admin is open in Chrome / Edge on that PC it imports them to
// the server:
//   - when a file changes (checked every few minutes, by its modified time)
//   - at the set times of day (every file, changed or not)
// Same parsers and the same save calls as the manual Import screens:
//   FDT       - "All": the pilot's Daily Duty is replaced by the whole file
//   Roster    - from today to the end of the sheet (past days left alone)
//   Training  - Pilot Training Due workbook, and Staff Training workbooks

export const SOURCES = [
  { key: "fdt", label: "FDT files (folder)", kind: "dir" },
  { key: "roster", label: "Roster file", kind: "file" },
  { key: "training", label: "Pilot Training Due file", kind: "file" },
  { key: "staff", label: "Staff Training files", kind: "files" }
];

export const DEFAULT_CONFIG = { enabled: false, checkMinutes: 15, times: ["06:00", "18:00"], rosterSheet: "" };
const LOG_MAX = 300;

export const isSupported = () =>
  typeof window !== "undefined" && typeof window.showDirectoryPicker === "function" && typeof window.showOpenFilePicker === "function";

export const isFdtFileName = (name) => /_FDT\.xlsx?$/i.test(String(name || "")) && !String(name).startsWith("~$");

const pad = (n) => String(n).padStart(2, "0");
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The set times that are due now and have not run today: "HH:MM" <= now.
export function dueSlots(times, now, ranSlots = {}) {
  const today = localIso(now);
  const t = hhmm(now);
  return (times || []).filter((s) => /^\d{2}:\d{2}$/.test(s) && s <= t && ranSlots[s] !== today);
}

// Roster: from today (or the sheet's first day, if later) to the sheet's end.
export function rosterRangeFromToday(dateRange, todayIso) {
  if (!dateRange?.from || !dateRange?.to) return null;
  const from = dateRange.from > todayIso ? dateRange.from : todayIso;
  return from <= dateRange.to ? { from, to: dateRange.to } : null;
}

// ---------------------------------------------------------------- state

const listeners = new Set();
let state = { running: false, lastCheck: null, config: DEFAULT_CONFIG, log: [], handles: {}, access: {}, account: null };

// Auto Import signs in on its own (webDatabase importerSignIn), so it keeps
// working after the admin signs the page out.
export async function refreshAccount() {
  let account = null;
  try { const s = await getImporterSession(); account = s?.user?.email || null; } catch { /* offline */ }
  emit({ account });
  return account;
}

export function subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
function emit(patch) { state = { ...state, ...patch }; listeners.forEach((fn) => fn(state)); }
export const getState = () => state;

async function addLog(entries) {
  const list = Array.isArray(entries) ? entries : [entries];
  const at = new Date().toISOString();
  const log = [...list.map((e) => ({ at, ...e })), ...state.log].slice(0, LOG_MAX);
  emit({ log });
  try { await kvSet("log", log); } catch { /* keep in memory */ }
}

export async function clearLog() { emit({ log: [] }); try { await kvSet("log", []); } catch { /* ignore */ } }

export async function loadState() {
  const [config, log, ...handles] = await Promise.all([
    kvGet("config"), kvGet("log"), ...SOURCES.map((s) => kvGet(`handle:${s.key}`))
  ]);
  const h = {};
  SOURCES.forEach((s, i) => { if (handles[i]) h[s.key] = handles[i]; });
  emit({ config: { ...DEFAULT_CONFIG, ...(config || {}) }, log: log || [], handles: h });
  await Promise.all([refreshAccess(), refreshAccount()]);
  return state;
}

export async function saveConfig(patch) {
  const config = { ...state.config, ...patch };
  emit({ config });
  await kvSet("config", config);
}

export async function setHandle(key, handle) {
  await kvSet(`handle:${key}`, handle || null);
  emit({ handles: { ...state.handles, [key]: handle || undefined } });
  await refreshAccess();
}

const asList = (h) => (Array.isArray(h) ? h : h ? [h] : []);

async function permission(handle, ask) {
  if (!handle?.queryPermission) return "granted";
  let p = await handle.queryPermission({ mode: "read" });
  if (p !== "granted" && ask) p = await handle.requestPermission({ mode: "read" });
  return p;
}

// "granted" / "prompt" / "denied" / "none" per source. Chrome may drop the
// grant when the browser restarts; a click on "Allow access" (a user gesture)
// asks again.
export async function refreshAccess(ask = false) {
  const access = {};
  for (const s of SOURCES) {
    const list = asList(state.handles[s.key]);
    if (!list.length) { access[s.key] = "none"; continue; }
    let worst = "granted";
    for (const h of list) {
      try {
        const p = await permission(h, ask);
        if (p !== "granted") worst = p;
      } catch { worst = "denied"; }
    }
    access[s.key] = worst;
  }
  emit({ access });
  return access;
}

// ---------------------------------------------------------------- import

async function filesFor(key) {
  const handle = state.handles[key];
  if (!handle) return [];
  if (key === "fdt") {
    const out = [];
    for await (const entry of handle.values()) {
      if (entry.kind === "file" && isFdtFileName(entry.name)) out.push(await entry.getFile());
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const out = [];
  for (const h of asList(handle)) out.push(await h.getFile());
  return out;
}

async function pickChanged(key, files, force) {
  const seen = (await kvGet(`seen:${key}`)) || {};
  return { seen, files: force ? files : files.filter((f) => seen[f.name] !== f.lastModified) };
}

async function markSeen(key, seen, files) {
  const next = { ...seen };
  for (const f of files) next[f.name] = f.lastModified;
  await kvSet(`seen:${key}`, next);
}

async function importFdt(files) {
  const logs = [];
  const parsed = await parseAllFdtFiles(files);
  const done = [];
  for (const r of parsed) {
    if (r.error) { logs.push({ source: "FDT", file: r.filename, ok: false, text: r.error }); continue; }
    try {
      const res = await replaceDutyEntriesFromFile(r.code, r.entries, null);
      logs.push({ source: "FDT", file: r.filename, ok: true, text: `${r.code}: ${r.entries.length} entries written, ${res?.removed ?? 0} old removed (All)` });
      done.push(files.find((f) => f.name === r.filename));
    } catch (err) {
      logs.push({ source: "FDT", file: r.filename, ok: false, text: err.message || String(err) });
    }
  }
  return { logs, done: done.filter(Boolean) };
}

async function importRoster(file) {
  const wb = await readRosterWorkbookFile(file);
  const names = listRosterSheetNames(wb);
  const wanted = state.config.rosterSheet;
  const sheet = wanted && names.includes(wanted) ? wanted : guessRosterSheet(names);
  if (wanted && sheet !== wanted) throw new Error(`Sheet "${wanted}" not found - used "${sheet}"`);
  const parsed = parseRosterWorkbook(wb, sheet);
  const range = rosterRangeFromToday(parsed.dateRange, localIso(new Date()));
  if (!range) return `Sheet "${sheet}" has no days from today on - nothing to import`;
  const selected = parsed.entries.filter((e) => e.date >= range.from && e.date <= range.to);
  const res = await replaceRosterRange(selected, range);
  const filled = selected.filter((e) => !e.clearExisting).length;
  return `Sheet "${sheet}": ${range.from} → ${range.to} replaced, ${res?.removed ?? 0} old cell(s) removed, ${filled} written (${parsed.pilots.length} pilots)`;
}

async function importTraining(file) {
  const parsed = await parseTrainingExcelFile(file);
  await importTrainingMany(parsed.pilots.map((p) => ({ code: p.code, name: p.name, record: p.record })));
  if (parsed.thresholds) {
    const current = (await getSetting("training_thresholds")) || {};
    await saveSetting("training_thresholds", { ...current, ...parsed.thresholds });
  }
  return `${parsed.pilots.length} pilot(s) imported`;
}

async function importStaff(file) {
  const parsed = await parseStaffTrainingExcelFile(file);
  const res = await staffTrainingRepository.importData(parsed);
  return `${res.addedPeople} personnel, ${res.addedRecords} records (${parsed.recognised.join(", ")})`;
}

async function runSource(key, force) {
  const label = SOURCES.find((s) => s.key === key).label;
  if (!state.handles[key]) return [];
  if (state.access[key] !== "granted") {
    return [{ source: label, ok: false, text: "No access to the folder / file - open Auto Import and press Allow access" }];
  }
  let files;
  try { files = await filesFor(key); } catch (err) {
    return [{ source: label, ok: false, text: `Could not read: ${err.message || err}` }];
  }
  if (!files.length) return key === "fdt" ? [{ source: label, ok: false, text: "No *_FDT.xlsx files in the folder" }] : [];
  const { seen, files: todo } = await pickChanged(key, files, force);
  if (!todo.length) return [];
  if (key === "fdt") {
    const { logs, done } = await importFdt(todo);
    await markSeen(key, seen, done);
    return logs;
  }
  const logs = [];
  const done = [];
  for (const f of todo) {
    try {
      const text = key === "roster" ? await importRoster(f) : key === "training" ? await importTraining(f) : await importStaff(f);
      logs.push({ source: label, file: f.name, ok: true, text });
      done.push(f);
    } catch (err) {
      logs.push({ source: label, file: f.name, ok: false, text: err.message || String(err) });
    }
  }
  await markSeen(key, seen, done);
  return logs;
}

// One run over every source. force = import every file (a set time or "Run
// now"); otherwise only files whose modified time changed. A Web Lock keeps
// two open Admin tabs from importing the same files at once.
export async function runAll({ force = false, reason = "check" } = {}) {
  if (state.running) return;
  const work = async () => {
    emit({ running: true });
    try {
      await refreshAccess();
      if (!(await refreshAccount())) {
        await addLog({ source: "Auto Import", ok: false, reason, text: "Not signed in - sign in under Auto Import account" });
        return;
      }
      const logs = [];
      await withImporterClient(async () => {
        for (const s of SOURCES) logs.push(...(await runSource(s.key, force)));
      });
      const now = new Date().toISOString();
      emit({ lastCheck: now });
      try { await kvSet("lastCheck", now); } catch { /* ignore */ }
      if (logs.length) await addLog(logs.map((l) => ({ ...l, reason })));
      else if (force) await addLog({ source: "Auto Import", ok: true, reason, text: "Nothing to import" });
    } finally {
      emit({ running: false });
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    await navigator.locks.request("avicore-autoimport", { ifAvailable: true }, async (lock) => { if (lock) await work(); });
  } else {
    await work();
  }
}

// ---------------------------------------------------------------- scheduler

let timer = null;

async function tick() {
  const cfg = state.config;
  if (!cfg.enabled || state.running) return;
  const now = new Date();
  const ran = (await kvGet("ranSlots")) || {};
  const due = dueSlots(cfg.times, now, ran);
  if (due.length) {
    const today = localIso(now);
    const next = { ...ran };
    due.forEach((s) => { next[s] = today; });
    await kvSet("ranSlots", next);
    await runAll({ force: true, reason: `time ${due.join(", ")}` });
    return;
  }
  const last = (await kvGet("lastCheck")) || null;
  const every = Math.max(1, Number(cfg.checkMinutes) || DEFAULT_CONFIG.checkMinutes) * 60000;
  if (!last || now - new Date(last) >= every) await runAll({ force: false, reason: "file changed" });
}

// Started once after the admin signs in; runs while AviCore Admin is open.
export async function startScheduler() {
  if (timer || !isSupported()) return;
  try { await loadState(); } catch { return; }
  // A set time that passed before the page was opened today should not fire
  // a full import the moment the admin opens AviCore - mark it as done.
  try {
    const ran = (await kvGet("ranSlots")) || {};
    const now = new Date();
    const today = localIso(now);
    const next = { ...ran };
    dueSlots(state.config.times, now, ran).forEach((s) => { next[s] = today; });
    await kvSet("ranSlots", next);
  } catch { /* ignore */ }
  timer = setInterval(() => { tick().catch(() => {}); }, 60000);
  tick().catch(() => {});
}

export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
