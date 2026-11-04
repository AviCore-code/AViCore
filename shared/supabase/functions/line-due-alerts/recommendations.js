import { computeStats, overallStatus, buildRecommendations } from "../../../../src/utils/statusCompute.js";
import { checkRecoveryRest168 } from "../../../../src/utils/dutyPeriods.js";

const ROLLING_FTL_KEYS = new Set(["ft7d", "ft28d", "ft365d", "dt7d", "dt14d", "dt28d"]);

export function recommendationsForAudience(recommendations, audience) {
  return audience === "primary"
    ? recommendations
    : recommendations.filter((item) => item.category === "training");
}

export function updateFirstSeenWarnings(recommendations, previous, day, now = new Date()) {
  const active = {};
  for (const rec of recommendations) {
    active[rec.key] = previous?.[rec.key] || day;
    const first = Date.parse(`${active[rec.key]}T00:00:00+07:00`);
    rec.overdue = Number.isFinite(first) && now.getTime() - first >= 7 * 86400000;
  }
  return active;
}

function recommendationState(rec) {
  return `${String(rec?.category || "training")}|${String(rec?.status || "warn")}`;
}

const VALID_WARNING_STATES = new Set([
  "training|warn",
  "training|exc",
  "ftl|warn",
  "ftl|exc",
]);

function validWarningSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const prototype = Object.getPrototypeOf(snapshot);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(snapshot).every((state) => VALID_WARNING_STATES.has(state));
}

export function selectNewRecommendations(recommendations, previousSnapshot) {
  const snapshot = {};
  for (const rec of recommendations || []) {
    const key = String(rec?.key || "").trim();
    if (key) snapshot[key] = recommendationState(rec);
  }
  const initialized = validWarningSnapshot(previousSnapshot);
  if (!initialized) return { recommendations: [], snapshot, initialized: false };
  return {
    recommendations: (recommendations || []).filter((rec) => {
      const key = String(rec?.key || "").trim();
      if (!key) return false;
      if (!Object.prototype.hasOwnProperty.call(previousSnapshot, key)) return true;
      const current = snapshot[key];
      const category = String(rec?.category || "training");
      return previousSnapshot[key] === `${category}|warn` && current === `${category}|exc`;
    }),
    snapshot,
    initialized: true,
  };
}

/**
 * @param {{ experience?: any[], duty?: any[], limits: any, asOfDay?: string | Date }} input
 */
export function buildLineFtlRecommendations({ experience = [], duty = [], limits, asOfDay = new Date() }) {
  const entriesByPilot = new Map();
  for (const row of duty) {
    const code = String(row?.pilot_code || "").toUpperCase();
    let entry = row?.entry_json ?? row;
    if (typeof entry === "string") {
      try { entry = JSON.parse(entry); } catch { entry = {}; }
    }
    if (!code || !entry) continue;
    if (!entriesByPilot.has(code)) entriesByPilot.set(code, []);
    entriesByPilot.get(code).push({
      date: row?.date,
      dutyType: row?.duty_type,
      ...(entry && typeof entry === "object" ? entry : {})
    });
  }

  const recommendations = [];
  for (const pilot of experience) {
    if (!pilot?.code) continue;
    const entries = entriesByPilot.get(String(pilot.code).toUpperCase()) || [];
    const stats = computeStats(entries, limits, asOfDay);
    const recoveryRest = checkRecoveryRest168(entries, limits);
    const status = overallStatus(stats, limits, recoveryRest.status);
    const pilotRecommendations = buildRecommendations(
      { pilot, entries, stats, recoveryRest, status },
      limits
    );
    recommendations.push(...pilotRecommendations
      .filter((item) => ROLLING_FTL_KEYS.has(String(item.key || "").split("|").at(-1)))
      .map((item) => ({ ...item, category: "ftl" })));
  }
  return recommendations;
}
