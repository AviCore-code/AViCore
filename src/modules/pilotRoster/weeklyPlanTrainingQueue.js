// "Who needs a training slot booked, and hasn't got one yet."
//
// Training Monitor answers a different question. It says WHEN an item is due
// - LPC 30 Sep, HUET 15 Aug - and turns red the day it expires. By then the
// pilot is grounded and there is nothing to plan around. What the chief pilot
// actually needs, three weeks earlier, is: "nobody has booked KTO's LPC and
// he is out of hours to do it in."
//
// So this crosses the two sources that already exist:
//
//   DUE DATE     from Training Monitor (the pilot's training record)
//   BOOKED DATE  from the ROSTER - an S / T / C / H / CR ... code between now
//                and the due date is the slot, because that is where training
//                is scheduled (Capt. Weera: "จะจัดไว้ที่หน้า roster")
//
// An item that is due soon and has no matching roster code in between comes
// back as something to book.
//
// It deliberately covers ONLY items that are actually scheduled as a day at
// work. Passport, medical and licence renewals are admin the pilot does in
// their own time; they appear on Training Monitor but there is no roster code
// for them, and listing them here as "not booked" would be noise that teaches
// people to ignore the panel.

import { rosterDayInfo } from "./rosterCodes.js";
import { todayIso } from "../../utils/dateKeys.js";

// Which roster codes satisfy which training item. A simulator day covers both
// the LPC and the OPC (they are flown in the same visit); a line check is a
// flight with a checker, code C.
// "T" (Flight Training) was REMOVED at Capt. Weera's instruction: "ส่วน code T
// เอาออก เลย ไม่ค่อยได้ใช้แล้ว".
//
// Four items used to be satisfied by it. Rather than silently re-point them at
// some other code (which would book pilots onto the wrong kind of day), they are
// no longer planned onto the roster AT ALL, on instruction - "เลิกวางแผน
// หลักสูตรเหล่านี้ไปเลย":
//
//   flightTraining, ese, ground, dgs
//
// They still appear on Training Monitor with their own due dates; they simply
// aren't auto-booked or listed as "not booked" here any more, and are scheduled
// by hand if they come up. lineCheck keeps "C" (a flight with a checker), which
// is what it always really was.
//
// An "T" already sitting on an imported roster is still READ correctly - the
// legend in rosterCodes.js keeps it as a legacy code - it is just never written.
export const ITEM_ROSTER_CODES = {
  lpc: ["S", "C"],
  opc2: ["S", "C"],
  lineCheck: ["C"],
  // Night currency is renewed EITHER in the simulator or on the real aircraft.
  //
  // Capt. Weera: "เราสมมุติ สถานการณ์ เป็นบินกลางคืนได้ ครับ ถึงแม้จะฝึกอบรม
  // ช่วงเวลา กลางวัน หรือกลางคืน ครับ" - the sim can simulate night whatever the
  // clock says, so a sim visit gives night training too and only "S" is written
  // ("เข้า sim ครั้งเดียว ได้ night ด้วยเลย ใส่แค่ S"). "NT" is the real-aircraft
  // night detail flown about three months after the sim.
  //
  // "S" is listed FIRST so trainingCodeFor("night") stays "NT": when this
  // planner has to CREATE a night booking it means the real-aircraft one, since
  // the sim is booked under its own LPC/OPC item. Order matters here - see
  // trainingCodeFor below.
  night: ["NT", "S"],
  crm: ["CR"],
  huet: ["H"],
  firstAids: ["FIRST"],
  fireFighting: ["FIRE"],
  sms: ["SMS"],
  avsec: ["AVS"],
  pbn: ["S"],
  egpwsTcas: ["S"]
};

// The roster code written when a slot is booked from the board: the first,
// most specific one for that item. A booking made here has to be readable by
// everything else afterwards - the planner, the checks, the queue itself -
// which is why it goes on the roster as a normal code rather than into a
// table of its own.
export function trainingCodeFor(itemKey) {
  return ITEM_ROSTER_CODES[itemKey]?.[0] || null;
}

const MS_PER_DAY = 86400000;

function isoOf(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const [ay, am, ad] = String(fromIso).split("-").map(Number);
  const [by, bm, bd] = String(toIso).split("-").map(Number);
  if (!ay || !by) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

// Every roster day for this pilot that carries one of `codes`, on or after
// `fromIso`. Read through rosterDayInfo so a combo cell like "O,S" counts.
function bookedDates(rosterByPilotDate, pilotCode, codes, fromIso) {
  const wanted = new Set(codes);
  const found = [];
  for (const [key, raw] of rosterByPilotDate || []) {
    const [code, date] = key.split("|");
    if (code !== pilotCode) continue;
    if (date < fromIso) continue;
    if (!rosterDayInfo(raw)?.occupied) continue;
    const parts = String(raw).toUpperCase().split(",").map((p) => p.trim());
    if (parts.some((p) => wanted.has(p))) found.push(date);
  }
  return found.sort();
}

/**
 * @param records  [{ code, record: { lpc: "2026-09-30", ... } }] - as the
 *                 Training module already loads them.
 * @param thresholds  the per-item caution window in days, from Training
 *                 Setting. Reused deliberately: the company has already said
 *                 how much warning each item needs, and having a second
 *                 number here that disagreed with the one on the Training
 *                 page would be worse than having none.
 * @param monitored   Set of item keys switched on in Training Setting.
 * @param items       TRAINING_ITEMS (passed in to keep this module free of
 *                 the Training module's imports).
 */
export function trainingToBook({
  records,
  thresholds,
  monitored,
  items,
  rosterByPilotDate,
  todayIso: todayIsoArg
}) {
  const today = todayIsoArg || todayIso();
  const out = [];

  for (const entry of records || []) {
    const pilotCode = String(entry?.code || "").toUpperCase();
    if (!pilotCode) continue;
    const record = entry.record || {};

    for (const item of items || []) {
      const codes = ITEM_ROSTER_CODES[item.key];
      if (!codes) continue;                                  // not a rostered course
      if (monitored && !monitored.has(item.key)) continue;    // switched off
      if (item.type === "count") continue;                    // a count, not a date

      const dueIso = isoOf(record[item.key]);
      if (!dueIso) continue;                                  // nothing recorded
      const daysRemaining = daysBetween(today, dueIso);
      if (daysRemaining == null) continue;

      const window = thresholds?.[item.key];
      if (!Number.isFinite(window)) continue;
      if (daysRemaining > window) continue;                   // not near due yet

      // A slot only counts if it falls BEFORE the item expires. One booked
      // the week after the due date doesn't keep the pilot legal.
      const booked = bookedDates(rosterByPilotDate, pilotCode, codes, today)
        .find((d) => d <= dueIso) || null;

      out.push({
        pilotCode,
        item: item.key,
        label: item.label,
        dueIso,
        daysRemaining,
        booked,
        // Already expired, or due before anything is booked.
        severity: daysRemaining < 0 ? "exc" : booked ? "ok" : "warn"
      });
    }
  }

  // Most urgent first, and unbooked before booked at the same distance -
  // the list is read from the top and acted on until the reader runs out of
  // patience, so the thing that needs doing has to be there.
  return out.sort((a, b) => {
    if (!!a.booked !== !!b.booked) return a.booked ? 1 : -1;
    return a.daysRemaining - b.daysRemaining;
  });
}

// --- Suggesting a slot ------------------------------------------------------
// The list above says what needs booking. This says WHEN it could go.
//
// It only ever SUGGESTS. Nothing is written to the roster: the chief pilot
// confirms and books it himself ("เสนอวันให้ดู แต่ผมกดยืนยันเอง"). A planner
// that silently moved training days onto the roster would be making crewing
// decisions nobody had seen.
//
// A slot has to be a run of consecutive days where the pilot is already
// ROSTERED ON DUTY. Training on a day off would be sending someone in on
// their own time, and training on a rest day breaks the rest.

const MIN_LEAD_DAYS = 7; // don't propose something for tomorrow

export function suggestTrainingSlot({
  pilotCode,
  dueIso,
  days = 1,
  rosterByPilotDate,
  todayIso: todayIsoArg,
  minLeadDays = MIN_LEAD_DAYS,
  busyDates
}) {
  const today = todayIsoArg || todayIso();
  const needed = Math.max(1, Math.ceil(days || 1));

  // Every day this pilot is free to be sent, in order.
  const usable = [];
  for (const [key, raw] of rosterByPilotDate || []) {
    const [code, date] = key.split("|");
    if (code !== pilotCode) continue;
    if (date < today || date > dueIso) continue;
    if (daysFrom(today, date) < minLeadDays) continue;
    const info = rosterDayInfo(raw);
    if (!info?.onDuty) continue;            // off, rest, leave, or already busy
    if (busyDates?.has(date)) continue;     // already flying in the plan
    usable.push(date);
  }
  usable.sort();

  // The earliest run of `needed` consecutive dates. Earliest, not latest:
  // booking early leaves room to move it if the sim slot falls through,
  // whereas the last possible date has no second chance behind it.
  for (let i = 0; i + needed <= usable.length; i++) {
    let run = true;
    for (let j = 1; j < needed; j++) {
      if (daysFrom(usable[i + j - 1], usable[i + j]) !== 1) { run = false; break; }
    }
    if (run) return { start: usable[i], end: usable[i + needed - 1], days: needed };
  }

  return {
    start: null,
    end: null,
    days: needed,
    reason: usable.length
      ? `no ${needed} consecutive duty days free before ${dueIso}`
      : `no duty days free before ${dueIso}`
  };
}

function daysFrom(fromIso, toIso) {
  const [ay, am, ad] = String(fromIso).split("-").map(Number);
  const [by, bm, bd] = String(toIso).split("-").map(Number);
  if (!ay || !by) return NaN;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY);
}

export function describeSuggestion(s) {
  if (!s) return "";
  if (!s.start) return `no slot found — ${s.reason}`;
  return s.start === s.end ? `suggest ${s.start}` : `suggest ${s.start} → ${s.end}`;
}

// One line, ready to print.
export function describeTrainingToBook(row) {
  const when = row.daysRemaining < 0
    ? `EXPIRED ${Math.abs(row.daysRemaining)} days ago`
    : `due in ${row.daysRemaining} days`;
  if (row.booked) return `${row.pilotCode} — ${row.label} ${when} (${row.dueIso}), booked ${row.booked} ✓`;
  return `${row.pilotCode} — ${row.label} ${when} (${row.dueIso}), NOT booked`;
}
