export function bangkokDay(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

const BIRTH_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function birthdayPilots(rows, day) {
  const target = String(day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!target) return [];
  const targetMonth = Number(target[2]);
  const targetDay = Number(target[3]);
  return (rows || []).flatMap(row => {
    const raw = row?.record_json?.profile?.hbd;
    const match = String(raw || "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
    if (!match) return [];
    const birthDay = Number(match[1]);
    const birthMonth = BIRTH_MONTHS[match[2].toLowerCase()];
    if (!birthMonth) return [];
    const valid = new Date(Date.UTC(2000, birthMonth - 1, birthDay));
    if (valid.getUTCMonth() + 1 !== birthMonth || valid.getUTCDate() !== birthDay) return [];
    if (birthMonth !== targetMonth || birthDay !== targetDay) return [];
    return [{ code: String(row.code || "").trim(), name: String(row.name || row?.record_json?.profile?.name || "").trim() }];
  }).filter(pilot => pilot.code || pilot.name).sort((a, b) => a.code.localeCompare(b.code));
}

export async function deliveryRetryKey(scope) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope)));
  hash[6] = (hash[6] & 15) | 64;
  hash[8] = (hash[8] & 63) | 128;
  const hex = Array.from(hash.slice(0, 16), b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Preserve complete Unicode characters; LINE limits text to 5,000 UTF-16 units.
export function digestMessages(recommendations, day, options = {}) {
  const birthdays = options.birthdays || [];
  if (!recommendations.length && !birthdays.length) return [];
  const chunks = [];
  if (birthdays.length) {
    const pilots = birthdays.map(pilot => `🎂 ${pilot.code}${pilot.code && pilot.name ? " — " : ""}${pilot.name}`).join("\n");
    const greeting = `🎉 สุขสันต์วันเกิดนักบิน\n${day}\n\n${pilots}\n\nขอให้มีความสุข สุขภาพแข็งแรง และปลอดภัยในทุกเที่ยวบินครับ`;
    let text = "";
    for (const char of greeting) {
      if (text.length + char.length > 4500) { chunks.push(text); text = ""; }
      text += char;
    }
    if (text) chunks.push(text);
  }
  if (recommendations.length) {
    const title = options.title || "AviCore — Training Due Date & FTL Limits";
    const header = `${title}\n${day} · ${recommendations.length} รายการ\n`;
    let text = header;
    for (const rec of recommendations) {
      const category = rec.category === "ftl" ? "FTL" : "TRAINING";
      const line = `\n${rec.overdue ? "🔴 " : ""}[${category}][${rec.status === "exc" ? "เกินเกณฑ์" : "แจ้งเตือน"}] ${rec.text}${rec.overdue ? " — ยังไม่ได้แก้ไขเกิน 7 วัน" : ""}\n`;
      for (const char of line) {
        if (text.length + char.length > 4500) { chunks.push(text); text = header; }
        text += char;
      }
    }
    if (text !== header) chunks.push(text);
  }
  const batches = [];
  for (let i = 0; i < chunks.length; i += 5) {
    batches.push(chunks.slice(i, i + 5).map(text => ({ type: "text", text })));
  }
  return batches;
}

/**
 * @param {any} existing
 * @param {{ recommendations: any[], day: string, birthdays?: any[], groups?: string[], users?: string[] }} input
 * @returns {any}
 */
export function ensureSecondaryDelivery(existing, { recommendations, day, birthdays = [], groups = [], users = [] }) {
  if (existing) return existing;
  const batches = digestMessages(recommendations, day, { title: "AviCore — Training Due Date", birthdays });
  const destinations = [
    ...groups.map((id) => ({ kind: "group", id, sent: batches.map(() => false) })),
    ...users.map((id) => ({ kind: "private", id, sent: batches.map(() => false) })),
  ];
  return { batches, destinations };
}

/**
 * @param {any} existing
 * @param {{ companyId: string, groupId: string, day: string, birthdays?: any[], primaryRecommendations: any[], secondaryRecommendations: any[], groups?: string[], users?: string[] }} input
 * @returns {Promise<any>}
 */
export async function ensureDeliverySnapshot(existing, input) {
  const secondary = ensureSecondaryDelivery(existing?.secondary, {
    recommendations: input.secondaryRecommendations,
    day: input.day,
    birthdays: input.birthdays,
    groups: input.groups,
    users: input.users,
  });
  for (const destination of secondary.destinations) {
    if (!destination.batches) {
      destination.batches = await Promise.all(secondary.batches.map(async (_, index) => ({
        retryKey: await deliveryRetryKey(`${input.companyId}|${destination.kind}|${destination.id}|${input.day}|${index}`),
        sent: Boolean(destination.sent?.[index]),
      })));
      delete destination.sent;
    }
  }
  if (existing) {
    existing.secondary = secondary;
    return existing;
  }
  const batches = await Promise.all(digestMessages(input.primaryRecommendations, input.day, { birthdays: input.birthdays })
    .map(async (messages, index) => ({
      messages,
      retryKey: await deliveryRetryKey(`${input.companyId}|${input.groupId}|${input.day}|${index}`),
      sent: false,
    })));
  return { day: input.day, groupId: input.groupId, complete: false, batches, secondary };
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
