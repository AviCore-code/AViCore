const ADMIN_INTENTS = [
  ["help", /(ข้อมูล.*(?:avicore\s*)?admin|admin.*มีอะไร|ข้อมูลในระบบ)/i],
  ["roster", /(ตารางบิน|ตารางเวร|roster|ตารางปฏิบัติงาน)/i],
  ["weeklyPlan", /(แผนรายสัปดาห์|แผนประจำสัปดาห์|weekly\s*plan|training\s*plan)/i],
  ["training", /(training|ฝึกอบรม|ใบอนุญาต|licen[cs]e|currency|หมดอายุ|ครบกำหนด)/i],
  ["experience", /(experience|ประสบการณ์|ชั่วโมงบิน|flight\s*hours?)/i],
  ["duty", /(duty|ftl|เวลาปฏิบัติหน้าที่|เวลาพัก|fatigue)/i],
  ["pilots", /(รายชื่อนักบิน|pilot\s*list|นักบินทั้งหมด)/i],
  ["overdue", /(overdue|หมดอายุ|ครบกำหนด|ล้าหลัง|night\s*recency|ฝึกครบ)/i],
];

const BLOCKED_FIELD = /(email|phone|mobile|address|birth|passport|national|photo|image|document|file|attachment|token|secret|password|device|user.?id|uuid|raw|note|remark|emergency|employee|blood|contact|personalDetails)/i;

const ALLOWLIST = {
  roster: new Set(["pilot_code", "pilot_name", "base", "date", "code"]),
  weeklyPlan: new Set(["date", "section", "slot", "pilot_code", "level"]),
  training: new Set(["code", "name", "licence", "checklist_type", "completion_date", "expiry_date", "status", "nightCurrency"]),
  experience: new Set(["licence", "code", "name", "category", "total_hours", "update_date"]),
  duty: new Set(["date", "pilot_code", "duty_type", "start_time", "end_time", "total_hours"]),
  pilots: new Set(["pilot_code", "pilot_name", "base", "rank", "type_rating"]),
};
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

function formatField(key, value, intent) {
  if (!value || value === "") return null;
  if (BLOCKED_FIELD.test(key)) return null;
  const allowedFields = ALLOWLIST[intent?.kind];
  if (allowedFields && !allowedFields.has(key)) return null;
  const text = String(value);
  if (text.length > 120 || /^data:|^https?:\/\//i.test(text)) return null;
  return text;
}

function extractSafeFields(row, intent) {
  const fields = [];
  if (!row || typeof row !== "object") return fields;
  const allowedFields = ALLOWLIST[intent?.kind];
  
  // Extract from flat row fields
  for (const key of allowedFields || []) {
    const value = formatField(key, row[key], intent);
    if (value) fields.push(value);
  }
  
  // Extract from nested record_json if present
  if (row.record_json && typeof row.record_json === "object") {
    for (const key of allowedFields || []) {
      if (fields.some(f => f.includes(row.record_json[key]))) continue; // avoid duplicates
      const value = formatField(key, row.record_json[key], intent);
      if (value) fields.push(value);
    }
  }
  
  return fields.slice(0, 6);
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
  if (intent.kind === "training") {
    return rows.slice(0, 15).map(row => {
      const fields = extractSafeFields(row, intent);
      return fields.length ? fields.join(" · ") : `${row.code || "?"} · ${row.name || "?"}`;
    }).join("\n");
  }
  if (intent.kind === "experience") {
    return rows.slice(0, 15).map(row => {
      const fields = extractSafeFields(row, intent);
      return fields.length ? fields.join(" · ") : `${row.licence || "?"} · ${row.code || "?"} · ${row.name || "?"}`;
    }).join("\n");
  }
  if (intent.kind === "duty") {
    return rows.slice(0, 20).map(row => {
      const fields = extractSafeFields(row, intent);
      return `${row.date} · ${row.pilot_code} · ${row.duty_type || "-"}${fields.length ? `\n${fields.join(" · ")}` : ""}`;
    }).join("\n\n");
  }
  if (intent.kind === "overdue") {
    const today = intent.now ? bangkokDate(intent.now) : bangkokDate(new Date());
    const overdue = [];
    for (const row of rows) {
      const expiry = row.expiry_date || (row.record_json?.expiry_date);
      if (expiry && expiry < today) {
        const code = row.code || row.pilot_code || "?";
        const name = row.name || row.pilot_name || "?";
        const type = row.checklist_type || row.licence || "Training";
        overdue.push(`⚠️ ${code} · ${name} · ${type} · หมดอายุ ${expiry}`);
      }
    }
    if (!overdue.length) return "ไม่มีนักบินที่มี training/recency หมดอายุครับ";
    return overdue.slice(0, 20).join("\n");
  }
}

export async function createSupabaseAdminReader(sb, companyId) {
  if (!sb || !companyId) throw new Error("Missing Supabase client or company ID");
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
      query = sb.from("Admin_pilot_training").select("code,name,checklist_type,completion_date,expiry_date,status,record_json")
        .eq("company_id", companyId).is("deleted_at", null).order("code").limit(intent.pilotCode ? 5 : 30);
      if (intent.pilotCode) query = query.eq("code", intent.pilotCode);
    } else if (intent.kind === "experience") {
      query = sb.from("Admin_pilot_experience").select("licence,code,name,category,total_hours,update_date,record_json")
        .eq("company_id", companyId).is("deleted_at", null).order("code").limit(intent.pilotCode ? 5 : 30);
      if (intent.pilotCode) query = query.eq("code", intent.pilotCode);
    } else if (intent.kind === "duty") {
      const start = new Date(`${date}T00:00:00+07:00`); start.setUTCDate(start.getUTCDate() - 27);
      query = sb.from("Admin_pilot_duty_entries").select("pilot_code,date,duty_type,start_time,end_time,total_hours,entry_json")
        .eq("company_id", companyId).gte("date", bangkokDate(start)).lte("date", date).is("deleted_at", null).order("date", {ascending:false}).limit(50);
    } else if (intent.kind === "overdue") {
      // Check training expiry across all pilots
      query = sb.from("Admin_pilot_training").select("code,pilot_code,name,pilot_name,checklist_type,expiry_date,record_json")
        .eq("company_id", companyId).is("deleted_at", null).order("code").limit(100);
    } else {
      query = sb.from("Admin_pilot_roster").select("pilot_code,pilot_name,base")
        .eq("company_id", companyId).is("deleted_at", null).order("pilot_code").limit(1000);
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
    return "AviCore Bot อ่านข้อมูลปฏิบัติการจาก AviCore Admin ได้ดังนี้ครับ\n• ตารางบิน/ตารางเวร\n• แผนรายสัปดาห์\n• สถานะ Training และ Currency\n• ประสบการณ์และชั่วโมงบิน\n• Duty/FTL ย้อนหลัง\n• รายชื่อนักบิน\n• ใครมี training/recency หมดอายุ\n\nระบุรหัสนักบินเมื่อถามข้อมูลรายบุคคล เช่น “AviCore Bot training PDE” ครับ";
  }
  if (["duty", "training", "experience"].includes(intent.kind) && !intent.pilotCode) {
    return "กรุณาระบุรหัสนักบิน เช่น “AviCore Bot ข้อมูล training PDE” ครับ";
  }
  try {
    const rows = await read({...intent, now});
    const response = `ข้อมูลล่าสุดจาก AviCore Admin\n${formatRows(intent, rows)}\n\nข้อมูลนี้ใช้เพื่อการปฏิบัติงานภายในบริษัท โปรดตรวจสอบใน Admin ก่อนนำไปใช้ครับ`;
    return Array.from(response).slice(0, 4900).join("");
  } catch (err) {
    console.error("[admin-data] query failed", err);
    return "ขณะนี้อ่านข้อมูล Admin ไม่ได้ กรุณาลองใหม่ครับ";
  }
}

// Detect if query needs both admin data AND knowledge explanation
export function isHybridQuery(query) {
  const text = String(query || "").toLowerCase();
  // Queries about "overdue", "due", "recency" + asking "who" → need both admin list + explanation
  return /overdue|due|recency|หมดอายุ|ครบกำหนด|ล้าหลัง/i.test(text);
}
