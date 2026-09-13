import {
  WEEKLY_SECTIONS,
  SECTION_BY_KEY,
  MIN_REST_HOURS,
  dutyWindow,
  restHoursBetween,
  plannedDutyHours
} from "./weeklyPlanSections.js";
import {
  DEFAULT_PLAN_DUTY_LIMITS,
  LINE_ROTATION_PATTERN,
  MIN_FLIGHT_HOURS_PER_CYCLE,
  WORK_CYCLE_DAYS,
  MAX_NIGHT_DAYS_PER_CYCLE,
  PREFER_UNFAMILIAR_PAIRINGS,
  PAIRING_LOOKBACK_DAYS,
  FIRST_DAY_NO_NIGHT,
  FIRST_DAY_PAIR_WITH_CURRENT,
  CURRENTLY_OPERATING_WITHIN_DAYS,
  LAST_DAY_PREFER_EARLY_FINISH,
  LAST_DAY_NIGHT_NOTICE_DAYS,
  LAST_DAY_NIGHT_LAST_RESORT,
  NIGHT_TRAINING_MIN_PILOTS,
  NIGHT_TRAINING_PREFERRED_PILOTS,
  NIGHT_TRAINING_REQUIRES_CAPTAIN,
  NIGHT_TRAINING_REQUIRES_CURRENT_PILOT,
  dayCrewsOn
} from "./weeklyPlanRules.js";
import { classifyTourDay } from "./weeklyPlanTourDays.js";
import { checkTrainingPair, crewSatisfiesSeatedDirectives } from "./weeklyPlanTrainingPairs.js";
import { MIN_PAIR_LEVEL_SUM } from "../../utils/experienceLevel.js";
import { availabilityReason } from "./weeklyPlanAvailability.js";
import { rollingSum, isoAddDays as headroomAddDays } from "./weeklyPlanHeadroom.js";
import { rosterDayInfo } from "./rosterCodes.js";

// Builds a week's plan automatically from the PUBLISHED duty roster.
//
// The input is "who is on duty on each day" (the Duty Schedule calendar -
// codes O / N / ND count as on duty, everything else - X, RR, R, leave,
// training, inspection - does not). The output is a set of cells for the
// Weekly Schedule grid.
//
// The roster answers WHEN a pilot works - which days count toward the 21
// working days of the cycle, and therefore what they're paid. It does NOT
// decide WHAT they do: an O, an N and an ND are all just "a working day",
// and this planner may put any of them on any line. A pilot the roster shows
// as N can be planned onto a day crew; that is normal, not a conflict. What
// can never be touched is a day the roster gives OFF - X, RR, R and leave
// are not reassignable. The point is that the constraints a planner has to
// hold in their head are applied mechanically and identically every week:
//
//   1. NIGHT CURRENCY - both pilots on a night line must hold valid night
//      currency. A pilot whose Night Currency has expired is never put on
//      night, no matter how short-handed the day is.
//   2. MINIMUM REST - 12 hours between the end of one duty and the report
//      time of the next. Coming off night (ends 05:30) that means the
//      earliest next report is 17:30: night-to-night is legal, night-to-day
//      the next morning is not. The same test also catches day-to-night on
//      the same date (day ends 17:30, night reports 17:30 = zero rest).
//   3. TRAINING NOT OVERDUE - a pilot with an expired monitored training
//      item is not assigned to fly. (Night Currency is handled by rule 1 and
//      only blocks night lines, not day flying - matching how the Training
//      module already grades it.)
//   4. CREW COMPOSITION - a two-pilot crew can be Captain+Captain or
//      Captain+Co-pilot, never Co-pilot+Co-pilot. Captains are therefore
//      placed first and each remaining seat is filled with whoever keeps the
//      crew legal.
//   5. FDT MONITOR STANDING - the pilot's rolling Duty Time (7/14/28d),
//      rolling Flight Time (7/28/365d) and the 168-hour Recovery Rest cycle,
//      exactly as FDT Monitor shows them. Anyone already at a limit, or due
//      a Recovery Rest, is not planned for duty.
//   6. NIGHT SPREAD - no more than six night duties per 28-day cycle. The
//      duty limits alone won't produce this: night books only 3h, so it is
//      cheap against every FTL limit and an unconstrained planner parks the
//      same night-current pilot there night after night, entirely legally.
//   7. FIRST / LAST DAY OF TOUR - the first day back from the seven days off
//      is never night standby (a week out of Area Operations), and a
//      returning pilot is crewed with someone currently operating. The last
//      day gets an early-finishing line, because the pilot flies home that
//      evening; night on the last day is allowed but must be notified.
//   8. TRAINING PAIRINGS - a pilot under a temporary "must fly with X until
//      <date>" instruction is only crewed with that instructor (or with any
//      instructor). Entered as data with an end date, so it expires by
//      itself. An instructor is anyone holding TRI or TRE hours.
//   9. PAIRING VARIETY - where there is a free choice, crew a pilot with
//      someone they haven't flown with recently. This is a CRM measure: a
//      fixed partnership drifts into shorthand and stops practising the
//      explicit briefing and cross-check CRM depends on.
//  10. ROTATION PATTERN - Night -> OFF -> Crew 1 -> Crew 3 -> Crew 2 ->
//      Crew 4, and flight-hour fairness (nobody under 40h a cycle). Both are
//      PREFERENCES that order the pilots already legal for a seat - neither
//      can place someone the rules have refused.
//  11. ROLLING DUTY LIMITS - the real limit on how often a pilot can be used.
//      There is NO cap on consecutive duty days or consecutive nights; what
//      stops you is the 7 / 14 / 28-day duty totals. A day crew books its
//      whole window (Crew 1 reports 05:30 for its 06:30 departure = 12h),
//      while night standby books only 25% of its
//      12 hours (= 3h), so a pilot can sit night indefinitely but runs out of
//      the 60h/7-day allowance after five Crew-1 duties. Hours ALREADY
//      FLOWN (from Daily Duty) are counted first, then the plan adds to them,
//      so the two never disagree.
//
// It never invents an assignment for a pilot who isn't rostered on duty, and
// it never silently drops someone: whoever is on duty but couldn't be placed
// comes back in `unplaced` with the reason, so the planner can see it.

// The clock window of a roster training day, as real dates.
function trainingWindow(iso, window) {
  if (!window) return null;
  const at = (hhmm) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const [h, min] = String(hhmm).split(":").map(Number);
    return new Date(y, (m || 1) - 1, d || 1, h || 0, min || 0, 0, 0);
  };
  return { start: at(window.start), end: at(window.end) };
}

// Day lines are filled in order (Crew 1 first, which also has the earliest
// report), then the night lines. OPC/Training/OFF are left to the planner -
// they come from the training plan, not from who happens to be on duty.
const DAY_SECTION_KEYS = WEEKLY_SECTIONS.filter((s) => s.kind === "crew").map((s) => s.key);
const NIGHT_SECTION_KEYS = WEEKLY_SECTIONS.filter((s) => s.kind === "night").map((s) => s.key);

function isCaptain(position) {
  return position === "Captain";
}

// A crew is illegal only when BOTH seats are non-Captains.
function crewWouldBeLegal(existingPositions, candidatePosition) {
  const all = [...existingPositions, candidatePosition];
  return all.some(isCaptain);
}

// OPS-CM-01 7.17.4(2): the two pilots' Experience Levels added must be at
// least 4. Enforced only when both levels are known - if the Experience
// records aren't complete enough to compute a level, the pairing isn't
// blocked here (it's reported by the checks instead), otherwise a gap in the
// data would empty the whole roster.
function pairingWouldBeLegal(existingCodes, candidateCode, levelByCode, minSum) {
  if (!levelByCode || !existingCodes.length) return true;
  const candidateLevel = levelByCode.get(candidateCode);
  if (candidateLevel == null) return true;
  for (const code of existingCodes) {
    const other = levelByCode.get(code);
    if (other == null) continue;
    if (other + candidateLevel < minSum) return false;
  }
  return true;
}

const MS_PER_DAY = 86400000;

function isoAddDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function autoFillWeek({
  dates,
  rosterByPilotDate,
  positionsByCode,
  nightCurrentByCode,
  trainingOverdueByCode,
  previousDutyEndByCode,
  // { "CODE": { "YYYY-MM-DD": hours } } - duty already recorded in Daily
  // Duty before this plan starts. Without it the rolling windows would only
  // see the planned week and a pilot could be planned straight past a limit
  // they had already nearly reached.
  priorDutyHoursByCode,
  limits = DEFAULT_PLAN_DUTY_LIMITS,
  stbyCreditPercent = 25,
  // Map of pilot code -> Experience Level 1-4 (OPS-CM-01 7.17.4). Used for
  // the pairing rule; omit it and pairing simply isn't enforced.
  levelByCode,
  minPairLevelSum = MIN_PAIR_LEVEL_SUM,
  // Map of pilot code -> pilotAvailability() result, derived from FDT
  // Monitor (rolling DT/FT limits + the 168h Recovery Rest cycle). A pilot
  // whose severity is "exc" is not planned for duty at all.
  availabilityByCode,
  // { "CODE": { "YYYY-MM-DD": hours } } - flight hours already RECORDED.
  // Flight time can't be projected (the plan doesn't know what will be
  // flown), but it can be checked as of each planned date against history,
  // which is what makes a 30-day plan honest: a pilot blocked on FT today
  // may be clear by day 20 as old flights roll out of the window.
  priorFlightHoursByCode,
  // Plan to the WARNING threshold, not the legal maximum. Nobody should end
  // a three-week plan sitting on yellow: a warning means there is no room
  // left for the callouts and delays that actually happen, so the plan is
  // built to stay below it and only falls back to the hard max if a seat
  // would otherwise go unfilled.
  targetWarnThreshold = true,
  // What to do when a seat can only be filled by pushing somebody into the
  // warning band. Default is to LEAVE THE SEAT EMPTY and report it: an
  // unmanned crew line is a visible, fixable planning problem, whereas a
  // pilot quietly sitting on yellow for three weeks is a fatigue problem
  // nobody notices until something goes wrong. Set true to fill anyway.
  stretchIntoWarning = false,
  // Preferred order a pilot moves through the lines. Only reorders pilots
  // who are already legal for the seat - it can never place someone the
  // rules have refused.
  rotationPattern = LINE_ROTATION_PATTERN,
  minFlightHoursPerCycle = MIN_FLIGHT_HOURS_PER_CYCLE,
  cycleDays = WORK_CYCLE_DAYS,
  // { "CODE": Set<"YYYY-MM-DD"> } - nights this pilot has ALREADY been
  // planned before this run, so the six-per-cycle cap counts across the
  // boundary instead of resetting every time the planner is re-run.
  priorNightDatesByCode,
  maxNightDaysPerCycle = MAX_NIGHT_DAYS_PER_CYCLE,
  // Assignments that are ALREADY planned inside `dates` and must be kept.
  // They are not re-decided: their seats are treated as taken, and the
  // running state (duty hours, rest, night count, rotation position) is
  // seeded from them, so what follows continues on from the existing plan
  // instead of being computed as though the period were empty.
  //
  // This is what lets "re-plan this week only" be followed by "plan 30 days"
  // without the second run undoing the first.
  existingCells,
  // [{ date, codes: ["A","B"] }] - crews that have already flown together,
  // for the CRM pairing-variety preference. Seeded from the previous cycle's
  // plan; the current run adds to it as it goes.
  priorPairings,
  preferUnfamiliarPairings = PREFER_UNFAMILIAR_PAIRINGS,
  pairingLookbackDays = PAIRING_LOOKBACK_DAYS,
  firstDayNoNight = FIRST_DAY_NO_NIGHT,
  firstDayPairWithCurrent = FIRST_DAY_PAIR_WITH_CURRENT,
  lastDayPreferEarlyFinish = LAST_DAY_PREFER_EARLY_FINISH,
  // Night on the last day of a tour is allowed, but only with three weeks'
  // notice and only when nothing else will fill the seat. `noticeFromIso` is
  // the day the plan is being made - notice is counted from there, not from
  // the start of the period being planned.
  lastDayNightNoticeDays = LAST_DAY_NIGHT_NOTICE_DAYS,
  lastDayNightLastResort = LAST_DAY_NIGHT_LAST_RESORT,
  noticeFromIso,
  // [{ pilotCode, withCode, from, to, note }] - temporary "must fly with"
  // instructions with an end date (line training, post-OPC consolidation,
  // return to line). See weeklyPlanTrainingPairs.js.
  trainingPairs,
  // Set of pilot codes holding TRI/TRE hours - who counts as an instructor.
  instructors,
  // dutyReportOffsetMinutes from the FTL settings. Day-crew times are
  // SCHEDULED DEPARTURES, so duty starts this many minutes earlier.
  reportOffsetMinutes = 60,
  // How many day crews open on a given date. Weekends are lighter, so this
  // is a function of the date rather than a single number. Overridable so a
  // one-off busy Saturday can be planned without editing the rules.
  dayCrews = dayCrewsOn
}) {
  const cells = [];
  const unplaced = [];
  const notes = [];

  // Seats already filled, keyed date|section|slot, and the pilots occupying
  // them per date - both consulted before any new assignment is made.
  const keptSeats = new Set();
  const keptByDate = new Map();
  for (const c of existingCells || []) {
    if (!c?.date || !c?.section || !c?.pilotCode) continue;
    const code = String(c.pilotCode).toUpperCase();
    keptSeats.add(`${c.date}|${c.section}|${c.slot ?? 0}`);
    if (!keptByDate.has(c.date)) keptByDate.set(c.date, new Set());
    keptByDate.get(c.date).add(code);
  }

  // Running duty hours per pilot per date - seeded with what's already been
  // flown, then added to as the plan is built.
  const dutyByPilotDate = new Map();
  for (const [code, byDate] of Object.entries(priorDutyHoursByCode || {})) {
    dutyByPilotDate.set(String(code).toUpperCase(), new Map(Object.entries(byDate)));
  }

  function rollingHours(pilotCode, endIso, windowDays) {
    const byDate = dutyByPilotDate.get(pilotCode);
    if (!byDate) return 0;
    let total = 0;
    for (let i = 0; i < windowDays; i++) {
      total += byDate.get(isoAddDays(endIso, -i)) || 0;
    }
    return total;
  }

  function addDuty(pilotCode, iso, hours) {
    if (!dutyByPilotDate.has(pilotCode)) dutyByPilotDate.set(pilotCode, new Map());
    const byDate = dutyByPilotDate.get(pilotCode);
    byDate.set(iso, (byDate.get(iso) || 0) + hours);
  }

  // Would adding this duty break a rolling limit? Checked against every
  // window that ENDS on or after this date, since adding hours today also
  // raises the totals of the next few days' windows - but the day itself is
  // the binding one for a plan built in date order.
  function withinLimits(pilotCode, iso, hours, ceiling = "max") {
    const pick = (limit) => (ceiling === "warn" ? (limit?.warn ?? limit?.max) : limit?.max);
    const checks = [
      { days: 7, max: pick(limits.dt7d), label: "duty" },
      { days: 14, max: pick(limits.dt14d), label: "duty" },
      { days: 28, max: pick(limits.dt28d), label: "duty" }
    ];
    for (const c of checks) {
      if (!c.max) continue;
      const total = rollingHours(pilotCode, iso, c.days) + hours;
      // The monitors turn yellow AT the warning figure, not past it, so
      // planning to the warning ceiling has to stay strictly below it -
      // landing exactly on 54h would still show as yellow.
      const exceeds = ceiling === "warn" ? total >= c.max : total > c.max;
      if (exceeds) {
        return { ok: false, days: c.days, max: c.max, metric: "duty", would: +total.toFixed(1) };
      }
    }

    // Recorded FLIGHT time in the window ending on this date. Not projected
    // forward (the plan has no flight hours of its own), but a pilot whose
    // recorded flying already fills the window can't be given more on that
    // date - and, unlike a "today" snapshot, this correctly clears them
    // again once those hours age out.
    const flightByDate = priorFlightHoursByCode?.[pilotCode];
    if (flightByDate) {
      const ftChecks = [
        { days: 7, max: pick(limits.ft7d) },
        { days: 28, max: pick(limits.ft28d) },
        { days: 365, max: pick(limits.ft365d) }
      ];
      for (const c of ftChecks) {
        if (!c.max) continue;
        const used = rollingSum(flightByDate, iso, c.days);
        if (used >= c.max) {
          return { ok: false, days: c.days, max: c.max, metric: "flight", would: +used.toFixed(1) };
        }
      }
    }
    return { ok: true };
  }

  // Where each pilot currently sits in the rotation, so the next seat
  // offered to them is the next one along the pattern.
  const lastLineByCode = new Map();
  const patternIndex = new Map(rotationPattern.map((key, i) => [key, i]));

  function nextLineFor(pilotCode) {
    const last = lastLineByCode.get(pilotCode);
    if (last == null) return null;
    const i = patternIndex.get(last);
    if (i == null) return null;
    return rotationPattern[(i + 1) % rotationPattern.length];
  }

  // How far round the pattern this section is from where the pilot is now.
  // 0 = exactly the next line they're due; higher = further out of turn.
  function rotationDistance(pilotCode, sectionKey) {
    const next = nextLineFor(pilotCode);
    if (next == null) return 0;
    const from = patternIndex.get(next);
    const to = patternIndex.get(sectionKey);
    if (from == null || to == null) return rotationPattern.length;
    return (to - from + rotationPattern.length) % rotationPattern.length;
  }

  // How often each pair has flown together, and when. Keyed with the two
  // codes sorted, so the pair is the same whichever way round it's asked.
  const pairHistory = new Map();

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function recordPair(a, b, iso) {
    const key = pairKey(a, b);
    if (!pairHistory.has(key)) pairHistory.set(key, []);
    pairHistory.get(key).push(iso);
  }

  for (const p of priorPairings || []) {
    const codes = (p?.codes || []).map((c) => String(c).toUpperCase());
    if (codes.length < 2 || !p.date) continue;
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) recordPair(codes[i], codes[j], p.date);
    }
  }

  // How many times these two have crewed together inside the lookback
  // window ending on `iso`. Lower is better - it means they know each other's
  // habits less well, which is exactly the point.
  function pairingsWithin(a, b, iso) {
    const dates = pairHistory.get(pairKey(a, b));
    if (!dates?.length) return 0;
    const from = isoAddDays(iso, -pairingLookbackDays);
    return dates.filter((d) => d > from && d <= iso).length;
  }

  // First / last day of tour, worked out once per pilot per date from the
  // roster - see weeklyPlanTourDays.js for why these two days are special.
  const tourDayCache = new Map();
  function tourDay(pilotCode, iso) {
    const key = `${pilotCode}|${iso}`;
    if (!tourDayCache.has(key)) tourDayCache.set(key, classifyTourDay(rosterByPilotDate, pilotCode, iso));
    return tourDayCache.get(key);
  }

  // Has this pilot worked in the last few days - i.e. are they in the run of
  // operations, or have they just walked back in? Counts recorded duty and
  // anything already placed by this run.
  function currentlyOperating(pilotCode, iso) {
    const byDate = dutyByPilotDate.get(pilotCode);
    if (!byDate) return false;
    for (let i = 1; i <= CURRENTLY_OPERATING_WITHIN_DAYS; i++) {
      if ((byDate.get(isoAddDays(iso, -i)) || 0) > 0) return true;
    }
    return false;
  }

  // Night duties per pilot, recorded plus planned, so the six-per-cycle cap
  // can be applied as the plan is built.
  const nightDatesByCode = new Map();
  for (const [code, dates] of Object.entries(priorNightDatesByCode || {})) {
    nightDatesByCode.set(String(code).toUpperCase(), new Set(dates));
  }

  function nightDaysInCycle(pilotCode, iso) {
    const dates = nightDatesByCode.get(pilotCode);
    if (!dates) return 0;
    let count = 0;
    for (let i = 0; i < cycleDays; i++) {
      if (dates.has(isoAddDays(iso, -i))) count++;
    }
    return count;
  }

  function nightCapReached(pilotCode, iso) {
    if (!maxNightDaysPerCycle) return false;
    return nightDaysInCycle(pilotCode, iso) >= maxNightDaysPerCycle;
  }

  // Flight hours actually flown in the last cycle - used to favour whoever
  // has been flying least, so the 40h-per-cycle target is met by everyone
  // rather than on average.
  function flightHoursInCycle(pilotCode, iso) {
    const byDate = priorFlightHoursByCode?.[pilotCode];
    if (!byDate) return 0;
    return rollingSum(byDate, iso, cycleDays);
  }

  // Crews inside the kept assignments count as flown-together too.
  const keptCrews = new Map();
  for (const c of existingCells || []) {
    if (!c?.date || !c?.section || !c?.pilotCode) continue;
    const key = `${c.date}|${c.section}`;
    if (!keptCrews.has(key)) keptCrews.set(key, []);
    keptCrews.get(key).push(String(c.pilotCode).toUpperCase());
  }
  for (const [key, codes] of keptCrews) {
    const date = key.split("|")[0];
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) recordPair(codes[i], codes[j], date);
    }
  }

  // Seed the running state from the assignments being kept, in date order,
  // exactly as if this run had made them itself.
  for (const c of [...(existingCells || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    if (!c?.date || !c?.section || !c?.pilotCode) continue;
    const code = String(c.pilotCode).toUpperCase();
    const section = SECTION_BY_KEY.get(c.section);
    addDuty(code, c.date, plannedDutyHours(c.section, c.date, stbyCreditPercent, reportOffsetMinutes));
    if (section?.kind === "night") {
      if (!nightDatesByCode.has(code)) nightDatesByCode.set(code, new Set());
      nightDatesByCode.get(code).add(c.date);
    }
  }

  // Rolling record of when each pilot's last planned duty ended, seeded with
  // whatever they were doing before this week started. This is what makes
  // the 12-hour rule work across day boundaries (and across the Sunday of
  // the previous week).
  const lastDutyEnd = new Map(previousDutyEndByCode || []);
  const lastLineSeed = [...(existingCells || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const c of lastLineSeed) {
    if (!c?.date || !c?.section || !c?.pilotCode) continue;
    const code = String(c.pilotCode).toUpperCase();
    const window = dutyWindow(c.section, c.date, reportOffsetMinutes);
    if (window) lastDutyEnd.set(code, window.end);
    lastLineByCode.set(code, c.section);
  }

  for (const date of dates) {
    // Who is rostered on duty today, per the published calendar - and, just
    // as importantly, who is at TRAINING today. Training is scheduled on the
    // roster, not here, but it is duty: it burns hours against the rolling
    // limits and it ends at a time the next duty has to rest 12 hours from.
    // Booking it before anyone is placed means the day's decisions are made
    // against the true picture.
    const onDuty = [];
    const occupiedToday = [];
    for (const [key, code] of rosterByPilotDate) {
      const [pilotCode, rosterDate] = key.split("|");
      if (rosterDate !== date) continue;
      const info = rosterDayInfo(code);
      if (!info) continue;
      if (info.occupied) {
        const window = trainingWindow(date, info.window);
        if (window) {
          addDuty(pilotCode, date, (window.end - window.start) / 3600000);
          lastDutyEnd.set(pilotCode, window.end);
        }
        occupiedToday.push({ pilotCode, kind: info.occupied });
        continue;
      }
      if (info.onDuty) onDuty.push(pilotCode);
    }

    // Captains first: every crew needs at least one, and placing them first
    // means a crew can never end up needing a Captain that's already used.
    onDuty.sort((a, b) => {
      const capA = isCaptain(positionsByCode?.[a]) ? 0 : 1;
      const capB = isCaptain(positionsByCode?.[b]) ? 0 : 1;
      if (capA !== capB) return capA - capB;
      return a.localeCompare(b);
    });

    const available = new Set(onDuty);
    const placedToday = new Set(keptByDate.get(date) || []);
    for (const code of placedToday) available.delete(code);

    // How much warning a pilot would get about this date, counted from the
    // day the plan is being made.
    function noticeDays(iso) {
      const from = noticeFromIso || dates[0];
      if (!from) return Infinity;
      const [ay, am, ad] = String(from).split("-").map(Number);
      const [by, bm, bd] = String(iso).split("-").map(Number);
      if (!ay || !by) return Infinity;
      return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
    }

    function restOk(pilotCode, sectionKey) {
      const window = dutyWindow(sectionKey, date, reportOffsetMinutes);
      if (!window) return { ok: true };
      const previousEnd = lastDutyEnd.get(pilotCode);
      if (!previousEnd) return { ok: true };
      const rest = restHoursBetween(previousEnd, window.start);
      if (rest == null) return { ok: true };
      return { ok: rest >= MIN_REST_HOURS, rest };
    }

    function take(sectionKey, slot, filter, preferNonCaptain = false, ceiling = "max", allowLastDayNight = false) {
      // Never re-decide a seat that is already planned and being kept.
      if (keptSeats.has(`${date}|${sectionKey}|${slot}`)) return null;
      const section = SECTION_BY_KEY.get(sectionKey);
      const seated = cells.filter((c) => c.date === date && c.section === sectionKey);
      const seatedPositions = seated.map((c) => positionsByCode?.[c.pilotCode]);
      const seatedCodes = seated.map((c) => c.pilotCode);

      // For the second seat, take a Co-pilot in preference to a Captain.
      // Captain+Captain is legal but wasteful: every crew needs a Captain,
      // so burning two on one line leaves later crews unmannable. With ~10
      // pilots on duty (about 4-5 Captains) this is the difference between
      // filling two crews and filling all five.
      // Ordering is what keeps the whole plan out of the yellow. Among the
      // pilots who are legal for this seat, take the one carrying the LEAST
      // duty over the last 7 and 28 days - so work spreads across everyone
      // available instead of piling onto whoever happens to sort first.
      // Rank preference still comes first (a crew needs its Captain, and the
      // second seat prefers a Co-pilot so Captains aren't wasted).
      const order = [...onDuty].sort((a, b) => {
        // 1. Rank - a crew needs its Captain, and the second seat prefers a
        //    Co-pilot so Captains aren't wasted.
        if (preferNonCaptain) {
          const capA = isCaptain(positionsByCode?.[a]) ? 1 : 0;
          const capB = isCaptain(positionsByCode?.[b]) ? 1 : 0;
          if (capA !== capB) return capA - capB;
        }
        // 2. CRM: prefer whoever has flown with this crew LEAST recently.
        //    This is checked BEFORE the rotation pattern, but it only bites
        //    on the SECOND seat - there has to be someone already sitting to
        //    compare against. So the Captain seat still follows the rotation
        //    strictly, and the variety is found in who sits beside them.
        //    Ordering it the other way round made the preference almost
        //    inert: rotation had already narrowed the field to one candidate
        //    before CRM was ever consulted.
        if (preferUnfamiliarPairings && seatedCodes.length) {
          const famA = seatedCodes.reduce((n, code) => n + pairingsWithin(a, code, date), 0);
          const famB = seatedCodes.reduce((n, code) => n + pairingsWithin(b, code, date), 0);
          if (famA !== famB) return famA - famB;
        }
        // 2b. Last day of tour: they travel home this evening, so give the
        //     earliest-reporting line (which finishes earliest) to whoever is
        //     going home. Only reorders within the day lines.
        if (lastDayPreferEarlyFinish && section.kind === "crew") {
          const lastA = tourDay(a, date).lastDay ? 0 : 1;
          const lastB = tourDay(b, date).lastDay ? 0 : 1;
          if (lastA !== lastB) return lastA - lastB;
        }
        // 3. Whose turn it is - Night -> OFF -> Crew 1 -> 3 -> 2 -> 4.
        const rotA = rotationDistance(a, sectionKey);
        const rotB = rotationDistance(b, sectionKey);
        if (rotA !== rotB) return rotA - rotB;
        // 4. For a night seat, whoever has had the fewest nights this cycle -
        //    night is cheap on duty hours, so without this the same
        //    night-current pilot gets it over and over.
        if (SECTION_BY_KEY.get(sectionKey)?.kind === "night") {
          const nA = nightDaysInCycle(a, date);
          const nB = nightDaysInCycle(b, date);
          if (nA !== nB) return nA - nB;
        }
        // 5. Who has been flying least this cycle - keeps everyone above the
        //    40h target instead of letting the same names get all the flying.
        const shortA = flightHoursInCycle(a, date) < minFlightHoursPerCycle ? 0 : 1;
        const shortB = flightHoursInCycle(b, date) < minFlightHoursPerCycle ? 0 : 1;
        if (shortA !== shortB) return shortA - shortB;
        const ft = flightHoursInCycle(a, date) - flightHoursInCycle(b, date);
        if (Math.abs(ft) > 0.01) return ft;
        // 6. Who is carrying the least duty - what keeps the plan out of the
        //    yellow.
        const load7 = rollingHours(a, date, 7) - rollingHours(b, date, 7);
        if (Math.abs(load7) > 0.01) return load7;
        const load28 = rollingHours(a, date, 28) - rollingHours(b, date, 28);
        if (Math.abs(load28) > 0.01) return load28;
        return a.localeCompare(b);
      });

      for (const pilotCode of order) {
        if (!available.has(pilotCode) || placedToday.has(pilotCode)) continue;
        if (trainingOverdueByCode?.has(pilotCode)) continue;
        if (availabilityByCode?.get(pilotCode)?.blocked) continue;
        if (section.requiresNightCurrency && !nightCurrentByCode?.has(pilotCode)) continue;
        if (section.kind === "night" && nightCapReached(pilotCode, date)) continue;
        // First day back from the seven days off is never given night
        // standby - a week out of Area Operations is the wrong moment for a
        // night callout.
        if (section.kind === "night" && firstDayNoNight && tourDay(pilotCode, date).firstDay) continue;
        // Training directive: a pilot under one must be crewed with their
        // named instructor (or any instructor). Checked in both directions -
        // the candidate's own directive against who is already sitting, and
        // the seated pilots' directives against the candidate.
        if (trainingPairs?.length) {
          const own = checkTrainingPair({
            pilotCode, mates: seatedCodes, pairs: trainingPairs, iso: date, instructors
          });
          if (own.required && !own.ok) continue;
          const theirs = crewSatisfiesSeatedDirectives({
            candidate: pilotCode, seated: seatedCodes, pairs: trainingPairs, iso: date, instructors
          });
          if (theirs.required && !theirs.ok) continue;
        }
        // A returning pilot must be crewed with someone currently operating,
        // not with another pilot who has also just come back.
        if (firstDayPairWithCurrent && seatedCodes.length) {
          const candidateFresh = tourDay(pilotCode, date).firstDay;
          const mateFresh = seatedCodes.some((m) => tourDay(m, date).firstDay);
          if (candidateFresh && mateFresh) continue;
          if (candidateFresh && !seatedCodes.some((m) => currentlyOperating(m, date))) continue;
        }
        // Night on the last day of a tour: never inside the notice window,
        // and otherwise only on the final pass, once everyone else has been
        // tried. They fly home that evening.
        if (SECTION_BY_KEY.get(sectionKey)?.kind === "night" && tourDay(pilotCode, date).lastDay) {
          if (noticeDays(date) < lastDayNightNoticeDays) continue;
          if (lastDayNightLastResort && !allowLastDayNight) continue;
        }
        if (!restOk(pilotCode, sectionKey).ok) continue;
        if (!crewWouldBeLegal(seatedPositions, positionsByCode?.[pilotCode])) continue;
        if (!pairingWouldBeLegal(seatedCodes, pilotCode, levelByCode, minPairLevelSum)) continue;
        if (filter && !filter(pilotCode)) continue;

        const hours = plannedDutyHours(sectionKey, date, stbyCreditPercent, reportOffsetMinutes);
        if (!withinLimits(pilotCode, date, hours, ceiling).ok) continue;

        available.delete(pilotCode);
        placedToday.add(pilotCode);
        const window = dutyWindow(sectionKey, date, reportOffsetMinutes);
        if (window) lastDutyEnd.set(pilotCode, window.end);
        addDuty(pilotCode, date, hours);
        lastLineByCode.set(pilotCode, sectionKey);
        for (const mate of seatedCodes) recordPair(pilotCode, mate, date);
        if (SECTION_BY_KEY.get(sectionKey)?.kind === "night" && tourDay(pilotCode, date).lastDay) {
          // Legal - they come off at 05:30 on the first RR day and the OFF
          // block is intact - but it changes their travel plans, so it has
          // to be told to them in advance.
          notes.push(`${date}: ${pilotCode} is on night standby on the LAST DAY of their tour — no one else could take the seat. TELL THEM NOW: ${noticeDays(date)} days' notice, and they normally fly home about 20:00 that evening.`);
        }
        if (SECTION_BY_KEY.get(sectionKey)?.kind === "night") {
          if (!nightDatesByCode.has(pilotCode)) nightDatesByCode.set(pilotCode, new Set());
          nightDatesByCode.get(pilotCode).add(date);
        }
        cells.push({ date, section: sectionKey, slot, pilotCode, level: null });
        return pilotCode;
      }
      return null;
    }

    // Every seat is filled in two passes: first refusing anyone the
    // assignment would push past the WARNING line, then - only if the seat
    // would otherwise stay empty - allowing up to the hard maximum. A seat
    // filled on the second pass is recorded in `notes`, because that's the
    // moment the plan stopped having slack.
    function fillSeat(sectionKey, slot, filter, preferNonCaptain) {
      if (keptSeats.has(`${date}|${sectionKey}|${slot}`)) return "kept";
      // The very last thing tried, after every ceiling has been exhausted:
      // a pilot on the last day of their tour, who then has to be told.
      const lastResort = () => {
        if (!lastDayNightLastResort) return null;
        if (SECTION_BY_KEY.get(sectionKey)?.kind !== "night") return null;
        return take(sectionKey, slot, filter, preferNonCaptain, "warn", true)
          || (stretchIntoWarning ? take(sectionKey, slot, filter, preferNonCaptain, "max", true) : null);
      };
      if (!targetWarnThreshold) return take(sectionKey, slot, filter, preferNonCaptain, "max") || lastResort();
      const safe = take(sectionKey, slot, filter, preferNonCaptain, "warn");
      if (safe) return safe;
      const label = SECTION_BY_KEY.get(sectionKey)?.label || sectionKey;
      if (!stretchIntoWarning) {
        const late = lastResort();
        if (late) return late;
        // Somebody COULD legally take this seat, but only by crossing the
        // warning line. Say so plainly - "no one available" would be untrue
        // and would hide a decision the planner should be making.
        notes.push(`${date}: ${label} left unmanned — filling it would push a pilot into the warning band.`);
        return null;
      }
      const stretched = take(sectionKey, slot, filter, preferNonCaptain, "max");
      if (stretched) {
        notes.push(`${date}: ${label} filled with ${stretched}, who goes into the warning band — no one else was available.`);
        return stretched;
      }
      return lastResort();
    }

    // Night lines first - they are the constrained ones (currency + rest),
    // so filling them before the day crews avoids spending a night-current
    // pilot on a day seat and then having no one legal for the night.
    for (const sectionKey of NIGHT_SECTION_KEYS) {
      const section = SECTION_BY_KEY.get(sectionKey);
      for (let slot = 0; slot < section.slots; slot++) {
        const taken = slot === 0
          ? fillSeat(sectionKey, slot, (code) => isCaptain(positionsByCode?.[code]), false)
          : fillSeat(sectionKey, slot, null, true);
        if (!taken && slot === 0) {
          notes.push(`${date}: no night-current Captain available for ${section.label}.`);
          break;
        }
        if (!taken) notes.push(`${date}: only one pilot could be placed on ${section.label}.`);
      }
    }

    // Only the crews the customers need that day. Weekends open four, not
    // six - the earliest-departing lines, so the ladder stays intact.
    const openCrews = DAY_SECTION_KEYS.slice(0, Math.max(0, dayCrews(date)));
    for (const sectionKey of openCrews) {
      const section = SECTION_BY_KEY.get(sectionKey);
      const captain = fillSeat(sectionKey, 0, (code) => isCaptain(positionsByCode?.[code]), false);
      if (!captain) break; // no Captain left - stop opening further crews
      const second = fillSeat(sectionKey, 1, null, true);
      if (!second) notes.push(`${date}: ${section.label} has a Captain but no second pilot available.`);
    }

    // Copy the roster's training days onto the board. The planner doesn't
    // decide these - Training Monitor and the roster do - but the board is
    // what gets printed and handed round, so a day where three pilots are at
    // the simulator has to be visible on it. Read straight from the roster
    // codes, so the two can never drift apart.
    for (const { pilotCode, kind } of occupiedToday) {
      const sectionKey = kind === "night" ? "nightTraining" : "training";
      const section = SECTION_BY_KEY.get(sectionKey);
      if (!section) continue;
      if (cells.some((c) => c.date === date && c.section === sectionKey && c.pilotCode === pilotCode)) continue;
      const used = new Set(cells.filter((c) => c.date === date && c.section === sectionKey).map((c) => c.slot));
      let slot = 0;
      while (slot < section.slots && (used.has(slot) || keptSeats.has(`${date}|${sectionKey}|${slot}`))) slot++;
      if (slot >= section.slots) {
        // More pilots at training than the row has lines. Said out loud
        // rather than dropped, because the pilot IS at training either way.
        notes.push(`${date}: ${pilotCode} is at ${kind === "night" ? "night training" : "training"} but ${section.label} has only ${section.slots} lines — not shown on the board.`);
        continue;
      }
      cells.push({ date, section: sectionKey, slot, pilotCode });
    }

    // Night Training is flown together, and one of the pilots on it has to be a
    // Captain (Capt. Weera: "ควร จัด นักบินด้วยกัน อย่างน้อย 2-3 คน ในนั้น ต้อง
    // เป็น กัปตัน หนึ่งท่านครับ"). The planner does not DECIDE these cells - they
    // are copied from whoever the roster marks "NT" above - so it can only say
    // that the roster needs another NT day added, which is where the fix is.
    {
      const ntCodes = cells
        .filter((c) => c.date === date && c.section === "nightTraining" && c.pilotCode)
        .map((c) => c.pilotCode);
      const unique = [...new Set(ntCodes)];
      if (unique.length > 0) {
        if (unique.length < NIGHT_TRAINING_MIN_PILOTS) {
          notes.push(`${date}: night training has only ${unique.length} pilot (${unique.join(", ")}) — it is flown together, ${NIGHT_TRAINING_MIN_PILOTS}-${NIGHT_TRAINING_PREFERRED_PILOTS} pilots. Add another NT day on the roster.`);
        }
        if (NIGHT_TRAINING_REQUIRES_CAPTAIN && positionsByCode) {
          const known = unique.filter((code) => positionsByCode[code]);
          const hasCaptain = known.some((code) => isCaptain(positionsByCode[code]));
          // Only judge once every position is known, so an unrecorded rank
          // doesn't read as "no Captain".
          if (known.length === unique.length && !hasCaptain) {
            notes.push(`${date}: night training (${unique.join(", ")}) has no Captain — one of the pilots on it must be a Captain.`);
          }
        }
        // At least one pilot on the detail must already hold Night Currency -
        // the others are there to regain it, same reasoning as the Captain
        // requirement above (Capt. Weera: "NT ต้องมี นักบินที่ยังมี Night
        // Current อย่างน้อย 1 ท่าน").
        if (NIGHT_TRAINING_REQUIRES_CURRENT_PILOT && nightCurrentByCode) {
          const hasCurrent = unique.some((code) => nightCurrentByCode.has(code));
          if (!hasCurrent) {
            notes.push(`${date}: night training (${unique.join(", ")}) has nobody already Night Current — at least one pilot on the detail needs current Night Currency.`);
          }
        }
      }
    }

    // Anyone on duty who couldn't be used - always reported, never hidden.
    for (const pilotCode of onDuty) {
      if (placedToday.has(pilotCode)) continue;
      // A day not flown counts as the OFF step of the rotation, so the pilot
      // comes back round to Crew 1 next rather than being stuck waiting for
      // the line they missed.
      if (lastLineByCode.get(pilotCode) === "nightStandby1") lastLineByCode.set(pilotCode, "off");
      let reason = "no seat left";
      // A machine-readable twin of `reason`, so callers that need to ACT on
      // why a pilot was skipped (rather than just print it) don't have to
      // parse English sentences to tell "near an FDT limit" apart from "no
      // instructor available". See weeklyPlanWriteback.js.
      let cause = "no-seat";
      const directive = trainingPairs?.length
        ? checkTrainingPair({ pilotCode, mates: [], pairs: trainingPairs, iso: date, instructors })
        : null;
      const availability = availabilityByCode?.get(pilotCode);
      if (directive?.required && directive.directives?.length) {
        const d = directive.directives[0];
        reason = d.withCode === "ANY_INSTRUCTOR"
          ? `must fly with an instructor until ${d.to || "further notice"} — none available`
          : `must fly with ${d.withCode} until ${d.to || "further notice"} — not available`;
        cause = "training-pair";
      }
      if (trainingOverdueByCode?.has(pilotCode)) {
        reason = `training overdue (${trainingOverdueByCode.get(pilotCode)})`;
        cause = "training-overdue";
      } else if (availability?.blocked) {
        reason = availabilityReason(availability);
        cause = "fdt-blocked";
      } else {
        const dayRest = restOk(pilotCode, DAY_SECTION_KEYS[0]);
        const dayHours = plannedDutyHours(DAY_SECTION_KEYS[0], date, stbyCreditPercent, reportOffsetMinutes);
        const limit = withinLimits(pilotCode, date, dayHours);
        if (!dayRest.ok) { reason = `needs ${MIN_REST_HOURS}h rest (only ${dayRest.rest?.toFixed(1)}h after last duty)`; cause = "rest"; }
        else if (nightCapReached(pilotCode, date)) { reason = `already ${nightDaysInCycle(pilotCode, date)} night duties in the last ${cycleDays} days (max ${maxNightDaysPerCycle})`; cause = "night-cap"; }
        else if (!limit.ok) {
          reason = limit.metric === "flight"
            ? `${limit.days}-day flight time already at ${limit.would}h of ${limit.max}h on this date`
            : `would exceed ${limit.days}-day duty limit (${limit.would}h vs ${limit.max}h)`;
          cause = "fdt-limit";
        }
      }
      unplaced.push({ date, pilotCode, reason, cause });
    }
  }

  return { cells, unplaced, notes };
}
