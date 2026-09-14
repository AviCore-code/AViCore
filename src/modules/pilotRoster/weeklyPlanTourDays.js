import { getCodeInfo } from "./rosterCodes.js";
import { OFF_DAYS_PER_CYCLE } from "./weeklyPlanRules.js";

// The first and last working days of a tour are not like the days in the
// middle, and the difference is operational, not administrative.
//
// FIRST DAY - the pilot has been away from Area Operations for seven days.
//   They are not put on night standby at all: a night callout is the worst
//   possible re-introduction after a week away. If they fly, they fly with
//   someone who is currently in the run of operations, not with another
//   pilot who has just walked back in.
//
// LAST DAY - the pilot is travelling home that evening. Pilots normally book
//   the flight home for the last day around 20:00, before the RR RR days, so
//   a duty that finishes late costs them the ticket. Give them a line that
//   finishes early. Night on the last day IS possible - they come off at
//   05:30 on the first RR day, which still leaves the OFF block intact - but
//   it changes their travel plans, so it must be TOLD to them in advance,
//   not sprung on them when the schedule is published.
//
// All of this is worked out from the published roster: a working day whose
// previous day is part of an OFF block is a first day; one whose next day
// starts an OFF block is a last day.

const OFF_BLOCK_MIN_DAYS = Math.max(3, OFF_DAYS_PER_CYCLE - 2);
const ON_DUTY_CATEGORIES = new Set(["duty", "night"]);

function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function categoryOn(rosterByPilotDate, code, iso) {
  const raw = rosterByPilotDate?.get(`${code}|${iso}`);
  if (!raw) return null;
  return getCodeInfo(raw)?.category ?? null;
}

function isWorking(category) {
  return category != null && ON_DUTY_CATEGORIES.has(category);
}

// Length of the unbroken run of non-working days starting at `iso` and
// walking in `step` direction (-1 = backwards, +1 = forwards).
function nonWorkingRun(rosterByPilotDate, code, iso, step, limit = 14) {
  let run = 0;
  for (let i = 1; i <= limit; i++) {
    const category = categoryOn(rosterByPilotDate, code, isoAddDays(iso, step * i));
    if (category == null) break;      // roster not imported that far
    if (isWorking(category)) break;   // back on duty - the run ends
    run += 1;
  }
  return run;
}

// { firstDay, lastDay } for a working day. Both false for a day in the
// middle of a tour, and for a day the roster doesn't cover.
export function classifyTourDay(rosterByPilotDate, pilotCode, iso) {
  const category = categoryOn(rosterByPilotDate, pilotCode, iso);
  if (!isWorking(category)) return { firstDay: false, lastDay: false, working: false };

  const before = nonWorkingRun(rosterByPilotDate, pilotCode, iso, -1);
  const after = nonWorkingRun(rosterByPilotDate, pilotCode, iso, +1);

  return {
    working: true,
    // Back from the seven days off - not from a single RR mid-rotation.
    firstDay: before >= OFF_BLOCK_MIN_DAYS,
    // Last working day before the RR/RR + OFF block: this is the day they
    // travel home on.
    lastDay: after >= OFF_BLOCK_MIN_DAYS,
    daysOffBefore: before,
    daysOffAfter: after
  };
}

// Has this pilot been flying recently enough to count as "in the run of
// operations"? Used to make sure a first-day pilot is crewed with somebody
// current rather than with another pilot just back from leave.
export function isCurrentlyOperating(dutyDatesByCode, pilotCode, iso, withinDays = 4) {
  const dates = dutyDatesByCode?.get?.(pilotCode) ?? dutyDatesByCode?.[pilotCode];
  if (!dates) return false;
  const list = dates instanceof Set ? [...dates] : Object.keys(dates || {});
  const from = isoAddDays(iso, -withinDays);
  return list.some((d) => d > from && d < iso);
}
