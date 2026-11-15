// Daily Training Due & FTL email alerts (Admin Settings): who gets them and
// when. Capt. Weera: each recipient has their own time of day (Bangkok), e.g.
// dispatch at 05:00, the chief pilot at 07:00. Saved as
//   { enabled, recipients: [{ email, time: "HH:MM" }], toAddress }
// toAddress (the same addresses, comma-separated) is kept for the older
// server function, which reads only that and sends everyone at 05:00.

export const DEFAULT_ALERT_TIME = "05:00";
export const MAX_ALERT_RECIPIENTS = 10;

// 00:00, 00:15 ... 23:45 - the server checks every 15 minutes.
export const ALERT_TIME_OPTIONS = Array.from({ length: 96 }, (_, i) =>
  `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

// The recipient rows from a saved (or old-style) config.
export function alertRecipients(cfg = {}) {
  if (Array.isArray(cfg.recipients)) {
    return cfg.recipients.map((r) => ({
      email: String(r?.email || "").trim(),
      time: ALERT_TIME_OPTIONS.includes(r?.time) ? r.time : DEFAULT_ALERT_TIME
    }));
  }
  return String(cfg.toAddress || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((email) => ({ email, time: DEFAULT_ALERT_TIME }));
}

export function normalizeAlertEmailConfig(cfg = {}) {
  const rows = alertRecipients(cfg).filter((r) => r.email);
  const seen = new Set();
  const recipients = [];
  for (const r of rows) {
    if (!EMAIL_RE.test(r.email)) throw new Error(`"${r.email}" is not a valid email address.`);
    const key = r.email.toLowerCase();
    if (seen.has(key)) throw new Error(`${r.email} is listed twice.`);
    seen.add(key);
    recipients.push(r);
  }

  if (recipients.length > MAX_ALERT_RECIPIENTS) {
    throw new Error("Email notifications support up to 10 recipients.");
  }
  if (cfg.enabled && recipients.length === 0) {
    throw new Error("Add at least one recipient before enabling email notifications.");
  }

  return {
    enabled: !!cfg.enabled,
    recipients,
    toAddress: recipients.map((r) => r.email).join(", ")
  };
}
