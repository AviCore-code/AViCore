const ADMIN_INTENTS = [
  ["help", /(ข้อมูล.*(?:avicore\s*)?admin|admin.*มีอะไร|ข้อมูลในระบบ)/i],
  ["roster", /(ตารางบิน|ตารางเวร|roster|ตารางปฏิบัติงาน)/i],
  ["weeklyPlan", /(แผนรายสัปดาห์|แผนประจำสัปดาห์|weekly\s*plan|training\s*plan)/i],
  ["training", /(training|ฝึกอบรม|ใบอนุญาต|licen[cs]e|currency|หมดอายุ|ครบกำหนด)/i],
  ["experience", /(experience|ประสบการณ์|ชั่วโมงบิน|flight\s*hours?)/i],
  ["duty", /(duty|ftl|เวลาปฏิบัติหน้าที่|เวลาพัก|fatigue)/i],
  ["pilots", /(รายชื่อนักบิน|pilot\s*list|นักบินทั้งหมด)/i],
];

const BLOCKED_FIELD = /(email|phone|mobile|address|birth|passport|national|photo|image|document|file|attachment|token|secret|password|device|user.?id|uuid|raw|note|remark)/i;
const CODE_STOPWORDS = new Set(["AI", "ALL", "BOT", "DUTY", "FTL", "LINE", "MORE", "PLAN"]);

function cleanCommand(value) {
  return String(value || "").replace(/@?avicore\s*(bot)?/ig, "").trim();
}

function pilotCodeFrom(command) {
  const hits = cleanCommand(command).match(/\b[A-Z]{2,4}\b/g) || [];
  return hits.find(code => !CODE_STOPWORDS.has(code)) || null;
}

function bangkokDate(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function classifyAdminQuery(value) {
  const command = cleanCommand(value);
  const match = ADMIN_INTENTS.find(([, pattern]) => pattern.test(command));
  if (!match) return null;
  return {
    kind: match[0],
    pilotCode: pilotCodeFrom(command),
    dayOffset: /(พรุ่งนี้|tomorrow)/i.test(command) ? 1 : 0,
    command,
  };
}

function safeScalars(value, prefix = "", depth = 0, out = []) {
  if (!value || typeof value !== "object" || depth > 2 || out.length >= 14) return out;
  for (const [key, item] of Object.entries(value)) {
    if (out.length >= 14 || BLOCKED_FIELD.test(key)) continue;
    const label = prefix ? `${prefix}.${key}` : key;
    if (item == null || item === "") continue;
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      const text = String(item);
      if (text.length <= 120 && !/^data:|^https?:\/\//i.test(text)) out.push(`${label}: ${text}`);
    } else if (!Array.isArray(item)) {
      safeScalars(item, label, depth + 1, out);
    }
  }
  return out;
}

function formatRows(intent, rows) {
  if (!rows.length) return "ไม่พบข้อมูลที่ตรงกับคำถามใน AviCore Admin ครับ";
  if (intent.kind === "roster") {
    return rows.slice(0, 30).map(row => `${row.date} · ${row.pilot_code}${row.pilot_name ? ` ${row.pilot_name}` : ""} · ${row.code || "-"}${row.base ? ` · ${row.base}` : ""}`).join("\n");
  }
  if (intent.kind === "weeklyPlan") {
    return rows.slice(0, 30).map(row => `${row.date} · ${row.section || "-"}/${row.slot ?? "-"} · ${row.pilot_code || "-"}${row.level ? ` · ${row.level}` : ""}`).join("\n");
  }
  if (intent.kind === "pilots") {
    const unique = new Map(rows.map(row => [row.pilot_code, row]));
    return [...unique.values()].slice(0, 40).map(row => `${row.pilot_code} · ${row.pilot_name || row.name || "-"}${row.base ? ` · ${row.base}` : ""}`).join("\n");
  }
  if (intent.kind === "duty") {
    return rows.slice(0, 20).map(row => {
      const fields = safeScalars(row.entry_json).slice(0, 6);
      return `${row.date} · ${row.pilot_code} · ${row.duty_type || "-"}${fields.length ? `\n${fields.join(" · ")}` : ""}`;
    }).join("\n\n");
  }
  return rows.slice(0, 10).map(row => {
    const fields = safeScalars(row.record_json);
    const heading = `${row.code || row.licence || row.pilot_code || "-"} · ${row.name || "-"}`;
    return `${heading}${fields.length ? `\n${fields.join(" · ")}` : ""}`;
  }).join("\n\n");
}

export function createSupabaseAdminReader(sb, companyId) {
  return async intent => {
    const today = bangkokDate(intent.now || new Date());
    const target = new Date(`${today}T00:00:00+07:00`);
    target.setUTCDate(target.getUTCDate() + intent.dayOffset);
    const date = bangkokDate(target);
    let query;
    if (intent.kind === "roster") {
      query = sb.from("Admin_pilot_roster").select("pilot_code,pilot_name,base,date,code")
        .eq("company_id", companyId).eq("date", date).is("deleted_at", null).order("pilot_code").limit(50);
    } else if (intent.kind === "weeklyPlan") {
      const end = new Date(`${date}T00:00:00+07:00`); end.setUTCDate(end.getUTCDate() + 6);
      query = sb.from("Admin_pilot_weekly_plan").select("date,section,slot,pilot_code,level")
        .eq("company_id", companyId).gte("date", date).lte("date", bangkokDate(end)).is("deleted_at", null).order("date").limit(100);
    } else if (intent.kind === "training") {
      query = sb.from("Admin_pilot_training").select("code,name,record_json")
        .eq("company_id", companyId).is("deleted_at", null).order("code").limit(intent.pilotCode ? 5 : 30);
    } else if (intent.kind === "experience") {
      query = sb.from("Admin_pilot_experience").select("licence,code,name,update_date,record_json")
        .eq("company_id", companyId).is("deleted_at", null).order("code").limit(intent.pilotCode ? 5 : 30);
    } else if (intent.kind === "duty") {
      const start = new Date(`${date}T00:00:00+07:00`); start.setUTCDate(start.getUTCDate() - 27);
      query = sb.from("Admin_pilot_duty_entries").select("pilot_code,date,duty_type,entry_json")
        .eq("company_id", companyId).gte("date", bangkokDate(start)).lte("date", date).is("deleted_at", null).order("date", {ascending:false}).limit(50);
    } else {
      query = sb.from("Admin_pilot_roster").select("pilot_code,pilot_name,base")
        .eq("company_id", companyId).is("deleted_at", null).order("pilot_code").limit(1000);
    }
    if (intent.pilotCode && intent.kind !== "pilots") {
      const column = ["training", "experience"].includes(intent.kind) ? "code" : "pilot_code";
      query = query.eq(column, intent.pilotCode);
    }
    const {data, error} = await query;
    if (error) throw error;
    return data || [];
  };
}

export async function replyAdminData(event, {groupId, read, now = new Date()}) {
  if (event?.type !== "message" || event.message?.type !== "text" || !event.replyToken) return null;
  const intent = classifyAdminQuery(event.message.text);
  if (!intent) return null;
  if (event.source?.type === "user") return "ข้อมูลจาก AviCore Admin ใช้ได้เฉพาะกลุ่มนักบินที่บริษัทกำหนดครับ";
  if (event.source?.type !== "group" || !groupId || event.source.groupId !== groupId) return null;
  if (intent.kind === "help") {
    return "AviCore Bot อ่านข้อมูลปฏิบัติการจาก AviCore Admin ได้ดังนี้ครับ\n• ตารางบิน/ตารางเวร\n• แผนรายสัปดาห์\n• สถานะ Training และ Currency\n• ประสบการณ์และชั่วโมงบิน\n• Duty/FTL ย้อนหลัง\n• รายชื่อนักบิน\n\nระบุรหัสนักบินเมื่อถามข้อมูลรายบุคคล เช่น “AviCore Bot training PDE” ครับ";
  }
  if (["duty", "training", "experience"].includes(intent.kind) && !intent.pilotCode) {
    return "กรุณาระบุรหัสนักบิน เช่น “AviCore Bot ข้อมูล training PDE” ครับ";
  }
  const rows = await read({...intent, now});
  const response = `ข้อมูลล่าสุดจาก AviCore Admin\n${formatRows(intent, rows)}\n\nข้อมูลนี้ใช้เพื่อการปฏิบัติงานภายในบริษัท โปรดตรวจสอบใน Admin ก่อนนำไปใช้ครับ`;
  return Array.from(response).slice(0, 4900).join("");
}
