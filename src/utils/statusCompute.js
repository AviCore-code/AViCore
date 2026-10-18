// desktopDatabase.js is imported dynamically inside loadAllPilotStatusRows
// below, NOT at module top-level - it pulls in @capacitor/core, which is
// fine in the Vite/Electron renderer but breaks a plain `node` process (e.g.
// the standalone background alert-check script in scripts/alertCheck.mjs)
// that only needs the pure calculation functions in this file and never
// calls loadAllPilotStatusRows itself. Keeping this import lazy lets that
// script `import` this whole file safely.
import { checkRecoveryRest168, buildDutyPeriods, periodDutyCreditHours, maxFdpForReportTime } from "./dutyPeriods.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "./ftlLimits.js";

// Shared "how am I tracking" computation used by My Status, Admin All
// Status, and Dashboard - a lighter-weight rolling-sum view of what's
// logged in Daily Duty, not a full daily-fatigue/max-FDP engine (that's
// buildDutyPeriods/checkRecoveryRest168 in dutyPeriods.js, used alongside
// this for the Recovery Rest section).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "d mmm yyyy HH:mm" - the same date/time convention as DateField/TimeField's
// input format (see src/components/DateField.jsx), used everywhere a Date
// needs to be shown to a user. Never toLocaleString() - that's locale/OS
// dependent and won't match the format used throughout the rest of the app.
export function formatDateTime(d) {
  if (!d) return "-";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}

export function hoursBetweenClock(start, end) {
  if (!start || !end) return 0;
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  let diff = toMin(end) - toMin(start);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

// Duration honoring an explicit endDate (for cross-day non-flight entries
// like Night Standby 17:30 -> 05:30 next day). Falls back to the same-day
// midnight-wrap when no endDate is present.
export function spanHours(startDate, start, endDate, end) {
  if (!start || !end) return 0;
  if (!endDate || endDate === startDate) return hoursBetweenClock(start, end);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const dayDiff = (new Date(endDate) - new Date(startDate)) / 86400000;
  return (dayDiff * 24 * 60 + toMin(end) - toMin(start)) / 60;
}

export function decimalToHHMM(dec) {
  const totalMin = Math.round((dec || 0) * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// "YYYY-MM-DD" -> a Date at LOCAL midnight on that calendar day.
//
// new Date("2026-07-22") parses as UTC midnight, which east of Greenwich is
// 07:00 LOCAL on the 22nd - and that is later than a local-midnight cutoff of
// the 23rd only by accident of timezone. Comparing a UTC-parsed date against a
// local cutoff is what made "DT 7 days" cover six: in Asia/Bangkok the oldest
// day in the window was silently dropped, so every rolling FTL total on FDT
// Monitor, All Status, the Dashboard and the Fatigue page read LOW.
//
// Both sides of the comparison are now built the same way, so the window is
// exactly `days` calendar days ending today, in whatever timezone the user is
// actually in.
function localMidnight(dateStr) {
  const s = String(dateStr || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Not a plain date string (a Date, or an ISO timestamp) - normalise whatever
  // it resolves to down to its own local calendar day.
  const d = new Date(s || dateStr);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function withinDays(dateStr, days) {
  const d = localMidnight(dateStr);
  if (!d) return false;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  // -days+1 so the window INCLUDES today: 7 days = today + the 6 before it.
  cutoff.setDate(cutoff.getDate() - days + 1);
  return d >= cutoff;
}

// Same rolling-window test as withinDays, but anchored on an arbitrary
// reference day instead of "today" - lets us project what a rolling sum
// will look like on a FUTURE day (e.g. tomorrow's 7/14/28-day windows).
export function withinDaysOf(dateStr, days, anchor) {
  const d = localMidnight(dateStr);
  if (!d) return false;
  const cutoff = new Date(anchor);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days + 1);
  const end = new Date(anchor);
  end.setHours(23, 59, 59, 999);
  return d >= cutoff && d <= end;
}

export function classify(value, limit) {
  if (value > limit.max) return "exc";
  if (value >= limit.warn) return "warn";
  return "ok";
}

export const STATUS_LABEL = { ok: "OK", warn: "WARNING", exc: "EXCEEDED" };

// Day/Night Standby only counts at limits.stbyCreditPercent% of its actual
// logged duration toward the DT rolling sums - everything else counts at
// full duration.
export function entryDutyHours(e, limits) {
  const raw = e.dutyType === "flight"
    ? hoursBetweenClock(e.schDep, e.stop)
    : spanHours(e.date, e.start, e.endDate, e.end);
  const isStandby = e.dutyType === "non_flight" && (e.nonFlightType === "Day Standby" || e.nonFlightType === "Night Standby");
  return isStandby ? raw * (limits.stbyCreditPercent / 100) : raw;
}

export function entryFlightHours(e) {
  return e.dutyType === "flight" ? hhmmToDecimal(e.totalFlightTime) : 0;
}

// "YYYY-MM-DD" from a Duty Period's start, using LOCAL calendar components -
// matches the format of entry.date strings, which withinDays compares
// against, so a Duty Period is attributed to the rolling window its report
// day falls in (same convention entries themselves already use).
function dateKeyLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function computeStats(entries, limits) {
  const sumFt = (days) => entries.filter((e) => withinDays(e.date, days)).reduce((s, e) => s + entryFlightHours(e), 0);
  // Duty Time rolling sums are built from merged Duty Periods (buildDutyPeriods),
  // not raw per-entry schDep/stop sums - each period's "Actual Duty" (report
  // - 1:00 through Last Engine Stop, OPS-CM-01 7.9.2-aware for Standby that
  // escalated into a report) is what counts, via periodDutyCreditHours,
  // which also re-applies the stbyCreditPercent credit for any Standby
  // involved (see its own comment in dutyPeriods.js for exactly how).
  const dutyPeriods = buildDutyPeriods(entries, limits);
  const sumDt = (days) => dutyPeriods
    .filter((p) => withinDays(dateKeyLocal(p.start), days))
    .reduce((s, p) => s + periodDutyCreditHours(p, limits), 0);
  const flightEntries90 = entries.filter((e) => e.dutyType === "flight" && withinDays(e.date, 90));
  const flightEntries180 = entries.filter((e) => e.dutyType === "flight" && withinDays(e.date, 180));
  const num = (v) => Number(v) || 0;
  return {
    ft7d: sumFt(7), ft28d: sumFt(28), ft90d: sumFt(90), ft365d: sumFt(365),
    dt7d: sumDt(7), dt14d: sumDt(14), dt28d: sumDt(28),
    toDay90: flightEntries90.reduce((s, e) => s + num(e.toDay), 0),
    toNight90: flightEntries90.reduce((s, e) => s + num(e.toNight), 0),
    landDay90: flightEntries90.reduce((s, e) => s + num(e.landDay), 0),
    landNight90: flightEntries90.reduce((s, e) => s + num(e.landNight), 0),
    iApp180: flightEntries180.reduce((s, e) => s + num(e.iApp), 0),
    // IFR flight-rules time over 180 days (FDT Logbook column V, exposed as
    // ifrRulesHours) - the "IFR(180)" recency figure.
    //
    // Falls back to ifrHours only when ifrRulesHours is ABSENT, which means one
    // of two things, both wanting the fallback:
    //   - an FDT-imported entry from before ifrRulesHours existed, or
    //   - a hand-typed entry from before the form had separate IFR and IMC
    //     boxes, when the single "IFR Hours" field wrote ifrRulesHours' value
    //     into ifrHours (see DutyEntry.jsx).
    // `?? ` and not `||`: an entry saved with IFR deliberately left blank has
    // ifrRulesHours === "", which must count as zero rather than silently
    // falling back to that flight's IMC time and overstating recency.
    ifr180: flightEntries180.reduce((s, e) => s + hhmmToDecimal(e.ifrRulesHours ?? e.ifrHours), 0)
  };
}

// The largest single-day duty (and its flight-time cap) achievable for a
// duty that must END by endTimeStr on `dayDate`, per the report-time FDP
// table (OPS-CM-01 7.4.1). Scans candidate report times and, for each,
// takes min(hours-until-end, that report's Max FDP) - the best of those is
// how long a duty ending at endTimeStr can legally be. Returns the winning
// band's flight-time cap too. Example (default table, end 17:30): reporting
// ~06:30 gives an 11h FDP landing exactly at 17:30, flight cap 8h.
function maxDutyEndingAt(endTimeStr, limits, dayDate) {
  const [eh, em] = String(endTimeStr).split(":").map(Number);
  const endMin = (eh || 0) * 60 + (em || 0);
  let best = { fdp: 0, maxFt: null };
  for (let r = 0; r <= endMin - 60; r += 15) {
    const reportDate = new Date(dayDate);
    reportDate.setHours(0, r, 0, 0);
    const { maxFdp, maxFt } = maxFdpForReportTime(reportDate, limits);
    const feasible = Math.min((endMin - r) / 60, maxFdp);
    if (feasible > best.fdp) best = { fdp: feasible, maxFt };
  }
  return { maxFdp: best.fdp, maxFt: best.maxFt };
}

// "How much flight time and duty time is still available for TOMORROW" - a
// planning figure for the FDT Monitor. Two independent numbers:
//   flightAvailable = min( each FT rolling limit's headroom for tomorrow's
//                          window, the day's Max flight-time cap )
//   dutyAvailable   = min( each DT rolling limit's headroom for tomorrow's
//                          window, the day's Max FDP )
// Rolling headroom is limit.max minus the sum of already-logged duty that
// will still sit inside tomorrow's 7/14/28-day window. The single-day caps
// come from maxDutyEndingAt for a duty ending at endTime (17:30 by default,
// i.e. before Night Standby begins). Each figure also reports which limit is
// the binding constraint, so the planner can see WHY it's capped.
export function computeTomorrowAvailability(entries, limits, opts = {}) {
  const endTime = opts.endTime || "17:30";
  const asOf = opts.asOf || new Date();
  const tomorrow = new Date(asOf);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const sumFt = (days) => entries
    .filter((e) => withinDaysOf(e.date, days, tomorrow))
    .reduce((s, e) => s + entryFlightHours(e), 0);
  const dutyPeriods = buildDutyPeriods(entries, limits);
  const sumDt = (days) => dutyPeriods
    .filter((p) => withinDaysOf(dateKeyLocal(p.start), days, tomorrow))
    .reduce((s, p) => s + periodDutyCreditHours(p, limits), 0);

  const daily = maxDutyEndingAt(endTime, limits, tomorrow);

  const ftConstraints = [
    { key: "FT 7D", left: limits.ft7d.max - sumFt(7) },
    { key: "FT 28D", left: limits.ft28d.max - sumFt(28) },
    { key: "FT 365D", left: limits.ft365d.max - sumFt(365) },
    { key: "Daily flight cap", left: daily.maxFt != null ? daily.maxFt : Infinity }
  ];
  const dtConstraints = [
    { key: "DT 7D", left: limits.dt7d.max - sumDt(7) },
    { key: "DT 14D", left: limits.dt14d.max - sumDt(14) },
    { key: "DT 28D", left: limits.dt28d.max - sumDt(28) },
    { key: "Max FDP", left: daily.maxFdp }
  ];

  const ftMin = ftConstraints.reduce((m, c) => (c.left < m.left ? c : m));
  const dtMin = dtConstraints.reduce((m, c) => (c.left < m.left ? c : m));

  return {
    endTime,
    flightAvailable: Math.max(0, ftMin.left),
    dutyAvailable: Math.max(0, dtMin.left),
    flightLimiter: ftMin.key,
    dutyLimiter: dtMin.key,
    dailyMaxFdp: daily.maxFdp,
    dailyMaxFt: daily.maxFt
  };
}

// Worst-of across a stat block's Bar-classified fields plus the Recovery
// Rest status and the FT 90D customer-requirement minimum - used to badge
// a pilot row "OK/WARNING/EXCEEDED" at a glance in All Status / Dashboard
// without re-rendering every bar.
const RANK = { ok: 0, warn: 1, exc: 2 };
export function overallStatus(stats, limits, recoveryRestStatus) {
  const checks = [
    classify(stats.dt7d, limits.dt7d), classify(stats.dt14d, limits.dt14d), classify(stats.dt28d, limits.dt28d),
    classify(stats.ft7d, limits.ft7d), classify(stats.ft28d, limits.ft28d), classify(stats.ft365d, limits.ft365d),
    stats.ft90d >= limits.ft90dMin ? "ok" : "warn",
    recoveryRestStatus
  ];
  return checks.reduce((worst, s) => (RANK[s] > RANK[worst] ? s : worst), "ok");
}

const METRIC_LABELS = {
  dt7d: "Duty Time 7D", dt14d: "Duty Time 14D", dt28d: "Duty Time 28D",
  ft7d: "Flight Time 7D", ft28d: "Flight Time 28D", ft365d: "Flight Time 365D"
};

// Plain-language advisories for anything not "ok" on a pilot's row - used by
// the Dashboard's recommendations list (and, via each entry's stable `key`,
// by the email-notification dedup in Dashboard.jsx so the same pilot+metric
// warning doesn't re-send every time the app opens). Each entry names the
// pilot, the metric, where they stand, and a concrete next step.
export function buildRecommendations(row, limits) {
  const { pilot, stats, recoveryRest, status } = row;
  if (status === "ok") return [];
  const who = `${pilot.code || "-"} — ${pilot.name || "-"}`;
  const pilotKey = pilot.code || pilot.licence || who;
  const recs = [];

  for (const key of Object.keys(METRIC_LABELS)) {
    const s = classify(stats[key], limits[key]);
    if (s === "ok") continue;
    const action = s === "exc"
      ? "already over the limit — remove from further duty until the rolling window clears."
      : "approaching the limit — avoid assigning more duty this window if possible.";
    recs.push({
      key: `${pilotKey}|${key}`,
      pilot: who, status: s,
      text: `${who}: ${METRIC_LABELS[key]} at ${decimalToHHMM(stats[key])} / ${decimalToHHMM(limits[key].max)} — ${action}`
    });
  }

  if (stats.ft90d < limits.ft90dMin) {
    recs.push({
      key: `${pilotKey}|ft90d`,
      pilot: who, status: "warn",
      text: `${who}: Flight Time 90D at ${decimalToHHMM(stats.ft90d)} / ≥${decimalToHHMM(limits.ft90dMin)} (Customer Requirement) — below the minimum, schedule more flight time this window if possible.`
    });
  }

  if (recoveryRest.status === "warn") {
    const deadline = recoveryRest.lastQualifyingRestEnd
      ? new Date(recoveryRest.lastQualifyingRestEnd.getTime() + limits.recoveryRestCycleMaxHours * 3600000)
      : null;
    recs.push({
      key: `${pilotKey}|recoveryRest`,
      pilot: who, status: "warn",
      text: `${who}: 168 hr Duty Cycle is running low on headroom${deadline ? ` — next Recovery Rest must start by ${formatDateTime(deadline)}` : ""}.`
    });
  } else if (recoveryRest.status === "exc") {
    recs.push({
      key: `${pilotKey}|recoveryRest`,
      pilot: who, status: "exc",
      text: `${who}: 168 hr Duty Cycle deadline has passed without a qualifying Recovery Rest — schedule Recovery Rest immediately.`
    });
  }

  return recs;
}

// Fetches every pilot + their duty entries, computes stats/recovery
// rest/overall status for each, and returns rows sorted by name. Shared by
// All Status and Dashboard so both pages load the fleet identically.
export async function loadAllPilotStatusRows() {
  const { listExperience, listDutyEntriesByPilot, getSetting } = await import("../services/desktopDatabase.js");
  const { isDemoPilotCode } = await import("../config/demoUsers.js");
  const [all, savedLimits] = await Promise.all([listExperience(), getSetting("ftl_limits")]);
  // DEMO is a view-only login, not a crew member. It has no duty records, so
  // it only ever added an empty row that read as a pilot at zero hours -
  // which on an FDT page is a meaningful-looking figure, not a blank.
  // Filtered here rather than in each page, so All Status and the Dashboard
  // (which share this loader) can't drift apart. Same rule Pilot Roster and
  // Hours Summary already apply.
  const list = all.filter((p) => !isDemoPilotCode(p.code));
  const limits = withFtlDefaults(savedLimits);
  const rows = await Promise.all(
    list.map(async (pilot) => {
      const entries = pilot.code ? await listDutyEntriesByPilot(pilot.code) : [];
      const stats = computeStats(entries, limits);
      const recoveryRest = checkRecoveryRest168(entries, limits);
      const status = overallStatus(stats, limits, recoveryRest.status);
      return { pilot, entries, stats, recoveryRest, status };
    })
  );
  rows.sort((a, b) => (a.pilot.name || "").localeCompare(b.pilot.name || ""));
  return { rows, limits };
}
