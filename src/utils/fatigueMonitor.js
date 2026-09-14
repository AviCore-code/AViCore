// Company Fatigue Monitor - OPS-CM-01 §7.17.3, daily score.
//
// THE NUMBERS IN THIS FILE ARE NOT ADJUSTABLE BY GUESSWORK.
// They are transcribed from the formulas that actually run in the Crew
// Scheduler's workbook (`<CODE>_FDT.xlsx`, sheet `DT`, columns AE-AK), and an
// analysis built on them is submitted to the CAAT every three months
// (§7.17.3.2). Where the approved PDF and the working spreadsheet disagree -
// and they do, in several places - the reasoning is recorded in
// docs/FATIGUE-MONITOR.md. Read that before changing anything here.
//
// Four parameters, summed:
//
//   Flight Duty Time  0-6      Crews Number      0-6
//   Sectors           0-6      Flights per Day   0-4
//
// Limits: one day < 22, two consecutive days < 40.

import { todayIso } from "./dateKeys.js";
import { OPS_CM_01 } from "./fatigueCriteria.js";

// --- Parameter 1: Flight Duty Time -----------------------------------------
// DT!AI = IF(AE>=7,6, >=6,5, >=5,4, >=4,3, >=3,2, >0,1, 0) where AE = duty
// hours. Note the floor is 1, not 0: any duty at all scores. The PDF says 0;
// the spreadsheet says 1 and the spreadsheet is what runs.
// `criteria` is optional throughout this module. Omitted, every function uses
// the OPS-CM-01 figures exactly as before - so the ~40 existing call sites keep
// producing the approved numbers without being touched, and a criteria object
// only ever changes behaviour where one is deliberately passed in.
export function flightDutyTimePoints(dutyHours, criteria) {
  return scoreDescending(dutyHours, criteria?.dutyTime || OPS_CM_01.dutyTime);
}

// Shared evaluator for the "first band whose threshold is met" scales.
// Rows are ordered highest-first; anything below the lowest band scores 0.
function scoreDescending(value, rows) {
  const v = Number(value) || 0;
  for (const r of rows || []) {
    const at = Number(r?.atLeast);
    if (Number.isFinite(at) && v >= at) return Number(r.points) || 0;
  }
  return 0;
}

// --- Parameter 2: Crews Number ---------------------------------------------
// From the DEPARTURE TIME BAND, confirmed by Capt. Weera. The bands are
// contiguous and wrap midnight, so every time maps to exactly one Crew.
//
// Crew 1 covers the whole night deliberately: a night standby called out at
// 02:00 scores 6, the maximum, because night flying is the most fatiguing.
//
// NOTE this is the one place AviCore does NOT follow the workbook, which
// derives Crews from a duration (DT!Q = IF(L*24>=9,6,...)). Capt. Weera was
// shown both and confirmed the bands. See docs/FATIGUE-MONITOR.md.
export const CREW_BANDS = [
  // [crew, points, startMinutes, endMinutes] - end inclusive, minutes from 00:00
  { crew: 2, points: 5, from: 7 * 60, to: 7 * 60 + 30 },        // 07:00-07:30
  { crew: 3, points: 4, from: 7 * 60 + 31, to: 8 * 60 },        // 07:31-08:00
  { crew: 4, points: 3, from: 8 * 60 + 1, to: 8 * 60 + 30 },    // 08:01-08:30
  { crew: 5, points: 2, from: 8 * 60 + 31, to: 9 * 60 },        // 08:31-09:00
  { crew: 6, points: 1, from: 9 * 60 + 1, to: 22 * 60 + 29 }    // 09:01-22:29
];
// Crew 1 is everything else: 22:30-06:59, which wraps midnight and so can't be
// expressed as one from<=t<=to range.
const CREW1 = { crew: 1, points: 6 };

// "HH:MM" -> minutes from midnight, or null if unparseable.
export function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function crewForDeparture(hhmm, criteria) {
  const t = timeToMinutes(hhmm);
  if (t == null) return null;

  // Custom bands come as "HH:MM" strings, with the midnight-crossing band
  // marked wraps:true (it cannot be expressed as one from<=t<=to range).
  const bands = criteria?.crews;
  if (Array.isArray(bands) && bands.length) {
    let wrapBand = null;
    for (const b of bands) {
      const from = timeToMinutes(b.from), to = timeToMinutes(b.to);
      if (from == null || to == null) continue;
      if (b.wraps || from > to) { wrapBand = b; continue; }
      if (t >= from && t <= to) return { crew: Number(b.crew), points: Number(b.points) || 0 };
    }
    // The wrapping band is the catch-all, checked last: it is the night, and a
    // departure that matched nothing else belongs to it.
    if (wrapBand) return { crew: Number(wrapBand.crew), points: Number(wrapBand.points) || 0 };
    return null;
  }

  for (const b of CREW_BANDS) {
    if (t >= b.from && t <= b.to) return { crew: b.crew, points: b.points };
  }
  return { ...CREW1 };   // 22:30-06:59
}

export function crewsNumberPoints(hhmm, criteria) {
  return crewForDeparture(hhmm, criteria)?.points ?? 0;
}

// --- Parameter 3: Sectors ---------------------------------------------------
// DT!AG = IF(R>10,6, >=9,5, >=7,4, >=5,3, >=4,2, >0,1, 0) - and R's header is
// "Sectors", not the separate "Landings" column, so sectors is what scores.
//
// Counted from the hyphens in the route string. Capt. Weera: "sector ดู
// เครื่องหมาย '-' ใน route มีกี่อัน ก้อเท่าจำนวน sector", and "//" carries no
// special meaning - count the hyphens either way:
//
//   VTSH-AQP-VTSH         -> 2
//   VTSH-AQP//-BQP-VTSH   -> 3
export function countSectors(route) {
  const text = String(route || "").trim();
  if (!text) return 0;
  let n = 0;
  for (const ch of text) if (ch === "-") n++;
  return n;
}

export function sectorsPoints(sectors, criteria) {
  return scoreDescending(sectors, criteria?.sectors || OPS_CM_01.sectors);
}

// --- Parameter 4: Flights per Day -------------------------------------------
// DT!AH = IF(S=3,4, S=2,2, S=1,1, 0). Deliberately NOT a >= scale - the
// workbook tests equality, so 4+ flights falls through to 0. Transcribed as
// written rather than "fixed", because changing it changes what is reported to
// the regulator. Flagged in docs/FATIGUE-MONITOR.md if it ever needs review.
export function flightsPerDayPoints(flights, criteria) {
  const map = criteria?.flightsPerDay || OPS_CM_01.flightsPerDay;
  const f = Number(flights) || 0;
  const pts = map[f] ?? map[String(f)];
  return Number.isFinite(Number(pts)) ? Number(pts) : 0;
}

// --- Limits -----------------------------------------------------------------
export const DAILY_LIMIT = 22;
export const TWO_DAY_LIMIT = 40;

/**
 * Score one day.
 *
 * @param dutyHours  hours of flight duty that day
 * @param departure  "HH:MM" of the day's first departure (decides the Crew)
 * @param sectors    total sectors across every flight that day
 * @param flights    number of flights that day
 */
export function scoreDay({ dutyHours = 0, departure = null, sectors = 0, flights = 0, criteria = null } = {}) {
  const dailyLimit = Number(criteria?.limits?.daily) || DAILY_LIMIT;
  // Every key here is a POINT value, and each is suffixed "Points" so it can
  // never be confused with (or overwrite) the raw count it came from. An
  // earlier version returned `sectors` as the points, which silently clobbered
  // the sector COUNT when the two were merged into one row.
  const points = {
    flightDutyTimePoints: flightDutyTimePoints(dutyHours, criteria),
    crewsPoints: crewsNumberPoints(departure, criteria),
    sectorsPoints: sectorsPoints(sectors, criteria),
    flightsPoints: flightsPerDayPoints(flights, criteria)
  };
  const total =
    points.flightDutyTimePoints + points.crewsPoints +
    points.sectorsPoints + points.flightsPoints;
  return {
    ...points,
    crew: crewForDeparture(departure, criteria)?.crew ?? null,
    total,
    overDaily: total >= dailyLimit
  };
}

/**
 * Roll a pilot's flight entries up into one scored row per day.
 *
 * Sectors and flights are summed ACROSS THE DAY, not per flight - Capt. Weera:
 * "ถ้า บิน สองเที่ยว ก้อเอา sector มารวมกัน". The Crew comes from the day's
 * FIRST departure, since that is what sets the report time.
 *
 * @param entries     Daily Duty entries for one pilot
 * @param dutyHoursByDate  optional { "YYYY-MM-DD": hours } from buildDutyPeriods,
 *                    which applies the report/post-flight buffers properly. When
 *                    absent, falls back to summing logged flight time - a
 *                    smaller figure, so the score errs low rather than high.
 */
export function scoreDaysForPilot(entries, dutyHoursByDate = null, criteria = null) {
  const byDate = new Map();

  for (const e of entries || []) {
    if (e?.dutyType !== "flight") continue;
    const date = String(e.date || "").slice(0, 10);
    if (!date) continue;
    if (!byDate.has(date)) {
      byDate.set(date, { date, flights: 0, sectors: 0, departures: [], flightHours: 0 });
    }
    const d = byDate.get(date);
    d.flights += 1;
    d.sectors += countSectors(e.route);
    if (e.schDep) d.departures.push(e.schDep);
    d.flightHours += hhmmToHours(e.totalFlightTime);
  }

  const rows = [];
  for (const d of byDate.values()) {
    // Earliest departure of the day decides the Crew.
    const departure = d.departures.slice().sort()[0] || null;
    const dutyHours = dutyHoursByDate?.[d.date] ?? d.flightHours;
    rows.push({
      date: d.date,
      flights: d.flights,
      sectors: d.sectors,
      departure,
      dutyHours,
      ...scoreDay({ dutyHours, departure, sectors: d.sectors, flights: d.flights, criteria })
    });
  }

  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Two-CONSECUTIVE-day check: only meaningful for days that are actually
  // adjacent on the calendar. Two duty days a week apart summing over 40 is not
  // what the rule is about.
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (daysBetween(prev.date, cur.date) !== 1) continue;
    const pair = prev.total + cur.total;
    cur.twoDayTotal = pair;
    cur.overTwoDay = pair >= (Number(criteria?.limits?.twoDay) || TWO_DAY_LIMIT);
    if (cur.overTwoDay) prev.partOfOverTwoDay = true;
  }

  return rows;
}

function hhmmToHours(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}

function daysBetween(a, b) {
  const [ay, am, ad] = String(a).split("-").map(Number);
  const [by, bm, bd] = String(b).split("-").map(Number);
  if (!ay || !by) return NaN;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---------------------------------------------------------------------------
// WEEKLY FATIGUE INDEX - OPS-CM-01 §7.17.3.2
// ---------------------------------------------------------------------------
//
// Every constant below was verified by reproducing the company's own
// "Fatique Weekly Monitor" printout (fatigue.pdf, 28 Jul 2026): all 14 crewed
// rows come out to the same DT INDEX, Fatigue Index and TOTAL INDEX to the
// decimal place shown. This is transcription, not derivation.
//
//   DT (1xW) INDEX  = weekly duty hours / 24        -> 0.00 - 2.50
//   Fatique Index   = fatigue value / 154           -> 0.00 - 1.00
//   TOTAL INDEX     = the two added                 -> 0.00 - 3.50
//
// The "/24" is not a unit conversion anyone chose - it is what Excel's
// ABS(H:mm) does. A duration cell holds days, so 32:18 is the serial 1.3458,
// and that serial IS the index. Written as /24 here because that is what it
// means in hours, which is the unit the rest of this app works in.
//
// 154 = 22 x 7: the daily cap over a rolling week. So the fatigue value fed in
// is a SEVEN-day total, not the two-day figure the PDF text describes.

// Every figure below was confirmed by Capt. Weera on 29 Jul 2026, WITH its
// derivation - none of them is a chosen constant:
//
//   WEEKLY_DUTY_INDEX_MAX  60 h / 24 = 2.50
//     "DT (1W 60) เลย ใช้ ABS(ชั่วโมงการทำงาน) = ตัวเลข ในที่นี้ MAX 60 hrs.
//      DT 1w ABS(60)=2.5"
//     i.e. the ceiling comes from the 60 h/week DUTY LIMIT. Change that limit
//     and this ceiling moves with it.
//
//   FATIGUE_VALUE_DIVISOR  22 x 7 = 154
//     "หาร ด้วย 154 ซึ่งมาค่า fatigue 1 วันสูงสุด 22 X 7 วัน เท่ากับ 154"
//
//   TOTAL_INDEX_MAX        2.50 + 1.00 = 3.5   (derived, not assumed)
//
// This is the DT-based "Fatigue Weekly Monitor" variant (max 3.5), NOT the
// FT-based "FT & Fatique Weekly Monitor" variant (max 5).
export const WEEKLY_DUTY_LIMIT_HOURS = 60;   // DT 1 week, the source of the 2.50
export const WEEKLY_DUTY_INDEX_DIVISOR = 24;
export const FATIGUE_VALUE_DIVISOR = 154;    // = DAILY_LIMIT x 7
export const WEEKLY_DUTY_INDEX_MAX = WEEKLY_DUTY_LIMIT_HOURS / WEEKLY_DUTY_INDEX_DIVISOR;  // 2.50
export const FATIGUE_INDEX_MAX = 1.00;
export const TOTAL_INDEX_MAX = WEEKLY_DUTY_INDEX_MAX + FATIGUE_INDEX_MAX;                  // 3.5

// The action bands printed under the company's table. These are not advisory:
// at 3.0 the manual requires a recovery rest, so the wording is reproduced
// verbatim rather than paraphrased into something softer.
export const TOTAL_INDEX_BANDS = [
  {
    key: "rest",
    from: 3.0,
    to: 3.5,
    label: "Recovery rest required",
    detail: "The flight crew member shall be provided with a minimum recovery rest period of 36 hours, including 2 local nights."
  },
  {
    key: "monitor",
    from: 2.5,
    to: 2.99,
    label: "Closely Monitor",
    detail: "Closely monitor this crew member before assigning further duty."
  }
];

// `totalMax` is accepted so a changed weekly-duty limit does not leave the
// action bands measured against a scale that no longer exists.
//
// The 3.0 and 2.5 thresholds are NOT rescaled proportionally. They are
// REGULATORY ACTIONS from OPS-CM-01 ("shall be provided with a minimum recovery
// rest period of 36 hours"), not points on a curve - inventing a moved
// threshold would be writing a rule the manual does not contain. Instead they
// are held at their approved values, and if a custom limit lowers the ceiling
// below a band, that band simply becomes unreachable, which is visible and
// honest rather than silently redefined.
export function totalIndexBand(totalIndex, totalMax = TOTAL_INDEX_MAX) {
  const v = Number(totalIndex) || 0;
  for (const b of TOTAL_INDEX_BANDS) {
    if (b.from > totalMax) continue;      // unreachable on this scale
    if (v >= b.from) return b;
  }
  return null;
}

/**
 * Weekly index for one pilot.
 *
 * @param weeklyDutyHours  duty hours over the 7-day window (the "Total 7 Days"
 *                         column - hours, not an Excel serial)
 * @param fatigueValue     summed daily fatigue score over the same window
 */
export function weeklyIndex({ weeklyDutyHours = 0, fatigueValue = 0, criteria = null } = {}) {
  // Both ceilings move with the criteria, because both are DERIVED:
  //   DT INDEX max      = weekly duty limit / 24   (60/24 = 2.50 as approved)
  //   FATIGUE INDEX max = 1.00, from daily limit x 7 as the divisor (22x7 = 154)
  // Confirmed by Capt. Weera - see fatigueCriteria.js. Recomputing them here
  // means a changed limit cannot leave the scale it is measured against stale.
  const weeklyDutyLimit = Number(criteria?.limits?.weeklyDutyHours) || WEEKLY_DUTY_LIMIT_HOURS;
  const dailyLimit = Number(criteria?.limits?.daily) || DAILY_LIMIT;
  const fatigueDivisor = dailyLimit * 7;
  const dutyIndexMax = weeklyDutyLimit / WEEKLY_DUTY_INDEX_DIVISOR;
  const totalMax = dutyIndexMax + FATIGUE_INDEX_MAX;

  const dutyIndex = (Number(weeklyDutyHours) || 0) / WEEKLY_DUTY_INDEX_DIVISOR;
  const fatigueIndex = (Number(fatigueValue) || 0) / fatigueDivisor;
  const total = dutyIndex + fatigueIndex;
  return {
    dutyIndex,
    fatigueIndex,
    total,
    band: totalIndexBand(total, totalMax),
    dutyIndexMax,
    totalMax,
    // The caps are what the column headings promise (0-2.50, 0-1.00, 3.5).
    // A figure past one of them is real data, not a display bug, so it is
    // reported rather than silently clamped - it means the pilot is further
    // beyond the limit than the scale was drawn to show.
    overDutyIndexScale: dutyIndex > dutyIndexMax,
    overFatigueIndexScale: fatigueIndex > FATIGUE_INDEX_MAX,
    overTotalScale: total > totalMax
  };
}

/**
 * Everything the weekly monitor row needs for one pilot.
 *
 * TWO DIFFERENT HOUR FIGURES, and they are not interchangeable:
 *
 *   DT (1xW)      total DUTY hours over the week. Its own column, and the
 *                 input to the DT INDEX. Always the larger of the two.
 *   Total 7 Days  total FLIGHT hours over the week - the sum of the seven
 *                 day cells, which are flight time, not duty. Headed
 *                 "(29/34)", the 7-day flight-time limits.
 *
 * Verified against the company printout: for every pilot the seven day cells
 * add up exactly to Total 7 Days, while DT (1xW) is a separate, higher number
 * (KPO 19:39 flight vs 32:18 duty). An earlier version of this function put
 * duty hours in both, which made the two columns duplicates.
 *
 * @param scoredDays        output of scoreDaysForPilot()
 * @param dates             the 7 dates of the window, newest first
 * @param dutyHoursByDate   { iso: hours } - duty, for the DT column
 * @param flightHoursByDate { iso: hours } - flight time, for the day cells
 */
export function weeklyRowForPilot({
  scoredDays = [], dates = [], dutyHoursByDate = {}, flightHoursByDate = {}, criteria = null
} = {}) {
  const byDate = new Map(scoredDays.map((d) => [d.date, d]));
  const perDay = dates.map((iso) => ({
    date: iso,
    // What the day cell shows: flight time.
    flightHours: flightHoursByDate[iso] || 0,
    dutyHours: dutyHoursByDate[iso] || 0,
    score: byDate.get(iso) || null
  }));
  const weeklyDutyHours = perDay.reduce((s, d) => s + d.dutyHours, 0);
  const weeklyFlightHours = perDay.reduce((s, d) => s + d.flightHours, 0);
  // The fatigue value is the sum of the DAILY scores across the same window -
  // which is why the divisor is 22x7.
  const fatigueValue = perDay.reduce((s, d) => s + (d.score?.total || 0), 0);
  return {
    perDay,
    weeklyDutyHours,
    weeklyFlightHours,
    fatigueValue,
    ...weeklyIndex({ weeklyDutyHours, fatigueValue, criteria })
  };
}

// ---------------------------------------------------------------------------
// One pilot's weekly fatigue picture, from their raw duty entries.
// ---------------------------------------------------------------------------
//
// Lives here rather than in either page so the Admin fleet table and the Crew
// dashboard cannot drift apart - a pilot who sees "1.7" on their own dashboard
// must see the same 1.7 on the Chief Pilot's screen, or neither figure is
// trustworthy.
//
// Needs buildDutyPeriods/periodDutyCreditHours passed in rather than imported,
// to keep this module free of a circular dependency on dutyPeriods.js.

// A duty period's date, keyed by LOCAL calendar day - never UTC.
//
// Thailand is UTC+7, so an 05:30 local report is 22:30 UTC the previous day.
// Keying by toISOString() filed early Crew 1 duties under the wrong date, which
// is how the Fatigue page came to disagree with All Status.
export function dateKeyLocal(d) {
  const t = new Date(d);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// FLIGHT hours per date - the day cells, and "Total 7 Days".
export function flightHoursByDate(entries) {
  const out = {};
  for (const e of entries || []) {
    if (e?.dutyType !== "flight") continue;
    const date = String(e.date || "").slice(0, 10);
    if (!date) continue;
    const [h, m] = String(e.totalFlightTime || "0:00").split(":");
    out[date] = (out[date] || 0) + (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
  }
  return out;
}

/**
 * DUTY hours per date, credited per OPS-CM-01 7.9.2 (standby at 25%).
 *
 * @param buildDutyPeriods       injected from dutyPeriods.js
 * @param periodDutyCreditHours  injected from dutyPeriods.js
 */
export function dutyHoursByDate(entries, limits, { buildDutyPeriods, periodDutyCreditHours }) {
  const out = {};
  try {
    for (const p of buildDutyPeriods(entries, limits) || []) {
      out[dateKeyLocal(p.start)] = (out[dateKeyLocal(p.start)] || 0) + periodDutyCreditHours(p, limits);
    }
  } catch {
    // One malformed entry must not blank the caller's whole page.
  }
  return out;
}

/**
 * The whole weekly row for one pilot: per-day cells, totals and indices.
 *
 * @param dt7d  the pilot's ALREADY-COMPUTED 7-day duty total (statusCompute's
 *              stats.dt7d). Passed in rather than re-summed because
 *              withinDays(7) uses a midnight-local cutoff that does not match a
 *              naive "last 7 dates" sum - deferring to it is what keeps this
 *              page and FDT Monitor showing the same DT figure.
 */
export function pilotWeeklyFatigue({
  entries, limits, asOfIso, dt7d,
  buildDutyPeriods, periodDutyCreditHours, windowDays = 7,
  criteria = null
}) {
  const asOf = asOfIso || todayIso();
  const dates = Array.from({ length: windowDays }, (_, i) => isoAddDays(asOf, -i));
  const duty = dutyHoursByDate(entries, limits, { buildDutyPeriods, periodDutyCreditHours });
  const flight = flightHoursByDate(entries);
  const scored = scoreDaysForPilot(entries, duty, criteria);
  const week = weeklyRowForPilot({
    scoredDays: scored, dates, dutyHoursByDate: duty, flightHoursByDate: flight, criteria
  });
  if (!Number.isFinite(dt7d)) return { ...week, dates, scored };
  // Recompute the indices from the authoritative dt7d so the DT column and the
  // DT INDEX derived from it can never tell different stories.
  return {
    ...week,
    ...weeklyIndex({ weeklyDutyHours: dt7d, fatigueValue: week.fatigueValue, criteria }),
    weeklyDutyHours: dt7d,
    dates,
    scored
  };
}

// Worst state across a set of scored days, for a fleet list.
export function summarisePilot(rows) {
  let worstDay = 0, worstPair = 0, overDays = 0, overPairs = 0;
  for (const r of rows || []) {
    if (r.total > worstDay) worstDay = r.total;
    if (r.overDaily) overDays++;
    if (r.twoDayTotal > worstPair) worstPair = r.twoDayTotal;
    if (r.overTwoDay) overPairs++;
  }
  return {
    worstDay,
    worstPair,
    overDays,
    overPairs,
    status: overDays || overPairs ? "exc" : (worstDay >= DAILY_LIMIT - 4 || worstPair >= TWO_DAY_LIMIT - 6) ? "warn" : "ok"
  };
}
