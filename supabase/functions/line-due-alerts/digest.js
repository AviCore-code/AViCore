export function bangkokDay(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

export async function deliveryRetryKey(scope) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope)));
  hash[6] = (hash[6] & 15) | 64;
  hash[8] = (hash[8] & 63) | 128;
  const hex = Array.from(hash.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Preserve complete Unicode characters; LINE limits text to 5,000 UTF-16 units.
export function digestMessages(recommendations, day) {
  if (!recommendations.length) return [];
  const header = `AviCore — Pilot Due Date\n${day} · ${recommendations.length} รายการ\n`;
  const chunks = [];
  let text = header;
  for (const rec of recommendations) {
    const line = `\n${rec.overdue ? "🔴 " : ""}[${rec.status === "exc" ? "เกินเกณฑ์" : "แจ้งเตือน"}] ${rec.text}${rec.overdue ? " — ยังไม่ได้แก้ไขเกิน 7 วัน" : ""}\n`;
    for (const char of line) {
      if (text.length + char.length > 4500) { chunks.push(text); text = header; }
      text += char;
    }
  }
  if (text !== header) chunks.push(text);
  const batches = [];
  for (let i = 0; i < chunks.length; i += 5) {
    batches.push(chunks.slice(i, i + 5).map(text => ({ type: "text", text })));
  }
  return batches;
}

export async function pushBatch({ token, groupId, retryKey, messages, fetcher = fetch }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Line-Retry-Key": retryKey },
      body: JSON.stringify({ to: groupId, messages }),
    });
    if (response.ok || (response.status === 409 && response.headers.get("x-line-accepted-request-id"))) return;
    const detail = await response.text().catch(() => "");
    if (response.status !== 429 || attempt === 2) {
      console.error("LINE push failed", response.status, detail.slice(0, 500));
      throw new Error(`LINE request failed (${response.status}) ${detail.slice(0, 180)}`);
    }
    const retryAfter = Number(response.headers.get("retry-after") || 2);
    await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(retryAfter, 1), 10) * 1000));
  }
}
