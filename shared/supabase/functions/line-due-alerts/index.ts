import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import { withTrainingThresholdDefaults, withTrainingDisabledDefaults, withCustomTrainingItems, buildTrainingRecommendations } from "../../../src/utils/trainingDue.js";
import { bangkokDay, digestMessages, pushBatch, deliveryRetryKey } from "./digest.js";

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
    const [thresholds, disabled, custom] = await Promise.all([
      get("training_thresholds").then(withTrainingThresholdDefaults),
      get("training_disabled_items").then(withTrainingDisabledDefaults),
      get("training_custom_items").then(withCustomTrainingItems),
    ]);
    const recs = [];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await sb.from("Admin_pilot_training").select("code,name,record_json")
        .eq("company_id", companyId!).is("deleted_at", null).order("code").range(offset, offset + 999);
      if (error) throw error;
      for (const row of rows || []) recs.push(...buildTrainingRecommendations(
        { code: row.code, name: row.name, record: row.record_json }, thresholds, disabled, today, custom));
      if (!rows || rows.length < 1000) break;
    }
    // Keep first-seen dates so an unresolved warning is clearly marked after
    // seven daily checks. LINE text messages cannot render font colours, so
    // the red-circle marker is used consistently in group and private chats.
    const firstSeen = (await get("line_alert_first_seen")) || {};
    const seenNow = { ...firstSeen };
    const nowMs = now.getTime();
    for (const rec of recs) {
      if (!seenNow[rec.key]) seenNow[rec.key] = day;
      const first = Date.parse(`${seenNow[rec.key]}T00:00:00+07:00`);
      rec.overdue = Number.isFinite(first) && nowMs - first >= 7 * 86400000;
    }
    if (!dryRun) await save("line_alert_first_seen", seenNow);
    recs.sort((a, b) => (a.status === "exc" ? 0 : 1) - (b.status === "exc" ? 0 : 1) || a.key.localeCompare(b.key));
    if (dryRun) {
      const response = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`LINE group lookup failed (${response.status})`);
      const group = await response.json();
      return json({ ok: true, dryRun: true, company: slug, groupId, groupName: group.groupName,
        warnings: recs.length, batches: digestMessages(recs, day).length });
    }
    // Save payload + retry keys BEFORE sending. On network failure reuse the same payload/key.
    const delivery = previous?.day === day && previous?.groupId === groupId ? previous : {
      day, groupId, complete: false,
      batches: await Promise.all(digestMessages(recs, day).map(async (messages, index) => ({ messages,
        retryKey: await deliveryRetryKey(`${companyId}|${groupId}|${day}|${index}`), sent: false }))),
    };
    await save("line_alert_delivery", delivery);
    for (const batch of delivery.batches) {
      if (batch.sent) continue;
      await pushBatch({ token, groupId, messages: batch.messages, retryKey: batch.retryKey });
      batch.sent = true;
      await save("line_alert_delivery", delivery);
    }
    // Also deliver to every LINE group where the bot has been observed by the webhook.
    // The configured group remains the primary destination; discovered groups are added
    // automatically so a newly joined pilot group receives the same daily notice.
    const { data: groupRows, error: groupError } = await sb.from("admin_line_user_events")
      .select("line_group_id").eq("company_id", companyId!).not("line_group_id", "is", null);
    if (groupError) throw groupError;
    const discoveredGroups = [...new Set((groupRows || []).map((r: any) => r.line_group_id).filter((id: any) => /^C[0-9a-f]{32}$/i.test(String(id)) && id !== groupId))];
    for (const extraGroupId of discoveredGroups) {
      for (let i = 0; i < delivery.batches.length; i++) {
        const batch = delivery.batches[i];
        await pushBatch({ token, groupId: extraGroupId, messages: batch.messages,
          retryKey: await deliveryRetryKey(`${companyId}|extra-group|${extraGroupId}|${day}|${i}`) });
      }
    }
    // A user who has added AviCore Bot receives the same daily digest in a
    // private chat. Group delivery remains the primary channel; private IDs
    // are learned from the webhook audit and de-duplicated.
    const { data: privateRows, error: privateError } = await sb.from("admin_line_user_events")
      .select("line_user_id").eq("company_id", companyId!).is("line_group_id", null)
      .in("event_type", ["friend_added", "message"]);
    if (privateError) throw privateError;
    const privateIds = [...new Set((privateRows || []).map((r: any) => r.line_user_id).filter(Boolean))];
    for (const userId of privateIds) {
      for (let i = 0; i < delivery.batches.length; i++) {
        const batch = delivery.batches[i];
        await pushBatch({ token, groupId: userId, messages: batch.messages,
          retryKey: await deliveryRetryKey(`${companyId}|private|${userId}|${day}|${i}`) });
      }
    }
    delivery.complete = true;
    await save("line_alert_delivery", delivery);
    await save("line_alert_status", { checkedAt: now.toISOString(), state: delivery.batches.length ? "LINE accepted" : "No due date alerts" });
    return json({ ok: true, batches: delivery.batches.length });
  } catch (error) {
    console.error("LINE due alerts failed", error instanceof Error ? error.message : "Unknown error");
    if (companyId) await save("line_alert_status", { checkedAt: new Date().toISOString(), state: "Failed — check server logs" }).catch(() => {});
    return json({ ok: false, error: "LINE due alerts failed; check server configuration/logs" }, 500);
  }
});
