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
// Schedule: pg_cron calls this every 15 minutes and each recipient is mailed at
// their own Bangkok time (Admin Settings) - see daily-alerts/schedule.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeStats, overallStatus, buildRecommendations, STATUS_LABEL } from "../../../src/utils/statusCompute.js";
import { checkRecoveryRest168 } from "../../../src/utils/dutyPeriods.js";
import { withFtlDefaults } from "../../../src/utils/ftlLimits.js";
import {
  withTrainingThresholdDefaults,
  withTrainingDisabledDefaults,
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

// Capt. Weera: several recipients, each with their OWN time of day. The
// config row (alert_email_config, Admin Settings) holds
//   recipients: [{ email, time: "HH:MM" }]   (Bangkok time)
// and pg_cron calls this every 15 minutes (schedule.sql). A run only reads
// the fleet when some recipient is due - their time has passed today and
// they have not had today's check yet - so the quarter-hourly ticks are cheap.
// Each recipient has their own "already told" list, so one person's 05:00
// email never stops another person's 07:00 email from carrying the same new
// warning.
type Recipient = { email: string; time: string };

export function recipientsOf(cfg: any): Recipient[] {
  const list: any[] = Array.isArray(cfg?.recipients) && cfg.recipients.length
    ? cfg.recipients
    : String(cfg?.toAddress || "").split(",").map((e: string) => ({ email: e, time: "05:00" }));
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const r of list) {
    const email = String(r?.email || "").trim();
    const time = /^\d{2}:\d{2}$/.test(String(r?.time || "")) ? String(r.time) : "05:00";
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push({ email, time });
  }
  return out.slice(0, 10);
}

function bangkokNow(d = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const STATE_KEY = "email_alert_recipient_state";

async function computeAlerts(companyId: string) {
  // pilot_experience: code/name/licence ONLY, not record_json. The FTL
  // pipeline (buildRecommendations et al, see statusCompute.js) never reads
  // anything else off the pilot object - but record_json can carry a base64
  // photo per pilot, and pulling that for the WHOLE fleet inside this small
  // Edge Function isolate caused "WORKER_RESOURCE_LIMIT".
  // Duty: only the last 400 days. The longest FTL window is 365 days, and the
  // whole fleet's full history (years of imported FDT) is far more than an
  // Edge Function's CPU budget can run through computeStats - that is what
  // made "Send test" fail with a bare non-2xx error.
  const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const [experience, duty, training] = await Promise.all([
    readAll("Admin_pilot_experience", "code, name, licence", companyId),
    readAll("Admin_pilot_duty_entries", "pilot_code, entry_json", companyId, (q) => q.gte("date", cutoff)),
    readAll("Admin_pilot_training", "code, name, record_json", companyId)
  ]);
  const [limits, thresholds, disabledItems] = await Promise.all([
    getSetting("ftl_limits", companyId).then(withFtlDefaults),
    getSetting("training_thresholds", companyId).then(withTrainingThresholdDefaults),
    getSetting("training_disabled_items", companyId).then(withTrainingDisabledDefaults)
  ]);
  const byPilot = new Map<string, any[]>();
  for (const row of duty) {
    const code = String(row.pilot_code || "").toUpperCase();
    if (!byPilot.has(code)) byPilot.set(code, []);
    byPilot.get(code)!.push(row.entry_json);
  }
  const ftlRecs: any[] = [];
  for (const p of experience) {
    const pilot = { code: p.code, name: p.name, licence: p.licence };
    const entries = byPilot.get(String(p.code || "").toUpperCase()) || [];
    const stats = computeStats(entries, limits);
    const recoveryRest = checkRecoveryRest168(entries, limits);
    const status = overallStatus(stats, limits, recoveryRest.status);
    ftlRecs.push(...buildRecommendations({ pilot, entries, stats, recoveryRest, status }, limits));
  }
  const trainingRecs: any[] = [];
  for (const t of training) {
    trainingRecs.push(...buildTrainingRecommendations(
      { code: t.code, name: t.name, record: t.record_json },
      thresholds, disabledItems, new Date()
    ));
  }
  const rank: Record<string, number> = { exc: 0, warn: 1 };
  const all = [...ftlRecs, ...trainingRecs].filter((r) => r.status === "warn").sort((a, b) => rank[a.status] - rank[b.status]);
  log(`Checked ${experience.length} pilot(s) + ${training.length} training record(s) - ${all.length} active warning(s).`);
  // Written whenever the fleet is checked, so the Dashboard's "Alert System
  // Status" can tell "the checker is alive" apart from "nothing to report".
  await saveSetting("last_check_at", new Date().toISOString(), companyId);
  return all;
}

const lines = (recs: any[]) => recs.map((r) => `[${STATUS_LABEL[r.status] || r.status}] ${r.text}`);

async function run(opts: { forceSend?: boolean; to?: string } = {}) {
  // Every read/write below is scoped to this one company (COMPANY_SLUG):
  // this function runs as service_role, which is not auto-scoped by RLS.
  const companyId = await currentCompanyId();
  const cfg = (await getSetting("alert_email_config", companyId)) || {};
  if (!cfg.enabled) {
    log("Alerts are switched off in Settings - nothing to do.");
    return { ok: true, skipped: "disabled" };
  }
  const recipients = recipientsOf(cfg);
  if (!recipients.length) {
    log("No recipients configured - nothing to do.");
    return { ok: true, skipped: "no-recipients" };
  }

  // --- "Send test" (Admin Settings) ---------------------------------------
  // Capt. Weera: a test carries the REAL alerts active right now, with a
  // subject that says it is a test. With nothing active it still sends a
  // short note, so a quiet fleet and a broken mail key never look the same.
  // The per-recipient "already told" lists are NOT touched: a warning mailed
  // only by a test must still count as new for that person's daily email.
  if (opts.forceSend) {
    const wanted = opts.to ? recipients.filter((r) => r.email.toLowerCase() === String(opts.to).trim().toLowerCase()) : recipients;
    if (!wanted.length) return { ok: false, error: "That address is not in the saved recipients - press Save Email Settings first." };
    const all = await computeAlerts(companyId);
    const subject = all.length
      ? `[TEST / ทดสอบ] AviCore: ${all.length} active alert${all.length > 1 ? "s" : ""}`
      : "[TEST / ทดสอบ] AviCore: no active alerts";
    const text = [
      "*** TEST EMAIL / อีเมลทดสอบ - sent from Admin Settings \"Send test\" ***",
      "",
      all.length
        ? `${all.length} alert(s) active right now (real data, sent whether or not they were emailed before):`
        : "No Training Due or FTL warnings are active right now. Email delivery works.",
      "",
      ...lines(all),
      ...(all.length ? [""] : []),
      "---",
      "AviCore Enterprise - test, not the automatic daily check."
    ].join("\n");
    try {
      await sendEmail(wanted.map((r) => r.email), subject, text);
    } catch (err) {
      log("Test send failed:", (err as Error).message);
      return { ok: false, error: (err as Error).message };
    }
    log(`Test send: ${all.length} active warning(s) to ${wanted.length} recipient(s).`);
    return { ok: true, checked: all.length, sent: all.length, recipients: wanted.length };
  }

  // --- the timed check -----------------------------------------------------
  const now = bangkokNow();
  const stateRaw = (await getSetting(STATE_KEY, companyId)) || {};
  const state: Record<string, { lastRunDate?: string; notified?: string[] }> = typeof stateRaw === "object" && stateRaw ? stateRaw : {};
  const due = recipients.filter((r) => r.time <= now.time && state[r.email.toLowerCase()]?.lastRunDate !== now.date);
  if (!due.length) return { ok: true, skipped: "not-due", time: now.time };

  const all = await computeAlerts(companyId);
  const currentKeys = all.map((r) => r.key);
  // A recipient with no list yet (first run after this change) starts from
  // the old shared list, so they are not sent every warning already reported.
  const legacyRaw = await getSetting("email_notified_warnings", companyId);
  const legacy: string[] = Array.isArray(legacyRaw) ? legacyRaw : [];

  let sent = 0;
  const errors: string[] = [];
  for (const r of due) {
    const id = r.email.toLowerCase();
    const notified = new Set(state[id]?.notified ?? legacy);
    const fresh = all.filter((x) => !notified.has(x.key));
    if (fresh.length) {
      const subject = `AviCore: ${fresh.length} new alert${fresh.length > 1 ? "s" : ""}`;
      const text = [
        `${fresh.length} new item${fresh.length > 1 ? "s" : ""} since your last check.`,
        "",
        ...lines(fresh),
        "",
        "---",
        `${all.length} item(s) are currently active in total.`,
        `AviCore Enterprise - automatic daily check (${r.time} Bangkok).`
      ].join("\n");
      try {
        await sendEmail([r.email], subject, text);
        sent++;
        log(`Emailed ${fresh.length} new warning(s) to ${r.email}.`);
      } catch (err) {
        // Left un-marked: an email that failed to send is retried on the
        // next tick, not silently counted as delivered.
        errors.push(`${r.email}: ${(err as Error).message}`);
        log("Send failed, will retry:", r.email, (err as Error).message);
        continue;
      }
    }
    // Keys that cleared are dropped, so a warning that returns later is
    // reported again rather than suppressed for ever.
    state[id] = { lastRunDate: now.date, notified: currentKeys };
  }
  await saveSetting(STATE_KEY, state, companyId);
  if (sent) await saveSetting("last_email_sent_at", new Date().toISOString(), companyId);
  return errors.length ? { ok: false, error: errors.join("; "), sent } : { ok: true, checked: all.length, sent, due: due.length };
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
  let body: { forceSend?: boolean; to?: string } = {};
  try {
    body = await req.json();
  } catch { /* no/invalid body - fine, forceSend stays false */ }

  // A test goes out on demand, so only a signed-in AviCore admin may ask for
  // one; the timed check (pg_cron, no body) needs no sign-in and only ever
  // mails what is due.
  if (body.forceSend) {
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") || "";
    const { data: auth } = jwt ? await sb.auth.getUser(jwt) : { data: null as any };
    const userId = auth?.user?.id;
    const { data: member } = userId
      ? await sb.from("company_members").select("company_id").eq("user_id", userId).eq("admin_web", true).limit(1).maybeSingle()
      : { data: null as any };
    if (!member) {
      return new Response(JSON.stringify({ ok: false, error: "Sign in to AviCore Admin to send a test." }), {
        status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    }
  }

  try {
    const result = await run({ forceSend: !!body.forceSend, to: body.to });
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
