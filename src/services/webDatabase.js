import { showDataErrorBanner } from "./dataErrorBanner.js";
import { cacheableRead, queueableWrite } from "./offlineWrap.js";
import { registerCurrentReader } from "./offlineQueue.js";
import { createClient } from "@supabase/supabase-js";
import { downloadElementAsPdf } from "./downloadPdf.js";

// Data layer for the plain-browser web build (`npm run build:web`, see
// vite.config.js's "web" mode and src/web/WebApp.jsx). Unlike the Android
// app (mobileDatabase.js/mobileSync.js), there is no local SQLite cache and
// no offline queue here - every read and write goes straight to Supabase
// using the same public anon key + RLS policies already set up for Android
// (sql/mobile-rls-setup.sql covers this exactly: anon can read
// pilot_experience, read+write pilot_duty_entries, read app_settings - so
// no new SQL is needed to bring this build online). That's a deliberate
// trade-off for v1: a web app is assumed to always have a connection, so
// there's no need to replicate the offline-first design built for pilots on
// offshore rigs with patchy signal - if that changes later, an IndexedDB
// cache could be layered in the same way mobileDatabase.js layers on top of
// mobileSqlite.js, without touching the four shared page components.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  // persistSession:true so an admin who signs in (Enterprise Web admin
  // build) stays logged in across reloads. The Crew build never calls
  // signInAdmin() below, so it stays anonymous exactly as before - the anon
  // key + RLS still govern everything it can read/write.
  //
  // The admin build stores that session in sessionStorage instead of the
  // default localStorage: sessionStorage is scoped to the browser tab, so
  // refreshing or navigating within the tab keeps you signed in, but CLOSING
  // the tab/window ends the session - the next visit lands on the login
  // screen. That's the requested "closing the page = logged out" behaviour,
  // and it's enforced by the browser itself rather than by an unload handler
  // (which is unreliable: a hard close or a crash may never run one). It also
  // means an admin console left open on a shared PC can't be resumed by the
  // next person just by reopening the browser.
  const adminBuild = import.meta.env.MODE === "admin";
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      ...(adminBuild && typeof sessionStorage !== "undefined" ? { storage: sessionStorage } : {})
    }
  });
}

// ---- Supabase Auth (Enterprise Web admin only) --------------------------
// The admin web build signs in a real user (email/password); every write
// below then carries that user's JWT, and RLS grants writes only to
// authenticated users (see sql/web-admin-write-rls.sql). The Crew build
// never touches these, so it can only ever READ (anon), never write settings
// or pilots.
export async function signInAdmin(email, password) {
  const sb = requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email: String(email || "").trim(), password: String(password || "") });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: data.user };
}
export async function signOutAdmin() {
  if (!supabase) return { ok: true };
  await supabase.auth.signOut();
  return { ok: true };
}
export async function getAdminSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export async function sendLineTestMessage() {
  const sb = requireSupabase();
  const { data, error } = await sb.functions.invoke("line-test-message", { body: {} });
  if (error) {
    let message = error.message;
    try {
      const payload = await error.context?.json?.();
      if (payload?.error) message = payload.error;
    } catch { /* use the invoke error */ }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || "ส่งทดสอบ LINE ไม่สำเร็จ");
  return data;
}

export function onAdminAuthChange(cb) {
  if (!supabase) return () => {};
  // Pass the event name through too - the UI needs to tell a real SIGNED_OUT
  // apart from a transient TOKEN_REFRESHED/USER_UPDATED so a token refresh
  // never bounces an admin back to the login screen mid-task.
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session || null));
  return () => data?.subscription?.unsubscribe?.();
}

const normalize = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function requireSupabase() {
  if (!supabase) throw new Error("Web build is not configured (missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).");
  return supabase;
}

// ---- Sync status: a small pub/sub the header's top-right status pill
// subscribes to (see WebApp.jsx) - there's no offline queue here to report
// on (see the file header comment), so "sync" for this build just means
// "can this browser currently reach Supabase". States:
//   connecting - initial state, before the first ping resolves
//   online     - last check reached Supabase fine
//   syncing    - a check is in flight right now
//   offline    - last check failed, or the browser itself is offline
//   unconfigured - no Supabase URL/key baked into this build at all
const syncState = { status: "connecting", lastSyncAt: null, lastError: null };
const syncListeners = new Set();
function setSyncState(patch) {
  Object.assign(syncState, patch);
  for (const fn of syncListeners) fn({ ...syncState });
}
export function subscribeSyncStatus(fn) {
  fn({ ...syncState });
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

// Cheapest possible round-trip to Supabase just to prove the connection is
// alive - reuses the same read-only app_settings access every pilot page
// already has (sql/mobile-rls-setup.sql), so no new RLS policy is needed.
export async function pingServer() {
  if (!supabase) { setSyncState({ status: "unconfigured" }); return; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setSyncState({ status: "offline", lastError: "Browser reports no internet connection" });
    return;
  }
  setSyncState({ status: "syncing" });
  try {
    const { error } = await supabase.from("Admin_app_settings").select("key").limit(1);
    if (error) throw error;
    setSyncState({ status: "online", lastSyncAt: new Date().toISOString(), lastError: null });
  } catch (err) {
    setSyncState({ status: "offline", lastError: err.message });
  }
}

// A real RFC-4122 v4 UUID. crypto.randomUUID() is unavailable on older mobile
// browsers (Safari < 15.4, some Android WebViews), so fall back to a manual
// v4 generator - it must still be a VALID uuid string because several Supabase
// columns (pilot_experience.uuid, pilot_duty_entries.uuid) are the `uuid`
// type and reject anything that isn't (a plain random string errored with
// "invalid input syntax for type uuid").
function makeId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem("avicore_web_device_id"); } catch { /* private mode */ }
  if (!id) {
    id = makeId();
    try { localStorage.setItem("avicore_web_device_id", id); } catch { /* ignore */ }
  }
  return id;
}

// "Which pilot is this browser paired to" - one pilot for every tab and page,
// with no header tap-to-switch (see WebApp.jsx).
//
// HOW LONG A PAIRING LASTS, and why it is not "until the tab closes".
//
// It used to live in sessionStorage only, so closing the browser logged the
// pilot out. That is tidy on a desk and useless on a rig: the pilot closes the
// app, has no signal, and cannot get back in - even though every page they
// need is already cached. The offline work was done and then locked behind a
// login that needs the network.
//
// So the pairing now persists, but EXPIRES. Capt. Weera chose a time limit over
// an indefinite one, which is the right call: these are shared devices, and a
// session that never ends means whoever picks the tablet up next is signed in
// as the last pilot.
//
// 24 hours covers a full offshore shift plus the trip home, and is short enough
// that a device left in a crew room is not a standing login.
export const PAIRING_TTL_HOURS = 24;
const PAIR_KEY = "avicore_web_pilot_code";
const PAIR_AT_KEY = "avicore_web_pilot_paired_at";

// Reads localStorage but honours the expiry, and CLEARS an expired pairing
// rather than just reporting it - leaving a stale code behind would let a later
// clock change or code path resurrect it.
export async function getPairedPilotCode() {
  try {
    const code = localStorage.getItem(PAIR_KEY) || "";
    if (!code) return "";

    const at = Number(localStorage.getItem(PAIR_AT_KEY));
    if (!Number.isFinite(at) || at <= 0) {
      // Paired by an older build that stored no timestamp. Treated as valid and
      // stamped now, so upgrading does not sign everyone out mid-shift.
      localStorage.setItem(PAIR_AT_KEY, String(Date.now()));
      return code;
    }

    const ageHours = (Date.now() - at) / 3600000;
    // A negative age means the clock moved backwards (timezone change, manual
    // set). Re-stamped rather than trusted, so a clock change cannot extend a
    // session indefinitely.
    if (ageHours < 0) {
      localStorage.setItem(PAIR_AT_KEY, String(Date.now()));
      return code;
    }
    if (ageHours >= PAIRING_TTL_HOURS) {
      localStorage.removeItem(PAIR_KEY);
      localStorage.removeItem(PAIR_AT_KEY);
      return "";
    }
    return code;
  } catch {
    return "";   // private mode - behave as not paired
  }
}

export async function setPairedPilotCode(code) {
  try {
    localStorage.setItem(PAIR_KEY, normalize(code));
    localStorage.setItem(PAIR_AT_KEY, String(Date.now()));
  } catch { /* private mode - pairing just will not persist */ }
}

export async function clearPairedPilotCode() {
  try {
    localStorage.removeItem(PAIR_KEY);
    localStorage.removeItem(PAIR_AT_KEY);
    // Also clear the old sessionStorage key, so a device that paired under a
    // previous build does not keep a second, invisible pairing.
    sessionStorage.removeItem(PAIR_KEY);
  } catch { /* private mode */ }
}

// Hours left on the current pairing, or null when not paired. Lets the UI say
// when the pilot will need a connection again, instead of logging them out
// without warning.
export async function getPairingHoursLeft() {
  try {
    if (!localStorage.getItem(PAIR_KEY)) return null;
    const at = Number(localStorage.getItem(PAIR_AT_KEY));
    if (!Number.isFinite(at) || at <= 0) return PAIRING_TTL_HOURS;
    const left = PAIRING_TTL_HOURS - (Date.now() - at) / 3600000;
    return Math.max(0, left);
  } catch {
    return null;
  }
}

// Used only by the pilot picker on first visit (see src/web/WebPilotLogin.jsx)
// - code/name only, matches mobileSync.js's fetchPilotRoster().
export async function fetchPilotRoster() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("Admin_pilot_experience")
    .select("code, name")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error("fetch pilot roster: " + error.message);
  return data || [];
}

async function rawAddDutyEntry(entry) {
  const sb = requireSupabase();
  const pilotCode = normalize(entry.pilotCode);
  if (!pilotCode) throw new Error("Pilot code is required");
  if (!entry.date) throw new Error("Date is required");
  const now = new Date().toISOString();
  const uuid = makeId();
  const { error } = await sb.from("Admin_pilot_duty_entries").insert({
    uuid,
    device_id: getDeviceId(),
    pilot_code: pilotCode,
    date: entry.date,
    duty_type: entry.dutyType,
    entry_json: entry,
    created_at: now,
    modified_at: now,
    deleted_at: null
  });
  if (error) throw new Error("add duty entry: " + error.message);
  return { ok: true, id: uuid };
}

// "new row violates row-level security policy" is one of the least helpful
// messages Postgres produces. Nothing is being inserted: it means the UPDATE
// was refused by RLS - and here an UPDATE is how a DELETE is done, since
// deleting is soft (set deleted_at). Because the table has an INSERT policy
// but no UPDATE policy, adding entries worked while editing and deleting were
// silently impossible, which reads as a bug in the app rather than a missing
// grant in the database. Said plainly, with the fix.
function explainRls(err, action) {
  const message = String(err?.message || err || "");
  if (/row-level security/i.test(message)) {
    return new Error(
      `${action} was refused by the database security policy. ` +
      "pilot_duty_entries is missing its UPDATE policy - run " +
      "sql/fix-duty-entry-write-rls.sql once in Supabase -> SQL Editor."
    );
  }
  return new Error(`${action}: ${message}`);
}

async function rawDeleteDutyEntry(_code, id) {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await sb
    .from("Admin_pilot_duty_entries")
    .update({ deleted_at: now, modified_at: now })
    .eq("uuid", id);
  if (error) throw explainRls(error, "Deleting this duty entry");
  return { ok: true };
}

async function rawUpdateDutyEntry(_code, id, entry) {
  const sb = requireSupabase();
  const pilotCode = normalize(entry.pilotCode);
  if (!pilotCode) throw new Error("Pilot code is required");
  if (!entry.date) throw new Error("Date is required");
  const now = new Date().toISOString();
  const { error } = await sb
    .from("Admin_pilot_duty_entries")
    .update({
      pilot_code: pilotCode,
      date: entry.date,
      duty_type: entry.dutyType,
      entry_json: entry,
      modified_at: now
    })
    .eq("uuid", id);
  if (error) throw explainRls(error, "Saving this duty entry");
  return { ok: true };
}

// Only the settings the pilot-facing pages actually read (My Status shows
// FTL Limits, header shows branding, My Training Status shows the
// company's caution thresholds and any disabled items) - same allowlist
// idea as mobileDatabase.js's MOBILE_SETTING_KEYS, kept here too so a
// stray call can't accidentally fetch something Admin-only.
// No client-side key allowlist anymore: the admin build legitimately needs
// to read every setting (Settings page), and RLS on app_settings is the
// real guard for what's readable (anon read is already granted fleet-wide;
// writes require an authenticated admin, see saveSetting + the write-RLS).
async function rawGetSetting(key) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("Admin_app_settings")
    .select("value_json")
    .eq("key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`get setting(${key}): ` + error.message);
  return data ? data.value_json : null;
}

// ---- Admin writes (authenticated only; RLS enforces it server-side) ------
// All mirror the exact table shapes mobileSync.js pushes to, so a record
// written here is identical to one the PC/Android sync would produce.
async function rawSaveSetting(key, value) {
  const sb = requireSupabase();
  // created_at is NOT NULL on this table and an UPSERT that inserts a new row
  // has to supply it. Sending it on every write is harmless: on a row that
  // already exists this is an UPDATE, and Postgres keeps the stored value for
  // any column the update doesn't change... which is NOT true here, since the
  // upsert does list it - so it is written as "when this setting was last
  // (re)created", which is what the column means to this app. Nothing reads
  // it for ordering.
  const now = new Date().toISOString();
  const { error } = await sb.from("Admin_app_settings").upsert(
    {
      key,
      value_json: value,
      // device_id is NOT NULL as well - the table was designed around the
      // PC/Android sync, where every row records which device wrote it. The
      // browser has no device, so it uses the same generated id it already
      // stamps on experience records.
      device_id: getDeviceId(),
      created_at: now,
      modified_at: now,
      deleted_at: null
    },
    { onConflict: "key" }
  );
  if (error) {
    // This one has a specific cause and a one-line fix, so say which rather
    // than passing the raw Postgres wording through: the upsert needs a
    // UNIQUE constraint on app_settings.key and the table was created
    // without one, so every settings write fails with a 400.
    if (/no unique or exclusion constraint/i.test(error.message)) {
      throw new Error(
        `save setting(${key}): the app_settings table has no UNIQUE constraint on "key", ` +
        "so nothing can be saved. Run sql/fix-app-settings-key-unique.sql once in Supabase → SQL Editor."
      );
    }
    throw new Error(`save setting(${key}): ` + error.message);
  }
  return { ok: true };
}

async function rawSaveExperience(record) {
  const sb = requireSupabase();
  const licence = record?.profile?.licence || "";
  const licenceKey = normalize(licence);
  if (!licenceKey) throw new Error("Pilot licence is required");
  const now = new Date().toISOString();
  // pilot_experience.uuid is a real `uuid` column, so it must be a valid
  // UUID - not the licence. Re-use the existing row's uuid when this licence
  // is already on file (so a re-save updates in place), otherwise mint a new
  // one. licence_key stays the human/natural key we match on.
  const { data: existing } = await sb
    .from("Admin_pilot_experience")
    .select("uuid")
    .eq("licence_key", licenceKey)
    .maybeSingle();
  const uuid = existing?.uuid || makeId();
  const { error } = await sb.from("Admin_pilot_experience").upsert({
    uuid,
    device_id: getDeviceId(),
    licence,
    licence_key: licenceKey,
    code: record?.profile?.code || "",
    name: record?.profile?.name || "",
    update_date: record?.profile?.update || null,
    record_json: record,
    created_at: now,
    modified_at: now,
    deleted_at: null
  }, { onConflict: "uuid" });
  if (error) throw new Error("save experience: " + error.message);
  return { ok: true };
}

export async function deleteExperience(query) {
  const sb = requireSupabase();
  const key = normalize(query);
  const now = new Date().toISOString();
  const { error } = await sb.from("Admin_pilot_experience")
    .update({ deleted_at: now, modified_at: now })
    .eq("licence_key", key);
  if (error) throw new Error("delete experience: " + error.message);
  return { ok: true };
}

// uuid is the table's primary key and is NOT NULL, but the natural key this
// upsert matches on is code_key. So an existing pilot's uuid has to be REUSED
// - minting a fresh one on every save would either be rejected or leave two
// rows for the same pilot. Same pattern saveExperience already uses.
async function existingTrainingUuids(sb, codeKeys) {
  const keys = [...new Set(codeKeys)].filter(Boolean);
  if (!keys.length) return new Map();
  const { data, error } = await sb
    .from("Admin_pilot_training")
    .select("code_key, uuid")
    .in("code_key", keys);
  if (error) throw new Error("look up training rows: " + error.message);
  return new Map((data || []).map((r) => [r.code_key, r.uuid]));
}

async function rawSaveTraining(code, name, record) {
  const sb = requireSupabase();
  const codeKey = normalize(code);
  if (!codeKey) throw new Error("Pilot code is required");
  const now = new Date().toISOString();
  const existing = await existingTrainingUuids(sb, [codeKey]);
  const { error } = await sb.from("Admin_pilot_training").upsert({
    uuid: existing.get(codeKey) || makeId(),
    device_id: getDeviceId(),
    // created_at is NOT NULL on these tables; an upsert that INSERTS has to
    // carry it or Postgres rejects the write. Same class of failure as
    // app_settings above - it only shows up on a brand-new row, which is why
    // it hides until the day someone adds a pilot rather than edits one.
    code_key: codeKey, code, name: name || "", record_json: record,
    created_at: now, modified_at: now, deleted_at: null
  }, { onConflict: "code_key" });
  if (error) throw new Error("save training: " + error.message);
  return { ok: true };
}

async function rawImportTrainingMany(pilots) {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const wanted = (pilots || []).map((p) => normalize(p.code)).filter(Boolean);
  const existing = await existingTrainingUuids(sb, wanted);
  const rows = (pilots || []).map((p) => {
    const codeKey = normalize(p.code);
    return {
      uuid: existing.get(codeKey) || makeId(),
      device_id: getDeviceId(),
      code_key: codeKey, code: p.code, name: p.name || "",
      record_json: p.record,
      created_at: now, modified_at: now, deleted_at: null
    };
  }).filter((r) => r.code_key);
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await sb.from("Admin_pilot_training").upsert(rows, { onConflict: "code_key" });
  if (error) throw new Error("import training: " + error.message);
  return { ok: true, count: rows.length };
}

export async function addDutyEntriesMany(code, entries) {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const pilotCode = normalize(code);
  const sourceFile = (entries || []).find((e) => e.sourceFile)?.sourceFile || null;
  // Replace-by-source-file: soft-delete any existing rows from the same
  // imported file first (same semantics as the local addDutyEntriesMany).
  if (sourceFile) await removeDutyEntriesBySourceFile(code, sourceFile);
  const rows = (entries || []).map((e) => ({
    uuid: makeId(),
    device_id: getDeviceId(),
    pilot_code: pilotCode,
    date: e.date,
    duty_type: e.dutyType,
    entry_json: e,
    created_at: now,
    modified_at: now,
    deleted_at: null
  }));
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await sb.from("Admin_pilot_duty_entries").insert(rows);
  if (error) throw new Error("import duty entries: " + error.message);
  return { ok: true, count: rows.length };
}

// Heading used for duty entries that carry no sourceFile (hand-typed in Daily
// Duty, or imported by a build old enough to predate the field). Exported so
// the Import screen and the delete path agree on the exact string.
export const MANUAL_SOURCE = "(not from a file)";

export async function removeDutyEntriesBySourceFile(code, sourceFile) {
  const sb = requireSupabase();
  const pilotCode = normalize(code);
  // The synthetic heading is not a real filename - deleting it means "every
  // entry for this pilot that has no sourceFile at all".
  const manual = sourceFile === MANUAL_SOURCE;

  // Loops until nothing matches, because a single UPDATE ... RETURNING is
  // subject to the SAME 1000-row cap as a SELECT: one pilot's file can hold
  // several thousand entries, so a single call soft-deleted the first 1000 and
  // reported success while the rest stayed live.
  //
  // That is exactly how deleted files came back: "Remove" appeared to work,
  // the file vanished from the list once its remaining rows fell under the
  // truncated read, but the leftover entries kept counting towards FT/DT.
  // A stale duty entry that no page can show is the worst kind - it inflates
  // the pilot's hours with nothing on screen to explain why.
  let removed = 0;
  for (let pass = 0; pass < 50; pass++) {
    const now = new Date().toISOString();
    let q = sb.from("Admin_pilot_duty_entries")
      .update({ deleted_at: now, modified_at: now })
      .eq("pilot_code", pilotCode)
      .is("deleted_at", null);
    q = manual
      ? q.is("entry_json->>sourceFile", null)
      : q.eq("entry_json->>sourceFile", sourceFile);
    const { data, error } = await q.select("uuid");
    if (error) throw new Error("remove duty by file: " + error.message);
    const n = (data || []).length;
    removed += n;
    if (!n) break;              // nothing left matching
  }
  return { ok: true, removed };
}

export async function listImportedFdtFiles() {
  const sb = requireSupabase();
  // Paged: this spans the WHOLE fleet, so it hit the 1000-row cap almost
  // immediately - which is why the file list showed only the first two or
  // three pilots and every later import looked as though it had not happened.
  let data;
  try {
    data = await fetchAllRows(() => sb.from("Admin_pilot_duty_entries")
      .select("pilot_code, entry_json")
      .is("deleted_at", null)
      .order("pilot_code", { ascending: true }));
  } catch (error) {
    throw new Error("list imported files: " + error.message);
  }
  const groups = new Map();
  for (const r of data || []) {
    const e = r.entry_json || {};
    // Entries with NO sourceFile are still listed, under a synthetic
    // "(not from a file)" heading.
    //
    // They used to be skipped outright, which made them undeletable from this
    // page and invisible everywhere except the totals: they went on counting
    // towards FT/DT and the Fatigue Monitor while the file list insisted the
    // pilot's data had been removed. Anything holding duty hours has to be
    // visible somewhere it can be removed.
    const sourceFile = e.sourceFile || MANUAL_SOURCE;
    const gkey = `${r.pilot_code} ${sourceFile}`;
    if (!groups.has(gkey)) groups.set(gkey, { code: r.pilot_code, filename: sourceFile, manual: !e.sourceFile, flightCount: 0, nonFlightCount: 0, aircraftType: "", importedAt: null });
    const g = groups.get(gkey);
    if (e.dutyType === "flight") { g.flightCount++; if (!g.aircraftType && e.aircraftType) g.aircraftType = e.aircraftType; }
    else g.nonFlightCount++;
  }
  return [...groups.values()];
}

async function rawListRoster(query) {
  const sb = requireSupabase();
  const { from, to } = query || {};
  // Paged: the roster is one row per pilot per DAY, so ~20 pilots over a year
  // is ~7300 rows. The training planner reads 12-24 months at a stretch; an
  // unpaged read would return the first 1000 and the planner would treat every
  // unseen day as "not a duty day", silently refusing to book training.
  const data = await fetchAllRows(() => {
    let q = sb.from("Admin_pilot_roster").select("pilot_code, pilot_name, base, date, code").is("deleted_at", null);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    return q.order("date", { ascending: true });
  }).catch((error) => { throw new Error("list roster: " + error.message); });
  return data || [];
}

async function rawListRosterPilots() {
  const sb = requireSupabase();
  // Paged: same table, same row count - and this one builds the PILOT LIST, so
  // truncation drops whole pilots off the roster board.
  const data = await fetchAllRows(() => sb
    .from("Admin_pilot_roster").select("pilot_code, pilot_name, base")
    .is("deleted_at", null)
    .order("pilot_code", { ascending: true })
  ).catch((error) => { throw new Error("list roster pilots: " + error.message); });
  const byCode = new Map();
  for (const r of data || []) byCode.set(r.pilot_code, { pilot_code: r.pilot_code, pilot_name: r.pilot_name, base: r.base });
  return [...byCode.values()];
}

async function rawImportRosterMany(entries) {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const rows = (entries || []).map((e) => {
    const pilotCode = String(e.pilotCode ?? e.pilot_code ?? "").toUpperCase();
    const date = e.date;
    if (!pilotCode || !date) return null;
    return {
      uuid: `${pilotCode}_${date}`,
      device_id: getDeviceId(),
      pilot_code: pilotCode,
      pilot_name: e.pilotName ?? e.pilot_name ?? "",
      base: e.base ?? "",
      date,
      code: e.code ?? "",
      created_at: now,
      modified_at: now,
      deleted_at: null
    };
  }).filter(Boolean);
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await sb.from("Admin_pilot_roster").upsert(rows, { onConflict: "uuid" });
  if (error) throw new Error("import roster: " + error.message);
  return { ok: true, count: rows.length };
}

async function rawDeleteRosterEntry(query) {
  const sb = requireSupabase();
  const { pilotCode, date } = query || {};
  const now = new Date().toISOString();
  const { error } = await sb.from("Admin_pilot_roster")
    .update({ deleted_at: now, modified_at: now })
    .eq("uuid", `${String(pilotCode || "").toUpperCase()}_${date}`);
  if (error) throw new Error("delete roster entry: " + error.message);
  return { ok: true };
}

// ---- Weekly Schedule plan (sql/weekly-plan-setup.sql) --------------------
// One row per (date, section, slot) cell - see the long comment in that SQL
// file for the shape. uuid encodes the cell coordinates, so re-importing the
// same spreadsheet overwrites in place rather than duplicating, exactly like
// pilot_roster does with (pilot_code, date).

function weeklyPlanUuid(date, section, slot) {
  return `${date}_${section}_${slot}`;
}

async function rawListWeeklyPlan(query) {
  const sb = requireSupabase();
  const { from, to } = query || {};
  // Paged: several rows per date (one per section/slot), so a multi-week
  // range crosses 1000 quickly and would drop the tail of the plan.
  const data = await fetchAllRows(() => {
    let q = sb.from("Admin_pilot_weekly_plan")
      .select("date, section, slot, pilot_code, level, note")
      .is("deleted_at", null);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    return q.order("date", { ascending: true });
  }).catch((error) => { throw new Error("list weekly plan: " + error.message); });
  return data || [];
}

// Upserts a batch of cells. A cell with no pilot code is a DELETION (the
// planner cleared it), which is soft-deleted rather than removed so the row
// still syncs the change out to other devices instead of silently
// reappearing from a stale copy.
async function rawSaveWeeklyPlanMany(cells) {
  const sb = requireSupabase();
  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const rows = (cells || []).map((c) => {
    const date = c.date;
    const section = c.section;
    const slot = Number(c.slot) || 0;
    if (!date || !section) return null;
    const code = String(c.pilotCode ?? c.pilot_code ?? "").trim().toUpperCase();
    return {
      uuid: weeklyPlanUuid(date, section, slot),
      device_id: deviceId,
      date,
      section,
      slot,
      pilot_code: code || null,
      level: c.level ?? null,
      note: c.note ?? null,
      created_at: now,
      modified_at: now,
      deleted_at: code ? null : now
    };
  }).filter(Boolean);
  if (!rows.length) return { ok: true, count: 0 };
  const { error } = await sb.from("Admin_pilot_weekly_plan").upsert(rows, { onConflict: "uuid" });
  if (error) throw new Error("save weekly plan: " + error.message);
  return { ok: true, count: rows.length };
}

// Clears a whole date range - used by the importer's "replace this period"
// option, so a re-import of a re-planned week doesn't leave behind cells
// that were deleted in the spreadsheet.
export async function clearWeeklyPlanRange(query) {
  const sb = requireSupabase();
  const { from, to } = query || {};
  if (!from || !to) return { ok: true };
  const now = new Date().toISOString();
  const { error } = await sb.from("Admin_pilot_weekly_plan")
    .update({ deleted_at: now, modified_at: now })
    .gte("date", from).lte("date", to).is("deleted_at", null);
  if (error) throw new Error("clear weekly plan: " + error.message);
  return { ok: true };
}

// ---- Pilot Experience (for MyExperience.jsx) ---------------------------
// List all pilots' experience records (for dropdown in MyExperience)
// Supabase table: pilot_experience
async function rawListExperience() {
  const sb = requireSupabase();

  // ONLY REAL COLUMNS HERE. Rank is not one: it lives inside the record, at
  // record_json->profile->>position. Asking for a bare `position` made
  // PostgREST reject the WHOLE query with "column does not exist", and every
  // pilot disappeared from every page in the app - the pilot list, All Status,
  // FDT, the roster, the weekly plan - while the records sat untouched in the
  // database.
  //
  // The lesson is not "use the right JSON path" but "this query must not be
  // able to fail". It is the one read the entire app depends on, so it asks
  // for the least it possibly can. Rank is fetched separately, below, where a
  // failure costs a label rather than the whole fleet.
  const { data, error } = await sb
    .from("Admin_pilot_experience")
    .select("code, name, licence, update_date, modified_at")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("listExperience:", error.message);
    throw new Error(`Couldn't read the pilot list: ${error.message}`);
  }

  const pilots = (data || []).map((r) => ({
    code: r.code,
    name: r.name,
    licence: r.licence,
    position: "",
    update_date: r.update_date,
    modified_at: r.modified_at
  }));

  // Rank, best-effort. Wrapped so that ANY failure here - a JSON path this
  // PostgREST version won't parse, a permissions change, a network blip -
  // leaves the pilots on screen without their rank, instead of leaving the
  // screen empty.
  try {
    const byCode = await listExperiencePositions();
    for (const p of pilots) {
      const rank = byCode.get(String(p.code || "").toUpperCase());
      if (rank) p.position = rank;
    }
  } catch (err) {
    console.warn("listExperience: rank unavailable —", err.message);
  }

  return pilots;
}

// Pilot code -> "Captain" / "FO" / ..., read out of the record's JSON without
// downloading the record itself (record_json carries base64 photos and runs to
// hundreds of KB per pilot).
export async function listExperiencePositions() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("Admin_pilot_experience")
    .select("code, position:record_json->profile->>position")
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const r of data || []) {
    const code = String(r.code || "").toUpperCase();
    if (code && r.position) map.set(code, r.position);
  }
  return map;
}

// List all duty entries for a specific pilot (by code)
// entry_json is a jsonb column, so Supabase hands it back already parsed -
// but a record written by an older client (or by the PC sync, which stores
// text) can still arrive as a string. Accept both rather than assuming.
function parseEntryJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

// Load one pilot's full experience record by licence number
// Supabase table: pilot_experience
async function rawLoadExperience(licence) {
  const sb = requireSupabase();
  if (!licence) return null;
  try {
    // Matched on licence_key, the normalised form saveExperience() writes -
    // not on the raw `licence` text. "TH.FCL.00005088" and "TH FCL 00005088"
    // are the same licence and must find the same record; matching the raw
    // string means a stray dot or space silently finds nothing.
    const { data, error } = await sb
      .from("Admin_pilot_experience")
      .select("*")
      .eq("licence_key", normalize(licence))
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw new Error("load experience: " + error.message);
    if (!data) return null;

    // Return what the PC app returns: the RECORD, not the row wrapping it.
    // The row is just an envelope - the pilot's actual data (profile,
    // experienceBase, all the aircraft tables) lives in record_json, and
    // every page reads record.profile.* / record.experienceBase.*.
    //
    // Handing back the raw row instead gave those pages an object with no
    // .profile at all, so the Experience Builder opened completely blank for
    // every pilot - looking exactly like a pilot with no data on file. Same
    // mistake, same shape, as the duty entries above.
    const record = parseEntryJson(data.record_json);
    if (record && Object.keys(record).length) return record;

    // Nothing in record_json (an old or partially-synced row): rebuild the
    // minimum from the columns rather than returning an empty screen.
    return {
      profile: {
        code: data.code || "",
        name: data.name || "",
        licence: data.licence || "",
        update: data.update_date || ""
      },
      experienceBase: {}
    };
  } catch (err) {
    console.error("loadExperience:", err.message);
    showDataErrorBanner(`Experience record could not be READ (it is not deleted): ${err.message}`);
    return null;
  }
}

// Read EVERY row a query matches, not just the first page.
//
// PostgREST (and therefore Supabase) caps an unbounded select at 1000 rows and
// returns the first 1000 SILENTLY - no error, no flag, just a short array. On
// a duty table that is catastrophic and invisible at the same time: one pilot
// alone can hold 779 entries, so any query spanning the fleet is truncated
// long before it has seen everyone, and the pages downstream cannot tell a
// truncated read from a pilot who simply has not flown.
//
// This is what made "Files in the system" show only 2-3 files, and it would
// have started silently under-reporting FT/DT for any pilot who passed 1000
// entries - i.e. quietly showing a pilot as legal when they were not.
//
// Pages through in blocks with .range() until a short page says it is done.
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}

// Supabase table: pilot_duty_entries
async function rawListDutyEntriesByPilot(pilotCode) {
  const sb = requireSupabase();
  if (!pilotCode) return [];
  try {
    // Only what is actually used. "*" also dragged down device_id,
    // created_at/modified_at/deleted_at and synced_at for every row of every
    // pilot - pure weight on a query that was already timing out.
    //
    // The key here is `uuid`, NOT `id`: this table is Postgres, and the `id`
    // column belongs to the PC build's SQLite schema. The two stores hold the
    // same records under different keys, and naming one while reading the
    // other fails the whole query.
    // Paged: a pilot past 1000 entries would otherwise lose the overflow
    // silently, under-reporting their own FT/DT.
    let data;
    try {
      data = await fetchAllRows(() => sb
        .from("Admin_pilot_duty_entries")
        .select("uuid, pilot_code, date, duty_type, entry_json")
        .eq("pilot_code", pilotCode)
        .is("deleted_at", null)
        .order("date", { ascending: false }));
    } catch (error) {
      throw new Error("list duty entries: " + error.message);
    }

    // Return exactly what the PC app returns. The row in the table is only a
    // wrapper: the duty itself lives in entry_json, and the PC handler does
    //     rows.map((r) => ({ id: r.id, ...JSON.parse(r.entry_json) }))
    // so every page downstream expects the ENTRY's own field names -
    // dutyType, start, end, endDate, blocks... The web build was handing back
    // the raw row instead, whose columns are duty_type, entry_json and so on.
    //
    // Nothing errored. The rows were all there. Every FDT calculation just
    // read e.dutyType, found undefined, and quietly produced nothing - which
    // on screen is indistinguishable from a pilot who has never flown.
    return (data || []).map((row) => {
      const entry = parseEntryJson(row.entry_json);
      return {
        // Pages edit and delete by `id`, which on the web IS the uuid (see
        // addDutyEntry, which returns uuid as the id). Both are exposed so
        // either name works.
        id: row.uuid,
        uuid: row.uuid,
        // The entry's own fields win; the row's columns are the fallback for
        // anything an older record didn't carry inside the JSON.
        pilotCode: row.pilot_code,
        date: row.date,
        dutyType: row.duty_type,
        ...entry
      };
    });
  } catch (err) {
    // Same rule as the pilot list: an unreadable table must not be shown as
    // an empty one. FDT going blank is indistinguishable from "this pilot has
    // flown nothing", which is a very different and much more alarming thing.
    console.error("listDutyEntriesByPilot:", err.message);
    showDataErrorBanner(`Duty records for ${pilotCode} could not be READ (they are not deleted): ${err.message}`);
    return [];
  }
}

// Export logbook/experience as PDF
// Web: print-to-PDF via browser dialog (user saves manually)
// Electron: handled by IPC to Electron main process
// Mobile: handled by Capacitor
export async function exportLogbookPdf(suggestedName) {
  try {
    const filename = suggestedName || "logbook.pdf";

    // NOTE: an html2pdf branch used to sit here and was REMOVED.
    //
    // It was dead code - html2pdf is not bundled or loaded anywhere, so
    // `window.html2pdf` was never set and the branch never ran. Worse, it was
    // hardcoded to `orientation: "portrait"` and to a stale
    // ".mylogbook-print-area" selector, so if it ever HAD run it would have
    // produced a portrait PDF of the wrong element. Keeping a never-executed
    // alternative implementation of the same feature only invites edits to the
    // copy that does nothing.

    // Build a real PDF and download it under the requested name.
    //
    // This used to call window.print() and hope. It cannot work: the print
    // dialog's filename comes from the name Chrome derived when the page
    // loaded, and three attempts to override it via document.title all failed.
    // A generated download is ours to name, so that is what this does now.
    //
    // The element is whichever print area the calling page renders; falling
    // back to <body> keeps a page without one from silently exporting nothing.
    // Which print area belongs to the page that asked. Ordered most-specific
    // first; <body> only as a last resort so a page without one still exports
    // something rather than silently nothing.
    const experience = document.querySelector(".myexp-print-area");
    const element =
      document.querySelector(".logbook-print-area") ||
      experience ||
      document.querySelector(".dashboard-print-area") ||
      document.querySelector(".allstatus-print-area") ||
      document.body;

    // An experience summary is a ONE-SHEET document - split over two pages the
    // signature block lands on a page with nothing above it to sign for. The
    // logbook is the opposite: a 12-month extract is inherently many pages and
    // must be sliced, never shrunk to fit.
    return downloadElementAsPdf(element, filename, {
      landscape: true,
      fitToPage: element === experience
    });
  } catch (err) {
    console.error("exportLogbookPdf:", err.message);
    return { ok: false, error: `Export failed: ${err.message}` };
  }
}

// Read-only: one pilot's own training/certificate record for the "My
// Training Status" tab (see sql/web-training-readonly-rls.sql for the RLS
// policy this needs - Training data entry/import stays PC/Admin-only, this
// is view-only). Shape matches Electron's training:list rows
// ({ code, name, record }) so the same computeTrainingRow()/
// TrainingItemCell rendering code works unchanged.
async function rawGetMyTraining(code) {
  const sb = requireSupabase();
  const key = normalize(code);
  if (!key) return null;
  const { data, error } = await sb
    .from("Admin_pilot_training")
    .select("code, name, record_json")
    .eq("code_key", key)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("get training: " + error.message);
  return data ? { code: data.code, name: data.name, record: data.record_json } : null;
}

// Read-only: EVERY pilot's training/certificate record - used by the
// Enterprise Web admin build's Training Monitor and Dashboard (both view
// only; training data entry/import stays PC/Admin-only). Same row shape as
// getMyTraining above and Electron's training:list ({ code, name, record })
// so computeTrainingRow()/the monitor tables render unchanged. Needs the
// pilot_training table readable by anon (see sql/web-training-readonly-rls.sql).
async function rawListTraining() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("Admin_pilot_training")
    .select("code, name, record_json")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw new Error("list training: " + error.message);
  return (data || []).map((r) => ({ code: r.code, name: r.name, record: r.record_json }));
}

// ---- Crew login tracking -------------------------------------------------
// The Crew web app records one row here each time a pilot picks their name
// and confirms "This is me" on the login screen (see WebPilotLogin.jsx). The
// Enterprise Web admin's Utility tab reads them back to monitor who opened
// Crew and when. RLS: anon may INSERT (Crew logs its own open) but NOT read;
// only an authenticated admin may SELECT (see sql/crew-login-tracking.sql).
export async function recordCrewLogin(code, name) {
  if (!supabase) return { ok: false };
  try {
    const { error } = await supabase.from("Admin_crew_login_events").insert({
      pilot_code: normalize(code),
      pilot_name: name || "",
      device_id: getDeviceId(),
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      logged_in_at: new Date().toISOString()
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    // Never let a logging failure block the pilot from getting into the app.
    return { ok: false, error: e.message };
  }
}

export async function listCrewLogins(limit = 300) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("Admin_crew_login_events")
    .select("id, pilot_code, pilot_name, device_id, user_agent, logged_in_at")
    .order("logged_in_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("list crew logins: " + error.message);
  return data || [];
}

// Delete selected login rows (admin only - authenticated delete RLS).
export async function deleteCrewLogins(ids) {
  const sb = requireSupabase();
  const list = (ids || []).filter((v) => v != null);
  if (!list.length) return { ok: true, removed: 0 };
  const { error } = await sb.from("Admin_crew_login_events").delete().in("id", list);
  if (error) throw new Error("delete crew logins: " + error.message);
  return { ok: true, removed: list.length };
}

// Delete the ENTIRE login log. Supabase blocks an unfiltered delete, so the
// `neq id, -1` matches every row (identity ids are always >= 1).
export async function clearAllCrewLogins() {
  const sb = requireSupabase();
  const { error } = await sb.from("Admin_crew_login_events").delete().neq("id", -1);
  if (error) throw new Error("clear crew logins: " + error.message);
  return { ok: true };
}

// ---- Per-pilot Crew passwords (server-side RPC, see sql/crew-pilot-passwords.sql)
// The bcrypt hash never leaves Postgres - these just call the SECURITY
// DEFINER functions. normalize() matches the code-normalisation the SQL does.
export async function pilotHasPassword(code) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("pilot_has_password", { p_code: normalize(code) });
  if (error) throw new Error("check pilot password: " + error.message);
  return !!data;
}

export async function verifyPilotPassword(code, password) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("verify_pilot_password", { p_code: normalize(code), p_password: String(password || "") });
  if (error) throw new Error("verify pilot password: " + error.message);
  return !!data;
}

// Admin only (authenticated) - set or reset a pilot's Crew password.
export async function setPilotPassword(code, password) {
  const sb = requireSupabase();
  const { error } = await sb.rpc("set_pilot_password", { p_code: normalize(code), p_password: String(password || "") });
  if (error) throw new Error("set pilot password: " + error.message);
  return { ok: true };
}

// Admin only - which pilots currently have a password (code -> updated_at).
export async function listPilotPasswordStatus() {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("list_pilot_password_status");
  if (error) throw new Error("list pilot password status: " + error.message);
  const map = {};
  for (const r of data || []) map[normalize(r.pilot_code)] = r.updated_at;
  return map;
}

export function isConfigured() {
  return !!supabase;
}

// ---- Offline-capable exports --------------------------------------------
// Everything above talks to Supabase directly and knows nothing about being
// offline. The wrappers below add that, in one place, identically for every
// table (see offlineWrap.js):
//
//   reads  - served from the last cached copy when the connection is down
//   writes - queued and sent later when the connection is down
//
// The `kind` strings are part of the stored format: a write queued by today's
// build is replayed by whatever build is installed when the connection comes
// back, so renaming one would strand it. They must not change.

export const getSetting = cacheableRead((key) => `setting:${key}`, rawGetSetting);
export const listExperience = cacheableRead("experience:list", rawListExperience);
export const loadExperience = cacheableRead((licence) => `experience:${normalize(licence)}`, rawLoadExperience);
export const listDutyEntriesByPilot = cacheableRead((code) => `duty:${normalize(code)}`, rawListDutyEntriesByPilot);
export const listRoster = cacheableRead((q) => `roster:${q?.from || ""}:${q?.to || ""}`, rawListRoster);
export const listRosterPilots = cacheableRead("roster:pilots", rawListRosterPilots);
export const listWeeklyPlan = cacheableRead((q) => `weekly:${q?.from || ""}:${q?.to || ""}`, rawListWeeklyPlan);
export const listTraining = cacheableRead("training:list", rawListTraining);
// The pilot's OWN training record. This was the one Crew page read that was
// not cached, so Training Monitor was the only tab that went blank without a
// connection while every other tab kept working - and it is the tab a pilot
// checks before accepting a duty, to see whether a licence or medical has
// expired. Read-only, so there is nothing to queue: caching it is all that is
// needed for the page to work on a rig.
export const getMyTraining = cacheableRead((code) => `mytraining:${normalize(code)}`, rawGetMyTraining);

export const addDutyEntry = queueableWrite(
  "addDutyEntry", rawAddDutyEntry,
  (entry) => `Duty ${entry?.date || ""} — ${entry?.pilotCode || ""}`
);
export const updateDutyEntry = queueableWrite(
  "updateDutyEntry", rawUpdateDutyEntry,
  (_code, _id, entry) => `Edit duty ${entry?.date || ""} — ${entry?.pilotCode || ""}`
);
export const deleteDutyEntry = queueableWrite(
  "deleteDutyEntry", rawDeleteDutyEntry,
  (code) => `Delete duty — ${code || ""}`
);

// The two SHARED documents - roster and weekly plan - are also editable
// offline, but they are not simply replayed. Each queued edit carries what the
// cell held when it was made, and on reconnect every cell is compared against
// the server before anything is written (offlineMerge.js):
//
//   nobody else touched it        -> sent, no questions
//   someone made the same change  -> nothing to do
//   someone set it to something else -> held, and put in front of the admin
//                                       with all three values named
//
// That is the difference between "my edits win" and "I can see what I would be
// overwriting". Only the genuine clashes ever interrupt anyone.
export const importRosterMany = queueableWrite(
  "importRosterMany", rawImportRosterMany,
  (entries) => `Roster — ${(entries || []).length} วัน`,
  { document: "roster" }
);
export const deleteRosterEntry = queueableWrite(
  "deleteRosterEntry", rawDeleteRosterEntry,
  (q) => `ลบ roster ${q?.date || ""} — ${q?.pilotCode || ""}`,
  { document: "roster" }
);
export const saveWeeklyPlanMany = queueableWrite(
  "saveWeeklyPlanMany", rawSaveWeeklyPlanMany,
  (cells) => `Weekly plan — ${(cells || []).length} ช่อง`,
  { document: "weekly" }
);

// EVERYTHING ELSE STAYS ONLINE-ONLY, on purpose.
//
// Offline writing was asked for because a pilot on a rig has no signal and
// still has to log the flight he just made (Capt. Weera: "ส่วนมาก เอาแค่นักบิน
// กรอกข้อมูลพอครับ"). That is one person recording his own facts - nobody
// else can produce a conflicting version of them, so queuing is safe.
//
// The admin work is the opposite. A roster or a weekly plan is one shared
// document that several people read and act on; a training record is edited by
// whoever is at a desk. Queuing those would mean a plan silently rewritten
// hours later, on top of decisions other people had already taken from the
// version they could see. Admins work with a connection, so the honest
// behaviour when it drops is to say so immediately and let them retry - not
// to accept the change and apply it when nobody is looking.
export {
  rawSaveTraining as saveTraining,
  rawImportTrainingMany as importTrainingMany,
  rawSaveExperience as saveExperience,
  rawSaveSetting as saveSetting
};

// ---- Full server backup / restore ----------------------------------------
//
// Wrapped here rather than handing the Supabase client to the UI: only this
// module is supposed to know how to reach the database, and a backup screen
// holding a live client is one refactor away from writing to it directly.
//
// Online-only by definition - a backup of the server has to talk to the server,
// and a restore must never be queued and replayed later.
export async function downloadServerBackup(onProgress) {
  const { createBackup } = await import("./serverBackup.js");
  return createBackup(requireSupabase(), onProgress);
}

export async function uploadServerBackup(data, onProgress) {
  const { restoreBackup } = await import("./serverBackup.js");
  return restoreBackup(requireSupabase(), data, onProgress);
}

// Current server values for exactly the cells an offline edit touched, so the
// queue can tell "nobody touched this" from "someone else changed it".
// Registered here because only this module knows the tables.
registerCurrentReader(async (document, keys) => {
  const sb = requireSupabase();

  if (document === "roster") {
    const dates = [...new Set(keys.map((k) => k.split("|")[1]).filter(Boolean))];
    if (!dates.length) return new Map();
    // Paged: this is the CONFLICT check before a write. A truncated read here
    // would report "no conflict" for rows it never saw, letting one planner
    // silently overwrite another's edits.
    const data = await fetchAllRows(() => sb
      .from("Admin_pilot_roster")
      .select("pilot_code, date, code")
      .in("date", dates)
      .is("deleted_at", null)
      .order("date", { ascending: true }));
    const map = new Map();
    for (const r of data || []) map.set(`${String(r.pilot_code).toUpperCase()}|${r.date}`, r.code || "");
    // A key with no row means the cell is empty, not unknown.
    for (const k of keys) if (!map.has(k)) map.set(k, "");
    return map;
  }

  if (document === "weekly") {
    const dates = [...new Set(keys.map((k) => k.split("|")[0]).filter(Boolean))];
    if (!dates.length) return new Map();
    // Paged: same conflict-check reasoning as the roster branch above.
    const data = await fetchAllRows(() => sb
      .from("Admin_pilot_weekly_plan")
      .select("date, section, slot, pilot_code")
      .in("date", dates)
      .is("deleted_at", null)
      .order("date", { ascending: true }));
    const map = new Map();
    for (const r of data || []) map.set(`${r.date}|${r.section}|${r.slot}`, String(r.pilot_code || "").toUpperCase());
    for (const k of keys) if (!map.has(k)) map.set(k, "");
    return map;
  }

  return new Map();
});
