// Month-by-month flight and duty hours for one pilot, for one calendar year.
//
// Kept apart from the dashboard component on purpose: this is arithmetic over
// duty records, it is what the whole page means, and it is the part that can
// be wrong in ways nobody notices. A number on a dashboard is believed.
//
// Two figures per month, because they answer different questions:
//
//   FLIGHT hours - time in the air. What a logbook counts.
//   DUTY hours   - time at work, computed by buildDutyPeriods, which is what
//                  the FTL limits are measured against. Always the larger of
//                  the two, and the gap between them is the point: a pilot
//                  can be near a duty limit having flown very little.
//
// Both come from the SAME functions the FDT Monitor uses (entryFlightHours via
// statusCompute, buildDutyPeriods + periodDutyCreditHours via dutyPeriods), so
// the dashboard and FDT Monitor can never quietly disagree.

import { buildDutyPeriods, periodDutyCreditHours } from "./dutyPeriods.js";
import { entryDutyHours } from "./statusCompute.js";
import { todayIso } from "./dateKeys.js";

export const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Local-time ISO date. Deliberately NOT toISOString(): that is UTC, and in
// Thailand (UTC+7) a duty starting at 05:30 would be filed under the previous
// day - which is most of the day crews.
function localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthOf(iso) {
  const m = Number(String(iso || "").slice(5, 7));
  return Number.isFinite(m) && m >= 1 && m <= 12 ? m - 1 : null;
}

function yearOf(iso) {
  const y = Number(String(iso || "").slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

// "H:MM" or a decimal -> decimal hours. Duty entries carry both shapes
// depending on which build wrote them.
export function toDecimalHours(value) {
  if (value == null || value === "") return 0;
  const text = String(value).trim();
  if (text.includes(":")) {
    const [h, m] = text.split(":");
    return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

export function decimalToHm(hours) {
  const total = Math.max(0, Math.round((Number(hours) || 0) * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The flight time on one entry. Non-flight duties have none - a standby is
// work, but it is not flying, and adding it to the flight bar would overstate
// what the logbook says.
function flightHoursOf(entry) {
  if (!entry || entry.dutyType !== "flight") return 0;
  return toDecimalHours(entry.totalFlightTime);
}

/**
 * @param entries   every duty entry for this pilot (any year - filtered here)
 * @param year      calendar year to summarise
 * @param limits    FTL limits, needed by buildDutyPeriods for standby credit
 * @param todayIso  "now", injectable so tests don't depend on the clock
 */
export function summariseYear({ entries, year, limits, todayIso: todayIsoArg }) {
  const today = todayIsoArg || todayIso();
  const currentYear = yearOf(today);
  const currentMonth = monthOf(today);

  const months = MONTH_LABELS.map((label, i) => ({
    label,
    month: i + 1,
    flightHours: 0,
    dutyHours: 0,
    dutyDays: 0,
    // A month that hasn't happened is not a month with zero hours. The chart
    // draws nothing for these rather than a zero-height bar, which would read
    // as "flew nothing in December" in January.
    future: year > currentYear || (year === currentYear && i > currentMonth),
    partial: year === currentYear && i === currentMonth
  }));

  const inYear = (entries || []).filter((e) => yearOf(e?.date) === year);

  // Flight hours: straight from each entry.
  for (const entry of inYear) {
    const m = monthOf(entry.date);
    if (m == null) continue;
    months[m].flightHours += flightHoursOf(entry);
  }

  // Duty hours: computed per DUTY PERIOD, not per entry. A day with a meeting
  // followed by a flight is ONE duty period; adding the two entries' spans
  // would double-count the overlap. buildDutyPeriods is the same code the FDT
  // Monitor uses, so the figures match what the pilot sees there.
  let periods = [];
  try {
    periods = buildDutyPeriods(inYear, limits) || [];
  } catch {
    periods = [];
  }

  const dutyDaysByMonth = MONTH_LABELS.map(() => new Set());
  for (const period of periods) {
    // A duty period carries `start` as a Date, not an ISO date string - it
    // has no `date` field at all. Read in LOCAL time: toISOString() converts
    // to UTC, which in Thailand (UTC+7) throws every duty reporting before
    // 07:00 into the previous day, and a Crew 1 report is 05:30.
    const iso = period?.start instanceof Date ? localIso(period.start) : null;
    const m = monthOf(iso);
    if (m == null) continue;
    let credit = 0;
    try {
      credit = periodDutyCreditHours(period, limits) || 0;
    } catch {
      credit = 0;
    }
    months[m].dutyHours += credit;
    dutyDaysByMonth[m].add(iso);
  }

  // Fallback: if duty periods couldn't be built (an old record shape, a
  // missing time), fall back to per-entry duty hours rather than showing a
  // flat zero next to real flight hours - a zero would look like a fact.
  const noDuty = months.every((m) => m.dutyHours === 0);
  if (noDuty && inYear.length) {
    for (const entry of inYear) {
      const m = monthOf(entry.date);
      if (m == null) continue;
      months[m].dutyHours += entryDutyHours(entry, limits) || 0;
      dutyDaysByMonth[m].add(entry.date);
    }
  }

  months.forEach((m, i) => { m.dutyDays = dutyDaysByMonth[i].size; });

  const flownMonths = months.filter((m) => !m.future);
  const totalFlight = months.reduce((s, m) => s + m.flightHours, 0);
  const totalDuty = months.reduce((s, m) => s + m.dutyHours, 0);
  const totalDutyDays = months.reduce((s, m) => s + m.dutyDays, 0);

  return {
    year,
    months,
    totalFlight,
    totalDuty,
    totalDutyDays,
    // Averaged over months that have actually happened - dividing a
    // half-finished year by 12 makes every pilot look under-used until
    // December.
    averageFlightPerMonth: flownMonths.length ? totalFlight / flownMonths.length : 0,
    peakHours: Math.max(0, ...months.map((m) => Math.max(m.flightHours, m.dutyHours)))
  };
}

// Which years this pilot has records for, newest first, always including the
// current one so the arrows have somewhere to go on a brand-new account.
export function yearsWithRecords(entries, todayIsoArg) {
  const years = new Set([yearOf(todayIsoArg || todayIso())]);
  for (const e of entries || []) {
    const y = yearOf(e?.date);
    if (y) years.add(y);
  }
  return [...years].filter(Boolean).sort((a, b) => b - a);
}
