// Duty & Flight History - the numbers behind the Pilot Roster tab of the
// same name: what each pilot has actually flown and been on duty, day by day,
// and how much they can still be given over the coming week.
//
// Built on exactly the same calculations as FDT Monitor so the two can never
// disagree:
//   * flight time per day  = entryFlightHours, keyed by the entry's date
//   * duty time per day    = buildDutyPeriods + periodDutyCreditHours, keyed by
//                            the period's report day (as computeStats does)
//   * rolling totals       = computeStats as of today
// The forward view counts RECORDED flying only - nothing is invented for the
// future - so "FT left" on a coming day is what the 7/28/365-day limits still
// allow once older flights have dropped out of each window.

import { computeStats, entryFlightHours, classify } from "../../utils/statusCompute.js";
import { buildDutyPeriods, periodDutyCreditHours } from "../../utils/dutyPeriods.js";
import { isoAddDays, rollingSum } from "./weeklyPlanHeadroom.js";

export const FT_WINDOWS = [
  { key: "ft7d", days: 7, label: "FT 7D" },
  { key: "ft28d", days: 28, label: "FT 28D" },
  { key: "ft365d", days: 365, label: "FT 365D" }
];
export const DT_WINDOWS = [
  { key: "dt7d", days: 7, label: "DT 7D" },
  { key: "dt14d", days: 14, label: "DT 14D" },
  { key: "dt28d", days: 28, label: "DT 28D" }
];

const NON_FLIGHT_SHORT = {
  "Day Standby": "DSB", "Night Standby": "NSB", "Positioning": "POS",
  "Ground Training": "GT", "Meeting": "MTG", "Travel": "TRV",
  "Office": "OFF", "Ground Run": "GR", "Other": "OTH"
};

export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Days from (todayIso - count + 1) through todayIso, oldest first.
export function pastDays(todayIso, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(isoAddDays(todayIso, -i));
  return out;
}

export function nonFlightShort(type) {
  return NON_FLIGHT_SHORT[type] || String(type || "").slice(0, 3).toUpperCase();
}

// One pilot's history. entries: that pilot's duty entries (any dates).
export function pilotHistory(entries, limits, { todayIso, asOf = new Date(), aheadDays = 7 }) {
  const flightByDate = new Map();
  const nonFlightTypes = new Map();     // iso -> Set of non-flight types
  for (const e of entries || []) {
    if (!e?.date) continue;
    if (e.dutyType === "flight") {
      flightByDate.set(e.date, (flightByDate.get(e.date) || 0) + entryFlightHours(e));
    } else if (e.dutyType === "non_flight") {
      if (!nonFlightTypes.has(e.date)) nonFlightTypes.set(e.date, new Set());
      nonFlightTypes.get(e.date).add(e.nonFlightType || "Other");
    }
  }

  const dutyByDate = new Map();
  for (const p of buildDutyPeriods(entries || [], limits)) {
    const key = localIso(p.start);
    dutyByDate.set(key, (dutyByDate.get(key) || 0) + periodDutyCreditHours(p, limits));
  }

  const day = (iso) => {
    const ft = flightByDate.get(iso) || 0;
    const dt = dutyByDate.get(iso) || 0;
    const types = [...(nonFlightTypes.get(iso) || [])];
    return {
      ft, dt,
      flew: ft > 0 || flightByDate.has(iso),
      nonFlight: types.map(nonFlightShort),
      nonFlightFull: types
    };
  };

  const stats = computeStats(entries || [], limits, asOf);
  const totals = [...FT_WINDOWS, ...DT_WINDOWS].map((w) => {
    const used = stats[w.key] || 0;
    const limit = limits?.[w.key];
    return {
      key: w.key, label: w.label, used,
      max: limit?.max ?? null,
      left: limit?.max != null ? limit.max - used : null,
      status: limit ? classify(used, limit) : "ok"
    };
  });

  // Flight time still allowed on each coming day: the tightest of the
  // 7/28/365-day windows, counting recorded flights only.
  const ahead = [];
  for (let i = 1; i <= aheadDays; i++) {
    const iso = isoAddDays(todayIso, i);
    let left = Infinity;
    let warn = false;
    for (const w of FT_WINDOWS) {
      const limit = limits?.[w.key];
      if (limit?.max == null) continue;
      const used = rollingSum(flightByDate, iso, w.days);
      left = Math.min(left, limit.max - used);
      if (limit.warn != null && used >= limit.warn) warn = true;
    }
    if (left === Infinity) left = null;
    const status = left == null ? "ok" : left <= 0 ? "exc" : warn ? "warn" : "ok";
    ahead.push({ iso, left: left == null ? null : Math.max(0, left), status });
  }

  return { day, totals, ahead };
}
