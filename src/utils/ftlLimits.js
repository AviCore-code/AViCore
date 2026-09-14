// Generic placeholder defaults only - not verified against CAAT's actual FTL
// requirements or United Offshore Aviation's CAAT-approved FTL Scheme (see
// discussion in this project). An admin overrides these from Settings once
// the real company scheme is confirmed; the value is stored under the
// "ftl_limits" key via getSetting/saveSetting and syncs to every machine.
export const DEFAULT_FTL_LIMITS = {
  ft7d: { warn: 30, max: 34 },
  ft28d: { warn: 99, max: 110 },
  ft365d: { warn: 900, max: 1000 },
  dt7d: { warn: 54, max: 60 },
  dt14d: { warn: 99, max: 110 },
  dt28d: { warn: 171, max: 190 },
  iappMin180d: 3,
  // Take Off + Landing count minimum (90 days), IFR Hours minimum (180
  // days), and Flight Time minimum (90 days, oil & gas customer
  // requirement) - same "must reach at least this much to stay current"
  // shape as iappMin180d above, shown as Warning (not Exceeded) when under
  // threshold since falling short of currency isn't itself a duty-time
  // violation.
  takeoffLandingMin90d: 3,
  ifrMin180d: 3,
  ft90dMin: 50,
  // Recovery Rest (168-hour duty cycle) per OPS-CM-01 7.12.4: a qualifying
  // rest is >= minHours long and covers >= 2 local nights (nightStartHour:00
  // to nightEndHour:00 next day), each by >= minNightOverlapHours (or
  // truncated-by-morning-report, see dutyPeriods.js). The end of the last
  // qualifying rest = start of the current 168h duty cycle; the next
  // recovery rest must START within cycleMaxHours of that point. WARNING is
  // derived, not a separate setting: it fires when the time remaining in
  // the cycle is less than recoveryRestMinHours (no longer enough room to
  // complete a full recovery rest before the deadline).
  recoveryRestMinHours: 36,
  recoveryRestMinNightOverlapHours: 8,
  recoveryRestNightStartHour: 22,
  recoveryRestNightEndHour: 8,
  // 168h Duty Cycle bar (like the FT/DT bars): turns yellow at or above
  // cycleWarnHours elapsed, red at or above cycleMaxHours. Default warn 132
  // = 36h of headroom left before the 168h deadline.
  recoveryRestCycleWarnHours: 132,
  recoveryRestCycleMaxHours: 168,
  // Duty Period (FDP) rules, confirmed directly with the domain expert
  // (not guessed placeholders like the numbers above, though still worth a
  // final check against the written CAAT-approved FTL Scheme when
  // available): Duty Period start = first activity of the day minus
  // dutyReportOffsetMinutes (applies whether the first activity is a
  // flight or a non-flight one, e.g. a meeting - "Mixed Duty" day); end =
  // last flight's shutdown plus dutyPostFlightOffsetMinutes when the
  // period includes a flight. Must not exceed dutyPeriodMaxHours, may
  // extend by dutyPeriodUnforeseenExtensionHours if there was flying.
  // dutyMinRestHours is the minimum rest floor between Duty Periods
  // (separate from the 168h/36h Recovery Rest rule above). stbyCreditPercent
  // is the % of actual Day/Night Standby duration credited toward the DT
  // 7/14/28-day rolling sums (see src/utils/dutyPeriods.js).
  dutyReportOffsetMinutes: 60,
  dutyPostFlightOffsetMinutes: 30,
  // Max FDP and max daily flight time vary by REPORT TIME per OPS-CM-01
  // 7.4.1 (two-pilot helicopter table, verified against the manual Issue 07).
  // Windows cover the full 24h; the 2100-0459 row wraps midnight. from/to
  // are inclusive "HHMM" strings compared against the Duty Period's start
  // (report) time-of-day. dutyPeriodMaxHours below stays as a fallback if a
  // saved override leaves a gap in the table.
  fdpByReportTime: [
    { from: "0500", to: "0559", maxFdp: 10, maxFt: 7 },
    { from: "0600", to: "0659", maxFdp: 11, maxFt: 8 },
    { from: "0700", to: "1259", maxFdp: 12, maxFt: 8 },
    { from: "1300", to: "2059", maxFdp: 10, maxFt: 7 },
    { from: "2100", to: "0459", maxFdp: 9, maxFt: 6 }
  ],
  dutyPeriodMaxHours: 12,
  dutyPeriodUnforeseenExtensionHours: 2,
  // Two-tier minimum rest per OPS-CM-01 7.17.3.1: below 12h violates the
  // oil & gas customer requirement (warn/yellow), below 8h violates the
  // CAAT requirement (exc/red).
  dutyMinRestHours: 12,
  dutyMinRestCaatHours: 8,
  stbyCreditPercent: 25,
  // OPS-CM-01 7.9.2 - Standby Other Than Base Airport: governs what
  // happens when a pilot on Day/Night Standby actually gets called out to
  // report for a duty (most commonly a flight), not the "quiet" standby
  // case where it's released without ever escalating (that's just Duty
  // Time credited at stbyCreditPercent above, no FDP implications).
  standbyMaxHours: 16, // 7.9.2(a) - a standby period itself must never run longer than this
  // 7.9.2(b) - standby duration + the FDP that follows it combined must
  // not exceed this many hours (company procedure keeping total awake
  // time in check).
  standbyPlusFdpMaxAwakeHours: 18,
  // 7.9.2(f)/(g) - the first N hours of standby before the crew reports
  // don't reduce the max FDP that follows; anything beyond that reduces
  // the max FDP hour-for-hour.
  standbyFdpReductionFreeHours: 6,
  // 7.9.2(h) - extends the free-hours threshold to 8h on a split-duty day.
  // Not auto-detected (the app doesn't currently model split duty), so
  // this is exposed for an Admin to apply manually if needed - the
  // automatic check in dutyPeriods.js always uses the standard 6h value.
  standbyFdpReductionFreeHoursSplitDuty: 8,
  // 7.9.2(j) - reference value only (the company's contracted response
  // time between being called and reporting). Not enforced automatically -
  // Daily Duty Entry doesn't capture a separate "time contacted" timestamp
  // distinct from the logged standby end/report time.
  standbyResponseTimeMinutes: 60,
  // Report A ("Pilot Experience / Qualification Summary") threshold minimums
  // (As Customer Requirement), shown in the report's column headers and used
  // to red-flag pilots below them. The aircraft-type minimum is
  // position-dependent: reportAw139Min applies to Captains, and
  // reportAw139SecondaryMin applies to Co-pilots (SFO/FO).
  reportTotalTimeMin: 3000,
  reportMEngPicMin: 1200,
  reportPicMin: 1500,
  reportAw139Min: 100,
  reportAw139SecondaryMin: 50
};

export const FTL_ROLLING_FIELDS = [
  { key: "ft7d", label: "Flight Time — 7 days", section: "Flight Time" },
  { key: "ft28d", label: "Flight Time — 28 days", section: "Flight Time" },
  { key: "ft365d", label: "Flight Time — 365 days", section: "Flight Time" },
  { key: "dt7d", label: "Duty Time — 7 days", section: "Duty Time" },
  { key: "dt14d", label: "Duty Time — 14 days", section: "Duty Time" },
  { key: "dt28d", label: "Duty Time — 28 days", section: "Duty Time" }
];

// Merges a saved (possibly partial/older-shaped) value over the defaults so
// a field added after a company already saved custom limits doesn't end up
// undefined.
export function withFtlDefaults(saved) {
  if (!saved) return DEFAULT_FTL_LIMITS;
  const merged = { ...DEFAULT_FTL_LIMITS, ...saved };
  for (const { key } of FTL_ROLLING_FIELDS) {
    merged[key] = { ...DEFAULT_FTL_LIMITS[key], ...(saved[key] || {}) };
  }
  return merged;
}
