// Legend for the duty-code letters used in the company's pilot roster Excel
// (verified against "NEW Pilot Schedule 2026 (Include RR9).xlsx", sheet
// "RR 2026", rows 29-45 - that legend block is duplicated 2-3 times across
// the sheet for different month-page printouts, this is the union of all of
// them). "PATTERN 21/7" for the base rotation is: Duty 6, RR 2, Duty 6, RR 2,
// Duty 3, RR 2, OFF 7 (21 duty-related days = 15 O + 6 RR, plus 7 OFF, per
// 28-day cycle) - see src/services/rosterTemplate.js. The RR pair before the
// OFF block is required, not optional: Capt. Weera, "การทำงาน 21/7 จะจัด RR
// 2 วัน ก่อน พัก 7 วัน".
export const CODE_LEGEND = [
  { code: "O", label: "Day Duty", category: "duty" },
  { code: "X", label: "Day off from duty", category: "off" },
  // RR and R are BOTH rest, but they are not interchangeable - they answer
  // different questions, and mixing them up is a compliance problem.
  // Confirmed by Capt. Weera:
  //
  //   RR = Recovery Rest. The long one, used to RESET the 168-hour duty
  //        cycle. Needs at least 36 hours' rest, and inside that 36 hours
  //        there must be TWO CONSECUTIVE local nights (the night window is
  //        22:00-08:00) with at least 8 hours' sleep available in each.
  //        Scheduled when the pilot's 168-hour cycle is running out (see
  //        ftlLimits.js recoveryRest* and weeklyPlanAvailability.js), and
  //        always as the pair immediately before the 7-day OFF block in the
  //        21/7 rotation.
  //        For pay/HR RR still counts as a WORKED day - the pilot is
  //        rostered, just resting near home base instead of flying. It is
  //        NOT one of the 7 days off.
  //
  //   R  = Rest Day. The short one: the 12-hour minimum rest after coming
  //        OFF NIGHT (05:30-17:30). It only discharges the minimum-rest
  //        requirement; it does NOT reset the 168-hour cycle. The pilot may
  //        be rostered for duty again the very next day, PROVIDED the
  //        168-hour cycle and the rolling FT/DT limits still allow it.
  { code: "RR", label: "Recovery Rest (>=36h, 2 consecutive nights)", category: "rest" },
  { code: "R", label: "Rest Day (12h min rest off night, OMA 7.11)", category: "rest" },
  // "N" (Night Standby) and "ND" (Night Duty) were REMOVED from the roster
  // at Capt. Weera's instruction: "ตัด N ออกจาก roster ไปเลย".
  //
  // The two documents answer different questions and were overlapping here:
  // the roster says WHICH DAYS a pilot works (the 21 days that pay is
  // calculated from), the weekly schedule says WHAT they do on those days
  // (Crew 1-6, night standby, training). Night belongs entirely to the
  // second. Carrying it in both meant a night duty could be recorded in one
  // and not the other, with no way to tell which was right.
  //
  // An old roster still holding "N" or "ND" is read as an ordinary duty day
  // (see rosterDayInfo below), so nothing already imported breaks - the code
  // simply stops being offered and stops meaning anything special.
  { code: "NT", label: "Night Training (17:30-22:30)", category: "training" },
  // "T" (Flight Training) was REMOVED at Capt. Weera's instruction: "ส่วน code
  // T เอาออก เลย ไม่ค่อยได้ใช้แล้ว". It is no longer offered for entry and
  // nothing writes it (see ITEM_ROSTER_CODES in weeklyPlanTrainingQueue.js),
  // but a "T" already sitting on an imported roster is still read as a
  // training day via LEGACY_CODES below - so its rest obligation and duty
  // window keep applying to months already on file.
  { code: "C", label: "Flight Check", category: "training" },
  { code: "S", label: "Simulator", category: "training" },
  // The simulator is at Subang, Malaysia, which is why travel has its own code
  // at all - Capt. Weera: "SIM (LPC =5 วัน OPC=4 วัน) at Malaysia subang".
  { code: "S/T", label: "Travel for Simulator (Subang, MY)", category: "training" },
  { code: "CR", label: "CRM Training", category: "training" },
  { code: "AVS", label: "AVSEC Training", category: "training" },
  { code: "H", label: "HUET", category: "training" },
  { code: "FIRE", label: "Fire Fighting", category: "training" },
  { code: "FIRST", label: "First Aid Training", category: "training" },
  { code: "SMS", label: "SMS Training", category: "training" },
  { code: "INS", label: "Helideck Inspection", category: "inspection" },
  { code: "VL", label: "Vacation Leave", category: "leave" },
  { code: "SL", label: "Sick Leave", category: "leave" }
];

export const CODE_LEGEND_MAP = new Map(CODE_LEGEND.map((c) => [c.code, c]));

// Training, checks and helideck inspections are WORK. They are scheduled on
// the roster (Capt. Weera: "พวกจัดการ training ต่างๆ หรือไปฝึกบิน sim จะจัดไว้
// ที่หน้า roster"), not on the weekly board, and until this existed the
// planner treated those days as empty: no duty hours, no rest obligation.
// That let a pilot finish Night Training at 22:30 and be given Crew 1 the
// next morning - report 05:30, seven hours' rest, against a twelve-hour
// minimum. The 12 hours after night training run to 10:30, and they bar the
// next FLYING and the next TRAINING alike.
//
// NT's window is 17:30-22:30 (Capt. Weera). Everything else defaults to the
// working day, 08:00-17:00,
// confirmed by Capt. Weera as the normal shape of a ground school or sim day.
// Simulator travel (S/T) is counted the same way rather than as a free day -
// positioning is duty, and over-counting an hour is the safe direction to be
// wrong in.
// IMPORTANT: these windows are PLANNING assumptions, not the record of what was
// actually worked. Capt. Weera: "การนับ DUTY ลงเวลา เหมือน FDT ปกติ ครับ ตาม
// ตาราง sim" - the real duty for a sim day is entered in Daily Duty from the
// actual sim schedule, exactly like any other duty, and FDT Monitor counts THAT.
//
// What these are for: giving the planner and the rest/conflict checks a figure
// to work with for a day that has not happened yet (a sim slot three months out
// has no recorded times). Where a real entry exists it is the authority; the
// sim slot time itself is not fixed ("อาจเป็นช่วงเย็นก็ได้ ขึ้นกับตาราง sim"),
// which is why an over-long span is the safe direction to assume here.
export const TRAINING_DUTY_WINDOWS = {
  // Night training runs 17:30-22:30 (Capt. Weera: "โดยปกติ night training จะ
  // ฝึกช่วงเวลา 17:30-22:30 กลับมา ต้อง พัก 12 ชั่วโมง ถึงจะถูกจัดบินได้ หรือ
  // จัดฝึกอบรมต่างๆๆ"). So the 12-hour minimum rest runs to 10:30 the next
  // morning - a pilot who flew night training cannot report for ANY duty, line
  // or further training, before then. That is enforced generally: the rest
  // check reads this window, it is not special-cased for night.
  night: { start: "17:30", end: "22:30" },
  // A simulator day is a duty period of its own and runs to about eight
  // hours, not the nine of a full working day (Capt. Weera: "DUTY Time SIM
  // ประมาณ ไม่เกิน 8 ชั่วโมง"). Kept as its own window rather than folded into
  // "day" so the figure stays visible and correctable.
  sim: { start: "08:00", end: "16:00" },
  day: { start: "08:00", end: "17:00" }
};

// Codes that used to exist on the roster and may still be sitting in months
// already imported. Read as ordinary duty days so an old sheet keeps working
// - they are simply no longer offered, and no longer mean "night".
const LEGACY_CODES = new Map([
  ["N", { code: "N", label: "Duty day (was Night Standby)", category: "duty" }],
  ["ND", { code: "ND", label: "Duty day (was Night Duty)", category: "duty" }],
  // Retired code, still honoured on rosters already imported. Kept in the
  // "training" category on purpose: a historic T day must go on occupying the
  // pilot and carrying its 12-hour rest obligation, otherwise removing the
  // code from the legend would quietly make old months look free.
  ["T", { code: "T", label: "Flight Training (retired code)", category: "training" }]
]);

const NIGHT_TRAINING_CODES = new Set(["NT"]);
// The sim session itself. "S/T" is the TRAVEL day either side of it and is a
// normal working day, so it is deliberately not in here.
const SIM_CODES = new Set(["S"]);
// Categories that occupy the pilot for the day without being a line duty.
const OCCUPYING_CATEGORIES = new Set(["training", "inspection"]);

// What a roster cell means for the weekly planner. One place, because the
// answer is needed by the auto-fill, the conflict checks and the board.
//
// Combo cells are read PART BY PART rather than as one opaque string: "O,T"
// is a duty day spent in training, "O,X" is a compensate day OFF. Treating
// every combo as "unknown, skip it" quietly removed those pilots from the
// whole plan.
export function rosterDayInfo(raw) {
  const text = String(raw || "").trim().toUpperCase();
  if (!text) return null;

  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const infos = parts.map((p) => CODE_LEGEND_MAP.get(p) || LEGACY_CODES.get(p)).filter(Boolean);
  if (!infos.length) return { code: text, onDuty: false, occupied: null, window: null, unknown: true };

  const categories = new Set(infos.map((i) => i.category));
  // Any "off", "rest" or "leave" part wins: O,X is a day off, not a duty day.
  const released = categories.has("off") || categories.has("rest") || categories.has("leave");
  // ALL the occupying parts, not just the first, so a cell carrying two of them
  // is not read as whichever happened to be written first.
  //
  // The case that matters is "S,NT". The simulator can SIMULATE night whatever
  // the clock says, so night training happens inside the sim session rather than
  // as a separate evening detail (Capt. Weera: "เราสมมุติ สถานการณ์ เป็นบิน
  // กลางคืนได้ ครับ ถึงแม้จะฝึกอบรม ช่วงเวลา กลางวัน หรือกลางคืน"). Normally that
  // day is written just "S".
  //
  // Where the widened window below still earns its keep: the sim SLOT time is
  // not fixed - "อาจเป็นช่วงเย็นก็ได้ ขึ้นกับตาราง sim" - so a visit can run into
  // the evening. Writing "S,NT" is how a late slot gets recorded, and the span
  // then has to cover it, or the duty is under-counted and the rest owed the
  // next morning is measured from the wrong time.
  const occupyingParts = infos.filter((i) => OCCUPYING_CATEGORIES.has(i.category));
  const kindOf = (info) =>
    NIGHT_TRAINING_CODES.has(info.code) ? "night" : SIM_CODES.has(info.code) ? "sim" : "day";
  const kinds = occupyingParts.map(kindOf);

  // The headline kind. Night wins when a day carries both, because the thing
  // that governs the next duty is when the pilot FINISHED, and night finishes
  // last.
  let occupied = null;
  if (kinds.length) occupied = kinds.includes("night") ? "night" : kinds[0];

  // The real span of the day: earliest start of any part to the latest end.
  // For "S,NT" that is 08:00 -> 22:30 - the safe reading of a sim day that ran
  // late, so the 12-hour rest runs to 10:30 the next morning rather than being
  // measured from a 16:00 finish that did not happen. Over-counting the span is
  // the safe direction to be wrong in.
  let window = occupied ? TRAINING_DUTY_WINDOWS[occupied] : null;
  if (kinds.length > 1) {
    const windows = kinds.map((k) => TRAINING_DUTY_WINDOWS[k]).filter(Boolean);
    if (windows.length) {
      const start = windows.map((w) => w.start).sort()[0];
      const end = windows.map((w) => w.end).sort().slice(-1)[0];
      window = { start, end };
    }
  }

  return {
    code: text,
    // Available to be given a line today. Training and inspection occupy the
    // pilot even when the cell also carries an "O".
    // Night is decided ENTIRELY by the weekly schedule now, so a roster cell
    // only says "working" or "not working".
    onDuty: !released && !occupied && categories.has("duty"),
    occupied,
    window,
    // Every occupying session on the day, so a caller that needs to know the
    // cell was BOTH sim and night training can see it rather than inferring it
    // from the widened window.
    occupiedKinds: kinds.length ? [...new Set(kinds)] : null
  };
}

// Combo cells (comma-separated, e.g. "O,N" / "O,X" / "O,T" / "O,C") mark a
// compensate day - a normal duty day that also carries a second marker. Kept
// as their own category (rather than just showing the "O" half) so they
// stand out on the calendar as "something changed on this day".
const COMPENSATE_LABELS = {
  "O,X": "Compensate day off"
};

// Palette for the calendar cells, on the roster's light-grey surface (see the
// "light surface" block in PilotRoster.css). Cells are NOT filled: a month
// grid is ~30 columns x every pilot, and a wall of coloured blocks - even
// pale ones - was tiring to read. The colour is carried by the code letters
// alone, so the grid stays a calm grey sheet and the eye picks out the codes
// rather than the background. bg stays in the shape (as "transparent") so
// nothing that consumes style.bg has to change. Works as-is in print too.
export const CATEGORY_STYLE = {
  duty: { bg: "transparent", fg: "#15803d" },
  off: { bg: "transparent", fg: "#dc2626" },
  rest: { bg: "transparent", fg: "#22c55e" },
  night: { bg: "transparent", fg: "#6d28d9" },
  training: { bg: "transparent", fg: "#b45309" },
  leave: { bg: "transparent", fg: "#be123c" },
  inspection: { bg: "transparent", fg: "#a16207" },
  compensate: { bg: "transparent", fg: "#0f766e" },
  // The one category that DOES get a fill. Everything else on this grid is
  // deliberately unfilled (see the note above) so the sheet stays calm, but a
  // cell that cannot actually be flown has to be impossible to scroll past.
  conflict: { bg: "#fee2e2", fg: "#b91c1c" },
  unknown: { bg: "transparent", fg: "#475569" }
};

// Per-code overrides, for the three codes that carry their own meaning
// regardless of which category they sit in: O = green (on duty), X = red
// (day off), RR = light green (recovery rest). Without this, X would take
// its "off" colour and RR its "rest" colour.
export const CODE_STYLE = {
  O: { bg: "transparent", fg: "#15803d" },
  X: { bg: "transparent", fg: "#dc2626" },
  RR: { bg: "transparent", fg: "#22c55e" }
};

// Resolves any raw cell value from the roster (a plain code like "O", or a
// combo like "O,T") to {code, label, category, style}. Never throws - an
// unrecognized code (a typo, or a code the company adds later that isn't in
// CODE_LEGEND yet) still renders, just styled as "unknown" rather than being
// silently dropped, so nothing imported from Excel ever disappears from view.
export function getCodeInfo(raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!code) return null;

  const direct = CODE_LEGEND_MAP.get(code);
  if (direct) return { code, label: direct.label, category: direct.category, style: CODE_STYLE[code] || CATEGORY_STYLE[direct.category] };

  if (code.includes(",")) {
    const parts = code.split(",").map((p) => p.trim()).filter(Boolean);
    const label = COMPENSATE_LABELS[code] || parts.map((p) => CODE_LEGEND_MAP.get(p)?.label || p).join(" + ");

    // TWO COURSES ON ONE DAY IS NOT A COMPENSATE DAY - IT IS A MISTAKE.
    //
    // Capt. Weera, on KPO being sent to the simulator and to AVSEC training on
    // the same date: "จัด ไป sim แลัว ยังมี อบรม AVS มันทำไม่ได้ครับ".
    //
    // Every combo cell used to fall through to "compensate", which is a calm
    // teal "something changed on this day" marker. That is right for "O,X" (a
    // compensate day off) and for "O,S" (a course taken on a day off, earning
    // overtime) - in both, the second part explains the first. It is wrong for
    // "S,AVS": a pilot cannot sit in the simulator and attend AVSEC on the same
    // day, and styling it as a normal compensate day meant nothing on the
    // roster said so.
    //
    // Exception: "S,NT". Capt. Weera - "night training สามารถ ไปฝึก ใน sim คราว
    // เดียวกัน ได้เลยครับ", and on why: "เราสมมุติ สถานการณ์ เป็นบินกลางคืนได้
    // ครับ ถึงแม้จะฝึกอบรม ช่วงเวลา กลางวัน หรือกลางคืน ครับ" - the simulator can
    // SIMULATE night whatever the clock says, so the night training happens
    // inside the sim session rather than as a second detail that evening.
    //
    // Normally the cell is just "S" ("เข้า sim ครั้งเดียว ได้ night ด้วยเลย ใส่
    // แค่ S") - ITEM_ROSTER_CODES lets "S" satisfy the night item on its own. But
    // "S,NT" is accepted rather than flagged, because someone recording both
    // explicitly is describing one session, not double-booking the pilot.
    const courseParts = parts.filter((p) => {
      const cat = CODE_LEGEND_MAP.get(p)?.category || LEGACY_CODES.get(p)?.category;
      return cat === "training" || cat === "inspection";
    });
    const isSimPlusNight =
      courseParts.length === 2 &&
      courseParts.some((p) => SIM_CODES.has(p)) &&
      courseParts.some((p) => NIGHT_TRAINING_CODES.has(p));

    if (courseParts.length > 1 && !isSimPlusNight) {
      return {
        code,
        label: `${label} — cannot both be on one day`,
        category: "conflict",
        style: CATEGORY_STYLE.conflict,
        conflict: true
      };
    }

    return { code, label, category: "compensate", style: CATEGORY_STYLE.compensate };
  }

  return { code, label: code, category: "unknown", style: CATEGORY_STYLE.unknown };
}

// Legend list for the UI footer - one entry per category (not per raw code),
// so it stays compact regardless of how many individual codes fall into
// "training" etc. Order matches a natural "at a glance" priority.
export const CATEGORY_ORDER = ["duty", "off", "rest", "night", "training", "leave", "inspection", "compensate", "conflict", "unknown"];

export const CATEGORY_LABELS = {
  duty: "Day Duty",
  off: "Off",
  rest: "Rest / Recovery Rest",
  night: "Night Duty / Standby",
  training: "Training / Check / Sim",
  leave: "Leave (Vacation / Sick)",
  inspection: "Helideck Inspection",
  compensate: "Compensate Day",
  conflict: "Clash — two courses on one day",
  unknown: "Unrecognized code"
};
