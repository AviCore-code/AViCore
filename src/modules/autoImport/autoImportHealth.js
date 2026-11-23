// Is Auto Import actually bringing the Excel files in? (Capt. Weera,
// 23 Nov 2026: the office PC was off from 22 Nov 16:30, so nothing reached
// the VPS and every import re-read yesterday's files - nobody noticed for a
// day.) Two things can stop it, and the admin pages now say so:
//   vps - the AviCore Auto Import service on the VPS has stopped reporting:
//         nothing is imported at all;
//   pc  - the office PC (AviCore Sync) has not sent files: imports run, but
//         on old copies, so changes in the Excel files don't arrive.
// Pure - the banner is AutoImportAlert.jsx.

export const VPS_ALERT_MINUTES = 15;   // the VPS reports every 5 minutes
export const PC_ALERT_MINUTES = 60;    // the PC syncs every 5 minutes

const minutesSince = (iso, now) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? Math.max(0, (now - t) / 60000) : null;
};

// null when all is well (or Auto Import is switched off); otherwise
// { kind: "vps" | "pc", level: "exc" | "warn", minutes, since, host }.
export function autoImportHealth(status, config, now = Date.now()) {
  if (!config?.enabled || !status) return null;
  const vps = minutesSince(status.heartbeat, now);
  if (vps == null || vps > VPS_ALERT_MINUTES) {
    return { kind: "vps", level: "exc", minutes: vps, since: status.heartbeat || null, host: "" };
  }
  const pc = minutesSince(status.pcLastSync, now);
  if (pc == null || pc > PC_ALERT_MINUTES) {
    return { kind: "pc", level: "warn", minutes: pc, since: status.pcLastSync || null, host: status.pcHost || "" };
  }
  return null;
}

// "6 ชม. 10 นาที" / "1 วัน 3 ชม." / "45 นาที".
export function thaiDuration(minutes) {
  if (minutes == null) return "";
  const m = Math.floor(minutes);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d) return `${d} วัน${h ? ` ${h} ชม.` : ""}`;
  if (h) return `${h} ชม.${mm ? ` ${mm} นาที` : ""}`;
  return `${mm} นาที`;
}
