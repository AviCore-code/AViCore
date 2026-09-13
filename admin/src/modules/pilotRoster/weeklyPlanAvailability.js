// Is this pilot available to be PLANNED for duty, according to everything
// the app already knows about them?
//
// The Weekly Schedule doesn't invent its own view of a pilot's standing - it
// reads the very same figures FDT Monitor and Training Monitor display, so a
// pilot who looks red on those pages can never quietly appear on next week's
// plan. Three sources:
//
//   FDT Monitor    - rolling Duty Time (7/14/28d), rolling Flight Time
//                    (7/28/365d), and the 168-hour Recovery Rest cycle.
//   Training Monitor - every monitored document and course: passport,
//                    licence, medical, LPC, OPC, line check, HUET, CRM, DGs,
//                    AVSEC ... all of them must be valid.
//   Night Currency - separately, and only for the night lines (a lapsed
//                    night currency doesn't stop day flying).
//
// "exc" blocks the pilot from being planned at all; "warn" is allowed but
// reported, because a planner may legitimately choose to use someone who is
// merely approaching a limit.

const FT_METRICS = [
  { key: "ft7d", label: "Flight Time 7 days" },
  { key: "ft28d", label: "Flight Time 28 days" },
  { key: "ft365d", label: "Flight Time 365 days" }
];

const DT_METRICS = [
  { key: "dt7d", label: "Duty Time 7 days" },
  { key: "dt14d", label: "Duty Time 14 days" },
  { key: "dt28d", label: "Duty Time 28 days" }
];

function classify(value, limit) {
  if (!limit || value == null) return "ok";
  if (value >= limit.max) return "exc";
  if (value >= limit.warn) return "warn";
  return "ok";
}

function fmt(hours) {
  if (hours == null) return "-";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// row: { stats, recoveryRest, status } as produced by loadAllPilotStatusRows.
export function pilotAvailability(row, limits) {
  const reasons = [];
  let severity = "ok";

  function add(level, text) {
    reasons.push({ level, text });
    if (level === "exc" || severity !== "exc") severity = level;
  }

  const stats = row?.stats;
  if (stats && limits) {
    for (const m of [...DT_METRICS, ...FT_METRICS]) {
      const s = classify(stats[m.key], limits[m.key]);
      if (s === "ok") continue;
      add(s, `${m.label} at ${fmt(stats[m.key])} of ${fmt(limits[m.key].max)}`);
    }

    // Flight Time 90 days is a MINIMUM (oil & gas recency), not a ceiling -
    // being under it is a currency caution, never a reason to refuse duty.
    // In fact more flying is the cure, so it must not block planning.
    if (limits.ft90dMin != null && stats.ft90d != null && stats.ft90d < limits.ft90dMin) {
      add("warn", `Flight Time 90 days only ${fmt(stats.ft90d)} of ${fmt(limits.ft90dMin)} minimum — needs flying to regain recency`);
    }
  }

  // 168-hour Recovery Rest cycle (OPS-CM-01 7.12.4). "exc" means the cycle
  // deadline has passed or there is no longer room to fit a qualifying rest
  // before it does - the pilot needs a Recovery Rest, not another duty.
  const rr = row?.recoveryRest;
  if (rr?.status === "exc") {
    add("exc", rr.hoursSinceLastRest != null
      ? `Recovery Rest due — ${Math.round(rr.hoursSinceLastRest)}h into the 168h duty cycle`
      : "Recovery Rest due (168h duty cycle)");
  } else if (rr?.status === "warn") {
    add("warn", "168h duty cycle running out — schedule a Recovery Rest");
  }

  return { severity, blocked: severity === "exc", reasons };
}

// Who is coming out of the work cycle under-flown?
//
// The opposite concern to every other check on this page: not "has this
// pilot done too much" but "has this pilot been given too little". A pilot
// consistently passed over for the flying loses currency and skill, and it
// is invisible on a page that only looks for limits being exceeded.
//
// Reported, never enforced - refusing to plan somebody because they haven't
// flown enough would make it worse.
export function underFlownPilots({ flightHoursByCode, iso, cycleDays = 28, minHours = 40, rollingSumFn }) {
  const rows = [];
  for (const [code, byDate] of Object.entries(flightHoursByCode || {})) {
    const flown = rollingSumFn(byDate, iso, cycleDays);
    if (flown < minHours) {
      rows.push({ code, flown: +flown.toFixed(1), minHours, short: +(minHours - flown).toFixed(1) });
    }
  }
  rows.sort((a, b) => a.flown - b.flown);
  return rows;
}

// Does the published roster actually give this pilot their 7 days off in the
// 28-day cycle?
//
// This checks the ROSTER, not the plan - the planner can only work with the
// duty days it's given, so a cycle short of rest days is a roster problem
// that has to be fixed upstream. Worth surfacing here because it is invisible
// on a month calendar: 22 or 23 duty days in a row looks unremarkable until
// somebody counts.
export function checkCycleOffDays({ rosterByPilotDate, pilots, throughIso, cycleDays = 28, offDaysRequired = 7, isoAddDaysFn }) {
  const ON_DUTY = new Set(["O", "N", "ND"]);
  const rows = [];
  for (const code of pilots || []) {
    let known = 0;
    let off = 0;
    for (let i = 0; i < cycleDays; i++) {
      const iso = isoAddDaysFn(throughIso, -i);
      const rosterCode = rosterByPilotDate?.get(`${code}|${iso}`);
      if (!rosterCode) continue;
      known++;
      if (!ON_DUTY.has(String(rosterCode).toUpperCase())) off++;
    }
    // Only judge a cycle the roster actually covers - a partially imported
    // month would otherwise look like everyone is being overworked.
    if (known < cycleDays) continue;
    if (off < offDaysRequired) {
      rows.push({ code, off, required: offDaysRequired, dutyDays: known - off });
    }
  }
  return rows.sort((a, b) => a.off - b.off);
}

// Convenience: one short line naming why, for the "couldn't be placed" list.
export function availabilityReason(availability) {
  if (!availability?.reasons?.length) return "";
  return availability.reasons.map((r) => r.text).join("; ");
}
