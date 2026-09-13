import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import { pushBatch, deliveryRetryKey } from "../line-due-alerts/digest.js";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-avicore-company", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return json({ error: "กรุณาลงชื่อเข้าใช้ Admin" }, 401);
  try {
    const { data: auth, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !auth.user) return json({ error: "กรุณาลงชื่อเข้าใช้ Admin ใหม่" }, 401);
    const { data: company, error: companyError } = await sb.from("companies").select("id")
      .eq("slug", Deno.env.get("COMPANY_SLUG") || "uoa").single();
    if (companyError) throw companyError;
    const { data: member, error: memberError } = await sb.from("company_members").select("role")
      .eq("company_id", company.id).eq("user_id", auth.user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member || !["admin", "owner"].includes(member.role)) return json({ error: "ต้องเป็น Admin ของบริษัทที่เชื่อม LINE" }, 403);
    const token = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    const groupId = Deno.env.get("LINE_PILOT_GROUP_ID");
    if (!token || !groupId || !/^C[0-9a-f]{32}$/i.test(groupId)) return json({ error: "ยังตั้งค่า LINE บนเซิร์ฟเวอร์ไม่ครบ" }, 503);
    const { data: groupRows, error: groupRowsError } = await sb.from("admin_line_user_events").select("line_group_id,occurred_at").eq("company_id", company.id).not("line_group_id", "is", null).order("occurred_at", { ascending: false }).limit(50);
    if (groupRowsError) throw groupRowsError;
    const destinations = [...new Set([groupId, ...(groupRows || []).map((r: any) => r.line_group_id)].filter((id: any) => /^C[0-9a-f]{32}$/i.test(String(id))))];
    if (!destinations.length) return json({ error: "ยังไม่พบ Group ID จาก LINE Webhook กรุณาส่งข้อความในกลุ่มใหม่หา Bot ก่อน" }, 503);
    const now = new Date();
    const time = now.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    // Collapse repeated clicks/retries within the same minute using LINE's retry key.
    const retryKey = await deliveryRetryKey(`admin-test|${company.id}|${groupId}|${auth.user.id}|${Math.floor(now.getTime() / 60000)}`);
    const messages = [{ type: "text" as const,
      text: `AviCore Bot — ทดสอบจาก Admin ✅\nเวลาไทย ${time}\nระบบส่งข้อความเข้า LINE Group และ LINE ส่วนตัวแล้วครับ\nข้อความนี้เป็นการทดสอบ ไม่ใช่สรุป Due Date ประจำวัน` }];
    for (const destination of destinations) {
      const groupCheck = await fetch(`https://api.line.me/v2/bot/group/${destination}/summary`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!groupCheck.ok) continue;
      await pushBatch({ token, groupId: destination, retryKey: await deliveryRetryKey(`admin-test|${company.id}|${destination}|${auth.user.id}|${Math.floor(now.getTime() / 60000)}`), messages });
    }
    const { data: privateRows, error: privateError } = await sb.from("admin_line_user_events")
      .select("line_user_id").eq("company_id", company.id).is("line_group_id", null)
      .in("event_type", ["friend_added", "message"]);
    if (privateError) throw privateError;
    const privateIds = [...new Set((privateRows || []).map((r: any) => r.line_user_id).filter(Boolean))];
    for (const userId of privateIds) {
      await pushBatch({ token, groupId: userId,
        retryKey: await deliveryRetryKey(`admin-test|${company.id}|private|${userId}|${auth.user.id}|${Math.floor(now.getTime() / 60000)}`), messages });
    }
    return json({ ok: true, acceptedAt: now.toISOString(), groupRecipients: destinations.length, privateRecipients: privateIds.length });
  } catch (error) {
    console.error("LINE admin test failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "ส่งทดสอบไม่สำเร็จ กรุณาตรวจ Token การเข้ากลุ่ม และโควตา LINE" }, 502);
  }
});
