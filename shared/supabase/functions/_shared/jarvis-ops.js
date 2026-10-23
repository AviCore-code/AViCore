const SAFE_STATUS = new Set(["warn", "exc"]);

export function authorizedJarvisRequest(authorization, secret) {
  if (!secret || typeof secret !== "string" || secret.length < 32) return false;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const candidate = authorization.slice(7);
  if (candidate.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < secret.length; i += 1) mismatch |= candidate.charCodeAt(i) ^ secret.charCodeAt(i);
  return mismatch === 0;
}

function shortText(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function safeAlert(row, kind) {
  const status = SAFE_STATUS.has(row?.status) ? row.status : "warn";
  const key = shortText(row?.key, 160);
  const text = shortText(row?.text, 500);
  if (!key || !text) return null;
  const pilot = shortText(row?.pilot, 160);
  return { key, kind, status, text, ...(pilot ? { pilot } : {}) };
}

/** @param {{generatedAt: Date|string, roster?: any[], ftlAlerts?: any[], trainingAlerts?: any[]}} input */
export function sanitizeOpsSnapshot({ generatedAt, roster = [], ftlAlerts = [], trainingAlerts = [] }) {
  if (roster.length > 2000 || ftlAlerts.length > 1000 || trainingAlerts.length > 1000) {
    throw new Error("Operational snapshot exceeds safe response limits");
  }
  return {
    ok: true,
    generated_at: new Date(generatedAt).toISOString(),
    roster: roster.map(row => ({
      pilot_id: shortText(row?.pilot_code, 32),
      pilot_name: shortText(row?.pilot_name, 120),
      date: shortText(row?.date, 10),
      assignment: shortText(row?.code, 80),
      base: shortText(row?.base, 40),
    })).filter(row => row.pilot_id && row.date),
    ftl_alerts: ftlAlerts.map(row => safeAlert(row, "ftl")).filter(Boolean),
    training_alerts: trainingAlerts.map(row => safeAlert(row, "training")).filter(Boolean),
  };
}
