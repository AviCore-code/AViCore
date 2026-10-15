export function normalizeAlertEmailConfig(cfg = {}) {
  const recipients = String(cfg.toAddress || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (recipients.length > 10) {
    throw new Error("Email notifications support up to 10 recipients.");
  }
  if (cfg.enabled && recipients.length === 0) {
    throw new Error("Add at least one recipient before enabling email notifications.");
  }

  return {
    enabled: !!cfg.enabled,
    toAddress: recipients.join(", ")
  };
}
