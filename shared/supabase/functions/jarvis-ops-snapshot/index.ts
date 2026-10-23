import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import { computeStats, overallStatus, buildRecommendations } from "../../../src/utils/statusCompute.js";
import { checkRecoveryRest168 } from "../../../src/utils/dutyPeriods.js";
import { withFtlDefaults } from "../../../src/utils/ftlLimits.js";
import { withTrainingThresholdDefaults, withTrainingDisabledDefaults, buildTrainingRecommendations } from "../../../src/utils/trainingDue.js";
import { authorizedJarvisRequest, sanitizeOpsSnapshot } from "../_shared/jarvis-ops.js";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const COMPANY_SLUG = Deno.env.get("COMPANY_SLUG");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function companyId() {
  if (!COMPANY_SLUG) throw new Error("COMPANY_SLUG is required");
  const { data, error } = await sb.from("companies").select("id").eq("slug", COMPANY_SLUG).maybeSingle();
  if (error) throw new Error(`company lookup failed: ${error.message}`);
  if (!data) throw new Error("configured company was not found");
  return data.id;
}

async function readAll(table: string, columns: string, company: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(columns).eq("company_id", company).is("deleted_at", null).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

async function setting(key: string, company: string) {
  const { data, error } = await sb.from("Admin_app_settings").select("value_json")
    .eq("company_id", company).eq("key", key).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(`setting ${key}: ${error.message}`);
  return data?.value_json ?? null;
}

function bangkokDay(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function buildSnapshot() {
  const company = await companyId();
  const now = new Date();
  // Supabase Edge runs in UTC. Shift the anchor so shared local-calendar
  // calculators see the same wall-clock date/time as Asia/Bangkok (UTC+7).
  const operationalNow = new Date(now.getTime() + 7 * 3600000);
  const start = bangkokDay(now);
  const endDate = new Date(now.getTime() + 7 * 86400000);
  const end = bangkokDay(endDate);

  const [roster, experience, duty, training, limits, thresholds, disabled] = await Promise.all([
    readAll("Admin_pilot_roster", "pilot_code,pilot_name,date,code,base", company,
      q => q.gte("date", start).lte("date", end).order("date").order("pilot_code").order("uuid")),
    readAll("Admin_pilot_experience", "code,name,licence", company, q => q.order("code").order("uuid")),
    readAll("Admin_pilot_duty_entries", "pilot_code,entry_json", company, q => q.order("pilot_code").order("date").order("duty_type").order("uuid")),
    readAll("Admin_pilot_training", "code,name,record_json", company, q => q.order("code").order("uuid")),
    setting("ftl_limits", company).then(withFtlDefaults),
    setting("training_thresholds", company).then(withTrainingThresholdDefaults),
    setting("training_disabled_items", company).then(withTrainingDisabledDefaults),
  ]);

  const byPilot = new Map<string, any[]>();
  for (const row of duty) {
    const code = String(row.pilot_code || "").toUpperCase();
    if (!byPilot.has(code)) byPilot.set(code, []);
    if (row.entry_json && typeof row.entry_json === "object") byPilot.get(code)!.push(row.entry_json);
  }

  const ftlAlerts: any[] = [];
  for (const pilot of experience) {
    const entries = byPilot.get(String(pilot.code || "").toUpperCase()) || [];
    const stats = computeStats(entries, limits, operationalNow);
    const recoveryRest = checkRecoveryRest168(entries, limits, operationalNow);
    const status = overallStatus(stats, limits, recoveryRest.status);
    ftlAlerts.push(...buildRecommendations({ pilot, entries, stats, recoveryRest, status }, limits));
  }

  const trainingAlerts: any[] = [];
  for (const row of training) {
    trainingAlerts.push(...buildTrainingRecommendations({ code: row.code, name: row.name, record: row.record_json }, thresholds, disabled, operationalNow));
  }

  return sanitizeOpsSnapshot({ generatedAt: now, roster, ftlAlerts, trainingAlerts });
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("JARVIS_OPS_TOKEN");
  if (!authorizedJarvisRequest(req.headers.get("Authorization") || undefined, secret)) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await buildSnapshot());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("jarvis-ops-snapshot failed", message);
    const code = message.includes("timezone") ? "CONFIG_TIMEZONE" : message.includes("column") ? "QUERY_SCHEMA" : message.includes("COMPANY_SLUG") ? "CONFIG_COMPANY" : "SNAPSHOT_ERROR";
    return json({ ok: false, error: "Live operations snapshot unavailable", code }, 500);
  }
});
