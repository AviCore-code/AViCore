import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

interface BirthdayAlert { code: string; name: string; age: number }

async function sendBirthdayGreetings(projectUrl: string, serviceRoleKey: string) {
  const sb = createClient(projectUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  
  // Find pilots with birthdays today (month-day match)
  const { data: pilots, error: pilotError } = await sb.rpc("get_birthday_pilots", { target_date: today });
  if (pilotError) throw pilotError;
  
  if (!pilots || pilots.length === 0) {
    return { ok: true, greetings_sent: 0, message: "No birthdays today" };
  }

  // Get company & LINE config
  const { data: company, error: compError } = await sb
    .from("companies")
    .select("id,slug")
    .eq("slug", Deno.env.get("COMPANY_SLUG") || "uoa")
    .single();
  if (compError || !company) return { ok: false, error: "Company not found" };

  const { data: cfg, error: cfgError } = await sb
    .from("Admin_app_settings")
    .select("value_json")
    .eq("company_id", company.id)
    .eq("key", "line_due_alerts_config")
    .single();
  if (cfgError || !cfg?.value_json?.enabled) {
    return { ok: true, greetings_sent: 0, message: "LINE birthdays not enabled" };
  }

  const groupId = (cfg.value_json as Record<string, unknown>).group_id as string || Deno.env.get("LINE_PILOT_GROUP_ID");
  const channelToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  
  if (!groupId || !channelToken) {
    return { ok: false, error: "LINE not configured for birthdays" };
  }

  // Build greeting message
  const greetings = (pilots as BirthdayAlert[]).map(
    p => `🎂 ${p.name} (${p.code}) — วันนี้เป็นวันเกิดอายุ ${p.age} ปี! สวัสดี และอวยพรให้คุณมีความสุขเต็มไปด้วยสุขภาพดีครับ`
  );
  const message = `🎉 วันเกิดในทีมวันนี้:\n\n${greetings.join("\n")}\n\nขอให้เป็นวันที่ดีเสมอ ✈️`;

  // Send via LINE Messaging API
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${channelToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text: message.slice(0, 5000) }]
      })
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `LINE API error: ${res.status} ${text}` };
    }

    // Mark greetings as sent
    const rows = (pilots as BirthdayAlert[]).map(p => ({
      company_id: company.id,
      pilot_code: p.code,
      pilot_name: p.name,
      greeting_date: today
    }));
    
    await sb.from("admin_birthday_greetings").insert(rows).throwOnError();

    return { ok: true, greetings_sent: pilots.length, message: "Birthday greetings sent" };
  } catch (err) {
    return { ok: false, error: `Failed to send LINE message: ${err instanceof Error ? err.message : String(err)}` };
  }
}

Deno.serve(async (req) => {
  try {
    const projectUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!projectUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ ok: false, error: "Missing Supabase env" }), { status: 500 });
    }

    const result = await sendBirthdayGreetings(projectUrl, serviceRoleKey);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("[birthday-greetings] Error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ ok: false, error: "Birthday greetings failed" }), { status: 500 });
  }
});
