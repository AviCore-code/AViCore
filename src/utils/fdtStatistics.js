// Monthly FDT and Fatigue statistics, for internal review and for audits.
//
// Capt. Weera: "ประชุม ภายใน บริษัท และ auditor มาตรวจ CAAT and Customer -
// รายเดือน", covering three things:
//   1. fleet FT/DT trend by month
//   2. pilots approaching their limits
//   3. Fatigue Index distribution across the action bands
//
// WHY THESE NUMBERS ARE NOT THE SAME AS THE ONES ON ALL STATUS
//
// All Status answers "is this pilot legal RIGHT NOW", so every figure there is
// a ROLLING window ending today - FT 7D means the last seven days from today.
// An audit asks a different question: "what happened in June". That is a
// CALENDAR month, fixed, and it does not move as the days pass.
//
// So this file deliberately sums by calendar month rather than reusing
// computeStats' rolling windows. A reviewer comparing the two will see
// different figures for what looks like the same thing, and that is correct -
// the note is here so nobody "fixes" one to match the other.
//
// The LIMIT checks below are the exception: those stay on the rolling windows,
// because a limit is a rolling rule. A pilot is not "within 90% of FT 28D"
// for a calendar month; they are within 90% of it today.

import { buildDutyPeriods, periodDutyCreditHours } from "./dutyPeriods.js";
import { entryFlightHours } from "./statusCompute.js";
import { pilotWeeklyFatigue, TOTAL_INDEX_BANDS } from "./fatigueMonitor.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "YYYY-MM" for a local date. Never toISOString() - east of Greenwich that
// files an early-morning duty under the previous month, which at a month
// boundary moves hours out of the period being reported on.
function monthKeyLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyOf(iso) {
  return String(iso || "").slice(0, 7);
}

export function monthLabel(key) {
  const [y, m] = String(key).split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${y}`;
}

// The last n calendar months up to and including the one containing `today`,
// oldest first - the order a trend chart is read in.
export function recentMonthKeys(n, today = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(monthKeyLocal(d));
  }
  return out;
}

/**
 * Fleet FT and DT totals per calendar month.
 *
 * DT comes from buildDutyPeriods (report buffer + post-flight + standby credit
 * per OPS-CM-01 7.9.2), not from raw entry times, so it matches what the FDT
 * pages report. A duty period is filed under the month its REPORT falls in,
 * which is how a duty crossing midnight into the 1st stays with the month it
 * began - the same convention the rolling windows use.
 */
export function monthlyFleetTotals({ rows, limits, months }) {
  const wanted = new Set(months);
  const byMonth = new Map(months.map((m) => [m, {
    month: m, label: monthLabel(m),
    ftHours: 0, dtHours: 0, flights: 0, dutyDays: 0, pilots: new Set()
  }]));

  for (const r of rows || []) {
    const entries = r.entries || [];

    for (const e of entries) {
      if (e?.dutyType !== "flight") continue;
      const key = monthKeyOf(e.date);
      const bucket = byMonth.get(key);
      if (!bucket) continue;
      bucket.ftHours += entryFlightHours(e);
      bucket.flights += 1;
      bucket.pilots.add(r.pilot?.code);
    }

    let periods = [];
    try { periods = buildDutyPeriods(entries, limits) || []; } catch { periods = []; }
    for (const p of periods) {
      if (!p?.start) continue;
      const key = monthKeyLocal(p.start);
      const bucket = byMonth.get(key);
      if (!bucket) continue;
      bucket.dtHours += periodDutyCreditHours(p, limits);
      bucket.dutyDays += 1;
      bucket.pilots.add(r.pilot?.code);
    }
  }

  return months.map((m) => {
    const b = byMonth.get(m);
    return {
      ...b,
      pilotCount: b.pilots.size,
      // Per-pilot averages: a fleet total rises simply because more pilots
      // flew, which reads as "we are working people harder" when it is not.
      // Divided by the pilots who ACTUALLY flew that month, not headcount.
      avgFtPerPilot: b.pilots.size ? b.ftHours / b.pilots.size : 0,
      avgDtPerPilot: b.pilots.size ? b.dtHours / b.pilots.size : 0,
      pilots: undefined
    };
  });
}

// How close each pilot is to each rolling limit, as a percentage.
//
// Rolling, not monthly - see the note at the top of this file.
export const LIMIT_KEYS = [
  { key: "ft7d", label: "FT 7D" },
  { key: "ft28d", label: "FT 28D" },
  { key: "ft365d", label: "FT 365D" },
  { key: "dt7d", label: "DT 7D" },
  { key: "dt14d", label: "DT 14D" },
  { key: "dt28d", label: "DT 28D" }
];

/**
 * Pilots at or above `threshold` of any limit (0.9 = 90%).
 *
 * Reports the WORST limit per pilot rather than one row per limit breached:
 * a pilot near three limits is one person to talk to, not three, and a list
 * that repeats them buries the pilot who appears once at 99%.
 */
export function pilotsApproachingLimits({ rows, limits, threshold = 0.9 }) {
  const out = [];

  for (const r of rows || []) {
    const stats = r.stats || {};
    let worst = null;

    for (const { key, label } of LIMIT_KEYS) {
      const max = Number(limits?.[key]?.max);
      const used = Number(stats[key]);
      if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(used)) continue;
      const pct = used / max;
      if (!worst || pct > worst.pct) worst = { key, label, used, max, pct };
    }

    if (worst && worst.pct >= threshold) {
      out.push({
        code: r.pilot?.code || "",
        name: r.pilot?.name || "",
        ...worst,
        remaining: worst.max - worst.used,
        over: worst.pct >= 1
      });
    }
  }

  // Worst first - the list is read from the top and acted on until the reader
  // runs out of time, so the pilot closest to a limit has to be there.
  return out.sort((a, b) => b.pct - a.pct);
}

/**
 * How many pilots sit in each Fatigue Index action band.
 *
 * Bands come from TOTAL_INDEX_BANDS so the counts mean exactly what the manual
 * says they mean - 3.00+ requires a 36-hour recovery rest, 2.50+ is "closely
 * monitor". Anything below the lowest band is counted as "Normal" rather than
 * left out, or the numbers would not add up to the fleet.
 */
export function fatigueDistribution({ rows, limits, asOfIso, criteria }) {
  const buckets = TOTAL_INDEX_BANDS.map((b) => ({
    key: b.key, label: b.label, from: b.from, to: b.to, pilots: []
  }));
  const normal = { key: "normal", label: "Normal", from: 0, to: null, pilots: [] };
  const noData = [];

  for (const r of rows || []) {
    const code = r.pilot?.code || "";
    const name = r.pilot?.name || "";
    if (!r.entries?.length) { noData.push({ code, name }); continue; }

    let week = null;
    try {
      week = pilotWeeklyFatigue({
        entries: r.entries,
        limits,
        asOfIso,
        dt7d: r.stats?.dt7d,
        buildDutyPeriods,
        periodDutyCreditHours,
        criteria
      });
    } catch { /* a pilot whose figures cannot be built is listed as no-data */ }

    if (!week || !Number.isFinite(week.total)) { noData.push({ code, name }); continue; }

    const entry = { code, name, total: week.total, dutyIndex: week.dutyIndex, fatigueIndex: week.fatigueIndex };
    const band = buckets.find((b) => week.total >= b.from);
    (band ? band.pilots : normal.pilots).push(entry);
  }

  const all = [...buckets, normal];
  for (const b of all) b.pilots.sort((a, c) => c.total - a.total);

  const counted = all.reduce((s, b) => s + b.pilots.length, 0);
  return {
    bands: all.map((b) => ({ ...b, count: b.pilots.length })),
    noData,
    counted,
    // Everyone with duty records, so a reader can check the bands add up.
    total: counted + noData.length
  };
}

/**
 * Fleet totals across the whole reported period.
 *
 * Summed from the monthly rows so the headline figures and the trend can never
 * disagree - a reader who adds the columns up must get the number printed at
 * the top, or neither is trusted.
 *
 * `pilotCount` is the number of DISTINCT pilots who flew at any point in the
 * period, which is why it is recomputed here rather than summed: adding the
 * monthly counts would count a pilot once per month they flew.
 */
export function periodSummary({ rows, limits, months }) {
  const monthly = monthlyFleetTotals({ rows, limits, months });
  const flew = new Set();

  for (const r of rows || []) {
    const code = r.pilot?.code;
    if (!code) continue;
    if ((r.entries || []).some((e) => months.includes(monthKeyOf(e.date)))) flew.add(code);
  }

  const ftHours = monthly.reduce((s, m) => s + m.ftHours, 0);
  const dtHours = monthly.reduce((s, m) => s + m.dtHours, 0);
  const flights = monthly.reduce((s, m) => s + m.flights, 0);
  const dutyDays = monthly.reduce((s, m) => s + m.dutyDays, 0);
  const busiest = monthly.reduce((b, m) => (!b || m.ftHours > b.ftHours ? m : b), null);

  return {
    monthly,
    ftHours,
    dtHours,
    flights,
    dutyDays,
    pilotCount: flew.size,
    monthCount: months.length,
    avgFtPerMonth: months.length ? ftHours / months.length : 0,
    avgDtPerMonth: months.length ? dtHours / months.length : 0,
    avgFtPerPilot: flew.size ? ftHours / flew.size : 0,
    avgDtPerPilot: flew.size ? dtHours / flew.size : 0,
    busiestMonth: busiest
  };
}

/**
 * Per-pilot totals for the period, for side-by-side comparison.
 *
 * WHY THE FLEET AVERAGE IS ON EVERY ROW
 *
 * A ranked list of hours invites the wrong reading - the pilot at the top is
 * not "the problem", they may simply have been rostered more. What a review
 * meeting needs is the DIFFERENCE from the fleet, so a genuine outlier stands
 * apart from ordinary variation. Each row therefore carries its share of the
 * fleet total and its gap from the mean, and the caller can sort by either.
 *
 * `activeMonths` counts the months a pilot actually flew, so someone who was
 * on leave for three of six months is not shown as "below average" for it -
 * their per-active-month figure is the fair comparison.
 */
export function pilotComparison({ rows, limits, months }) {
  const wanted = new Set(months);
  const out = [];

  for (const r of rows || []) {
    const code = r.pilot?.code || "";
    if (!code) continue;
    const entries = (r.entries || []).filter((e) => wanted.has(monthKeyOf(e.date)));

    let ftHours = 0, flights = 0;
    const active = new Set();
    for (const e of entries) {
      if (e?.dutyType !== "flight") continue;
      ftHours += entryFlightHours(e);
      flights += 1;
      active.add(monthKeyOf(e.date));
    }

    // Duty from the full entry list, then filtered by month - buildDutyPeriods
    // merges touching duties, and slicing the entries first would split a
    // period that straddles a month boundary into two shorter ones.
    let dtHours = 0, dutyDays = 0;
    try {
      for (const p of buildDutyPeriods(r.entries || [], limits) || []) {
        if (!p?.start) continue;
        const key = `${p.start.getFullYear()}-${String(p.start.getMonth() + 1).padStart(2, "0")}`;
        if (!wanted.has(key)) continue;
        dtHours += periodDutyCreditHours(p, limits);
        dutyDays += 1;
        active.add(key);
      }
    } catch { /* leave duty at zero rather than dropping the pilot */ }

    out.push({
      code,
      name: r.pilot?.name || "",
      position: r.pilot?.position || r.pilot?.profile?.position || "",
      ftHours,
      dtHours,
      flights,
      dutyDays,
      activeMonths: active.size,
      ftPerActiveMonth: active.size ? ftHours / active.size : 0,
      dtPerActiveMonth: active.size ? dtHours / active.size : 0
    });
  }

  const flew = out.filter((p) => p.activeMonths > 0);
  const fleetFt = flew.reduce((s, p) => s + p.ftHours, 0);
  const fleetDt = flew.reduce((s, p) => s + p.dtHours, 0);
  const avgFt = flew.length ? fleetFt / flew.length : 0;
  const avgDt = flew.length ? fleetDt / flew.length : 0;

  for (const p of out) {
    p.ftVsAvg = p.ftHours - avgFt;
    p.dtVsAvg = p.dtHours - avgDt;
    p.ftShare = fleetFt > 0 ? p.ftHours / fleetFt : 0;
    // Flagged only when clearly apart from the fleet, not merely above the
    // mean - in any group roughly half are above average, and highlighting
    // half the fleet says nothing.
    p.outlierHigh = avgFt > 0 && p.ftHours >= avgFt * 1.5;
    p.outlierLow = avgFt > 0 && p.activeMonths > 0 && p.ftHours <= avgFt * 0.5;
  }

  out.sort((a, b) => b.ftHours - a.ftHours);
  return { pilots: out, avgFt, avgDt, fleetFt, fleetDt, flownCount: flew.length };
}

export function hhmm(hours) {
  const total = Math.round((Number(hours) || 0) * 60);
  const sign = total < 0 ? "-" : "";
  const t = Math.abs(total);
  return `${sign}${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
