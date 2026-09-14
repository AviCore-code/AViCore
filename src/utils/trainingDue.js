// Flight Crew Training DUE tracking - mirrors the "Pilot Training DUE
// Monitor" sheet in the Training Track(V.3).xlsm workbook the company
// already uses (imported via the Training DUE module's "Import Excel"
// button). Every item here is a due-date except iApp180, which is a rolling
// 180-day COUNT minimum, not a date - same "must reach at least this much"
// shape as the FTL currency minimums in ftlLimits.js (iappMin180d etc).
export const TRAINING_ITEMS = [
  { key: "passport", label: "Passport" },
  { key: "thaiLicense", label: "Thai License" },
  { key: "medical", label: "Medical" },
  { key: "lpc", label: "LPC" },
  { key: "opc2", label: "OPC2" },
  { key: "lineCheck", label: "Line Check" },
  { key: "flightTraining", label: "Flight Training" },
  { key: "night", label: "Night Currency", maxSeverity: "warn" },
  { key: "crm", label: "CRM" },
  { key: "huet", label: "HUET" },
  { key: "firstAids", label: "First Aids" },
  { key: "fireFighting", label: "Fire Fighting" },
  { key: "ese", label: "ESE Training" },
  { key: "ground", label: "Ground" },
  { key: "dgs", label: "Dangerous Goods" },
  { key: "cac", label: "CAC" },
  { key: "icaoEnglish", label: "ICAO English" },
  { key: "sms", label: "SMS" },
  { key: "avsec", label: "AVSEC" },
  { key: "caAircraft", label: "Check Airmen (Aircraft)" },
  { key: "caSim", label: "Check Airmen (Sim)" },
  { key: "dcpCert", label: "DCP Certificate" },
  { key: "pbn", label: "PBN" },
  { key: "iApp180", label: "I.APP (180D)", type: "count" },
  { key: "egpwsTcas", label: "EGPWS & TCAS" },
  { key: "recencyFI", label: "Recency — Flight Instructor" },
  { key: "recencySI", label: "Recency — Sim Instructor" },
  { key: "recencyCAAircraft", label: "Recency — CA (Aircraft)" },
  { key: "recencyCASim", label: "Recency — CA (Sim)" },
  { key: "dcpReport", label: "DCP Report" }
  // "Flight Recency (90D)" removed at Capt. Weera's instruction. It is not a
  // training item: recency is a rolling COUNT that FDT Monitor already tracks
  // from recorded flights, and carrying it here as a due date meant two
  // pages could disagree about the same pilot.
  //
  // It was the LAST entry, which matters: the Excel importer maps columns
  // B..AF positionally onto this array, so dropping the final one leaves
  // every other column matched to the same item. Do not remove one from the
  // middle without fixing trainingImport.js.
];

// Caution windows (in days before due) copied from row 24 ("Caution") of the
// source workbook's "Pilot Training DUE Monitor" sheet. iApp180 is the
// minimum count instead of a day window ("No. < 5" in the sheet). Editable
// later from Settings if the company wants to tune these - stored the same
// way ftl_limits is (a single app_settings row, synced to every device).
export const DEFAULT_TRAINING_THRESHOLDS = {
  passport: 200, thaiLicense: 90, medical: 90, lpc: 90, opc2: 90, lineCheck: 90,
  flightTraining: 90, night: 30, crm: 90, huet: 90, firstAids: 90, fireFighting: 90,
  ese: 60, ground: 90, dgs: 90, cac: 60, icaoEnglish: 240, sms: 60, avsec: 60,
  caAircraft: 180, caSim: 180, dcpCert: 180, pbn: 90, iApp180: 5, egpwsTcas: 90,
  recencyFI: 180, recencySI: 180, recencyCAAircraft: 365, recencyCASim: 365,
  dcpReport: 30
};

export function withTrainingThresholdDefaults(saved) {
  return { ...DEFAULT_TRAINING_THRESHOLDS, ...(saved || {}) };
}

// --- How long each item TAKES ----------------------------------------------
// A due date says when something must be done by. It says nothing about how
// much of the pilot's time it costs, and that is what the flight planner
// needs: a two-day HUET course removes a pilot from the line for two days,
// a passport renewal might cost half a morning.
//
// Entered per item in Training Setting (Capt. Weera: "ให้สามารถป้อนเวลาในการทำ
// เอกสารใหม่ ฝึกอบรมแต่ละ course ได้ กี่วัน กี่ชั่วโมง ... เพื่อประโยชน์ในการ
// วางแผนการจัดบิน").
//
//   { days: 2, hours: 16 }   two days, sixteen duty hours in total
//
// Nothing here is INVENTED. The rule stands that a plausible-looking guess on a
// planning screen is worse than a blank the planner can see is blank, so an item
// only appears below once Capt. Weera has actually stated its length.
//
// The simulator is at SUBANG, MALAYSIA, so a sim visit spans travel out, the
// details, and travel back - not a day at the office. LPC and OPC are different
// lengths (Capt. Weera: "SIM (LPC =5 วัน OPC=4 วัน) at Malaysia subang"):
export const DEFAULT_TRAINING_DURATIONS = {
  lpc: { days: 5 },    // LPC at Subang, including travel
  opc2: { days: 4 }    // OPC at Subang, including travel
};

export function withTrainingDurationDefaults(saved) {
  return { ...DEFAULT_TRAINING_DURATIONS, ...(saved || {}) };
}

function positiveOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Normalises one entry to { days, hours } with nulls for "not set", so every
// consumer can tell "nobody has filled this in" from "zero".
export function trainingDuration(durations, key) {
  const raw = durations?.[key];
  if (!raw) return { days: null, hours: null, known: false };
  const days = positiveOrNull(raw.days);
  const hours = positiveOrNull(raw.hours);
  return { days, hours, known: days != null || hours != null };
}

export function describeTrainingDuration(durations, key) {
  const d = trainingDuration(durations, key);
  if (!d.known) return "";
  const parts = [];
  if (d.days != null) parts.push(`${d.days} day${d.days === 1 ? "" : "s"}`);
  if (d.hours != null) parts.push(`${d.hours} h`);
  return parts.join(" · ");
}

// Which items are actively monitored (drive overall status/badges/
// recommendations) - admin can turn individual items off from Training
// Setting (e.g. an item the company doesn't track for a given fleet) without
// losing the recorded data itself; a disabled item's value is still stored
// and still shown in the per-item breakdown, it just can't turn a pilot's
// overall badge yellow/red or generate a Dashboard recommendation.
export const DEFAULT_TRAINING_DISABLED_ITEMS = [];

export function withTrainingDisabledDefaults(saved) {
  return Array.isArray(saved) ? saved : DEFAULT_TRAINING_DISABLED_ITEMS;
}

export function monitoredTrainingItems(disabledItems) {
  const disabled = new Set(disabledItems || []);
  return TRAINING_ITEMS.filter((item) => !disabled.has(item.key));
}

// I.APP (180D) is entered via the "I.App" field on the Daily Duty flight
// form and rolled up automatically (same as the FTL currency counts) - it
// isn't a due-date an admin sets by hand, so it's hidden from the Training
// Setting UI's per-item threshold/due-date editor. Still fully computed and
// shown everywhere else (per-item breakdown, Dashboard recommendations) -
// only the Settings editor screen hides it, since there's nothing to set.
export const SETTINGS_HIDDEN_TRAINING_ITEMS = ["iApp180"];

export function settingsVisibleTrainingItems() {
  const hidden = new Set(SETTINGS_HIDDEN_TRAINING_ITEMS);
  return TRAINING_ITEMS.filter((item) => !hidden.has(item.key));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// value: ISO date string / Date, "For life" (lifetime marker), a number (for
// the iApp180 count item), or null/"" (never recorded in the source data).
// thresholdDays: caution window in days for date items, or the minimum
// count for iApp180.
export function classifyTrainingValue(item, value, thresholdDays, today = new Date()) {
  if (value == null || value === "") return { status: "unknown", daysRemaining: null };

  if (item.type === "count") {
    const n = Number(value);
    if (isNaN(n)) return { status: "unknown", daysRemaining: null };
    return { status: n < thresholdDays ? "warn" : "ok", daysRemaining: null, count: n };
  }

  if (typeof value === "string" && /life/i.test(value)) {
    return { status: "ok", daysRemaining: null, lifetime: true };
  }

  const due = value instanceof Date ? value : new Date(value);
  if (isNaN(due.getTime())) return { status: "unknown", daysRemaining: null };

  const daysRemaining = Math.floor((due.getTime() - today.getTime()) / MS_PER_DAY);
  let status = daysRemaining < 0 ? "exc" : daysRemaining <= thresholdDays ? "warn" : "ok";
  // Night Currency (maxSeverity:"warn") never escalates to red even when
  // actually overdue - overdue night currency only restricts night flying,
  // it doesn't ground the pilot for day operations, so it stays a caution
  // (yellow) rather than a violation (red). Downstream wording (below and
  // in TrainingItemCell) still needs to say "expired" for a genuinely
  // overdue item, so it checks the real daysRemaining, not this capped
  // status.
  if (item.maxSeverity === "warn" && status === "exc") status = "warn";
  return { status, daysRemaining, dueDate: due };
}

// Overall status for a pilot's whole record - worst item wins (exc > warn >
// ok), mirroring the FTL badge on My Status/All Status. Items with no data
// yet ("unknown") don't drag the overall badge to yellow/red on their own -
// they're still visible individually in the per-item breakdown so a gap in
// the imported data isn't hidden, just not treated as a violation. Only
// items in `monitoredKeys` count toward the overall badge - a disabled item
// (Training Setting's per-item Monitor toggle, off) never drags the badge
// yellow/red even if its own status is warn/exc, but its computed status is
// still returned per-item so the breakdown table isn't missing data.
export function overallTrainingStatus(perItem, monitoredKeys) {
  const keys = monitoredKeys ? new Set(monitoredKeys) : null;
  const statuses = Object.entries(perItem)
    .filter(([key]) => !keys || keys.has(key))
    .map(([, r]) => r.status);
  if (statuses.includes("exc")) return "exc";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

export function computeTrainingRow(record, thresholds, disabledItems, today = new Date()) {
  const perItem = {};
  for (const item of TRAINING_ITEMS) {
    perItem[item.key] = classifyTrainingValue(item, record?.[item.key], thresholds[item.key], today);
  }
  const monitoredKeys = monitoredTrainingItems(disabledItems).map((item) => item.key);
  return { perItem, status: overallTrainingStatus(perItem, monitoredKeys) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Same "D Mon YYYY" format Settings.jsx's About panel already uses for
// license expiry, for a consistent look. Uses local-time getters like that
// function does - fine for a UTC-midnight due date as long as the system
// timezone isn't behind UTC (true for Thailand/UTC+7, where this app runs).
export function formatDueDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "-";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Plain-language recommendations for one pilot's training record - same
// {key, pilot, status, text} shape as buildRecommendations in
// statusCompute.js, so Dashboard can merge FTL and Training issues into one
// sorted feed. Only warn/exc items produce a recommendation (ok and unknown
// don't - "unknown" means no data yet, not a violation, and is only shown in
// the per-item breakdown on the Training pages).
export function buildTrainingRecommendations(pilot, thresholds, disabledItems, today = new Date()) {
  const who = `${pilot.code || "-"} — ${pilot.name || "-"}`;
  const computed = computeTrainingRow(pilot.record, thresholds, disabledItems, today);
  const disabled = new Set(disabledItems || []);
  const recs = [];
  for (const item of TRAINING_ITEMS) {
    if (disabled.has(item.key)) continue;
    const r = computed.perItem[item.key];
    if (r.status !== "warn" && r.status !== "exc") continue;
    const isExc = r.status === "exc";
    // Wording keys off the REAL overdue-ness (daysRemaining < 0), not the
    // (possibly maxSeverity-capped) status - Night Currency reads "warn"
    // even when actually overdue, but the text should still say "expired",
    // not "due", once the date has genuinely passed.
    const isOverdue = item.type !== "count" && r.daysRemaining != null && r.daysRemaining < 0;
    let valueText, action;
    if (item.type === "count") {
      valueText = `${r.count} recorded (min ${thresholds[item.key]})`;
      action = isExc ? "below the required minimum — schedule more before the window closes." : "approaching the required minimum.";
    } else {
      valueText = isOverdue ? `expired ${formatDueDate(r.dueDate)} (${Math.abs(r.daysRemaining)}d ago)` : `due ${formatDueDate(r.dueDate)} (${r.daysRemaining}d left)`;
      action = isOverdue ? "renew immediately." : "schedule renewal soon.";
    }
    recs.push({
      key: `training|${pilot.code}|${item.key}`,
      pilot: who, status: r.status,
      text: `${who}: ${item.label} ${valueText} — ${action}`
    });
  }
  return recs;
}
