// Plans training onto the ROSTER, automatically and a long way ahead.
//
// Capt. Weera: "ส่วนการฝึกอบรมต่างๆ ก้อ วางแผน ลง ใน roster ได้เลย ตาม
// training monitor ก่อนที่จะครบ due ยกตัวอย่าง simulator สามารถจัดล่วงหน้า
// ได้ 1-3 เดือนก่อน ครบ due ส่วน หลักสูตร อื่น ก้อ 1-2 เดือน จัดไปก่อนได้เลย
// ยาวๆๆ เป็นการวางแผน" — and, on whether to ask first:
// "เขียน ลง อัตโนมัติ และ เจ้าหน้าที่เข้าไปแก้ไขได้".
//
// So this WRITES, it does not suggest. That is a deliberate reversal of the
// earlier rule for this feature (which was "เสนอวันให้ดู แต่ผมกดยืนยันเอง" -
// see weeklyPlanTrainingQueue.js's suggestTrainingSlot, still used by the
// Weekly Schedule panel, which stays suggest-only). The difference is scope:
// the Weekly Schedule is deciding who flies together next week and wants a
// human in the loop; this is long-range training planning, where the point is
// to fill a year of roster without the chief pilot re-typing every course.
// Whatever is written stays fully editable cell by cell afterwards.
//
// TWO HARD RULES, both from Capt. Weera, both enforced below:
//
//   1. Only ever write on a plain DUTY day ("เขียนในช่วง 19 ทำงาน").
//      Training happens on company time.
//   2. Never touch RR ("แต่ไม่ทับ กับ RR"), and by the same reasoning never
//      touch R, X, or leave. RR/R exist to satisfy the 168-hour cycle and the
//      minimum-rest rule; writing a course over one would silently break an
//      FDT protection. X and VL/SL are the pilot's own days.
//
// Rule 2 is why this module refuses rather than reschedules: if there is no
// free duty day before the due date, it reports that fact and leaves the
// roster alone. A training day invented on top of a rest day would look
// compliant on the roster and be illegal in the air.
//
// What gets written is the plain training code ("S", "H", "CR" ...), NOT the
// comma form "O,S". The comma form has its own meaning: a course placed on a
// pilot's day off, which earns overtime ("ถือเป็นทำงานวันหยุด เลยใส่ O/S").
// That is a decision the chief pilot makes case by case, never this planner -
// which only ever writes on days that are already duty days, where claiming OT
// would be wrong.

import { rosterDayInfo, TRAINING_DUTY_WINDOWS } from "../modules/pilotRoster/rosterCodes.js";
import { ITEM_ROSTER_CODES, trainingCodeFor } from "../modules/pilotRoster/weeklyPlanTrainingQueue.js";
import { MIN_REST_HOURS } from "../modules/pilotRoster/weeklyPlanSections.js";
import { todayIso } from "../utils/dateKeys.js";

const MS_PER_DAY = 86400000;

// How far AHEAD of the due date a course may be placed, in days.
//
// Capt. Weera gave these as months: simulator 1-3 months, other courses 1-2
// months. Stored as a window with a MINIMUM and a MAXIMUM lead:
//
//   maxLeadDays - the earliest the course may sit before its due date. Going
//                 earlier wastes validity: an LPC flown 5 months early
//                 shortens the useful life of the renewal.
//   minLeadDays - the latest it may sit. Inside this, there is no room left
//                 to re-book if the slot falls through, so the planner treats
//                 it as too late to be a *plan* (the Weekly Schedule's
//                 near-term queue is what catches those).
//
// Simulator items get the wider window because sim slots are booked against
// a third party's calendar and rarely land on the first date asked for.
// Night currency is deliberately NOT in here. Capt. Weera: "simulator 6 เดือน
// ไป ที หนึ่ง ก้อจะได้ night training ด้วย และอีก ใกล้ 3 เดือน หลังจากไปsim มา ก็
// วางแผนฝึก ไนท์ กับเครื่องจริง … สรุป ไนท์ ได้จาก ที่ sim และเครื่ิองจริง" - the
// sim visit is six-monthly and covers night training, then about three months
// later night is flown again on the real aircraft. So it comes round roughly
// every three months, alternating between the two sources, and belongs on the
// shorter COURSE_LEAD window rather than the sim one.
const SIM_ITEMS = new Set(["lpc", "opc2", "pbn", "egpwsTcas", "ese"]);
const SIM_LEAD = { minLeadDays: 30, maxLeadDays: 90 };    // 1-3 months
const COURSE_LEAD = { minLeadDays: 30, maxLeadDays: 60 }; // 1-2 months

export function leadWindowFor(itemKey) {
  return SIM_ITEMS.has(itemKey) ? { ...SIM_LEAD } : { ...COURSE_LEAD };
}

// How many roster days one item occupies when Training Setting doesn't say.
//
// The simulator is at SUBANG, MALAYSIA, so a sim visit is not a day at the
// office - it is travel out, the details, and travel back. Capt. Weera:
// "SIM (LPC =5 วัน OPC=4 วัน) at Malaysia subang".
//
// LPC and OPC are NOT the same length, so they get their own figures rather
// than one shared "sim" default:
//   LPC  5 days
//   OPC  4 days
// Everything else defaults to one day.
//
// Overridden per item by the caller from Training Setting where that exists,
// exactly like the Weekly Schedule's queue does - the company's own course
// lengths win over anything assumed here.
const DEFAULT_DAYS = { lpc: 5, opc2: 4 };

export function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const [ay, am, ad] = String(fromIso).split("-").map(Number);
  const [by, bm, bd] = String(toIso).split("-").map(Number);
  if (!ay || !by) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

function isoOf(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Is this roster cell a plain duty day with nothing else already on it?
//
// This is the gate that implements both hard rules. Deliberately delegated to
// rosterDayInfo().onDuty, which is already defined as
// "!released && !occupied && has duty" - i.e. it ALREADY excludes rest (RR,
// R), off (X), leave (VL, SL), anything occupying (S, T, C, NT, INS ...) and
// combo cells like "O,X" / "O,S". Re-implementing those exclusions here would
// give two copies of the same safety rule, free to drift apart; if the code
// legend gains a category, this follows it automatically.
//
// So "O" passes, and "RR", "R", "X", "VL", "SL", "S", "O,S", "O,X" all fail.
export function isWritableDutyDay(rawCode) {
  const raw = String(rawCode || "").trim();
  if (!raw) return false;                       // nothing rostered = not a duty day
  return rosterDayInfo(raw)?.onDuty === true;
}

// Would putting a course on `iso` break the 12-hour rest owed after the
// PREVIOUS day's duty?
//
// The case that matters is night training. Capt. Weera: "โดยปกติ night training
// จะ ฝึกช่วงเวลา 17:30-22:30 กลับมา ต้อง พัก 12 ชั่วโมง ถึงจะถูกจัดบินได้ หรือ
// จัดฝึกอบรมต่างๆๆ" - the 12 hours bar the next FLYING *and* the next TRAINING
// alike. NT ends 22:30, so the earliest next report is 10:30, and a course
// starting 08:00 the following morning is illegal by two and a half hours.
//
// Checked here rather than left to weeklyPlanChecks.js: that module flags a bad
// plan after the fact, but this one WRITES, so it has to not create the problem
// in the first place. Read from the same TRAINING_DUTY_WINDOWS the checker uses,
// so the two can't disagree about when a night finishes.
function restOkAfterPreviousDay({ rosterByPilotDate, pilotCode, iso, startHHMM }) {
  const prevRaw = rosterByPilotDate?.get(`${pilotCode}|${isoAddDays(iso, -1)}`);
  if (!prevRaw) return true;                    // nothing known the day before
  const prev = rosterDayInfo(prevRaw);
  const prevEnd = prev?.window?.end;
  if (!prevEnd) return true;                    // previous day carries no window

  const [ph, pm] = String(prevEnd).split(":").map(Number);
  const [sh, sm] = String(startHHMM).split(":").map(Number);
  if (!Number.isFinite(ph) || !Number.isFinite(sh)) return true;

  // Hours from the previous duty's end to this day's start, crossing midnight.
  const restHours = (24 - (ph + (pm || 0) / 60)) + (sh + (sm || 0) / 60);
  return restHours >= MIN_REST_HOURS;
}

// Every date this pilot could take training on, within one item's lead window,
// earliest first.
function writableDatesInWindow({
  rosterByPilotDate,
  pilotCode,
  dueIso,
  todayIso,
  minLeadDays,
  maxLeadDays,
  claimedDates
}) {
  // The window is [due - maxLead, due - minLead], clipped so we never plan
  // into the past.
  let windowStart = isoAddDays(dueIso, -maxLeadDays);
  const windowEnd = isoAddDays(dueIso, -minLeadDays);
  if (windowStart < todayIso) windowStart = todayIso;
  if (windowEnd < windowStart) return [];

  const dates = [];
  for (const [key, raw] of rosterByPilotDate || []) {
    const sep = key.indexOf("|");
    if (sep < 0) continue;
    const code = key.slice(0, sep);
    const date = key.slice(sep + 1);
    if (code !== pilotCode) continue;
    if (date < windowStart || date > windowEnd) continue;
    if (claimedDates?.has(date)) continue;      // another course took it already
    if (!isWritableDutyDay(raw)) continue;
    // 12 hours' rest owed from the previous day's duty - the night-training
    // case above all (ends 22:30, so nothing may start before 10:30).
    if (!restOkAfterPreviousDay({
      rosterByPilotDate, pilotCode, iso: date,
      startHHMM: TRAINING_DUTY_WINDOWS.day.start
    })) continue;
    dates.push(date);
  }
  return dates.sort();
}

// The earliest run of `needed` consecutive dates in `dates`.
//
// Earliest rather than latest, for the same reason the Weekly Schedule's
// queue does it: booking early leaves room to move the slot if it falls
// through, whereas the last legal date has no second chance behind it.
function firstConsecutiveRun(dates, needed) {
  for (let i = 0; i + needed <= dates.length; i++) {
    let ok = true;
    for (let j = 1; j < needed; j++) {
      if (daysBetween(dates[i + j - 1], dates[i + j]) !== 1) { ok = false; break; }
    }
    if (ok) return dates.slice(i, i + needed);
  }
  return null;
}

function isCaptainPosition(position) {
  return String(position || "").toLowerCase().includes("captain");
}

// --- Simulator details go as a GROUP: one sim instructor + two pilots --------
//
// Capt. Weera: "TBO and PDA role TRI/TRE SIMulator, YLU role TRI Simulator …
// การมา sim ต้อง TRI sim มาด้วย กับ นักบิน อีกสองท่าน (ครูซิม นักบิน 2 ท่าน)".
//
// The sim is at Subang, so the whole party travels together: a TRI/TRE sim
// instructor plus exactly two pilots. Booking one pilot at a time - which is
// what this planner did before - produced a trip nobody could actually fly, and
// silently used up the only free week in the process.
//
// Who counts as an instructor is NOT a list kept here. It comes from the TRI/TRE
// hours already on each pilot's Pilot Experience record, via
// isInstructorFromSpecialty() in weeklyPlanTrainingPairs.js - the same source
// the Weekly Schedule's pairing directives use, so the two can never disagree
// about who is an instructor.
const SIM_PILOTS_PER_DETAIL = 2;

// Every date in `usableDates` where `count` OTHER pilots are also free, plus an
// instructor. Returns the first workable {start, instructor, pilots} or null.
function findSimDetail({
  pilotCode, needed, usableDates, rosterByPilotDate, instructors,
  claimedByPilot, allCodes, simGroupByStart
}) {
  for (const start of usableDates) {
    const run = [];
    for (let i = 0; i < needed; i++) run.push(isoAddDays(start, i));

    // A detail already forming on these dates? Join it if there is room.
    const existing = simGroupByStart.get(start);
    if (existing) {
      if (existing.pilots.includes(pilotCode)) return { joined: existing, start, run };
      if (existing.pilots.length < SIM_PILOTS_PER_DETAIL) {
        return { joined: existing, start, run };
      }
      continue;   // this detail is full - look for another week
    }

    // Everyone who could do the WHOLE run (not just the first day).
    const freeForRun = (code) => run.every((d) => {
      if (claimedByPilot.get(code)?.has(d)) return false;
      if (!isWritableDutyDay(rosterByPilotDate?.get(`${code}|${d}`))) return false;
      return restOkAfterPreviousDay({
        rosterByPilotDate, pilotCode: code, iso: d,
        startHHMM: TRAINING_DUTY_WINDOWS.sim.start
      });
    });

    if (!freeForRun(pilotCode)) continue;

    const instructor = allCodes.find((c) => c !== pilotCode && instructors?.has?.(c) && freeForRun(c));
    if (!instructor) continue;

    const others = allCodes.filter(
      (c) => c !== pilotCode && c !== instructor && freeForRun(c)
    );
    // The pilot who needs it counts as one of the two, so only one more is
    // required. If nobody else is free the trip cannot go.
    const second = others[0];
    if (!second) continue;

    return { start, run, instructor, pilots: [pilotCode, second] };
  }
  return null;
}

// Who else could fly a night-training detail on `date`?
//
// Anyone whose roster shows a plain duty day, who is not already claimed by
// another course that day, and who clears the 12-hour rest from the day before.
// Deliberately NOT restricted to pilots whose own night currency is expiring:
// a Captain has to be there for the detail to fly at all, and holding one back
// because his own currency happens to be in date would make the exercise
// impossible for the co-pilot who needs it.
function nightPartnersAvailableOn({
  date, excludeCode, rosterByPilotDate, positionsByCode, claimedByPilot, allCodes
}) {
  const out = [];
  for (const code of allCodes) {
    if (code === excludeCode) continue;
    if (claimedByPilot.get(code)?.has(date)) continue;
    const raw = rosterByPilotDate?.get(`${code}|${date}`);
    if (!isWritableDutyDay(raw)) continue;
    if (!restOkAfterPreviousDay({
      rosterByPilotDate, pilotCode: code, iso: date,
      startHHMM: TRAINING_DUTY_WINDOWS.night.start
    })) continue;
    out.push(code);
  }
  return out;
}

// Books one night-training detail: the pilot who needs it, plus at least one
// partner, with a Captain guaranteed among them.
//
// Returns true if it wrote something (or joined an existing group), false if it
// recorded a skip instead.
function bookNightTrainingGroup({
  pilotCode, dueIso, item, code,
  usableDates, rosterByPilotDate, pilotInfoByCode, positionsByCode,
  todayIso, minLeadDays, maxLeadDays,
  claimedByPilot, nightGroupByDate,
  entries, planned, skipped
}) {
  const allCodes = Object.keys(pilotInfoByCode || {});
  const selfIsCaptain = isCaptainPosition(positionsByCode?.[pilotCode]);

  for (const date of usableDates) {
    // A group already forming on this date? Join it - that is the whole point
    // of flying together, and it keeps the detail to one night for everyone.
    const existing = nightGroupByDate.get(date);
    if (existing) {
      if (existing.codes.includes(pilotCode)) return true;
      const willHaveCaptain = existing.hasCaptain || selfIsCaptain;
      if (!willHaveCaptain) continue;      // still no Captain - keep looking
      if (!claimedByPilot.has(pilotCode)) claimedByPilot.set(pilotCode, new Set());
      claimedByPilot.get(pilotCode).add(date);
      const info = pilotInfoByCode?.[pilotCode] || {};
      entries.push({
        pilotCode, pilotName: info.pilotName || "", base: info.base || "", date, code
      });
      existing.codes.push(pilotCode);
      existing.hasCaptain = willHaveCaptain;
      planned.push({
        pilotCode, item: item.key, label: item.label, code,
        dueIso, start: date, end: date, days: 1,
        leadDays: daysBetween(date, dueIso),
        withPilots: existing.codes.filter((c) => c !== pilotCode)
      });
      return true;
    }

    // Otherwise start a new group - but only on a day a partner is actually
    // free, and only if a Captain will be on it.
    const partners = nightPartnersAvailableOn({
      date, excludeCode: pilotCode, rosterByPilotDate, positionsByCode,
      claimedByPilot, allCodes
    });
    if (!partners.length) continue;

    // Pick the partner that satisfies the Captain rule. If this pilot is not a
    // Captain, the partner must be one.
    let chosen = null;
    if (selfIsCaptain) {
      chosen = partners[0];
    } else {
      chosen = partners.find((c) => isCaptainPosition(positionsByCode?.[c])) || null;
    }
    if (!chosen) continue;                 // no Captain available on this date

    for (const c of [pilotCode, chosen]) {
      if (!claimedByPilot.has(c)) claimedByPilot.set(c, new Set());
      claimedByPilot.get(c).add(date);
      const info = pilotInfoByCode?.[c] || {};
      entries.push({
        pilotCode: c, pilotName: info.pilotName || "", base: info.base || "", date, code
      });
    }
    nightGroupByDate.set(date, {
      codes: [pilotCode, chosen],
      hasCaptain: selfIsCaptain || isCaptainPosition(positionsByCode?.[chosen])
    });
    planned.push({
      pilotCode, item: item.key, label: item.label, code,
      dueIso, start: date, end: date, days: 1,
      leadDays: daysBetween(date, dueIso),
      withPilots: [chosen]
    });
    return true;
  }

  // Nothing worked. Say why in the terms that actually block it, so the reader
  // knows whether to free a day or to free a Captain.
  skipped.push({
    pilotCode,
    item: item.key,
    label: item.label,
    dueIso,
    days: 1,
    reason: usableDates.length
      ? `night training needs a second pilot (with a Captain among them) on the same day — no day between ${isoAddDays(dueIso, -maxLeadDays)} and ${isoAddDays(dueIso, -minLeadDays)} has one free`
      : `no plain duty day free between ${isoAddDays(dueIso, -maxLeadDays)} and ${isoAddDays(dueIso, -minLeadDays)} (all rest, off, leave or already busy)`
  });
  return false;
}

/**
 * Work out every training day to write onto the roster.
 *
 * Returns { entries, planned, skipped } where `entries` is ready to hand
 * straight to importRosterMany (the same shape the roster import and the
 * Weekly Schedule's booking both use), `planned` describes what was placed
 * (for the on-screen summary and the audit log), and `skipped` says why an
 * item could NOT be placed - which is information the chief pilot needs, not
 * an error to swallow.
 *
 * @param records      [{ code, record: { lpc: "2026-09-30", ... } }]
 * @param items        TRAINING_ITEMS (passed in, so this module doesn't
 *                     import the Training module).
 * @param monitored    Set of item keys switched on in Training Setting.
 * @param durationsByItem  { lpc: { days: 2 }, ... } from Training Setting.
 * @param rosterByPilotDate  Map "CODE|YYYY-MM-DD" -> raw roster code.
 * @param pilotInfoByCode    { WJU: { pilotName, base } } for the written rows.
 * @param throughIso   plan no further ahead than this date.
 */
export function planTrainingOntoRoster({
  records,
  items,
  monitored,
  durationsByItem,
  rosterByPilotDate,
  pilotInfoByCode,
  // { WJU: "Captain", ... } - needed for night training, which must have a
  // Captain on it. Without it, night training is skipped rather than booked
  // wrongly.
  positionsByCode,
  // Set of pilot codes holding TRI/TRE hours, from Pilot Experience via
  // isInstructorFromSpecialty(). A simulator detail cannot go without one, so
  // without this set the sim items are reported rather than booked wrongly.
  instructors,
  todayIso: todayIsoArg,
  throughIso
}) {
  const today = todayIsoArg || todayIso();
  const entries = [];
  const planned = [];
  const skipped = [];

  // One course must not be planned onto a day another course just took. Keyed
  // per pilot, filled as we go.
  const claimedByPilot = new Map();

  // Night training booked so far, by date, so a second pilot needing NT joins
  // the group already forming rather than starting a lone one of their own.
  const nightGroupByDate = new Map();

  // Simulator details booked so far, keyed by start date, so a second pilot
  // needing the same sim item joins the trip already going rather than starting
  // another one of their own.
  const simGroupByStart = new Map();

  // SIMULATOR FIRST, then most urgent.
  //
  // Capt. Weera: "ส่วน SIM ให้ ความสำคัญ อันดับ แรกๆๆ เลย ห้าม book ทับ".
  //
  // Sorting by due date alone was not enough. A sim visit needs FIVE consecutive
  // duty days and is booked against a third party's calendar, so it is by far
  // the hardest thing to place - while a one-day course like AVSEC fits almost
  // anywhere. Whenever an AVSEC happened to fall due sooner it took a day out of
  // the middle of the only free week, and the sim then had nowhere to go and was
  // reported unplaceable. That is backwards: the flexible course should move, not
  // the sim.
  //
  // So every simulator item is placed before any other course is even considered.
  // Because each booking claims its dates as it goes (claimedByPilot), the later
  // one-day courses then simply flow around the sim block rather than into it -
  // which is the "ห้าม book ทับ" half of the instruction.
  const candidates = [];
  for (const entry of records || []) {
    const pilotCode = String(entry?.code || "").toUpperCase();
    if (!pilotCode) continue;
    const record = entry.record || {};

    for (const item of items || []) {
      if (!ITEM_ROSTER_CODES[item.key]) continue;          // not a rostered course
      if (monitored && !monitored.has(item.key)) continue;  // switched off
      if (item.type === "count") continue;                 // a count, not a date

      const dueIso = isoOf(record[item.key]);
      if (!dueIso) continue;                               // nothing recorded
      if (dueIso < today) continue;                        // already expired: not a
                                                           // planning problem any
                                                           // more, it's a grounding
      if (throughIso && dueIso > throughIso) continue;     // beyond the horizon
      candidates.push({ pilotCode, item, dueIso });
    }
  }
  candidates.sort((a, b) => {
    // Simulator items win outright, whatever the due dates say.
    const aSim = SIM_ITEMS.has(a.item.key) ? 0 : 1;
    const bSim = SIM_ITEMS.has(b.item.key) ? 0 : 1;
    if (aSim !== bSim) return aSim - bSim;
    // Within the same tier, the one expiring sooner goes first.
    return a.dueIso < b.dueIso ? -1 : a.dueIso > b.dueIso ? 1 : 0;
  });

  for (const { pilotCode, item, dueIso } of candidates) {
    const code = trainingCodeFor(item.key);
    if (!code) continue;

    const { minLeadDays, maxLeadDays } = leadWindowFor(item.key);
    const needed = Math.max(
      1,
      Math.ceil(durationsByItem?.[item.key]?.days ?? DEFAULT_DAYS[item.key] ?? 1)
    );

    if (!claimedByPilot.has(pilotCode)) claimedByPilot.set(pilotCode, new Set());
    const claimedDates = claimedByPilot.get(pilotCode);

    // Already booked somewhere in the window? Then there is nothing to plan.
    // Read the roster rather than trusting a separate record of bookings, so
    // a slot the admin typed by hand counts exactly the same as one written
    // from here.
    const satisfying = new Set(ITEM_ROSTER_CODES[item.key]);
    let alreadyBooked = null;
    for (const [key, raw] of rosterByPilotDate || []) {
      const sep = key.indexOf("|");
      if (sep < 0) continue;
      if (key.slice(0, sep) !== pilotCode) continue;
      const date = key.slice(sep + 1);
      if (date < today || date > dueIso) continue;
      const parts = String(raw).toUpperCase().split(",").map((p) => p.trim());
      if (parts.some((p) => satisfying.has(p))) { alreadyBooked = date; break; }
    }
    if (alreadyBooked) continue;

    const usable = writableDatesInWindow({
      rosterByPilotDate,
      pilotCode,
      dueIso,
      todayIso: today,
      minLeadDays,
      maxLeadDays,
      claimedDates
    });

    const run = firstConsecutiveRun(usable, needed);
    if (!run) {
      // Deliberately reported, not worked around. The alternatives would all
      // mean breaking one of the two hard rules.
      skipped.push({
        pilotCode,
        item: item.key,
        label: item.label,
        dueIso,
        days: needed,
        reason: usable.length
          ? `no ${needed} consecutive plain duty day(s) free between ${isoAddDays(dueIso, -maxLeadDays)} and ${isoAddDays(dueIso, -minLeadDays)}`
          : `no plain duty day free between ${isoAddDays(dueIso, -maxLeadDays)} and ${isoAddDays(dueIso, -minLeadDays)} (all rest, off, leave or already busy)`
      });
      continue;
    }

    // --- Night training is booked as a GROUP, never one pilot alone ---------
    //
    // Capt. Weera: "NT กับเครื่องจริง book ยัง book อยู่คนเดี่ยว ต้อง book เป็น
    // อย่างน้อย 2 คน ในวันเดียวกัน และต้องเป็นกัปตัน 1 คน".
    //
    // Every other item here is a personal renewal, so one pilot per booking is
    // right. Night training is a detail flown together: a lone booking is not a
    // usable plan, and until now the planner produced exactly that and left the
    // checker to complain about it afterwards. So instead of writing one seat,
    // this picks a day that ALREADY has (or can take) a partner, and writes both
    // pilots at once - with a Captain guaranteed to be among them.
    if (item.key === "night") {
      // Was this pilot already put on a night detail earlier in THIS run - as
      // somebody else's partner? Then their own currency is renewed and there
      // is nothing left to book. The `alreadyBooked` scan above only sees the
      // roster as it was loaded, so without this the planner books a second,
      // redundant detail for a pilot it has just rostered.
      let joinedAlready = null;
      for (const [date, group] of nightGroupByDate) {
        if (date > dueIso) continue;
        if (group.codes.includes(pilotCode)) { joinedAlready = date; break; }
      }
      if (joinedAlready) continue;

      bookNightTrainingGroup({
        pilotCode, dueIso, item, code,
        usableDates: usable,
        rosterByPilotDate, pilotInfoByCode, positionsByCode,
        todayIso: today, minLeadDays, maxLeadDays,
        claimedByPilot, nightGroupByDate,
        entries, planned, skipped
      });
      continue;
    }

    // --- Simulator: instructor + two pilots, travelling together -------------
    if (SIM_ITEMS.has(item.key)) {
      // Already on a detail booked earlier in this run? Nothing left to do.
      let onDetail = false;
      for (const [, g] of simGroupByStart) {
        if (g.item !== item.key) continue;
        if (g.pilots.includes(pilotCode)) { onDetail = true; break; }
      }
      if (onDetail) continue;

      const detail = findSimDetail({
        pilotCode, needed, usableDates: usable,
        rosterByPilotDate, instructors,
        claimedByPilot, allCodes: Object.keys(pilotInfoByCode || {}),
        simGroupByStart
      });

      if (!detail) {
        skipped.push({
          pilotCode, item: item.key, label: item.label, dueIso, days: needed,
          reason: `a simulator detail needs a TRI/TRE instructor and ${SIM_PILOTS_PER_DETAIL} pilots free for the same ${needed} days — no such week between ${isoAddDays(dueIso, -maxLeadDays)} and ${isoAddDays(dueIso, -minLeadDays)}`
        });
        continue;
      }

      // Joining a detail that already exists.
      if (detail.joined) {
        const g = detail.joined;
        if (!g.pilots.includes(pilotCode)) g.pilots.push(pilotCode);
        for (const d of detail.run) {
          if (!claimedByPilot.has(pilotCode)) claimedByPilot.set(pilotCode, new Set());
          claimedByPilot.get(pilotCode).add(d);
          const pi = pilotInfoByCode?.[pilotCode] || {};
          entries.push({
            pilotCode, pilotName: pi.pilotName || "", base: pi.base || "", date: d, code
          });
        }
        planned.push({
          pilotCode, item: item.key, label: item.label, code, dueIso,
          start: detail.run[0], end: detail.run[detail.run.length - 1], days: needed,
          leadDays: daysBetween(detail.run[detail.run.length - 1], dueIso),
          withPilots: [g.instructor, ...g.pilots.filter((c) => c !== pilotCode)],
          instructor: g.instructor
        });
        continue;
      }

      // A new detail: write the instructor and both pilots across the run.
      const party = [detail.instructor, ...detail.pilots];
      for (const c of party) {
        for (const d of detail.run) {
          if (!claimedByPilot.has(c)) claimedByPilot.set(c, new Set());
          claimedByPilot.get(c).add(d);
          const pi = pilotInfoByCode?.[c] || {};
          entries.push({
            pilotCode: c, pilotName: pi.pilotName || "", base: pi.base || "", date: d, code
          });
        }
      }
      simGroupByStart.set(detail.start, {
        item: item.key, instructor: detail.instructor, pilots: [...detail.pilots], run: detail.run
      });
      planned.push({
        pilotCode, item: item.key, label: item.label, code, dueIso,
        start: detail.run[0], end: detail.run[detail.run.length - 1], days: needed,
        leadDays: daysBetween(detail.run[detail.run.length - 1], dueIso),
        withPilots: [detail.instructor, ...detail.pilots.filter((c) => c !== pilotCode)],
        instructor: detail.instructor
      });
      continue;
    }

    const info = pilotInfoByCode?.[pilotCode] || {};
    for (const date of run) {
      claimedDates.add(date);
      // Write the training code on its own ("S", "H", "CR" ...), replacing the
      // plain "O".
      //
      // NOT "O,S". The comma form means something specific and different here:
      // Capt. Weera - "จัด ฝึก sim ช่วงวันพัก เลย ได้ ค่าทำงาน ล่วงเวลา ถือเป็น
      // ทำงานวันหยุด เลยใส่ O/S ครับ ขึ้นอยู่กับเราจัด ครับ" - i.e. "O,S" marks
      // a course placed on a pilot's DAY OFF, which earns overtime. Writing it
      // on an ordinary duty day would wrongly claim OT for a day that is
      // already a working day.
      //
      // And this planner never places anything on a day off anyway (that call
      // is the chief pilot's, case by case), so the comma form is never what
      // it should be emitting. The day was already an "O", so nothing is lost
      // from the 21 working days by replacing it.
      entries.push({
        pilotCode,
        pilotName: info.pilotName || "",
        base: info.base || "",
        date,
        code
      });
    }

    planned.push({
      pilotCode,
      item: item.key,
      label: item.label,
      code,
      dueIso,
      start: run[0],
      end: run[run.length - 1],
      days: needed,
      leadDays: daysBetween(run[run.length - 1], dueIso)
    });
  }

  return { entries, planned, skipped };
}

// One line, ready to print - on screen and into the audit log.
export function describePlannedTraining(p) {
  const when = p.start === p.end ? p.start : `${p.start} → ${p.end}`;
  // Night training is booked as a group, so say who else is on it - a line
  // that named only one pilot would look like the lone booking this is meant
  // to prevent.
  const withWho = p.withPilots?.length ? ` with ${p.withPilots.join(", ")}` : "";
  return `${p.pilotCode} — ${p.label} (${p.code}) on ${when}${withWho}, ${p.leadDays} day(s) before due ${p.dueIso}`;
}

export function describeSkippedTraining(s) {
  return `${s.pilotCode} — ${s.label} due ${s.dueIso}: ${s.reason}`;
}
