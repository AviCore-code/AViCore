// Daily FTL + Training alert email, sent from the SERVER.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// The original checker is scripts/alertCheck.mjs, run by Windows Task Scheduler
// on the office PC against the local SQLite file. It works, but it is silent
// whenever that PC is off - a licence expiring over a weekend, or in the week
// after the machine is reinstalled, is never reported. For a CAAT-facing figure
// that is the wrong failure mode: everyone assumes the system is watching.
//
// This runs on Supabase instead, on a schedule, reading the same central data
// the web apps use. No PC needs to be on.
//
// ---------------------------------------------------------------------------
// SHARED LOGIC, NOT A SECOND COPY
// ---------------------------------------------------------------------------
//
// The FTL and Training calculations are imported from the very same modules the
// app screens use (statusCompute.js, trainingDue.js, ftlLimits.js). That is
// deliberate: the moment this file re-implements "is this pilot over the limit",
// the email and the Dashboard can disagree, and nobody can tell which is right.
// Those modules are dependency-free ES modules, so Deno runs them unchanged.
//
// ---------------------------------------------------------------------------
// DEDUPLICATION
// ---------------------------------------------------------------------------
//
// Uses the SAME `email_notified_warnings` app_settings row as the PC checker and
// the Dashboard. So during the changeover, whichever runs first claims a
// warning and the other will not re-send it. Once the PC task is switched off,
// this owns the row alone.
//
// ---------------------------------------------------------------------------
// DEPLOY
// ---------------------------------------------------------------------------
//
//   supabase functions deploy daily-alerts --no-verify-jwt
//
// Secrets it needs (set once, never committed):
//   RESEND_API_KEY     from resend.com
//   ALERT_FROM         e.g. "AviCore <onboarding@resend.dev>"
//   ALERT_REPLY_TO     wjuntaklud@gmail.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
//
// Schedule (05:00 Asia/Bangkok = 22:00 UTC the previous day) via pg_cron - see
// supabase/functions/daily-alerts/schedule.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStats, overallStatus, buildRecommendations, STATUS_LABEL } from "../../../src/utils/statusCompute.js";
import { checkRecoveryRest168 } from "../../../src/utils/dutyPeriods.js";
import { withFtlDefaults } from "../../../src/utils/ftlLimits.js";
import {
  withTrainingThresholdDefaults,
  withTrainingDisabledDefaults,
  withCustomTrainingItems,
  buildTrainingRecommendations
} from "../../../src/utils/trainingDue.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_FROM = Deno.env.get("ALERT_FROM") || "AviCore <onboarding@resend.dev>";
const ALERT_REPLY_TO = Deno.env.get("ALERT_REPLY_TO") || "";
// Which company this job checks. Same idea as the Crew web build's
// VITE_COMPANY_SLUG (see webDatabase.js's crewCompanyId()) - this function
// runs with the service_role key, which bypasses RLS entirely, so unlike the
// app it is NOT automatically scoped to one company by the database. Without
// this, on a database with more than one customer it would read every
// company's pilots into one email and upsert settings with no company_id,
// which the (company_id, key) unique index then rejects outright (see the
// onConflict fix below). Set once as an Edge Function secret; defaults to
// "uoa" since that is the only customer today.
const COMPANY_SLUG = Deno.env.get("COMPANY_SLUG") || "uoa";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function currentCompanyId(): Promise<string> {
  const { data, error } = await sb
    .from("companies").select("id").eq("slug", COMPANY_SLUG).maybeSingle();
  if (error) throw new Error(`look up company(${COMPANY_SLUG}): ${error.message}`);
  if (!data) throw new Error(`No company found with slug "${COMPANY_SLUG}" - check the COMPANY_SLUG secret.`);
  return data.id;
}

// PostgREST caps an unbounded select at 1000 rows and reports NO error - the
// same trap that once made the Import FDT list show only two files. A fleet's
// duty history is far past 1000, so every read here pages explicitly.
async function readAll(table: string, columns: string, companyId: string, filter?: (q: any) => any) {
  const PAGE = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).eq("company_id", companyId).is("deleted_at", null).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function getSetting(key: string, companyId: string) {
  const { data, error } = await sb
    .from("Admin_app_settings").select("value_json").eq("key", key).eq("company_id", companyId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`get setting(${key}): ${error.message}`);
  return data ? data.value_json : null;
}

// device_id used for every row this function writes. app_settings was
// designed around the PC/Android sync, where every row records which device
// wrote it, so the column is NOT NULL - webDatabase.js's rawSaveSetting()
// uses a generated browser device id for the same reason (see its comment).
// This function has no device, so it uses one fixed, recognisable id instead
// of a fresh random one per call - a real device id would suggest a physical
// machine wrote these, which would be misleading in the sync history.
const DEVICE_ID = "supabase-daily-alerts";

async function saveSetting(key: string, value: unknown, companyId: string) {
  const now = new Date().toISOString();
  const { error } = await sb
    .from("Admin_app_settings")
    // created_at and device_id are both NOT NULL on this table, and an
    // UPSERT that INSERTS (first time this key is saved) has to supply both
    // or Postgres rejects the write - the same failure webDatabase.js's
    // rawSaveSetting() documents. On an UPDATE (row already exists),
    // created_at is simply overwritten with "now", which is harmless: nothing
    // reads it for ordering, only modified_at is used for that.
    .upsert(
      { key, value_json: value, company_id: companyId, device_id: DEVICE_ID, created_at: now, modified_at: now },
      // Matches the real unique index, (company_id, key) - not "key" alone.
      // See sql/fix-app-settings-company-key.sql for why: a global unique
      // constraint on key alone would make two companies' settings collide.
      { onConflict: "company_id,key" }
    );
  if (error) throw new Error(`save setting(${key}): ${error.message}`);
}

async function sendEmail(to: string[], subject: string, text: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const body: Record<string, unknown> = { from: ALERT_FROM, to, subject, text };
  // Replies go to a real person rather than the no-reply sending address.
  if (ALERT_REPLY_TO) body.reply_to = ALERT_REPLY_TO;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function run(opts: { forceSend?: boolean } = {}) {
  // Every read/write below is scoped to this one company - resolved once,
  // up front, from COMPANY_SLUG. See the comment on COMPANY_SLUG above for
  // why: this function runs as service_role, which is not auto-scoped by RLS
  // the way the logged-in app is.
  const companyId = await currentCompanyId();

  // --- who to tell -------------------------------------------------------
  const cfg = (await getSetting("alert_email_config", companyId)) || {};
  if (!cfg.enabled) {
    log("Alerts are switched off in Settings - nothing to do.");
    return { ok: true, skipped: "disabled" };
  }
  const recipients = String(cfg.toAddress || "")
    .split(",").map((s: string) => s.trim()).filter(Boolean).slice(0, 10);
  if (!recipients.length) {
    log("No recipients configured - nothing to do.");
    return { ok: true, skipped: "no-recipients" };
  }

  // --- read the fleet ----------------------------------------------------
  // pilot_experience: code/name/licence ONLY, not record_json. The FTL
  // pipeline (buildRecommendations et al, see statusCompute.js) never reads
  // anything else off the pilot object - but record_json can carry a base64
  // photo per pilot (webDatabase.js's own comment on this table says so), and
  // pulling that for the WHOLE fleet in one request inside this function's
  // small Edge Function isolate is what caused
  // "WORKER_RESOURCE_LIMIT: not having enough compute resources". The app
  // avoids this the same way (see rawListExperience()'s comment: "ONLY REAL
  // COLUMNS HERE").
  // pilot_training's record_json is small (just due-dates per course, no
  // photos) and IS needed in full, so that one is left as-is.
  const [experience, duty, training] = await Promise.all([
    readAll("Admin_pilot_experience", "code, name, licence", companyId),
    readAll("Admin_pilot_duty_entries", "pilot_code, entry_json", companyId),
    readAll("Admin_pilot_training", "code, name, record_json", companyId)
  ]);

  const [limits, thresholds, disabledItems, customItems] = await Promise.all([
    getSetting("ftl_limits", companyId).then(withFtlDefaults),
    getSetting("training_thresholds", companyId).then(withTrainingThresholdDefaults),
    getSetting("training_disabled_items", companyId).then(withTrainingDisabledDefaults),
    getSetting("training_custom_items", companyId).then(withCustomTrainingItems)
  ]);

  // Duty entries grouped per pilot, matching what computeStats expects.
  const byPilot = new Map<string, any[]>();
  for (const row of duty) {
    const code = String(row.pilot_code || "").toUpperCase();
    if (!byPilot.has(code)) byPilot.set(code, []);
    byPilot.get(code)!.push(row.entry_json);
  }

  // --- FTL ---------------------------------------------------------------
  const ftlRecs: any[] = [];
  for (const p of experience) {
    const pilot = { code: p.code, name: p.name, licence: p.licence };
    const entries = byPilot.get(String(p.code || "").toUpperCase()) || [];
    const stats = computeStats(entries, limits);
    const recoveryRest = checkRecoveryRest168(entries, limits);
    const status = overallStatus(stats, limits, recoveryRest.status);
    ftlRecs.push(...buildRecommendations({ pilot, entries, stats, recoveryRest, status }, limits));
  }

  // --- Training ----------------------------------------------------------
  const trainingRecs: any[] = [];
  for (const t of training) {
    trainingRecs.push(...buildTrainingRecommendations(
      { code: t.code, name: t.name, record: t.record_json },
      thresholds, disabledItems, new Date(), customItems
    ));
  }

  const rank: Record<string, number> = { exc: 0, warn: 1 };
  const all = [...ftlRecs, ...trainingRecs].filter((r) => r.status === "warn").sort((a, b) => rank[a.status] - rank[b.status]);
  log(`Checked ${experience.length} pilot(s) + ${training.length} training record(s) - ${all.length} active warning(s).`);

  // Written on every run regardless of whether mail goes out, so the
  // Dashboard's "Alert System Status" can tell "the checker is alive" apart
  // from "nothing new to report".
  await saveSetting("last_check_at", new Date().toISOString(), companyId);

  // --- only what is NEW --------------------------------------------------
  const notifiedRaw = await getSetting("email_notified_warnings", companyId);
  const notified = new Set(Array.isArray(notifiedRaw) ? notifiedRaw : []);
  const currentKeys = all.map((r) => r.key);
  const fresh = all.filter((r) => !notified.has(r.key));

  // forceSend (Admin Settings "Send Test Now" button only, never the 05:00
  // pg_cron run - see schedule.sql, which posts no body) - Capt. Weera wants
  // the test button to prove mail delivery works every time it's pressed,
  // not report "nothing new" once everything currently active has already
  // been emailed once. Sends everything active, dedup or not.
  //
  // email_notified_warnings is NOT touched on a forced send, in either
  // branch below - a warning this run mailed out only because forceSend
  // skipped the dedup filter must still count as "not yet notified" for
  // tomorrow's real 05:00 run, or a pilot's still-active warning would go
  // completely unreported by the actual daily check the first time it
  // legitimately becomes new.
  if (opts.forceSend) {
    if (!all.length) {
      log("Forced test run: nothing currently active to send.");
      return { ok: true, checked: 0, sent: 0 };
    }
    const subject = `AviCore: Test run - ${all.length} active alert${all.length > 1 ? "s" : ""}`;
    const text = [
      `Test run from Admin Settings - ${all.length} item(s) currently active`,
      "(sent regardless of whether they were emailed before).",
      "",
      ...all.map((r) => `[${STATUS_LABEL[r.status] || r.status}] ${r.text}`),
      "",
      "---",
      "AviCore Enterprise - test run, not the automatic daily check."
    ].join("\n");
    try {
      await sendEmail(recipients, subject, text);
      log(`Forced test send: emailed ${all.length} active warning(s) to ${recipients.length} recipient(s).`);
    } catch (err) {
      log("Forced test send failed:", (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
    return { ok: true, checked: all.length, sent: all.length };
  }

  if (!fresh.length) {
    log("Nothing new since the last check.");
    // Still prune keys that have cleared, so a warning that returns later is
    // reported again rather than being suppressed for ever.
    const changed = currentKeys.length !== notified.size || currentKeys.some((k) => !notified.has(k));
    if (changed) await saveSetting("email_notified_warnings", currentKeys, companyId);
    return { ok: true, checked: all.length, sent: 0 };
  }

  const subject = `AviCore: ${fresh.length} new alert${fresh.length > 1 ? "s" : ""}`;
  const text = [
    `${fresh.length} new item${fresh.length > 1 ? "s" : ""} since the last check.`,
    "",
    ...fresh.map((r) => `[${STATUS_LABEL[r.status] || r.status}] ${r.text}`),
    "",
    "---",
    `${all.length} item(s) are currently active in total.`,
    "AviCore Enterprise - automatic daily check."
  ].join("\n");

  try {
    await sendEmail(recipients, subject, text);
    await saveSetting("last_email_sent_at", new Date().toISOString(), companyId);
    log(`Emailed ${fresh.length} new warning(s) to ${recipients.length} recipient(s).`);
  } catch (err) {
    // The tracked set is deliberately NOT updated - an email that failed to
    // send must be retried tomorrow, not silently marked as delivered.
    log("Send failed, will retry next run:", (err as Error).message);
    return { ok: false, error: (err as Error).message };
  }

  await saveSetting("email_notified_warnings", currentKeys, companyId);
  return { ok: true, checked: all.length, sent: fresh.length };
}

// CORS. pg_cron and curl (used while building this) never send an Origin
// header, so they were never affected - only a browser call is. The Admin
// Settings screen's "Send Test Now" button calls this via
// supabase.functions.invoke(), which is a browser fetch: the browser sends a
// preflight OPTIONS request first and refuses to even attempt the real POST
// if that preflight doesn't come back with Access-Control-Allow-Origin. With
// no CORS headers at all (as this function had before), that preflight fails
// and the SDK reports it as "Failed to send a request to the Edge Function" -
// a network-level failure, not one this function's own error handling below
// ever gets a chance to run for.
// "*" rather than a specific origin: this function takes no header-based
// auth (it is deployed --no-verify-jwt and reads nothing from the request),
// so there is nothing an allowed origin would be protecting here anyway.
// x-avicore-company is included because webDatabase.js's Supabase client
// sends it on EVERY request, not just this one (see currentCompanyId()'s
// header comment - it's how the anonymous Crew build identifies its company
// to RLS). Since that header is set globally on the client, the browser
// includes it in the preflight for any call made through that client,
// including this one - even though this function itself never reads it.
// Missing it here is exactly what broke "Send Test Now": the browser refused
// to send the real POST at all once the preflight didn't list it, and
// reported that as a generic "Failed to send a request" / net::ERR_FAILED,
// not as the CORS error it actually was.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-avicore-company",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  // Lets the Admin screen fire a test run without waiting for 05:00.
  // pg_cron's own POST (schedule.sql) sends no body at all, so a body-parse
  // failure there must not break the real 05:00 run - default to {} rather
  // than let req.json() reject on an empty body.
  let body: { forceSend?: boolean } = {};
  try {
    body = await req.json();
  } catch { /* no/invalid body - fine, forceSend stays false */ }

  try {
    const result = await run({ forceSend: !!body.forceSend });
    return new Response(JSON.stringify(result), {
      status: result.ok === false ? 500 : 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    log("FAILED:", (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
});
