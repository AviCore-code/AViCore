// Tunable rules for planning the Weekly Schedule.
//
// Everything here came from the operator (Capt. Weera), not from guesswork -
// where a number is still unconfirmed it says so explicitly. Kept in one
// small file, separate from the algorithm, so a rule can be corrected
// without touching the planning code. The narrative behind each rule is in
// docs/WEEKLY-SCHEDULE-RULES.md.

// --- Rest ------------------------------------------------------------------
// Minimum rest between the end of one duty and the report time of the next.
// Coming off night standby (ends 05:30) this puts the earliest next report
// at 17:30: night-to-night is legal, night-to-day-crew the next morning is
// not.
export const MIN_REST_HOURS = 12;

// --- Duty credit -----------------------------------------------------------
// How much DUTY TIME each planned assignment is expected to consume. This is
// what the rolling 7/14/28-day limits are measured against, and it is the
// real constraint on how often a pilot can be used - NOT a cap on consecutive
// duty days, which does not exist.
//
// Night standby is 17:30-05:30, i.e. 12 clock hours, but only 25% of it is
// credited as duty (OPS-CM-01 7.9.2 / ftlLimits.js stbyCreditPercent) = 3h.
// That is why a pilot can sit night after night without approaching a limit,
// while a pilot on day crews accumulates 9.5-12h a day and runs out of 7-day
// headroom in five Crew-1 duties.
//
// IF A NIGHT STANDBY IS CALLED OUT, the actual FDP flown is added on top of
// the 3h. Planning can't know that in advance, so the plan books the 3h and
// the real figure arrives later from Daily Duty. Any pilot whose ACTUAL
// recorded hours are already at a limit is flagged separately by the FTL
// cross-check, so a heavy month of callouts still surfaces.
export const STANDBY_DUTY_CREDIT_PERCENT = 25;

// Day crews are planned at their full window - REPORT time to 17:30. The
// time on the schedule is the scheduled DEPARTURE, and report is one hour
// before it, so Crew 1 (departing 06:30) reports 05:30 and books 12h. The
// operator confirmed the day is planned as the full window rather than an
// average shorter day.
export const PLAN_FULL_DAY_WINDOW = true;

// --- Rolling duty limits ---------------------------------------------------
// These mirror ftl_limits (Settings -> FTL Limits), which is the single
// source of truth and is what the app actually reads at run time; the values
// here are only the fallback when that setting hasn't been loaded yet.
// A planned assignment that would push a pilot past `max` is not made;
// crossing `warn` is allowed but reported.
export const DEFAULT_PLAN_DUTY_LIMITS = {
  dt7d: { warn: 54, max: 60 },
  dt14d: { warn: 99, max: 110 },
  dt28d: { warn: 171, max: 190 },
  // Single duty period ceiling. Relevant when a night standby is called out
  // and the FDP is added to the 3h credit.
  dailyMaxHours: 12
};

// --- Night line ------------------------------------------------------------
// There is NO maximum number of CONSECUTIVE nights - a pilot may sit night
// standby several days running, provided the rolling duty limits above are
// respected.
export const MAX_CONSECUTIVE_NIGHTS = null;

// There IS a limit on how much night a pilot carries over a work cycle: no
// more than six night duties per 28-day cycle.
//
// The rolling duty limits alone don't produce this. Night standby only books
// 3h of duty (25% of 12), so it is "cheap" against every FTL limit - which
// means an unconstrained planner will happily park the same night-current
// pilot on the night line night after night, and the numbers will all look
// fine. That is exactly what happened in the first plan: CSU drew five
// nights in week one and six in week two, entirely legally.
//
// Night work is disruptive in a way duty hours don't measure, and the pool of
// night-current pilots is small, so this spreads it deliberately.
export const MAX_NIGHT_DAYS_PER_CYCLE = 6;

// Both pilots on a night line must hold valid Night Currency, read from the
// Training tab's "Night Currency" item. No date recorded counts as NOT
// current - an unknown is treated as expired, because the cost of being
// wrong is a non-current crew on a night sector.
export const NIGHT_REQUIRES_CURRENCY = true;

// --- Night Training --------------------------------------------------------
// Night Training is not run one pilot at a time: it is a detail flown
// together, and one of the people on it has to be a Captain.
//
// Capt. Weera: "การจัด Night training ควร จัด นักบินด้วยกัน อย่างน้อย 2-3 คน
// ในนั้น ต้องเป็น กัปตัน หนึ่งท่านครับ".
//
// Note this is a rule about the SHAPE of the group, not about currency - night
// training is how a pilot REGAINS night currency, so requiring it here would
// make the exercise impossible for the very people who need it. The Captain is
// what makes the detail safe to fly at night; NIGHT_REQUIRES_CURRENCY above
// still applies to the night STANDBY line, which is revenue flying.
export const NIGHT_TRAINING_MIN_PILOTS = 2;
export const NIGHT_TRAINING_PREFERRED_PILOTS = 3;
export const NIGHT_TRAINING_REQUIRES_CAPTAIN = true;

// --- Crew composition ------------------------------------------------------
// Two Co-pilots may never crew together. Captain+Captain is legal but
// wasteful (every crew needs a Captain), so the second seat prefers a
// Co-pilot.
export const ALLOW_TWO_CAPTAINS = true;
export const PREFER_COPILOT_IN_SECOND_SEAT = true;

// --- Training --------------------------------------------------------------
// A pilot with any overdue MONITORED training item is not planned to fly.
// Night Currency is excluded from this test because it restricts night
// flying only, not day flying - it is enforced by NIGHT_REQUIRES_CURRENCY.
export const BLOCK_ON_OVERDUE_TRAINING = true;

// --- Planning target: stay out of the yellow -------------------------------
// The plan is built against the WARNING figure, not the legal maximum, and
// aims to keep every pilot strictly below it for the whole planning horizon.
// A pilot sitting on yellow has no room left for the callouts, weather delays
// and extensions that actually happen - the plan looks legal on paper and
// isn't robust in the air.
//
// When a seat can only be filled by pushing someone into the warning band,
// the seat is LEFT UNMANNED and reported. An unmanned crew line is a visible
// planning decision; a pilot quietly on yellow for three weeks is a fatigue
// problem nobody notices. Set STRETCH_INTO_WARNING true to fill anyway.
export const PLAN_TO_WARNING_THRESHOLD = true;
export const STRETCH_INTO_WARNING = false;

// Work is handed to whoever is carrying the LEAST duty over the last 7 and
// 28 days, rather than in any fixed order. Load-balancing like this is what
// actually keeps everyone below the warning line - assigning in name order
// piles hours onto the same few pilots and puts them into the yellow within
// a fortnight.
export const BALANCE_BY_LEAST_LOADED = true;

// --- How many day crews open on each weekday -------------------------------
// The customers fly less at the weekend (Capt. Weera: "เสาร์-อาทิตย์ลูกค้าบิน
// น้อยลง"), so Saturday and Sunday open FOUR day crews instead of six.
//
// This is not cosmetic. Opening all six every day spent about twenty crew-days
// a month on lines nobody asked for, and every one of those days was charged
// against a pilot's rolling 7/14/28-day totals - hours that then weren't
// available on the days the flying actually was.
//
// NIGHT STANDBY IS UNAFFECTED: it runs every day of the week, weekend
// included, because it isn't the customer's flying programme - it is cover.
// Keyed by JavaScript's getDay(): 0 = Sunday ... 6 = Saturday.
export const DAY_CREWS_BY_WEEKDAY = {
  0: 4, // Sunday
  6: 4  // Saturday
};
export const DAY_CREWS_DEFAULT = 6;

export function dayCrewsOn(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return DAY_CREWS_DEFAULT;
  const weekday = new Date(y, m - 1, d).getDay();
  const n = DAY_CREWS_BY_WEEKDAY[weekday];
  return Number.isFinite(n) ? n : DAY_CREWS_DEFAULT;
}

// --- Line rotation pattern -------------------------------------------------
// The order a pilot moves through the lines:
//
//     Night → OFF → Crew 1 → Crew 3 → Crew 2 → Crew 4 → (back to Night)
//
// OFF sits deliberately straight after Night: coming off at 05:30 the pilot
// can't take a day crew the next morning anyway (12h rest), so the day out
// is where the rest already has to be. The day lines then alternate 1-3-2-4
// rather than running 1-2-3-4, which spreads the early 05:30 reports around
// instead of walking one pilot down the report times day after day.
//
// This is a PREFERENCE, not a constraint: it only orders the pilots who are
// already legal for a seat. Nobody is ever put on a line by the pattern if
// rest, currency, training, pairing or the duty ceiling say no - which is
// why the pattern can't be used to argue past a limit.
export const LINE_ROTATION_PATTERN = ["nightStandby1", "off", "crew1", "crew3", "crew2", "crew4"];

// --- Flight-hour fairness --------------------------------------------------
// Nobody should come out of a work cycle badly under-flown. The 21/7 roster
// gives 21 duty days in a 28-day cycle, and each pilot should be getting at
// least this much actual FLYING in that period - both for currency and
// because being consistently passed over for the flying is how skills and
// morale decay.
//
// Used two ways: pilots below the target are preferred when filling a seat,
// and anyone still short at the end of the planning horizon is reported.
// It is NOT a hard gate - refusing to plan somebody because they haven't
// flown enough would make the problem worse, not better.
export const MIN_FLIGHT_HOURS_PER_CYCLE = 40;

// The work cycle is 28 days: 21 working, 7 off. Everything measured "per
// cycle" - the 40h flying target, the six-night cap - is measured over this
// window, and the 21 working days are the pool those have to fit into (six
// nights is a little under a third of a pilot's duty days).
export const WORK_CYCLE_DAYS = 28;
export const WORK_DAYS_PER_CYCLE = 21;
export const OFF_DAYS_PER_CYCLE = 7;

// --- First and last day of a tour ------------------------------------------
// FIRST DAY back from the seven days off:
//   * never night standby. The pilot has been out of Area Operations for a
//     week; a night callout is the worst way to walk back in.
//   * if they fly, crew them with someone who is CURRENTLY operating, not
//     with another pilot who has also just returned.
export const FIRST_DAY_NO_NIGHT = true;
export const FIRST_DAY_PAIR_WITH_CURRENT = true;
// How recently a pilot must have worked to count as "currently operating".
export const CURRENTLY_OPERATING_WITHIN_DAYS = 4;
//
// LAST DAY - the pilot travels home that evening; the usual flight home is
// around 20:00 on the last day, before the RR RR days. So give them a line
// that finishes EARLY - the earliest-reporting crew available.
export const LAST_DAY_PREFER_EARLY_FINISH = true;
export const LAST_DAY_LATEST_FINISH = "17:00";
//
// Night on the last day IS allowed: they come off at 05:30 on the first RR
// day, and the OFF block is still intact. But it changes their travel plans,
// so the plan must SAY SO - the pilot has to be told in advance, not find out
// when the schedule is published. Some of them are booking flights to another
// province.
export const LAST_DAY_NIGHT_ALLOWED = true;
export const LAST_DAY_NIGHT_REQUIRES_NOTICE = true;

// ...and two limits on it, both from Capt. Weera: "อย่างน้อย 3 week ถ้าไม่จำเป็น
// ก็ไม่ต้องเข้า night ก่อน RR".
//
// 1. THREE WEEKS' NOTICE, counted from the day the plan is made. Pilots buy
//    their flights home well before the last day; telling someone a week out
//    that they are on night the evening they meant to travel is not notice,
//    it is a problem handed over. Inside the notice window the planner simply
//    will not do it - there is no way to give notice that has already passed.
// 2. ONLY IF NEEDED. It is the LAST option before a night seat goes unmanned,
//    not one choice among equals: every other legal pilot is tried first,
//    including pilots who would go into the warning band.
export const LAST_DAY_NIGHT_NOTICE_DAYS = 21;
export const LAST_DAY_NIGHT_LAST_RESORT = true;

// --- Pairing variety -------------------------------------------------------
// Where there's a free choice, put a pilot with someone they haven't flown
// with recently rather than with their usual partner.
//
// The reason is CRM, not fairness: two pilots who always fly together settle
// into shorthand and unspoken assumptions, and stop practising the explicit
// briefing, challenge and cross-check that CRM depends on. Mixing the pairs
// keeps that muscle working, and it spreads experience around the fleet
// instead of concentrating it in fixed partnerships.
//
// A PREFERENCE only, and a low-priority one: it orders candidates who are
// already legal for the seat and have already been sorted by rank, rotation
// and workload. It can never override the pairing LEVEL rule (7.17.4), the
// rest rules, or the duty ceilings.
export const PREFER_UNFAMILIAR_PAIRINGS = true;
export const PAIRING_LOOKBACK_DAYS = 28; // one work cycle

// --- Pairing by Experience Level -------------------------------------------
// OPS-CM-01 7.17.4 "Ranking of Flight Crew and Pairing Instruction"
// (Issue 07, 29 Apr 2025). A pilot's Level 1-4 is computed from five
// experience factors - see src/utils/experienceLevel.js for the tables.
// 7.17.4(2): "The minimum experience levels when pairing both pilots for
// scheduling are not less than 4" - the two Levels ADDED must reach this.
// So L3 + L1 is acceptable; L2 + L1 is not.
export const MIN_PAIR_LEVEL_SUM = 4;

// --- Still to be captured --------------------------------------------------
// Discussed but not yet answered; the planner does NOT apply these today:
//   * Crew pairing continuity - whether a pair should stay together for a
//     whole rotation or be deliberately mixed.
//   * Customer / aircraft assignment - whether Crew 1-6 map to specific
//     customers or aircraft rather than only to report times.
//   * First Day / Last Day of the 21/7 rotation - whether the first day back
//     should avoid the earliest report.
//   * Line training - whether a trainee must be paired with an instructor.
