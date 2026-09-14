import {
  WEEKLY_SECTIONS,
  SECTION_BY_KEY,
  WORKING_SECTION_KEYS,
  MIN_REST_HOURS,
  dutyWindow,
  restHoursBetween,
  plannedDutyHours
} from "./weeklyPlanSections.js";
import { getCodeInfo, rosterDayInfo } from "./rosterCodes.js";
import { checkPairing, MIN_PAIR_LEVEL_SUM } from "../../utils/experienceLevel.js";
import {
  MAX_NIGHT_DAYS_PER_CYCLE, WORK_CYCLE_DAYS,
  NIGHT_TRAINING_MIN_PILOTS, NIGHT_TRAINING_PREFERRED_PILOTS,
  NIGHT_TRAINING_REQUIRES_CAPTAIN
} from "./weeklyPlanRules.js";
import { classifyRestDay } from "./weeklyPlanRestDays.js";

// A {start,end} pair of "HH:MM" strings turned into real times on a date.
function clockWindow(iso, window) {
  if (!window) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  const at = (hhmm) => {
    const [h, min] = String(hhmm).split(":").map(Number);
    return new Date(y, m - 1, d, h || 0, min || 0, 0, 0);
  };
  return { start: at(window.start), end: at(window.end) };
}

function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Cross-checks the PLAN against what's already known about each pilot, so a
// problem is visible while the week is still being planned rather than after
// someone has been told to show up.
//
// Six independent checks, deliberately kept simple and explainable - a
// planner has to be able to see instantly WHY a cell is flagged:
//
//   1. Double-booked   - the same pilot in two working sections on one day.
//                        (OFF Crew is not a working section, so being listed
//                        off AND assigned is caught by check 2 instead.)
//   2. Roster conflict - the published duty roster says this pilot is on
//                        Rest / Recovery Rest / leave that day. Leave and the
//                        RR sitting immediately before the OFF block are
//                        fixed (red); a mid-rotation RR/R exists to satisfy
//                        the 168h cycle and the weekly plan may move it, so
//                        that is a caution (yellow), not a violation.
//   3. FDT Monitor     - the pilot's standing on the very pages the company
//                        already trusts: rolling Duty Time 7/14/28d, rolling
//                        Flight Time 7/28/365d, and the 168-hour Recovery
//                        Rest cycle. Fed from the same computeStats the
//                        Dashboard and FDT Monitor use, so the numbers never
//                        disagree - and each breach is named, not lumped
//                        together as "over limit".
//   4. Minimum rest    - less than 12 hours between the end of one planned
//                        duty and the report time of the next. Because the
//                        night line ends 05:30 and the day crews report
//                        05:30-08:00, this is what stops a night pilot being
//                        given a day crew the following morning; night-to-
//                        night (17:30) passes with exactly 12h.
//   5. Night currency  - both pilots on a night line must hold valid Night
//                        Currency (the Training module's "night" item).
//   6. Training overdue- an expired monitored training item means the pilot
//                        shouldn't be flying at all.
//   7. Rolling limits  - the duty this plan ADDS would push the pilot past a
//                        7/14/28-day total (check 3 covers hours already
//                        flown; this one covers hours about to be planned).
//   8. Pairing level   - OPS-CM-01 7.17.4(2): the two pilots' Experience
//                        Levels added must be at least 4.
//   9. Night spread    - no more than six night duties per 28-day cycle.
//                        Nothing in the FTL limits pushes back on stacking
//                        nights (night books only 3h), so this is the only
//                        rule that does.
//
// Severity: "exc" = would break a rule, "warn" = worth a second look.

// A rostered rest day, leave, TRAINING or helideck inspection all mean the
// pilot is not available for a line that day. Training was missing from this
// set until Capt. Weera confirmed training is scheduled on the roster: a
// pilot marked "S" (simulator) could be hand-typed onto Crew 2 and nothing
// objected.
const CONFLICT_CATEGORIES = new Set(["rest", "leave", "training", "inspection"]);

export function checkWeeklyPlan({
  cells,
  rosterByPilotDate,
  pilotStatusByCode,
  dates,
  nightCurrentByCode,
  trainingOverdueByCode,
  priorDutyHoursByCode,
  limits,
  stbyCreditPercent = 25,
  levelByCode,
  minPairLevelSum = MIN_PAIR_LEVEL_SUM,
  availabilityByCode,
  priorNightDatesByCode,
  maxNightDaysPerCycle = MAX_NIGHT_DAYS_PER_CYCLE,
  cycleDays = WORK_CYCLE_DAYS,
  reportOffsetMinutes = 60,
  // Needed for the Night Training Captain rule (check 10). Optional: without
  // it that half of the rule is simply skipped rather than guessed at.
  positionsByCode
}) {
  const issues = [];
  // cellKey -> worst severity, so the grid can colour each cell directly.
  const cellSeverity = new Map();

  function flag(cell, severity, text) {
    const key = `${cell.date}|${cell.section}|${cell.slot}`;
    const current = cellSeverity.get(key);
    if (severity === "exc" || current !== "exc") cellSeverity.set(key, severity);
    issues.push({ ...cell, severity, text });
  }

  const dateSet = new Set(dates || []);
  const inRange = (cells || []).filter((c) => c.pilotCode && (!dateSet.size || dateSet.has(c.date)));

  // --- 1. Double-booked ---------------------------------------------------
  const working = new Set(WORKING_SECTION_KEYS);
  const byDayPilot = new Map();
  for (const c of inRange) {
    if (!working.has(c.section)) continue;
    const key = `${c.date}|${c.pilotCode}`;
    if (!byDayPilot.has(key)) byDayPilot.set(key, []);
    byDayPilot.get(key).push(c);
  }
  for (const [key, list] of byDayPilot) {
    if (list.length < 2) continue;
    const [date, code] = key.split("|");
    const where = list.map((c) => SECTION_BY_KEY.get(c.section)?.label || c.section).join(" + ");
    for (const c of list) flag(c, "exc", `${code} is double-booked on ${date}: ${where}.`);
  }

  // --- 2. Conflict with the published duty roster -------------------------
  // Not every rest day is equally immovable, and treating them all as hard
  // conflicts made the planner refuse legitimate adjustments:
  //   * Leave (VL/SL)              - never touchable.
  //   * RR before the OFF block    - fixed. That rest exists to be taken
  //                                  right there, before the pilot goes off.
  //   * RR/R mid-rotation          - held to keep the pilot inside the 168h
  //                                  cycle. The weekly plan MAY move it, so
  //                                  this is a caution, not a violation -
  //                                  but the 168h projection then has to
  //                                  still come out clean.
  for (const c of inRange) {
    if (!working.has(c.section)) continue;
    const rosterCode = rosterByPilotDate?.get(`${c.pilotCode}|${c.date}`);
    if (!rosterCode) continue;
    const info = getCodeInfo(rosterCode);
    const day = rosterDayInfo(rosterCode);
    if (!info) continue;

    const sectionLabel = SECTION_BY_KEY.get(c.section)?.label || c.section;

    // At training or on an inspection - including a combo cell like "O,S",
    // which getCodeInfo alone reports as "compensate" and would let through.
    // Not a rest day, so the movable/locked question doesn't arise: they are
    // simply somewhere else that day.
    if (day?.occupied) {
      // Sitting in the Training row IS the roster's training day, shown on
      // the board. That agrees with the roster; it isn't a conflict.
      if (SECTION_BY_KEY.get(c.section)?.kind === "training") continue;
      flag(c, "exc", `${c.pilotCode} is rostered "${info.label}" (${info.code}) on ${c.date} but is planned for ${sectionLabel}. Training is scheduled on the roster and can't be flown over.`);
      continue;
    }

    if (!CONFLICT_CATEGORIES.has(info.category)) continue;
    const rest = classifyRestDay(rosterByPilotDate, c.pilotCode, c.date);

    if (rest.type === "rest" && !rest.locked) {
      flag(c, "warn", `${c.pilotCode} is planned for ${sectionLabel} on ${c.date}, over a rostered "${info.label}" (${info.code}). That rest is mid-rotation and may be moved — check the 168h cycle still has a Recovery Rest before its deadline.`);
      continue;
    }

    const why = rest.locked && rest.reason ? ` — ${rest.reason}` : "";
    flag(c, "exc", `${c.pilotCode} is rostered "${info.label}" (${info.code}) on ${c.date} but is planned for ${sectionLabel}${why}.`);
  }

  // --- 3. Standing on FDT Monitor -----------------------------------------
  // Rolling Duty Time (7/14/28d), rolling Flight Time (7/28/365d) and the
  // 168-hour Recovery Rest cycle, read from the same rows FDT Monitor shows.
  // Each breach is named individually - "check FDT Monitor" on its own tells
  // the planner nothing about WHICH limit or by how much.
  const flaggedPilots = new Set();
  for (const c of inRange) {
    if (!working.has(c.section)) continue;
    const availability = availabilityByCode?.get(c.pilotCode);
    if (availability && availability.severity !== "ok") {
      flag(c, availability.severity, "");
      if (!flaggedPilots.has(c.pilotCode)) {
        flaggedPilots.add(c.pilotCode);
        for (const reason of availability.reasons) {
          issues.push({
            date: c.date, section: c.section, slot: c.slot, pilotCode: c.pilotCode,
            severity: reason.level,
            text: `${c.pilotCode}: ${reason.text}${reason.level === "exc" ? " — not fit to be planned for duty." : ""}`
          });
        }
      }
      continue;
    }
    // Fallback for callers that only pass the coarse overall status.
    const status = pilotStatusByCode?.get(c.pilotCode);
    if (!status || availabilityByCode) continue;
    if (status.status === "exc" || status.status === "warn") {
      flag(c, status.status === "exc" ? "exc" : "warn", "");
      if (!flaggedPilots.has(c.pilotCode)) {
        flaggedPilots.add(c.pilotCode);
        issues.push({
          date: "", section: "", slot: 0, pilotCode: c.pilotCode,
          severity: status.status === "exc" ? "exc" : "warn",
          text: `${c.pilotCode} is already ${status.status === "exc" ? "EXCEEDED" : "at WARNING"} on rolling duty/flight limits — check FDT Monitor before adding duty.`
        });
      }
    }
  }

  // --- 4. Minimum rest between consecutive duties -------------------------
  // Walks each pilot's planned duties in time order and compares the end of
  // one with the report time of the next. Only sections with fixed hours
  // take part (OFF Crew and ad-hoc Training have no window).
  const timelineByPilot = new Map();
  function addToTimeline(pilotCode, entry) {
    if (!timelineByPilot.has(pilotCode)) timelineByPilot.set(pilotCode, []);
    timelineByPilot.get(pilotCode).push(entry);
  }
  for (const c of inRange) {
    if (!working.has(c.section)) continue;
    const window = dutyWindow(c.section, c.date, reportOffsetMinutes);
    if (!window) continue;
    addToTimeline(c.pilotCode, {
      cell: c, window,
      label: SECTION_BY_KEY.get(c.section)?.label || c.section,
      date: c.date
    });
  }
  // Training days come from the ROSTER, not from this board, and they are
  // duty. Night Training ends 22:30, so the 12-hour minimum rest runs to 10:30
  // the next morning - while the earliest a day crew reports is 05:30. Without
  // these entries that gap simply wasn't measured.
  //
  // Note this covers rest before ANY next duty, not just a flying line: a
  // further training day the following morning is in this same timeline and is
  // measured the same way (Capt. Weera: "กลับมา ต้อง พัก 12 ชั่วโมง ถึงจะถูกจัด
  // บินได้ หรือ จัดฝึกอบรมต่างๆๆ").
  for (const [key, rosterCode] of rosterByPilotDate || []) {
    const [pilotCode, date] = key.split("|");
    const day = rosterDayInfo(rosterCode);
    if (!day?.window) continue;
    const window = clockWindow(date, day.window);
    if (!window) continue;
    addToTimeline(pilotCode, {
      cell: null, window,
      label: getCodeInfo(rosterCode)?.label || rosterCode,
      date
    });
  }
  for (const [code, list] of timelineByPilot) {
    list.sort((a, b) => a.window.start - b.window.start);
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1];
      const current = list[i];
      const rest = restHoursBetween(previous.window.end, current.window.start);
      if (rest == null || rest >= MIN_REST_HOURS) continue;
      // Nothing to flag if the short rest lands on a roster training day -
      // that isn't a cell on this board, and the fix is to move the FLYING,
      // which is the entry that does get flagged in the other direction.
      if (!current.cell) continue;
      flag(current.cell, "exc",
        `${code} gets only ${rest.toFixed(1)}h rest before ${current.label} on ${current.date} — ${MIN_REST_HOURS}h required after ${previous.label} on ${previous.date}.`);
    }
  }

  // --- 5. Night currency on the night lines -------------------------------
  if (nightCurrentByCode) {
    for (const c of inRange) {
      const section = SECTION_BY_KEY.get(c.section);
      if (!section?.requiresNightCurrency) continue;
      if (!nightCurrentByCode.has(c.pilotCode)) {
        flag(c, "exc", `${c.pilotCode} is planned for ${section.label} on ${c.date} but Night Currency is expired or not recorded.`);
      }
    }
  }

  // --- 6. Overdue training ------------------------------------------------
  if (trainingOverdueByCode) {
    const seen = new Set();
    for (const c of inRange) {
      if (!working.has(c.section)) continue;
      const overdue = trainingOverdueByCode.get(c.pilotCode);
      if (!overdue) continue;
      flag(c, "exc", "");
      if (!seen.has(c.pilotCode)) {
        seen.add(c.pilotCode);
        issues.push({
          date: "", section: "", slot: 0, pilotCode: c.pilotCode, severity: "exc",
          text: `${c.pilotCode} has overdue training (${overdue}) and is planned for duty this week.`
        });
      }
    }
  }

  // --- 7. Rolling duty limits on the PLAN itself --------------------------
  // Check 3 looks at hours already FLOWN; this one looks at the hours this
  // plan would add. A day crew books its whole window (12h for Crew 1, which
  // reports 05:30 for its 06:30 departure) while
  // night standby books only 25% of its 12 hours (3h), which is why nights
  // can run back-to-back and day crews cannot. Prior recorded duty is folded
  // in first so the two figures never disagree.
  if (limits) {
    const dutyByPilotDate = new Map();
    for (const [code, byDate] of Object.entries(priorDutyHoursByCode || {})) {
      dutyByPilotDate.set(String(code).toUpperCase(), new Map(Object.entries(byDate)));
    }
    const plannedCells = [];
    for (const c of inRange) {
      if (!working.has(c.section)) continue;
      const hours = plannedDutyHours(c.section, c.date, stbyCreditPercent, reportOffsetMinutes);
      if (!hours) continue;
      if (!dutyByPilotDate.has(c.pilotCode)) dutyByPilotDate.set(c.pilotCode, new Map());
      const byDate = dutyByPilotDate.get(c.pilotCode);
      byDate.set(c.date, (byDate.get(c.date) || 0) + hours);
      plannedCells.push(c);
    }

    const windows = [
      { days: 7, max: limits.dt7d?.max, label: "7-day" },
      { days: 14, max: limits.dt14d?.max, label: "14-day" },
      { days: 28, max: limits.dt28d?.max, label: "28-day" }
    ].filter((w) => w.max);

    const reported = new Set();
    for (const c of plannedCells) {
      const byDate = dutyByPilotDate.get(c.pilotCode);
      for (const w of windows) {
        let total = 0;
        for (let i = 0; i < w.days; i++) total += byDate.get(isoAddDays(c.date, -i)) || 0;
        if (total <= w.max) continue;
        flag(c, "exc", "");
        const key = `${c.pilotCode}|${w.label}`;
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            date: c.date, section: c.section, slot: c.slot, pilotCode: c.pilotCode, severity: "exc",
            text: `${c.pilotCode} would reach ${total.toFixed(1)}h duty over ${w.label}s ending ${c.date} — limit is ${w.max}h.`
          });
        }
      }
    }
  }

  // --- 8. Pairing by Experience Level -------------------------------------
  // OPS-CM-01 7.17.4(2): the two pilots' Levels added must be at least 4.
  // Reported per crew, not per pilot, since it's the combination that's at
  // fault - and a level that can't be computed is called out separately so a
  // gap in the Experience records doesn't masquerade as a legal crew.
  if (levelByCode) {
    const crews = new Map();
    for (const c of inRange) {
      const section = SECTION_BY_KEY.get(c.section);
      if (!section || section.kind === "off") continue;
      if (section.slots < 2) continue;
      const key = `${c.date}|${c.section}`;
      if (!crews.has(key)) crews.set(key, []);
      crews.get(key).push(c);
    }
    for (const [, crew] of crews) {
      if (crew.length < 2) continue;
      const [a, b] = crew;
      const result = checkPairing(levelByCode.get(a.pilotCode), levelByCode.get(b.pilotCode), minPairLevelSum);
      const label = SECTION_BY_KEY.get(a.section)?.label || a.section;
      if (result.unknown) {
        flag(a, "warn", `${a.pilotCode} + ${b.pilotCode} on ${label} ${a.date}: Experience Level can't be worked out for one of them — check their Pilot Experience record.`);
        continue;
      }
      if (!result.ok) {
        flag(a, "exc", "");
        flag(b, "exc", `${a.pilotCode} (L${levelByCode.get(a.pilotCode)}) + ${b.pilotCode} (L${levelByCode.get(b.pilotCode)}) on ${label} ${a.date} = level ${result.sum} — OPS-CM-01 7.17.4 requires at least ${result.minSum}.`);
      }
    }
  }

  // --- 9. Night duties per cycle ------------------------------------------
  // No more than six nights in any 28-day window. Night books only 3h of
  // duty, so nothing in the FTL limits pushes back on stacking nights onto
  // one pilot - this is the only rule that does.
  if (maxNightDaysPerCycle) {
    const nightDates = new Map();
    for (const [code, dates] of Object.entries(priorNightDatesByCode || {})) {
      nightDates.set(String(code).toUpperCase(), new Set(dates));
    }
    const nightCells = [];
    for (const c of inRange) {
      if (SECTION_BY_KEY.get(c.section)?.kind !== "night") continue;
      if (!nightDates.has(c.pilotCode)) nightDates.set(c.pilotCode, new Set());
      nightDates.get(c.pilotCode).add(c.date);
      nightCells.push(c);
    }
    const reportedNight = new Set();
    for (const c of nightCells) {
      const dates = nightDates.get(c.pilotCode);
      let count = 0;
      for (let i = 0; i < cycleDays; i++) if (dates.has(isoAddDays(c.date, -i))) count++;
      if (count <= maxNightDaysPerCycle) continue;
      flag(c, "warn", "");
      if (!reportedNight.has(c.pilotCode)) {
        reportedNight.add(c.pilotCode);
        issues.push({
          date: c.date, section: c.section, slot: c.slot, pilotCode: c.pilotCode, severity: "warn",
          text: `${c.pilotCode} has ${count} night duties in the ${cycleDays} days to ${c.date} — the target is no more than ${maxNightDaysPerCycle} per cycle.`
        });
      }
    }
  }

  // --- 10. Night Training: flown together, with a Captain -----------------
  // Capt. Weera: "การจัด Night training ควร จัด นักบินด้วยกัน อย่างน้อย 2-3 คน
  // ในนั้น ต้องเป็น กัปตัน หนึ่งท่านครับ".
  //
  // Deliberately a WARNING, not a violation. These cells are copied onto the
  // board from whoever the roster marks "NT", so a lone pilot here means the
  // ROSTER needs a second person added - it is not an illegal plan the way a
  // double-booking or a rest bust is, and blocking the plan would not fix the
  // roster. Night currency is deliberately NOT required: night training is how
  // a pilot regains it.
  {
    const byDate = new Map();
    for (const c of inRange) {
      if (c.section !== "nightTraining") continue;
      if (!byDate.has(c.date)) byDate.set(c.date, []);
      byDate.get(c.date).push(c);
    }

    for (const [date, group] of byDate) {
      const codes = [...new Set(group.map((c) => c.pilotCode))];
      const first = group[0];

      if (codes.length < NIGHT_TRAINING_MIN_PILOTS) {
        for (const c of group) flag(c, "warn", "");
        issues.push({
          date, section: first.section, slot: first.slot, pilotCode: first.pilotCode, severity: "warn",
          text: `Night Training on ${date} has only ${codes.length} pilot (${codes.join(", ")}) — it is flown together, ${NIGHT_TRAINING_MIN_PILOTS}-${NIGHT_TRAINING_PREFERRED_PILOTS} pilots. Add another NT day on the roster.`
        });
      }

      if (NIGHT_TRAINING_REQUIRES_CAPTAIN && positionsByCode) {
        // Only judge this once every pilot's position is actually known - an
        // unknown position would otherwise read as "no Captain" and cry wolf.
        const known = codes.filter((code) => positionsByCode[code]);
        const hasCaptain = known.some((code) => String(positionsByCode[code]).toLowerCase().includes("captain"));
        if (known.length === codes.length && codes.length > 0 && !hasCaptain) {
          for (const c of group) flag(c, "warn", "");
          issues.push({
            date, section: first.section, slot: first.slot, pilotCode: first.pilotCode, severity: "warn",
            text: `Night Training on ${date} (${codes.join(", ")}) has no Captain — one of the pilots on it must be a Captain.`
          });
        }
      }
    }
  }

  return {
    cellSeverity,
    // Empty-text entries exist only to colour a cell; the list shown to the
    // user is the ones that actually say something.
    issues: issues.filter((i) => i.text)
  };
}

export { WEEKLY_SECTIONS };
