// Generates a repeating duty cycle for one pilot, going forward from a start
// date (or continuing on from their existing history). Coded using the same
// letters as src/modules/pilotRoster/rosterCodes.js: "O" = Day Duty,
// "RR" = Recovery Rest, "X" = Day off from duty.
//
// Capt. Weera: click a pilot's name, pick a start date and a pattern, save —
// it fills the table forward automatically, and every cell can still be
// edited by hand afterwards exactly as before.

// The company's base rotation: Duty 19, Recovery Rest 2, Off 7 — 21
// duty-related days (19 O + 2 RR) + 7 days off per 28-day cycle.
//
// ONLY ONE RR pair is generated, and it sits immediately before the 7-day OFF
// block. Capt. Weera: "roster RR RR สองวันที่ติด กับ พัก 7 วัน ต้อง ติดกัน
// แบบนั้น เลย ที่เหลือ จัดตามเงื่อนไข เลย" — that pair is fixed and always
// adjacent to the break (it is the rest taken before the pilot travels off,
// which is why weeklyPlanRestDays.js treats it as LOCKED: "RR ที่ก่อนวัน OFF
// 2 วัน ขยับไม่ได้").
//
// Everything else is deliberately left as plain duty. Earlier versions of this
// file also sprinkled RR pairs mid-rotation on a fixed count (…O6 RR2 O6 RR2…),
// which was wrong twice over: it pretended to know when the 168-hour cycle
// would run out before any hours had been flown, and it wrote rest days the
// pilot might not need. Mid-rotation Recovery Rest is scheduled "ตามเงื่อนไข" -
// by CONDITION, from the pilot's real rolling figures - which FDT Monitor
// computes and the Weekly Schedule acts on (ftlLimits.js recoveryRest*,
// weeklyPlanAvailability.js). A template cannot know it in advance, so it
// should not guess.
//
// RR counts as a WORKED day for pay/HR — the pilot is rostered, just resting
// near home base rather than flying. It is NOT part of the 7 days off.
const PATTERN_21_7 = [
  ...Array(19).fill("O"),
  ...Array(2).fill("RR"),
  ...Array(7).fill("X")
];

// NOT from a company document — there is no published "20/10" sheet the way
// there is for 21/7. Follows the same shape: one RR pair immediately before the
// OFF block, everything else plain duty, mid-rotation Recovery Rest left to the
// 168-hour condition rather than guessed here. Duty 18, RR 2, Off 10 — 20
// duty-related days + 10 days off per 30-day cycle. Confirm against a real
// company schedule before relying on it, the same way any generated template
// should be checked before it goes out as pay.
const PATTERN_20_10 = [
  ...Array(18).fill("O"),
  ...Array(2).fill("RR"),
  ...Array(10).fill("X")
];

// A short local rotation (e.g. onshore/admin), well inside every rolling
// rest limit on its own — no Recovery Rest day is needed inside five duty
// days, so none is inserted.
const PATTERN_5_2 = [
  ...Array(5).fill("O"),
  ...Array(2).fill("X")
];

export const ROSTER_PATTERNS = {
  "21/7": { label: "21/7 (company base rotation)", sequence: PATTERN_21_7 },
  "20/10": { label: "20/10", sequence: PATTERN_20_10 },
  "5/2": { label: "5/2", sequence: PATTERN_5_2 }
};

// Kept for anything still importing the old name directly.
export const CYCLE_PATTERN = PATTERN_21_7;

// A custom pattern is taken exactly as entered — plain duty days then plain
// days off, no Recovery Rest inserted automatically. Unlike the two named
// patterns above, nobody has reviewed this combination for the 168-hour
// rule, so it is the admin's own call (visible immediately: FDT Monitor
// turns a pilot amber/red the same way it would for any long run of O's
// typed by hand). Mirrors how "ป้อนเอง" already works everywhere else in
// this app — entered as data, not silently made "safe" on someone's behalf.
export function buildCustomPattern(dutyDays, offDays) {
  const duty = Math.max(0, Math.floor(Number(dutyDays) || 0));
  const off = Math.max(0, Math.floor(Number(offDays) || 0));
  return [...Array(duty).fill("O"), ...Array(off).fill("X")];
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// startDate/endDate are "YYYY-MM-DD" strings straight from an <input
// type="date"> (local calendar dates, not Excel serials) - parsed with an
// explicit T00:00:00 so this never shifts a day due to UTC/local timezone
// conversion the way `new Date("YYYY-MM-DD")` alone can.
//
// startIndex lets a caller say "startDate isn't Duty-day-1, it's wherever
// slot `startIndex` of the pattern falls" - used by continueCycleEntries
// below so a multi-year continuation doesn't reset the cycle to day 1 at
// the new start date. No upper bound on endDate, so picking e.g.
// 2028-12-31 generates straight across 2026/2027/2028 in one call.
export function generateCycleEntries(startDate, endDate, startIndex = 0, pattern = CYCLE_PATTERN) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  if (!pattern?.length) return [];

  const len = pattern.length;
  const out = [];
  const cursor = new Date(start);
  let i = ((startIndex % len) + len) % len;
  while (cursor <= end) {
    out.push({ date: toIsoDate(cursor), code: pattern[i % len] });
    cursor.setDate(cursor.getDate() + 1);
    i++;
  }
  return out;
}

// Figures out where in the cycle a pilot's existing roster history sits, so
// "Continue from last entry" can pick up on the right day instead of
// restarting at Duty-day-1. Only "O"/"RR"/"X" days are used as anchors
// (leave/training/etc. codes are ignored, not counted as mismatches) - for
// each possible offset we score how many anchor days would match `pattern`
// at that offset, and keep the best-fitting one. Real rosters have
// exceptions (sick leave, training swapped in) so this is a best-fit, not an
// exact match - `confidence` reports how clean the fit was.
//
// Matched against whichever pattern is currently selected in the dialog -
// there's no attempt to auto-detect WHICH pattern (21/7 vs 20/10 vs 5/2) a
// pilot is on; the admin picks that, the same way he picks the Start date.
export function detectCyclePhase(entries, pattern = CYCLE_PATTERN) {
  const anchors = (entries || [])
    .filter((e) => ["O", "RR", "X"].includes(String(e.code || "").toUpperCase()))
    .map((e) => ({ date: e.date, code: String(e.code).toUpperCase() }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (anchors.length === 0 || !pattern?.length) return null;

  // Cap the sample to the most recent ~2 cycles so a stale/old exception
  // early in a long history can't outweigh the pilot's current rotation.
  const len = pattern.length;
  const sample = anchors.slice(-len * 2);
  const refDate = new Date(`${sample[sample.length - 1].date}T00:00:00`);

  let bestOffset = 0;
  let bestScore = -1;
  for (let offset = 0; offset < len; offset++) {
    let score = 0;
    for (const a of sample) {
      const d = new Date(`${a.date}T00:00:00`);
      const diffDays = Math.round((refDate - d) / 86400000);
      const idx = (((offset - diffDays) % len) + len) % len;
      if (pattern[idx] === a.code) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return {
    // `offset` is the pattern index that best matches sample's last date.
    atDate: sample[sample.length - 1].date,
    offset: bestOffset,
    confidence: bestScore / sample.length
  };
}

// One-click "continue this pilot's pattern" - looks at every entry already
// on file for the pilot (any code, any date range), finds the most recent
// day, detects the cycle phase from the recent O/RR/X history against
// `pattern`, and generates forward from (last day + 1) through `throughDate`
// picking up the pattern exactly where it left off. Works across any number
// of years - throughDate of e.g. "2028-12-31" continues straight through
// 2027 and 2028 in the same call.
export function continueCycleEntries(existingEntriesForPilot, throughDate, pattern = CYCLE_PATTERN) {
  const history = existingEntriesForPilot || [];
  if (history.length === 0) return { entries: [], reason: "no-history" };

  const lastDate = history.reduce((max, e) => (e.date > max ? e.date : max), history[0].date);
  const phase = detectCyclePhase(history, pattern);
  if (!phase) return { entries: [], reason: "no-anchor-codes", lastDate };

  const len = pattern.length;
  const anchor = new Date(`${phase.atDate}T00:00:00`);
  const last = new Date(`${lastDate}T00:00:00`);
  const diffToLast = Math.round((last - anchor) / 86400000);
  const phaseAtLast = (((phase.offset + diffToLast) % len) + len) % len;

  const start = new Date(last);
  start.setDate(start.getDate() + 1);
  const startDate = toIsoDate(start);
  if (startDate > throughDate) {
    return { entries: [], reason: "already-covers-range", lastDate, confidence: phase.confidence };
  }

  const entries = generateCycleEntries(startDate, throughDate, phaseAtLast + 1, pattern);
  return { entries, reason: "ok", lastDate, confidence: phase.confidence, startDate };
}
