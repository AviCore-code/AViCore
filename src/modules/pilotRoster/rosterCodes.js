// Legend for the duty-code letters used in the company's pilot roster Excel
// (verified against "NEW Pilot Schedule 2026 (Include RR9).xlsx", sheet
// "RR 2026", rows 29-45 - that legend block is duplicated 2-3 times across
// the sheet for different month-page printouts, this is the union of all of
// them). One real cycle on that sheet came out Duty 6, RR 2, Duty 6, RR 2,
// Duty 3, RR 2, OFF 7 (21 duty-related days = 15 O + 6 RR, plus 7 OFF, per
// 28-day cycle) - see src/services/rosterTemplate.js.
//
// Capt. Weera's description of the NORMAL shape: three duty blocks of about
// 5 days each, an RR of 1-2 days between them, then a fixed 2-day RR
// immediately before the 7-day OFF block - "Day On 5 วัน, RR 1-2 วัน, Day On
// 5 วัน, RR 1-2 วัน, Day On 5 วัน, RR ต้อง 2 วัน ก่อน พัก 7 วัน". Only the
// last RR (the one before OFF) is fixed at 2 days and immovable - "การทำงาน
// 21/7 จะจัด RR 2 วัน ก่อน พัก 7 วัน". The two mid-rotation RRs are NOT on a
// fixed day count or fixed position: "RR ใน 7 วันรอบแรก และ 7 วันรอบที่สอง
// สามารถปรับได้ตลอด" - they move wherever the pilot's real 168-Hour Duty
// Cycle, rolling DT/FT limits and Fatigue Monitor actually call for one
// (ftlLimits.js recoveryRest*, weeklyPlanAvailability.js). That is exactly
// why the Excel instance above landed on 6/6/3 rather than 5/5/5 - it is one
// realized case of the same condition-driven rule, not a different pattern.
// It is also why rosterTemplate.js's generated PATTERN_21_7 deliberately
// inserts only the fixed pre-OFF RR pair and leaves the two mid-rotation
// ones for the Weekly Schedule to place by condition, rather than guessing
// a day count here.
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
  { code: "C", label: "Flight Check with Helicopter", category: "training" },
  // "L" (Line Check) is its own code, distinct from "C" (Flight Check) - both
  // are on the company's official "Roster Symbol" sheet. lineCheck still maps
  // to "C" in ITEM_ROSTER_CODES (weeklyPlanTrainingQueue.js) - adding "L" here
  // only makes it a recognised, correctly-coloured symbol; it does not change
  // what the training planner writes.
  { code: "L", label: "Line Check", category: "training" },
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
  { code: "PBN", label: "PBN", category: "training" },
  { code: "ESE", label: "ESE Training", category: "training" },
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
  ["N", { code: "N", label: "Night Standby (17:30-05:30) - legacy, now on the Weekly Schedule", category: "duty" }],
  ["ND", { code: "ND", label: "Duty day (was Night Duty)", category: "duty" }],
  // Retired code, still honoured on rosters already imported. Kept in the
  // "training" category on purpose: a historic T day must go on occupying the
  // pilot and carrying its 12-hour rest obligation, otherwise removing the
  // code from the legend would quietly make old months look free.
  ["T", { code: "T", label: "Flight Training with Helicopter (retired code)", category: "training" }]
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
  const infos = parts.map((p) => resolveLegendEntry(p)).filter(Boolean);
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

// Whether a TRAINING item may be WRITTEN onto this cell, replacing whatever is
// there. Deliberately more permissive than `onDuty` above (which governs
// whether a pilot can be given a FLYING line): Capt. Weera confirmed training
// may now sit on Recovery Rest (RR), a Rest Day (R) or an Off day (X), not
// only a plain duty day. This mirrors what weeklyPlanChecks.js already allows
// for a mid-rotation RR/R on the Weekly Schedule board - moving it is a
// caution, not a violation, provided the 168-hour Recovery Rest cycle still
// comes out clean afterwards. That check still has to be made by whoever
// reviews the plan; this function only says the CELL is writable, not that
// moving it is consequence-free.
//
// Still off limits:
//   - Leave (VL/SL) - the pilot's own day, never touched.
//   - A day already carrying a session (training/inspection) - can't
//     double-book.
//   - Any combo cell ("O,X", "O,S" ...) - someone entered that second code
//     deliberately, and overwriting it would silently lose that meaning.
export function isTrainingWritableDay(raw) {
  const text = String(raw || "").trim().toUpperCase();
  if (!text || text.includes(",")) return false;
  const info = resolveLegendEntry(text);
  if (!info) return false;
  if (info.category === "leave") return false;
  if (OCCUPYING_CATEGORIES.has(info.category)) return false;
  return info.category === "duty" || info.category === "rest" || info.category === "off";
}

// Combo cells (comma-separated, e.g. "O,N" / "O,X" / "O,T" / "O,C") mark a
// compensate day - a normal duty day that also carries a second marker. Kept
// as their own category (rather than just showing the "O" half) so they
// stand out on the calendar as "something changed on this day".
const COMPENSATE_LABELS = {
  "O,X": "Compensate day off",
  "O,N": "Compensate Day on",
  // The company's "Roster Symbol" sheet has an "Over time" colour swatch with
  // no code letter of its own - rosterTrainingPlanner.js already explains
  // what it maps to: a course placed on a pilot's day off earns overtime, and
  // that is recorded as "O,S" (Capt. Weera: "ถือเป็นทำงานวันหยุด เลยใส่ O/S").
  // So "O,S" is given its own label and colour here instead of falling
  // through to the generic "compensate" teal.
  "O,S": "Overtime (training on a day off)"
};

// Capt. Weera: the 21 working days read "เขียวแก่" (dark green - moved on
// from the earlier "เขียวขี้ม้า" khaki shade), and changing it here takes
// effect on the roster page immediately, no separate setting to flip -
// gridFill() below reads this SAME constant for the grid, and Settings >
// Roster Symbol's default (CODE_STYLE/CATEGORY_STYLE) reads it too. One
// place, both surfaces update together.
const GREEN = "#388e3c";
const YELLOW = "#fde047";
const PINK = "#f9a8d4";

// Colour for combo cells that have their own meaning (see COMPENSATE_LABELS
// above). All three ARE the "X สลับ O" compensate swap Capt. Weera described:
// "O,N" and "O,S" are an off day compensated TO working (night duty / a
// course earning overtime), "O,X" is a working day compensated to off. Text
// is RED - not the black every other symbol gets - specifically to flag a
// swap; the FILL still follows which side the day landed on: green like a
// plain O if it is now a working day, yellow like a plain X if it is now off.
// Deliberately NOT admin-overridable (like "conflict" below) - the red text
// is what makes a swap findable on the sheet.
const COMPENSATE_STYLE = {
  "O,X": { bg: YELLOW, fg: "#dc2626" },
  "O,N": { bg: GREEN, fg: "#dc2626" },
  "O,S": { bg: GREEN, fg: "#dc2626" }
};

// The DEFAULT identity colour for each category, as shown in Settings >
// Roster Symbol's "Colour" column: green for everything, except off (X)
// which is yellow (Capt. Weera: "default ค่า symbol ต่างๆ ใน roster setting
// เป็นสีเขียว ยกเว้น X เป็นสีเหลือง"). This is the STORED default an admin
// sees and can edit - it is deliberately not the same thing as what the
// calendar grid actually paints a cell (see gridFill() below), which forces
// PINK for anything other than a plain O/X regardless of this value, unless
// the admin has explicitly overridden that code's colour.
export const CATEGORY_STYLE = {
  duty: { bg: GREEN, fg: "#000000" },
  off: { bg: YELLOW, fg: "#000000" },
  rest: { bg: GREEN, fg: "#000000" },
  night: { bg: GREEN, fg: "#000000" },
  training: { bg: GREEN, fg: "#000000" },
  leave: { bg: GREEN, fg: "#000000" },
  inspection: { bg: GREEN, fg: "#000000" },
  compensate: { bg: GREEN, fg: "#000000" },
  // Kept deliberately distinct and NOT admin-overridable (see getCodeInfo) -
  // conflict red is a safety signal ("cannot both be on one day"), not a
  // decoration.
  conflict: { bg: "#fee2e2", fg: "#b91c1c" },
  // An unrecognised code fills grey rather than green - it is not yet a
  // known symbol, so it should not look like one.
  unknown: { bg: "#9ca3af", fg: "#000000" }
};

// Per-code default identity colours, same idea as CATEGORY_STYLE above -
// green for every built-in code except X (yellow). bg is the FULL FILL
// shown in Settings > Roster Symbol; fg is fixed black.
//
// Admin-editable from Settings > Roster Symbol (label and colour only - see
// applyRosterSymbolCustomizations below); these are just the defaults.
export const CODE_STYLE = {
  O: { bg: GREEN, fg: "#000000" },
  X: { bg: YELLOW, fg: "#000000" },
  RR: { bg: GREEN, fg: "#000000" },
  R: { bg: GREEN, fg: "#000000" },
  NT: { bg: GREEN, fg: "#000000" },
  N: { bg: GREEN, fg: "#000000" },
  ND: { bg: GREEN, fg: "#000000" },
  T: { bg: GREEN, fg: "#000000" },
  C: { bg: GREEN, fg: "#000000" },
  L: { bg: GREEN, fg: "#000000" },
  S: { bg: GREEN, fg: "#000000" },
  "S/T": { bg: GREEN, fg: "#000000" },
  CR: { bg: GREEN, fg: "#000000" },
  AVS: { bg: GREEN, fg: "#000000" },
  H: { bg: GREEN, fg: "#000000" },
  FIRE: { bg: GREEN, fg: "#000000" },
  FIRST: { bg: GREEN, fg: "#000000" },
  SMS: { bg: GREEN, fg: "#000000" },
  PBN: { bg: GREEN, fg: "#000000" },
  ESE: { bg: GREEN, fg: "#000000" },
  INS: { bg: GREEN, fg: "#000000" },
  VL: { bg: GREEN, fg: "#000000" },
  SL: { bg: GREEN, fg: "#000000" }
};

// VL and SL are LEAVE, not a duty replaced by a symbol - the pilot is off
// work exactly the way they are on a plain X day, so Capt. Weera has them
// read the same yellow as X rather than the general "something's here" pink
// every other symbol gets: "SL VL จะอยู่ช่วง 21 วัน ทำงาน พื้นหลัง จะเป็น
// สีเหลือง" - even though a leave day sits inside the 21 working days on the
// calendar, it reads as an off day, so it gets off's colour.
const YELLOW_LIKE_CODES = new Set(["VL", "SL"]);

// RR (Recovery Rest) reads green like O, not pink - it counts as a WORKED
// day for pay/HR (the pilot is rostered, just resting near base instead of
// flying - see the note on RR in CODE_LEGEND above), so Capt. Weera has it
// share O's colour rather than the general "something's here" pink. R (the
// short Rest Day) is NOT included here - it isn't documented as a worked day
// the way RR is, so it stays pink with everything else unless told otherwise.
const GREEN_LIKE_CODES = new Set(["RR"]);

// What the ROSTER GRID actually paints for a symbol - deliberately different
// from CODE_STYLE/CATEGORY_STYLE above. Capt. Weera's rule for the calendar
// itself: a plain working day (O, one of the 21 duty days) is green, a
// plain off day (X, one of the 7 days off) is yellow, and ANY OTHER SYMBOL
// landing on a day - training, rest, inspection, whatever - turns that cell
// PINK, so the sheet reads at a glance as "working / off / something else
// happening here, go read the letter" rather than a different pastel per
// code. RR (green) and Leave VL/SL (yellow) are the two exceptions - see the
// Sets above. An admin-set colour override always wins - the whole point of
// Settings > Roster Symbol is to let the company override this default.
function gridFill(category, overrideColor, code) {
  if (overrideColor) return overrideColor;
  if (category === "duty") return GREEN;
  if (category === "off") return YELLOW;
  if (code && GREEN_LIKE_CODES.has(code)) return GREEN;
  if (code && YELLOW_LIKE_CODES.has(code)) return YELLOW;
  return PINK;
}

// --- Settings > Roster Symbol: admin-editable label/colour overrides -------
//
// The CATEGORY of a code (duty/off/rest/training/leave/inspection) drives
// real FTL logic above - rest windows, duty credit, isTrainingWritableDay -
// so it stays hardcoded in CODE_LEGEND/LEGACY_CODES and is never
// admin-editable. What Settings > Roster Symbol DOES let the admin change,
// for any code (built-in or new):
//   - the LABEL and COLOUR shown for it
//   - brand-new codes, which must be given one of these categories so a
//     custom code still behaves correctly (rest, duty credit, training-write
//     eligibility...) even though nobody hand-wrote a rule for it.
export const ROSTER_SYMBOL_CATEGORIES = ["duty", "off", "rest", "training", "leave", "inspection"];

let customLegendEntries = [];   // [{ code, label, category, color }]
let labelColorOverrides = {};   // { CODE: { label?, color? } }

// Called once with the saved "roster_symbol_customizations" setting (see
// RosterSymbolSettingsTab.jsx) wherever the roster is shown or edited, so the
// admin's Add/Edit/Delete/Save choices take effect everywhere a roster code
// is displayed or interpreted - not just inside the Settings tab itself.
export function applyRosterSymbolCustomizations(saved) {
  customLegendEntries = Array.isArray(saved?.custom)
    ? saved.custom.filter((e) => e?.code && ROSTER_SYMBOL_CATEGORIES.includes(e.category))
    : [];
  labelColorOverrides = saved?.overrides && typeof saved.overrides === "object" ? saved.overrides : {};
}

function customEntry(code) {
  return customLegendEntries.find((e) => String(e.code).toUpperCase() === code) || null;
}

// CODE_LEGEND_MAP, then LEGACY_CODES, then any admin-added custom code - the
// one place that resolves a raw code to its CATEGORY, so a custom code
// participates in rosterDayInfo/isTrainingWritableDay exactly like a
// built-in one, driven by the category its creator picked for it.
function resolveLegendEntry(code) {
  return CODE_LEGEND_MAP.get(code) || LEGACY_CODES.get(code) || customEntry(code);
}

// Resolves any raw cell value from the roster (a plain code like "O", or a
// combo like "O,T") to {code, label, category, style}. Never throws - an
// unrecognized code (a typo, or a code the company adds later that isn't in
// CODE_LEGEND yet) still renders, just styled as "unknown" rather than being
// silently dropped, so nothing imported from Excel ever disappears from view.
//
// Checks LEGACY_CODES and any admin-added custom code too (via
// resolveLegendEntry), not just CODE_LEGEND - a legacy code like "N" or "T"
// sitting on an old imported roster is real duty (rosterDayInfo already
// treats it that way) and deserves a real label and colour here, not the
// grey "unknown" style it fell back to before.
export function getCodeInfo(raw) {
  const code = String(raw || "").trim().toUpperCase();
  if (!code) return null;

  if (!code.includes(",")) {
    const direct = resolveLegendEntry(code);
    if (direct) {
      const override = labelColorOverrides[code];
      const label = override?.label || direct.label;
      // A custom code's own colour (chosen when it was added - direct.color,
      // only ever set on customEntry() results) counts as an override too,
      // same as editing an existing code's colour afterwards.
      const bg = gridFill(direct.category, override?.color || direct.color, code);
      return { code, label, category: direct.category, style: { bg, fg: "#000000" } };
    }
  }

  if (code.includes(",")) {
    const parts = code.split(",").map((p) => p.trim()).filter(Boolean);
    const override = labelColorOverrides[code];
    const label = override?.label || COMPENSATE_LABELS[code] || parts.map((p) => resolveLegendEntry(p)?.label || p).join(" + ");

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
      const cat = resolveLegendEntry(p)?.category;
      return cat === "training" || cat === "inspection";
    });
    const isSimPlusNight =
      courseParts.length === 2 &&
      courseParts.some((p) => SIM_CODES.has(p)) &&
      courseParts.some((p) => NIGHT_TRAINING_CODES.has(p));

    if (courseParts.length > 1 && !isSimPlusNight) {
      // Deliberately NOT colour-overridable - conflict red is a safety
      // signal ("cannot both be on one day"), not a decoration.
      return {
        code,
        label: `${label} — cannot both be on one day`,
        category: "conflict",
        style: CATEGORY_STYLE.conflict,
        conflict: true
      };
    }

    // A known compensate swap (O,X / O,N / O,S) keeps its fixed red-text
    // green/yellow styling - not admin-overridable, same reasoning as
    // conflict below. Any OTHER combo (e.g. "S,NT") falls through to the
    // general "a symbol landed" pink.
    if (COMPENSATE_STYLE[code]) {
      return { code, label, category: "compensate", style: COMPENSATE_STYLE[code] };
    }
    const bg = gridFill("compensate", override?.color);
    return { code, label, category: "compensate", style: { bg, fg: "#000000" } };
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

// Every CURRENT symbol (built-in + admin-added custom), one row per code.
// Two colours are reported, because Settings > Roster Symbol and the roster
// pages show two different things:
//   color     - the STORED default identity colour (green, except X yellow),
//               which is what RosterSymbolSettingsTab.jsx shows and edits.
//   gridColor - what the roster grid actually paints for this symbol right
//               now (see gridFill above) - green for O, yellow for X, pink
//               for everything else, unless the admin overrode it. This is
//               what DutySchedule.jsx/MyRoster.jsx use for their legend, so
//               the legend always matches the cells.
// Legacy codes (N, ND, T) are left out - they still read correctly wherever
// they appear on an old roster, but are not offered as a current symbol.
export function listRosterSymbols() {
  const builtIn = CODE_LEGEND.map((c) => {
    const override = labelColorOverrides[c.code];
    return {
      code: c.code,
      label: override?.label || c.label,
      category: c.category,
      color: override?.color || CODE_STYLE[c.code]?.bg || CATEGORY_STYLE[c.category].bg,
      gridColor: gridFill(c.category, override?.color, c.code),
      builtIn: true
    };
  });
  const custom = customLegendEntries.map((c) => {
    const override = labelColorOverrides[c.code];
    return {
      code: c.code,
      label: override?.label || c.label,
      category: c.category,
      color: override?.color || c.color || CATEGORY_STYLE[c.category].bg,
      gridColor: gridFill(c.category, override?.color || c.color, c.code),
      builtIn: false
    };
  });
  return [...builtIn, ...custom];
}

// The three known Compensate Day swaps (fixed red text on green/yellow, NOT
// admin-overridable - see COMPENSATE_STYLE), for the roster pages' legend
// only. Deliberately separate from listRosterSymbols() above - these aren't
// editable rows in Settings > Roster Symbol, since there is nothing to
// change: DutySchedule.jsx/MyRoster.jsx append this to their own legend so
// a compensate swap is explained too, not just the single-letter codes.
export function listCompensateSymbols() {
  return Object.keys(COMPENSATE_LABELS).map((code) => ({
    code,
    label: COMPENSATE_LABELS[code],
    category: "compensate",
    color: COMPENSATE_STYLE[code].bg,
    gridColor: COMPENSATE_STYLE[code].bg,
    textColor: COMPENSATE_STYLE[code].fg
  }));
}
