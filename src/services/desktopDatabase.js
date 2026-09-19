import { showDataErrorBanner } from "./dataErrorBanner.js";
import { Capacitor } from "@capacitor/core";
import { DEMO_PILOT_CODES } from "../config/demoUsers.js";
import { downloadElementAsPdf, resolvePdfExportTarget } from "./downloadPdf.js";

const DEMO_SET = new Set((DEMO_PILOT_CODES || []).map((c) => String(c).toUpperCase()));

// True when the current web session is paired to a DEMO pilot code (see
// src/config/demoUsers.js). Reads the same key webDatabase.js writes on login,
// so it works synchronously anywhere (guards + UI). Always false on PC/mobile
// (that key is web-only), so demo mode is web-only.
//
// Checks localStorage first, then sessionStorage: the pairing moved to
// localStorage when it gained a 24-hour expiry, and a device paired under an
// earlier build still has its code in sessionStorage. Missing either store
// would let a DEMO account through the guards that block printing, export and
// writes - which is the whole point of this function.
export function isDemoSession() {
  try {
    const code =
      (typeof localStorage !== "undefined" ? localStorage.getItem("avicore_web_pilot_code") : "") ||
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("avicore_web_pilot_code") : "") ||
      "";
    return DEMO_SET.has(String(code).toUpperCase());
  } catch {
    return false;
  }
}

const normalize = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// True only inside the Android Crew app (built with `npm run build:mobile`
// and wrapped by Capacitor) - always false in Electron and in plain browser
// preview, so every function below keeps behaving exactly as it did before.
// @capacitor/core is designed to be imported in shared web code like this
// safely in any environment; isNativePlatform() just returns false instead
// of throwing when there's no native bridge (e.g. running inside Electron).
function isMobile() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// mobileDatabase.js pulls in @capacitor-community/sqlite and
// @capacitor/preferences, which register native plugin bridges - loaded
// lazily (only inside the isMobile() branches below) so none of that code
// ever runs, or is even downloaded, in the Electron/PC build.
function mobileDb() {
  return import("./mobileDatabase.js");
}

// True only in the plain-browser web build (`npm run build:web` / `--mode
// web`, see vite.config.js and src/web/WebApp.jsx). Vite bakes the mode
// into import.meta.env.MODE at build time, so this is a compile-time
// constant, not a runtime capability check like isMobile() above - there's
// no bridge to detect for a plain browser tab. Kept as a separate check
// (not folded into isMobile()) since the web build has no Capacitor and no
// local SQLite cache at all - see webDatabase.js for why.
// Exported (unlike isMobile() above) because the shared pilot page
// components need it directly, not just this file's own routing: on the
// web build a session is already locked to exactly one pilot for its
// whole lifetime (see webDatabase.js's sessionStorage-based pairing), so
// those pages hide their "Pilot" dropdown entirely instead of letting the
// signed-in pilot browse anyone else's records - see MyStatus.jsx,
// DutyEntry.jsx, MyLogbook.jsx, MyExperience.jsx.
export function isWeb() {
  // Both the Crew web build (mode "web") and the Enterprise Web admin build
  // (mode "admin") use the same browser/Supabase data layer (webDatabase.js)
  // and have no Electron bridge or local SQLite - so data routing below
  // treats them identically. The pilot self-service pages that ALSO use
  // isWeb() to lock their "Pilot" dropdown to one paired pilot aren't part
  // of the admin build (it renders Dashboard/All Status/Training/Reports),
  // so there's no conflict from folding "admin" in here.
  const mode = import.meta.env.MODE;
  return mode === "web" || mode === "admin";
}

// A build tied to exactly ONE pilot for the whole session (Crew web: one
// paired pilot per browser). The Enterprise Web admin build shares the same
// web data layer (isWeb() true) but is NOT single-pilot - an admin acts for
// any pilot, so its pages keep the full "Pilot" dropdown. This is why the
// pilot self-service pages branch on isSinglePilotDevice() (Crew only), not
// isWeb() (Crew + admin), for hiding that dropdown.
export function isSinglePilotDevice() {
  return import.meta.env.MODE === "web";
}

function webDb() {
  return import("./webDatabase.js");
}

export async function importPdf() {
  if (window.aviCoreAPI) return window.aviCoreAPI.importPdf();
  // PDF-based experience import relies on the PC app's built-in PDF parser
  // (Electron main process). On the web admin build there's no such parser,
  // so guide the user to the paths that DO work on web instead of throwing a
  // cryptic "Electron API not available".
  throw new Error("PDF import is only available in the PC app. On the web admin, enter the pilot's details manually, or import from Excel.");
}

export async function saveExperience(record) {
  if (window.aviCoreAPI) return window.aviCoreAPI.saveExperience(record);
  if (isWeb()) return (await webDb()).saveExperience(record);

  localStorage.setItem(`pilotExperience_${normalize(record.profile.licence)}`, JSON.stringify(record));
  return { ok: true };
}

export async function loadExperience(query) {
  if (window.aviCoreAPI) return window.aviCoreAPI.loadExperience(query);
  if (isMobile()) return (await mobileDb()).loadExperience(query);
  if (isWeb()) return (await webDb()).loadExperience(query);

  const raw = localStorage.getItem(`pilotExperience_${normalize(query)}`);
  return raw ? JSON.parse(raw) : null;
}

export async function listExperience() {
  if (window.aviCoreAPI) return window.aviCoreAPI.listExperience();
  if (isMobile()) return (await mobileDb()).listExperience();
  // A read that FAILS must not look like a table that is EMPTY. This one did,
  // for one wrong column name, and the whole pilot list disappeared from
  // every page while the records sat untouched in the database. Nobody could
  // tell "the query broke" from "the data is gone" - and the natural reaction
  // to the second is to start re-entering everything.
  //
  // So: the pages still get a list (they carry on working), and the reason is
  // put on the screen where it can't be missed.
  if (isWeb()) {
    try {
      return await (await webDb()).listExperience();
    } catch (err) {
      showDataErrorBanner(`Pilot records could not be READ (they are not deleted): ${err.message}`);
      return [];
    }
  }

  return Object.keys(localStorage)
    .filter((key) => key.startsWith("pilotExperience_"))
    .map((key) => {
      const r = JSON.parse(localStorage.getItem(key));
      return {
        licence: r.profile?.licence,
        code: r.profile?.code,
        name: r.profile?.name,
        position: r.profile?.position,
        update_date: r.profile?.update,
        modified_at: r.modifiedAt
      };
    });
}

export async function deleteExperience(query) {
  if (window.aviCoreAPI) return window.aviCoreAPI.deleteExperience(query);
  if (isWeb()) return (await webDb()).deleteExperience(query);

  localStorage.removeItem(`pilotExperience_${normalize(query)}`);
  return { ok: true };
}

export async function saveImage(dataUrl, folder, filename) {
  if (window.aviCoreAPI) return window.aviCoreAPI.saveImage({ dataUrl, folder, filename });
  return dataUrl;
}

// Saves an arbitrary attached document (PDF or photo of a certificate -
// Medical Class 1, Passport, License, training certificate, etc.) to disk
// and returns the saved path. In browser preview there's no filesystem, so
// the dataUrl itself is kept as the "path" (same fallback pattern saveImage
// already uses) - good enough for local testing, not meant for production.
export async function saveDocument(dataUrl, folder, filename) {
  if (window.aviCoreAPI) return window.aviCoreAPI.saveDocument({ dataUrl, folder, filename });
  return dataUrl;
}

// Opens a saved document with the OS's default viewer. Not available in
// browser preview (no filesystem to open from).
export async function openFile(filePath) {
  if (window.aviCoreAPI) return window.aviCoreAPI.openFile(filePath);

  // On the web there is no filesystem: saveDocument() returns the data URL
  // itself, so "the path" IS the file. Opening it needs one indirection that
  // isn't obvious - Chrome, Edge and Firefox all BLOCK top-level navigation
  // to a data: URL (it was a phishing vector), so window.open(dataUrl) is
  // silently refused and the document appears not to load. Turning it into a
  // blob: URL first is the supported way to do the same thing.
  const value = String(filePath || "");
  if (!value.startsWith("data:")) {
    return { ok: false, error: "This document was saved on the desktop app and isn't available here." };
  }
  try {
    const comma = value.indexOf(",");
    const header = value.slice(5, comma);
    const isBase64 = /;base64$/i.test(header);
    const mime = header.replace(/;base64$/i, "") || "application/octet-stream";
    const body = value.slice(comma + 1);

    let blob;
    if (isBase64) {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      blob = new Blob([bytes], { type: mime });
    } else {
      blob = new Blob([decodeURIComponent(body)], { type: mime });
    }

    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      URL.revokeObjectURL(url);
      return { ok: false, error: "The browser blocked the pop-up. Allow pop-ups for this site and try again." };
    }
    // Long enough for the new tab to have taken the data; revoking straight
    // away leaves an empty viewer in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Couldn't read the stored document (${err.message}).` };
  }
}

export async function addDutyEntry(entry) {
  if (isDemoSession()) throw new Error("Demo account (view only) — changes are not saved.");
  if (window.aviCoreAPI) return window.aviCoreAPI.addDutyEntry(entry);
  if (isMobile()) return (await mobileDb()).addDutyEntry(entry);
  if (isWeb()) return (await webDb()).addDutyEntry(entry);

  const key = `dutyEntries_${normalize(entry.pilotCode)}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  const id = Date.now();
  existing.unshift({ ...entry, id });
  localStorage.setItem(key, JSON.stringify(existing));
  return { ok: true, id };
}

export async function listDutyEntriesByPilot(code) {
  if (window.aviCoreAPI) return window.aviCoreAPI.listDutyEntriesByPilot(code);
  if (isMobile()) return (await mobileDb()).listDutyEntriesByPilot(code);
  if (isWeb()) return (await webDb()).listDutyEntriesByPilot(code);

  const raw = localStorage.getItem(`dutyEntries_${normalize(code)}`);
  const entries = raw ? JSON.parse(raw) : [];
  return entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
}

export async function deleteDutyEntry(code, id) {
  if (isDemoSession()) throw new Error("Demo account (view only) — changes are not saved.");
  if (window.aviCoreAPI) return window.aviCoreAPI.deleteDutyEntry(id);
  if (isMobile()) return (await mobileDb()).deleteDutyEntry(code, id);
  if (isWeb()) return (await webDb()).deleteDutyEntry(code, id);

  const key = `dutyEntries_${normalize(code)}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  localStorage.setItem(key, JSON.stringify(existing.filter((e) => e.id !== id)));
  return { ok: true };
}

export async function updateDutyEntry(code, id, entry) {
  if (isDemoSession()) throw new Error("Demo account (view only) — changes are not saved.");
  if (window.aviCoreAPI) return window.aviCoreAPI.updateDutyEntry(id, entry);
  if (isMobile()) return (await mobileDb()).updateDutyEntry(code, id, entry);
  if (isWeb()) return (await webDb()).updateDutyEntry(code, id, entry);

  const key = `dutyEntries_${normalize(code)}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  localStorage.setItem(key, JSON.stringify(existing.map((e) => (e.id === id ? { ...entry, id } : e))));
  return { ok: true };
}

export async function exportLogbookPdf(suggestedName) {
  if (isDemoSession()) return { ok: false, error: "Demo account — export is disabled." };

  // One-page reports must use the in-page raster path on every platform. The
  // Electron bridge prints the whole BrowserWindow and cannot target this DOM
  // node or guarantee fit-to-page, which caused blank/clipped extra sheets.
  const { element, fitToPage } = resolvePdfExportTarget();
  if (fitToPage) return downloadElementAsPdf(element, suggestedName, { landscape: true, fitToPage: true });

  if (window.aviCoreAPI) return window.aviCoreAPI.exportLogbookPdf(suggestedName);
  if (isMobile()) return (await mobileDb()).exportLogbookPdf(suggestedName);
  if (isWeb()) return (await webDb()).exportLogbookPdf(suggestedName);

  // Last-resort path (plain browser, no Electron bridge, not the web build).
  // A bare window.print() here dropped the requested name entirely; a generated
  // download is ours to name. See downloadPdf.js.
  return downloadElementAsPdf(element, suggestedName, { landscape: true, fitToPage });
}

export async function addDutyEntriesMany(code, entries) {
  if (window.aviCoreAPI) return window.aviCoreAPI.addDutyEntriesMany({ code, entries });
  if (isWeb()) return (await webDb()).addDutyEntriesMany(code, entries);

  const key = `dutyEntries_${normalize(code)}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  const sourceFile = entries.find((e) => e.sourceFile)?.sourceFile || null;
  const kept = sourceFile ? existing.filter((e) => e.sourceFile !== sourceFile) : existing;
  const replaced = existing.length - kept.length;
  let nextId = Date.now();
  kept.push(...entries.map((e) => ({ ...e, id: nextId++ })));
  localStorage.setItem(key, JSON.stringify(kept));
  return { ok: true, count: entries.length, replaced };
}

export async function removeDutyEntriesBySourceFile(code, sourceFile) {
  if (window.aviCoreAPI) return window.aviCoreAPI.removeDutyEntriesBySourceFile({ code, sourceFile });
  if (isWeb()) return (await webDb()).removeDutyEntriesBySourceFile(code, sourceFile);

  const key = `dutyEntries_${normalize(code)}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  const kept = existing.filter((e) => e.sourceFile !== sourceFile);
  localStorage.setItem(key, JSON.stringify(kept));
  return { ok: true, removed: existing.length - kept.length };
}

export async function listImportedFdtFiles() {
  if (window.aviCoreAPI) return window.aviCoreAPI.listImportedFdtFiles();
  if (isWeb()) return (await webDb()).listImportedFdtFiles();

  const groups = new Map();
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("dutyEntries_")) continue;
    const entries = JSON.parse(localStorage.getItem(key) || "[]");
    for (const e of entries) {
      if (!e.sourceFile) continue;
      const gkey = `${e.pilotCode} ${e.sourceFile}`;
      if (!groups.has(gkey)) groups.set(gkey, { code: e.pilotCode, filename: e.sourceFile, flightCount: 0, nonFlightCount: 0, aircraftType: "", importedAt: null });
      const g = groups.get(gkey);
      if (e.dutyType === "flight") {
        g.flightCount++;
        if (!g.aircraftType && e.aircraftType) g.aircraftType = e.aircraftType;
      } else {
        g.nonFlightCount++;
      }
    }
  }
  return [...groups.values()];
}

export async function saveTraining(code, name, record) {
  if (window.aviCoreAPI) return window.aviCoreAPI.saveTraining({ code, name, record });
  if (isWeb()) return (await webDb()).saveTraining(code, name, record);
  localStorage.setItem(`pilotTraining_${normalize(code)}`, JSON.stringify({ code, name, record }));
  return { ok: true };
}

export async function importTrainingMany(pilots) {
  if (window.aviCoreAPI) return window.aviCoreAPI.importTrainingMany(pilots);
  if (isWeb()) return (await webDb()).importTrainingMany(pilots);
  for (const p of pilots) localStorage.setItem(`pilotTraining_${normalize(p.code)}`, JSON.stringify(p));
  return { ok: true, count: pilots.length };
}

export async function listTraining() {
  if (window.aviCoreAPI) return window.aviCoreAPI.listTraining();
  if (isWeb()) return (await webDb()).listTraining();
  return Object.keys(localStorage)
    .filter((key) => key.startsWith("pilotTraining_"))
    .map((key) => JSON.parse(localStorage.getItem(key)));
}

export async function listRoster(query) {
  if (window.aviCoreAPI) return window.aviCoreAPI.listRoster(query);
  if (isWeb()) return (await webDb()).listRoster(query);
  const { from, to } = query || {};
  const all = JSON.parse(localStorage.getItem("pilotRoster") || "[]");
  return all.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

export async function listRosterPilots() {
  if (window.aviCoreAPI) return window.aviCoreAPI.listRosterPilots();
  if (isWeb()) return (await webDb()).listRosterPilots();
  const all = JSON.parse(localStorage.getItem("pilotRoster") || "[]");
  const byCode = new Map();
  for (const r of all) byCode.set(r.pilot_code, { pilot_code: r.pilot_code, pilot_name: r.pilot_name, base: r.base });
  return [...byCode.values()];
}

export async function importRosterMany(entries) {
  if (window.aviCoreAPI) return window.aviCoreAPI.importRosterMany(entries);
  if (isWeb()) return (await webDb()).importRosterMany(entries);
  const all = JSON.parse(localStorage.getItem("pilotRoster") || "[]");
  for (const e of entries || []) {
    const pilotCode = String(e.pilotCode ?? e.pilot_code ?? "").toUpperCase();
    const date = e.date;
    if (!pilotCode || !date) continue;
    const idx = all.findIndex((r) => r.pilot_code === pilotCode && r.date === date);
    const row = { pilot_code: pilotCode, pilot_name: e.pilotName ?? e.pilot_name ?? "", base: e.base ?? "", date, code: e.code ?? "" };
    if (idx >= 0) all[idx] = row; else all.push(row);
  }
  localStorage.setItem("pilotRoster", JSON.stringify(all));
  return { ok: true, count: (entries || []).length };
}

export async function deleteRosterEntry(query) {
  if (window.aviCoreAPI) return window.aviCoreAPI.deleteRosterEntry(query);
  if (isWeb()) return (await webDb()).deleteRosterEntry(query);
  const { pilotCode, date } = query || {};
  const all = JSON.parse(localStorage.getItem("pilotRoster") || "[]");
  const code = String(pilotCode || "").toUpperCase();
  localStorage.setItem("pilotRoster", JSON.stringify(all.filter((r) => !(r.pilot_code === code && r.date === date))));
  return { ok: true };
}

// ---- Weekly Schedule plan ------------------------------------------------
// Same routing shape as the roster functions above. The localStorage branch
// is the no-backend fallback used when the app runs as a plain page with no
// Electron bridge and no Supabase configured (dev / demo).

const WEEKLY_PLAN_KEY = "pilotWeeklyPlan";

function localWeeklyPlan() {
  try { return JSON.parse(localStorage.getItem(WEEKLY_PLAN_KEY) || "[]"); } catch { return []; }
}

export async function listWeeklyPlan(query) {
  if (window.aviCoreAPI?.listWeeklyPlan) return window.aviCoreAPI.listWeeklyPlan(query);
  if (isWeb()) return (await webDb()).listWeeklyPlan(query);
  const { from, to } = query || {};
  return localWeeklyPlan().filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

export async function saveWeeklyPlanMany(cells) {
  if (isDemoSession()) throw new Error("Demo account (view only) — changes are not saved.");
  if (window.aviCoreAPI?.saveWeeklyPlanMany) return window.aviCoreAPI.saveWeeklyPlanMany(cells);
  if (isWeb()) return (await webDb()).saveWeeklyPlanMany(cells);
  const all = localWeeklyPlan();
  for (const c of cells || []) {
    if (!c?.date || !c?.section) continue;
    const slot = Number(c.slot) || 0;
    const code = String(c.pilotCode ?? c.pilot_code ?? "").trim().toUpperCase();
    const idx = all.findIndex((r) => r.date === c.date && r.section === c.section && r.slot === slot);
    if (!code) { if (idx >= 0) all.splice(idx, 1); continue; }
    const row = { date: c.date, section: c.section, slot, pilot_code: code, level: c.level ?? null, note: c.note ?? null };
    if (idx >= 0) all[idx] = row; else all.push(row);
  }
  localStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(all));
  return { ok: true, count: (cells || []).length };
}

export async function clearWeeklyPlanRange(query) {
  if (isDemoSession()) throw new Error("Demo account (view only) — changes are not saved.");
  if (window.aviCoreAPI?.clearWeeklyPlanRange) return window.aviCoreAPI.clearWeeklyPlanRange(query);
  if (isWeb()) return (await webDb()).clearWeeklyPlanRange(query);
  const { from, to } = query || {};
  if (!from || !to) return { ok: true };
  const kept = localWeeklyPlan().filter((r) => r.date < from || r.date > to);
  localStorage.setItem(WEEKLY_PLAN_KEY, JSON.stringify(kept));
  return { ok: true };
}

export async function syncNow() {
  if (window.aviCoreAPI) return window.aviCoreAPI.syncNow();
  if (isMobile()) return (await mobileDb()).syncNow();
  return { ok: false, pushed: 0, pulled: 0, error: "Sync unavailable in browser preview" };
}

export async function getSyncStatus() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getSyncStatus();
  if (isMobile()) return (await mobileDb()).getSyncStatus();
  return { configured: false, syncing: false, lastSyncAt: null, lastError: "Sync unavailable in browser preview", pending: 0 };
}

export async function getSyncConfig() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getSyncConfig();
  return { configured: false, url: "" };
}

export async function setSyncConfig(url, serviceKey) {
  if (window.aviCoreAPI) return window.aviCoreAPI.setSyncConfig({ url, serviceKey });
  throw new Error("Sync setup is unavailable in browser preview");
}

export async function clearSyncConfig() {
  if (window.aviCoreAPI) return window.aviCoreAPI.clearSyncConfig();
  return { ok: true };
}

export async function listDevices() {
  if (window.aviCoreAPI) return window.aviCoreAPI.listDevices();
  return [];
}

export async function getSetting(key) {
  if (window.aviCoreAPI) return window.aviCoreAPI.getSetting(key);
  if (isMobile()) return (await mobileDb()).getSetting(key);
  if (isWeb()) return (await webDb()).getSetting(key);
  const raw = localStorage.getItem(`appSetting_${key}`);
  return raw ? JSON.parse(raw) : null;
}

// "Which pilot should a page default to, before the user picks anyone
// manually" - empty on PC (an admin/duty controller uses these pages for
// whichever pilot they're looking up, so there's no single "preferred"
// one), but the phone/browser's own paired pilot on Android and Web, where
// exactly one pilot uses that device/browser session. See MyStatus.jsx,
// DutyEntry.jsx, MyLogbook.jsx, MyExperience.jsx, and MyTrainingStatus.jsx
// for how this replaces defaulting to "the first pilot alphabetically" -
// which was never actually "you", just whoever happened to sort first.
export async function getPreferredPilotCode() {
  if (window.aviCoreAPI) return "";
  if (isMobile()) return (await mobileDb()).getPairedPilotCode();
  // A demo session isn't a real pilot, so don't default any page to it -
  // return "" so pages fall back to the first real pilot, and the demo user
  // browses others via the dropdown (which demo mode keeps visible).
  if (isWeb()) return isDemoSession() ? "" : (await webDb()).getPairedPilotCode();
  return "";
}

// Hours left on the web build's device pairing, or null when it does not apply
// (PC and Android pair permanently to one device, so there is nothing to
// expire). Used only to tell the pilot when they will next need a connection.
export async function getPairingHoursLeft() {
  if (window.aviCoreAPI) return null;
  if (isWeb()) return (await webDb()).getPairingHoursLeft();
  return null;
}

// One pilot's own training/certificate record, read-only - used by the web
// app's "My Training Status" tab (see webDatabase.js's getMyTraining() and
// sql/web-training-readonly-rls.sql for the RLS this needs). Not yet wired
// up for the Android app (Training was deliberately PC/Admin-only there -
// see sql/mobile-rls-setup.sql - this could be extended the same way later
// if that changes).
export async function getMyTraining(code) {
  if (window.aviCoreAPI) {
    const all = await window.aviCoreAPI.listTraining();
    return all.find((p) => p.code === code) || null;
  }
  if (isWeb()) return (await webDb()).getMyTraining(code);
  return null;
}

export async function saveSetting(key, value) {
  if (window.aviCoreAPI) return window.aviCoreAPI.saveSetting(key, value);
  if (isWeb()) return (await webDb()).saveSetting(key, value);
  localStorage.setItem(`appSetting_${key}`, JSON.stringify(value));
  return { ok: true };
}

export async function getHardwareId() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getHardwareId();
  return "N/A (browser preview)";
}

export async function copyHardwareId(id) {
  if (window.aviCoreAPI) return window.aviCoreAPI.copyHardwareId(id);
  return false;
}

export async function getLicenseStatus() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getLicenseStatus();
  return { valid: false, reason: "Not available in browser preview" };
}

export async function getEmailConfig() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getEmailConfig();
  return { enabled: false, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", hasPassword: false, fromAddress: "", toAddress: "" };
}

export async function setEmailConfig(cfg) {
  if (window.aviCoreAPI) return window.aviCoreAPI.setEmailConfig(cfg);
  throw new Error("Email setup is unavailable in browser preview");
}

export async function sendTestEmail() {
  if (window.aviCoreAPI) return window.aviCoreAPI.sendTestEmail();
  return { ok: false, error: "Not available in browser preview" };
}

export async function sendLineTestMessage() {
  if (isWeb()) return (await webDb()).sendLineTestMessage();
  return { ok: false, error: "LINE test messaging is only available in the web admin." };
}

export async function sendEmail(payload) {
  if (window.aviCoreAPI) return window.aviCoreAPI.sendEmail(payload);
  return { ok: false, error: "Not available in browser preview" };
}

// Admin PIN gate (see electron/main.cjs for the real salted-hash storage).
// The browser-preview fallback below is a dev convenience only - it is not
// cryptographically secure and must never be relied on outside Electron.
export async function hasAdminPin() {
  if (window.aviCoreAPI) return window.aviCoreAPI.hasAdminPin();
  return !!localStorage.getItem("devAdminPin");
}

export async function verifyAdminPin(pin) {
  if (window.aviCoreAPI) return window.aviCoreAPI.verifyAdminPin(pin);
  return { ok: localStorage.getItem("devAdminPin") === String(pin || "") };
}

export async function setAdminPin(pin, currentPin) {
  if (window.aviCoreAPI) return window.aviCoreAPI.setAdminPin(pin, currentPin);
  const trimmed = String(pin || "").trim();
  if (trimmed.length < 4) return { ok: false, error: "PIN must be at least 4 characters." };
  const existing = localStorage.getItem("devAdminPin");
  if (existing && existing !== String(currentPin || "")) return { ok: false, error: "Current PIN is incorrect." };
  localStorage.setItem("devAdminPin", trimmed);
  return { ok: true };
}

// Software update (see electron/updater.cjs). Not available in browser
// preview - there is no packaged installer to update in that mode.
export async function getAppVersion() {
  if (window.aviCoreAPI) return window.aviCoreAPI.getAppVersion();
  return "dev (browser preview)";
}

export async function checkForUpdates() {
  if (window.aviCoreAPI) return window.aviCoreAPI.checkForUpdates();
  return { ok: false, error: "Not available in browser preview" };
}

export async function downloadUpdate() {
  if (window.aviCoreAPI) return window.aviCoreAPI.downloadUpdate();
  return { ok: false, error: "Not available in browser preview" };
}

export async function installUpdate() {
  if (window.aviCoreAPI) return window.aviCoreAPI.installUpdate();
  return { ok: false, error: "Not available in browser preview" };
}

// Subscribes to update:event pushes from the main process (checking,
// available, not-available, progress, downloaded, error). Returns an
// unsubscribe function; no-op (returns a no-op unsubscribe) outside Electron.
export function onUpdateEvent(callback) {
  if (window.aviCoreAPI) return window.aviCoreAPI.onUpdateEvent(callback);
  return () => {};
}
