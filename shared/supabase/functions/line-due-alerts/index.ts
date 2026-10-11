import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import { withTrainingThresholdDefaults, withTrainingDisabledDefaults, buildTrainingRecommendations } from "../../../../src/utils/trainingDue.js";
import { withFtlDefaults } from "../../../../src/utils/ftlLimits.js";
import { bangkokDay, digestMessages, pushBatch, ensureDeliverySnapshot } from "./digest.js";
import {
  buildLineFtlRecommendations,
  recommendationsForAudience,
  updateFirstSeenWarnings,
} from "./recommendations.js";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Scheduled server calls only. Never accept a company, destination or token from a caller.
Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("LINE_ALERT_CRON_SECRET");
  const bearer = req.headers.get("Authorization");
  let authorized = !!secret && bearer === `Bearer ${secret}`;
  if (!authorized && /^Bearer [A-Za-z0-9_-]{32,128}$/.test(bearer || "")) {
    const { data, error } = await sb.rpc("avicore_verify_line_cron", { candidate: bearer!.slice(7) });
    authorized = !error && data === true;
  }
  if (!authorized) return json({ error: "Unauthorized" }, 401);
  let dryRun = false;
  try { dryRun = (await req.json()).dryRun === true; } catch { /* scheduled requests may have no body */ }
  let companyId: string | undefined;
  async function get(key: string) {
    const { data, error } = await sb.from("Admin_app_settings").select("value_json")
      .eq("company_id", companyId!).eq("key", key).is("deleted_at", null).maybeSingle();
    if (error) throw error;
    return data?.value_json;
  }
  async function save(key: string, value: unknown) {
    const now = new Date().toISOString();
    const { error } = await sb.from("Admin_app_settings").upsert({ company_id: companyId, key,
      value_json: value, device_id: "line-due-alerts", created_at: now, modified_at: now, deleted_at: null },
      { onConflict: "company_id,key" });
    if (error) throw error;
  }
  try {
    const slug = Deno.env.get("COMPANY_SLUG") || "uoa";
    if (!slug) throw new Error("COMPANY_SLUG is required");
    const { data, error } = await sb.from("companies").select("id").eq("slug", slug).single();
    if (error) throw error;
    companyId = data.id;
    const config = await get("alert_line_config");
    if (!dryRun && config?.enabled !== true) return json({ ok: true, skipped: "disabled" });
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    const groupId = Deno.env.get("LINE_PILOT_GROUP_ID");
    if (!token || !groupId || !/^C[0-9a-f]{32}$/i.test(groupId)) throw new Error("LINE server configuration is missing or invalid");
    const now = new Date();
    const day = bangkokDay(now);
    // Match the existing Dashboard/email elapsed-day calculation exactly.
    const today = now;
    const previous = await get("line_alert_delivery");
    if (!dryRun && previous?.day === day && previous?.groupId === groupId && previous?.complete) return json({ ok: true, skipped: "already-sent" });
    const [thresholds, disabled, limits] = await Promise.all([
      get("training_thresholds").then(withTrainingThresholdDefaults),
      get("training_disabled_items").then(withTrainingDisabledDefaults),
      get("ftl_limits").then(withFtlDefaults),
    ]);
    const trainingRecs = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("Admin_pilot_training").select("uuid,code,name,record_json")
        .eq("company_id", companyId!).is("deleted_at", null)
        .order("code").order("uuid").range(offset, offset + 999);
      if (error) throw error;
      for (const row of rows || []) trainingRecs.push(...buildTrainingRecommendations(
        { code: row.code, name: row.name, record: row.record_json }, thresholds, disabled, today)
        .map((item: any) => ({ ...item, category: "training" })));
      if (!rows || rows.length < 1000) break;
    }
    const experience: any[] = [];
    const duty: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("Admin_pilot_experience").select("uuid,code,name,licence")
        .eq("company_id", companyId!).is("deleted_at", null)
        .order("code").order("uuid").range(offset, offset + 999);
      if (error) throw error;
      experience.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("Admin_pilot_duty_entries").select("uuid,pilot_code,date,duty_type,entry_json")
        .eq("company_id", companyId!).is("deleted_at", null)
        .order("pilot_code").order("uuid").range(offset, offset + 999);
      if (error) throw error;
      duty.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    const ftlRecs = buildLineFtlRecommendations({ experience, duty, limits, asOfDay: day });
    const recs = [...trainingRecs, ...ftlRecs];
    // Keep first-seen dates so an unresolved warning is clearly marked after
    // seven daily checks. LINE text messages cannot render font colours, so
    // the red-circle marker is used consistently in group and private chats.
    const firstSeen = (await get("line_alert_first_seen")) || {};
    const seenNow = updateFirstSeenWarnings(recs, firstSeen, day, now);
    if (!dryRun) await save("line_alert_first_seen", seenNow);
    recs.sort((a, b) => (a.status === "exc" ? 0 : 1) - (b.status === "exc" ? 0 : 1) || a.key.localeCompare(b.key));
    if (dryRun) {
      const response = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`LINE group lookup failed (${response.status})`);
      const group = await response.json();
      return json({ ok: true, dryRun: true, company: slug, groupId, groupName: group.groupName,
        warnings: recs.length,
        trainingWarnings: recs.filter((rec: any) => rec.category === "training").length,
        ftlWarnings: recs.filter((rec: any) => rec.category === "ftl").length,
        batches: digestMessages(recs, day).length });
    }
    // Preserve the existing Training Due fan-out, but keep operational FTL data
    // restricted to the explicitly configured pilot group. Secondary payloads,
    // recipients and per-batch progress are frozen before the first send.
    // Also deliver Training Due alerts to every LINE group where the bot has been observed by the webhook.
    // The configured group remains the primary destination; discovered groups are added
    // automatically so a newly joined pilot group receives the same daily notice.
    const groupRows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("admin_line_user_events")
        .select("id,line_group_id").eq("company_id", companyId!).not("line_group_id", "is", null)
        .order("id").range(offset, offset + 999);
      if (error) throw error;
      groupRows.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    const discoveredGroups = [...new Set(groupRows.map((r: any) => r.line_group_id)
      .filter((id: any) => /^C[0-9a-f]{32}$/i.test(String(id)) && id !== groupId))];

    // A user who has added AviCore Bot continues to receive Training Due in a
    // private chat. FTL stays in the configured pilot group only; private IDs
    // are learned from the webhook audit and de-duplicated.
    const privateRows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("admin_line_user_events")
        .select("id,line_user_id").eq("company_id", companyId!).is("line_group_id", null)
        .in("event_type", ["friend_added", "message"]).order("id").range(offset, offset + 999);
      if (error) throw error;
      privateRows.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    const privateIds = [...new Set(privateRows.map((r: any) => r.line_user_id).filter(Boolean))];
    const delivery = await ensureDeliverySnapshot(
      previous?.day === day && previous?.groupId === groupId ? previous : null,
      {
      companyId: companyId!,
      groupId,
      day,
      primaryRecommendations: recs,
      secondaryRecommendations: recommendationsForAudience(recs, "secondary"),
      groups: discoveredGroups,
      users: privateIds,
    });
    // Persist the complete primary + secondary snapshot before the first LINE push.
    await save("line_alert_delivery", delivery);
    for (const batch of delivery.batches) {
      if (batch.sent) continue;
      await pushBatch({ token, groupId, messages: batch.messages, retryKey: batch.retryKey });
      batch.sent = true;
      await save("line_alert_delivery", delivery);
    }
    for (const destination of delivery.secondary.destinations) {
      for (let i = 0; i < delivery.secondary.batches.length; i++) {
        const attempt = destination.batches[i];
        if (attempt.sent) continue;
        await pushBatch({
          token,
          groupId: destination.id,
          messages: delivery.secondary.batches[i],
          retryKey: attempt.retryKey,
        });
        attempt.sent = true;
        await save("line_alert_delivery", delivery);
      }
    }
    delivery.complete = true;
    await save("line_alert_delivery", delivery);
    await save("line_alert_status", { checkedAt: now.toISOString(), state: delivery.batches.length ? "LINE accepted" : "No Training/FTL alerts" });
    return json({ ok: true, batches: delivery.batches.length });
  } catch (error) {
    console.error("LINE due alerts failed", error instanceof Error ? error.message : "Unknown error");
    if (companyId) await save("line_alert_status", { checkedAt: new Date().toISOString(), state: "Failed — check server logs" }).catch(() => {});
    return json({ ok: false, error: "LINE due alerts failed; check server configuration/logs" }, 500);
  }
});
