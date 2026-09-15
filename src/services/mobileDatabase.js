import { Preferences } from "@capacitor/preferences";
import { all, get, run } from "./mobileSqlite.js";
import { syncNow as doSyncNow, getSyncStatus as doGetSyncStatus } from "./mobileSync.js";
import { downloadElementAsPdf, resolvePdfExportTarget } from "./downloadPdf.js";

const normalize = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Same function surface as the desktop-only calls in desktopDatabase.js that
// My Status / Daily Duty / My Logbook / My Experience actually use - backed
// by on-device SQLite (mobileSqlite.js) instead of better-sqlite3, and
// Supabase's anon key (mobileSync.js) instead of the service_role key. See
// desktopDatabase.js for how this gets wired in automatically under
// Capacitor - none of those four page components had to change.

export async function listExperience() {
  return all(
    // position is inside record_json.profile (no column of its own) - pulled
    // out with json_extract so callers see a flat `position`, matching the
    // web/desktop shape (Duty Schedule's rank headcount relies on it).
    "SELECT licence, code, name, update_date, modified_at, json_extract(record_json, '$.profile.position') AS position FROM pilot_experience WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE"
  );
}

export async function loadExperience(query) {
  const key = normalize(query);
  const row = await get(
    `SELECT record_json FROM pilot_experience
     WHERE deleted_at IS NULL AND (licence_key=? OR UPPER(code)=UPPER(?) OR UPPER(name) LIKE '%' || UPPER(?) || '%')
     LIMIT 1`,
    [key, String(query || ""), String(query || "")]
  );
  return row ? JSON.parse(row.record_json) : null;
}

// id here is the row's uuid (a string), not a numeric autoincrement id like
// on desktop - DutyEntry.jsx treats it as an opaque key throughout (React
// key prop, equality checks, passed straight back to update/delete), so
// this is a transparent swap.
export async function addDutyEntry(entry) {
  const pilotCode = normalize(entry.pilotCode);
  if (!pilotCode) throw new Error("Pilot code is required");
  if (!entry.date) throw new Error("Date is required");
  const now = new Date().toISOString();
  const uuid = crypto.randomUUID();
  await run(
    `INSERT INTO pilot_duty_entries (uuid, pilot_code, date, duty_type, entry_json, created_at, modified_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [uuid, pilotCode, entry.date, entry.dutyType, JSON.stringify(entry), now, now]
  );
  return { ok: true, id: uuid };
}

export async function listDutyEntriesByPilot(code) {
  const rows = await all(
    "SELECT uuid, entry_json FROM pilot_duty_entries WHERE pilot_code=? AND deleted_at IS NULL ORDER BY date DESC",
    [normalize(code)]
  );
  return rows.map((r) => ({ id: r.uuid, ...JSON.parse(r.entry_json) }));
}

export async function deleteDutyEntry(_code, id) {
  const now = new Date().toISOString();
  await run(
    "UPDATE pilot_duty_entries SET deleted_at=?, modified_at=?, synced_at=NULL WHERE uuid=?",
    [now, now, id]
  );
  return { ok: true };
}

export async function updateDutyEntry(_code, id, entry) {
  const pilotCode = normalize(entry.pilotCode);
  if (!pilotCode) throw new Error("Pilot code is required");
  if (!entry.date) throw new Error("Date is required");
  const now = new Date().toISOString();
  await run(
    "UPDATE pilot_duty_entries SET pilot_code=?, date=?, duty_type=?, entry_json=?, modified_at=?, synced_at=NULL WHERE uuid=?",
    [pilotCode, entry.date, entry.dutyType, JSON.stringify(entry), now, id]
  );
  return { ok: true };
}

// Only these keys are ever stored locally (see mobileSync.js's
// pullFtlLimits/pullBranding/pullFleetConfig - targeted fetches, not a full
// app_settings mirror), so this ignores any other key rather than
// pretending to support the full desktop Settings surface.
const MOBILE_SETTING_KEYS = new Set(["ftl_limits", "customer_branding", "fleet_config"]);
export async function getSetting(key) {
  if (!MOBILE_SETTING_KEYS.has(key)) return null;
  const row = await get("SELECT value_json FROM app_settings WHERE key=?", [key]);
  return row ? JSON.parse(row.value_json) : null;
}

// Builds the PDF in-page and downloads it, since Android has no save dialog to
// hand a filename to.
export async function exportLogbookPdf(suggestedName) {
  // Generates a real PDF and downloads it under the given name. The old
  // window.print() here dropped the name entirely - see downloadPdf.js for why
  // the print dialog cannot be told what to call the file.
  const { element, fitToPage } = resolvePdfExportTarget();
  return downloadElementAsPdf(element, suggestedName, { landscape: true, fitToPage });
}

export async function syncNow() {
  return doSyncNow();
}

export async function getSyncStatus() {
  return doGetSyncStatus();
}

// "Which pilot is this phone" - set once on first launch (see
// src/mobile/PilotLogin.jsx), then every page defaults to this pilot
// instead of showing the full "pick anyone" dropdown the desktop kiosk UI
// uses. Stored via Capacitor Preferences (not SQLite) since it's a single
// small value, not app data.
export async function getPairedPilotCode() {
  const { value } = await Preferences.get({ key: "avicore_pilot_code" });
  return value || "";
}

export async function setPairedPilotCode(code) {
  await Preferences.set({ key: "avicore_pilot_code", value: normalize(code) });
}

export async function clearPairedPilotCode() {
  await Preferences.remove({ key: "avicore_pilot_code" });
}
