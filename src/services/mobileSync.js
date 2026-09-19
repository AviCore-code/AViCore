import { createClient } from "@supabase/supabase-js";
import { Preferences } from "@capacitor/preferences";
import { all, get, run } from "./mobileSqlite.js";

// Talks to the SAME Supabase project as the PC app's Central Sync (see
// electron/sync.cjs), but with the public "anon" key instead of the
// service_role key - the anon key is safe to embed inside a distributed
// Android APK, service_role is NOT (see sql/mobile-rls-setup.sql, which
// must be run once so the anon key only has access to exactly the tables
// this file touches). Baked in at build time via Vite env vars so the app
// doesn't need an in-app "Central Sync Setup" screen like the PC app does -
// a pilot's phone isn't an admin device.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

const status = { syncing: false, lastSyncAt: null, lastError: null };

async function getDeviceId() {
  const { value } = await Preferences.get({ key: "avicore_device_id" });
  if (value) return value;
  const id = crypto.randomUUID();
  await Preferences.set({ key: "avicore_device_id", value: id });
  return id;
}

async function getMeta(key) {
  const row = await get("SELECT value FROM sync_meta WHERE key=?", [key]);
  return row ? row.value : null;
}
async function setMeta(key, value) {
  await run(
    "INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value]
  );
}

// One-time, ephemeral lookup used only by the Pilot Login picker on first
// launch (before this phone is paired to anyone) - just code/name, never
// written to local SQLite, so a phone never caches the whole fleet's
// experience data, only the one pilot it ends up paired to (see
// pullExperience() below, which filters to that single code once paired).
export async function fetchPilotRoster() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("Admin_pilot_experience")
    .select("code, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error("fetch pilot roster: " + error.message);
  return data || [];
}

// ---- pilot_experience: read-only mirror, scoped to just this phone's
// paired pilot (RLS grants anon SELECT on the whole table, but there's no
// reason for one pilot's phone to also cache every other pilot's data
// locally - filtering here is a privacy/footprint choice, not a security
// boundary). ----
async function pullExperience() {
  if (!supabase) return 0;
  const { value: pairedCode } = await Preferences.get({ key: "avicore_pilot_code" });
  if (!pairedCode) return 0;

  const lastPullAt = (await getMeta("last_pull_pilot_experience")) || "1970-01-01T00:00:00.000Z";
  const { data, error } = await supabase
    .from("Admin_pilot_experience")
    .select("uuid, licence, licence_key, code, name, update_date, record_json, created_at, modified_at, deleted_at")
    .eq("code", pairedCode)
    .gt("modified_at", lastPullAt)
    .order("modified_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error("pull pilot_experience: " + error.message);
  if (!data.length) return 0;

  for (const row of data) {
    await run(
      `INSERT INTO pilot_experience (uuid, licence, licence_key, code, name, update_date, record_json, created_at, modified_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         licence=excluded.licence, licence_key=excluded.licence_key, code=excluded.code, name=excluded.name,
         update_date=excluded.update_date, record_json=excluded.record_json, created_at=excluded.created_at,
         modified_at=excluded.modified_at, deleted_at=excluded.deleted_at`,
      [row.uuid, row.licence, row.licence_key, row.code, row.name, row.update_date,
        JSON.stringify(row.record_json), row.created_at, row.modified_at, row.deleted_at]
    );
  }
  await setMeta("last_pull_pilot_experience", data[data.length - 1].modified_at);
  return data.length;
}

// ---- pilot_duty_entries: read + write (this is what a pilot actually
// creates offline on the phone via Daily Duty) ----
async function pushDutyEntries() {
  if (!supabase) return 0;
  const rows = await all("SELECT * FROM pilot_duty_entries WHERE synced_at IS NULL OR synced_at < modified_at");
  if (!rows.length) return 0;

  const deviceId = await getDeviceId();
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const payload = chunk.map((r) => ({
      uuid: r.uuid,
      device_id: deviceId,
      pilot_code: r.pilot_code,
      date: r.date,
      duty_type: r.duty_type,
      entry_json: r.entry_json ? JSON.parse(r.entry_json) : null,
      created_at: r.created_at,
      modified_at: r.modified_at,
      deleted_at: r.deleted_at
    }));
    const { error } = await supabase.from("Admin_pilot_duty_entries").upsert(payload, { onConflict: "uuid" });
    if (error) throw new Error("push pilot_duty_entries: " + error.message);

    for (const r of chunk) {
      await run("UPDATE pilot_duty_entries SET synced_at=? WHERE uuid=?", [r.modified_at, r.uuid]);
    }
  }
  return rows.length;
}

async function pullDutyEntries() {
  if (!supabase) return 0;
  const { value: pairedCode } = await Preferences.get({ key: "avicore_pilot_code" });
  if (!pairedCode) return 0;

  const lastPullAt = (await getMeta("last_pull_pilot_duty_entries")) || "1970-01-01T00:00:00.000Z";
  const { data, error } = await supabase
    .from("Admin_pilot_duty_entries")
    .select("uuid, pilot_code, date, duty_type, entry_json, created_at, modified_at, deleted_at")
    .eq("pilot_code", pairedCode)
    .gt("modified_at", lastPullAt)
    .order("modified_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error("pull pilot_duty_entries: " + error.message);
  if (!data.length) return 0;

  for (const row of data) {
    // Last-write-wins by modified_at: if this phone already has a newer (or
    // equal) local edit, leave it alone - the next push sends it up instead
    // of it being overwritten here (same rule as electron/sync.cjs).
    const existing = await get("SELECT modified_at FROM pilot_duty_entries WHERE uuid=?", [row.uuid]);
    if (existing && existing.modified_at && existing.modified_at >= row.modified_at) continue;

    const entryJson = JSON.stringify(row.entry_json);
    if (existing) {
      await run(
        `UPDATE pilot_duty_entries SET pilot_code=?, date=?, duty_type=?, entry_json=?, created_at=?, modified_at=?, deleted_at=?, synced_at=? WHERE uuid=?`,
        [row.pilot_code, row.date, row.duty_type, entryJson, row.created_at, row.modified_at, row.deleted_at, row.modified_at, row.uuid]
      );
    } else {
      await run(
        `INSERT INTO pilot_duty_entries (uuid, pilot_code, date, duty_type, entry_json, created_at, modified_at, deleted_at, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.uuid, row.pilot_code, row.date, row.duty_type, entryJson, row.created_at, row.modified_at, row.deleted_at, row.modified_at]
      );
    }
  }
  await setMeta("last_pull_pilot_duty_entries", data[data.length - 1].modified_at);
  return data.length;
}

// ---- app_settings: only the specific keys the mobile app actually needs
// (ftl_limits for My Status, customer_branding for the app header/footer
// logo+name) - targeted fetches, not a full-table pull, so nothing else in
// app_settings (admin PIN hash, sync config, ...) is ever requested. ----
async function pullAppSettingKey(key) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("Admin_app_settings")
    .select("value_json, modified_at")
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`pull app_settings(${key}): ` + error.message);
  if (!data) return null;

  await run(
    `INSERT INTO app_settings (key, value_json, modified_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, modified_at=excluded.modified_at`,
    [key, JSON.stringify(data.value_json), data.modified_at]
  );
  return data.value_json;
}

export async function pullFtlLimits() {
  return pullAppSettingKey("ftl_limits");
}

// Admin sets this once in the PC app's Settings > Admin Setting > Branding
// (logo + company name) - reused as-is here so the phone shows the same
// branding without a separate mobile-only config screen (this is a
// personal-phone app, not an admin device - see MobileApp.jsx).
export async function pullBranding() {
  return pullAppSettingKey("customer_branding");
}

// Admin sets this in the PC app's Settings > Flight Crew Setting (fleet's
// Aircraft Types + Registrations) - Daily Duty Entry's leg dropdowns read it
// via desktopDatabase.js's getSetting("fleet_config"), same as the PC app.
// Without pulling it down here, the phone always fell back to
// utils/fleetConfig.js's hardcoded DEFAULT_FLEET_CONFIG instead of whatever
// the Admin actually configured.
export async function pullFleetConfig() {
  return pullAppSettingKey("fleet_config");
}

// Best-effort presence ping for the "Connected Devices" monitor in the PC
// app's Admin Setting (see electron/sync.cjs's matching pushHeartbeat()).
// Never throws - a failed heartbeat must never fail or block the rest of a
// sync cycle, it's purely informational for the admin.
async function pushHeartbeat() {
  if (!supabase) return;
  try {
    const deviceId = await getDeviceId();
    const { value: pairedCode } = await Preferences.get({ key: "avicore_pilot_code" });
    let pilotName = null;
    if (pairedCode) {
      const row = await get(
        "SELECT name FROM pilot_experience WHERE code=? AND deleted_at IS NULL",
        [pairedCode]
      );
      pilotName = row ? row.name : null;
    }
    await supabase.from("device_status").upsert(
      {
        device_id: deviceId,
        device_type: "android",
        device_name: pairedCode ? `${pairedCode}'s phone` : "Unpaired phone",
        pilot_code: pairedCode || null,
        pilot_name: pilotName,
        app_version: null,
        supabase_url: SUPABASE_URL || null,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "device_id" }
    );
  } catch (err) {
    console.warn("[mobileSync] heartbeat failed:", err.message);
  }
}

export async function syncNow() {
  if (!supabase) {
    // Surface this into `status` too, not just the return value - MobileApp.jsx's
    // Sync button only reads getSyncStatus() (via doSync -> setSyncStatus),
    // it never inspects what syncNow() itself returns. Without this, a build
    // missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY silently shows
    // "Synced" (pending===0, lastError===null) forever - which is exactly
    // how this class of misconfiguration went unnoticed before: every press
    // of Sync looked like success but never actually talked to Supabase.
    const error = "Sync not configured for this build (missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).";
    status.lastError = error;
    return { ok: false, pushed: 0, pulled: 0, error };
  }
  status.syncing = true;
  let pushed = 0;
  let pulled = 0;
  try {
    pushed += await pushDutyEntries();
    pulled += await pullExperience();
    pulled += await pullDutyEntries();
    await pullFtlLimits();
    await pullBranding();
    await pullFleetConfig();
    status.lastSyncAt = new Date().toISOString();
    status.lastError = null;
    return { ok: true, pushed, pulled };
  } catch (err) {
    status.lastError = err.message;
    return { ok: false, pushed, pulled, error: err.message };
  } finally {
    // Always attempt the presence ping, even if the data sync above failed
    // partway through - the device still reached Supabase and should still
    // show up in Admin Setting > Connected Devices. pushHeartbeat() has its
    // own internal try/catch, so this can never throw or mask the real
    // sync result above.
    await pushHeartbeat();
    status.syncing = false;
  }
}

export async function getSyncStatus() {
  const pendingRow = await get(
    "SELECT COUNT(*) AS n FROM pilot_duty_entries WHERE synced_at IS NULL OR synced_at < modified_at"
  );
  return {
    configured: !!supabase,
    syncing: status.syncing,
    lastSyncAt: status.lastSyncAt,
    lastError: status.lastError,
    pending: pendingRow ? pendingRow.n : 0
  };
}
