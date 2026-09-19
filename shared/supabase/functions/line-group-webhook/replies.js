export function testReply(event, now = new Date()) {
  if (event?.type !== "message" || event.message?.type !== "text" || !event.replyToken) return null;
  const original = String(event.message.text || "");
  const addressed = /^\s*@?avicore\s*bot\b/i.test(original) || event.message.mention?.mentionees?.some(m => m.isSelf === true);
  if (["group", "room"].includes(event.source?.type) && !addressed) return null;
  const text = original.replace(/@?avicore\s*(bot)?/ig, "").trim();
  if (/กี่โมง|^(?:วัน\s*)?เวลา(?:อะไร|ไร)?$|\bwhat time\b|^time\??$/i.test(text) && !/^(ค้น|search|find)/i.test(text)) {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    return `ตอนนี้เวลา ${time} น. ตามเวลาไทยครับ (Asia/Bangkok)`;
  }
  if (/^(ทดสอบ(?:\s+notice)?|test(?:\s+notice)?|ping)\s*$/i.test(text)) return "AviCore Bot รับการทดสอบแล้วครับ ✅\nWebhook และการตอบกลับในกลุ่มใช้งานได้ปกติ\nตัวอย่าง Notice: [แจ้งเตือน] ระบบทดสอบส่งข้อความถึงกลุ่มนี้สำเร็จ\nหมายเหตุ: ปุ่ม Push จาก Admin ยังขึ้น 429 จาก LINE และไม่เกี่ยวกับ Webhook";
  if (/^(สวัสดี|ดีครับ|ดีค่ะ|hello|hi)\s*$/i.test(text)) return "สวัสดีครับ ผม AviCore Bot\nลองพิมพ์ “ทดสอบ AviCore” หรือ “AviCore ตอนนี้กี่โมง” ได้ครับ\nค้น Manual/SOP ในกลุ่มบริษัท: AviCore ค้นหา เวลาพัก";
  return null;
}

async function startLoadingAnimation(fetcher, token, userId, seconds = 20, logger = console) {
  try {
    const res = await fetcher("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: userId, loadingSeconds: Math.max(5, Math.min(60, seconds)) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) logger.error("LINE loading animation failed", res.status);
  } catch { /* best-effort only; never block the real reply on this */ }
}

export async function handleWebhook(req, { secret, token, knowledgeReply = async () => null, auditEvent = async () => {}, fetcher = fetch, logger = console, now = () => new Date() }) {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!secret) return new Response(null, { status: 503 });
  const body = await req.arrayBuffer();
  let data;
  try {
    const bytes = Uint8Array.from(atob(req.headers.get("x-line-signature") || ""), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, bytes, body)) return new Response(null, { status: 401 });
    data = JSON.parse(new TextDecoder().decode(body));
    if (!Array.isArray(data.events)) return new Response(null, { status: 400 });
  } catch { return new Response(null, { status: 400 }); }
  let failed = false;
  for (const event of data.events) {
    try { await auditEvent(event, { fetcher, token, now: now() }); } catch (error) { logger.error("LINE audit failed", error instanceof Error ? error.message : "Unknown error"); }
    if (event?.source?.type === "group" && /^C[0-9a-f]{32}$/i.test(event.source.groupId)) logger.log("Verified LINE group", event.source.groupId);
    const rawGroupText = String(event?.message?.text || "");
    const groupMentioned = /^\s*@?avicore\s*bot\b/i.test(rawGroupText) || event?.message?.mention?.mentionees?.some(m => m.isSelf === true);
    if (["group", "room"].includes(event?.source?.type) && !groupMentioned) continue;
    // Show LINE's native "..." loading animation while the knowledge search
    // runs (IQSMS FTS + optional Gemini can take a few seconds), the same
    // affordance the Jarvis bot shows. LINE only supports this in one-on-one
    // chats (chatId = userId) — it silently does nothing for group/room, so
    // this is safe to fire unconditionally and not await.
    if (token && event?.source?.type === "user" && event?.source?.userId && event?.message?.type === "text") {
      startLoadingAnimation(fetcher, token, event.source.userId, 30, logger).catch(() => {});
    }
    const knowledgeText = await knowledgeReply(event);
    // `false` is an explicit admin switch: do not answer this event at all.
    // `null` keeps the normal fallback (test/ping response) for compatibility.
    if (knowledgeText === false) continue;
    const text = knowledgeText || testReply(event, now());
    if (!text) continue;
    if (!token) { logger.error("LINE_CHANNEL_ACCESS_TOKEN is missing"); failed = true; continue; }
    try {
      const fullText = String(text).replace(/^__FULL__/, "");
      const fullRequest = String(text).startsWith("__FULL__");
      const payloadMessages = !fullRequest && fullText.length > 350 ? [{ type: "flex", altText: "AviCore Bot คำตอบ", contents: {
        type: "bubble", size: "mega",
        body: { type: "box", layout: "vertical", spacing: "sm", contents: String(text).split(/\n/).slice(0, 5).map(line => ({ type: "text", text: line || " ", size: "sm", wrap: true, maxLines: 1 })) },
        footer: { type: "box", layout: "vertical", contents: [{ type: "button", style: "primary", action: { type: "message", label: "More all", text: "MORE ALL" } }] }
      } }] : [{ type: "text", text: fullText }];
      const result = await fetcher("https://api.line.me/v2/bot/message/reply", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ replyToken: event.replyToken, messages: payloadMessages }),
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) { logger.error("LINE test reply failed", result.status); failed = true; }
      else logger.log("LINE test reply accepted");
    } catch { logger.error("LINE test reply network failure"); failed = true; }
  }
  return new Response(failed ? "Reply failed" : "OK", { status: failed ? 502 : 200 });
}
