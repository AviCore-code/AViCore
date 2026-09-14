// Pilot Experience Level - OPS-CM-01 7.17.4 "Ranking of Flight Crew and
// Pairing Instruction for Flight Operation" (Issue 07, 29 Apr 2025).
//
// Five experience factors, each scored 1-4 against a band table that differs
// for Captains and Co-pilots. The five scores are added, and the SUM maps to
// the pilot's overall Level 1-4:
//
//     sum  8-11 -> Level 1
//     sum 12-15 -> Level 2
//     sum 16-19 -> Level 3
//     sum    20 -> Level 4
//
// (The lowest possible sum is 5 - all factors at 1 - which the manual's
// table doesn't name explicitly; anything below 12 is Level 1.)
//
// PAIRING RULE, 7.17.4(2): "The minimum experience levels when pairing both
// pilots for scheduling are not less than 4" - the two pilots' Levels ADDED
// must be >= 4. So a Level 3 Captain may fly with a Level 1 Co-pilot (3+1=4),
// but a Level 2 Captain with a Level 1 Co-pilot (=3) is not an acceptable
// pairing. This is the rule that keeps a low-time crew off the same aircraft.

// Bands are [upperBoundInclusive, value]; the last entry is the open top end.
const CAPTAIN_BANDS = {
  totalTime: [[3000, 1], [4000, 2], [5000, 3], [Infinity, 4]],
  pic: [[1500, 1], [2000, 2], [2500, 3], [Infinity, 4]],
  type: [[400, 1], [800, 2], [1200, 3], [Infinity, 4]],
  offshore: [[500, 1], [1000, 2], [2000, 3], [Infinity, 4]],
  multi: [[1200, 1], [2500, 2], [3500, 3], [Infinity, 4]]
};

const COPILOT_BANDS = {
  totalTime: [[1000, 1], [2000, 2], [3000, 3], [Infinity, 4]],
  pic: [[500, 1], [1000, 2], [1500, 3], [Infinity, 4]],
  type: [[400, 1], [800, 2], [1200, 3], [Infinity, 4]],
  offshore: [[500, 1], [1000, 2], [2000, 3], [Infinity, 4]],
  multi: [[600, 1], [900, 2], [1200, 3], [Infinity, 4]]
};

export const EXPERIENCE_FACTORS = [
  { key: "totalTime", label: "Total Flight Time" },
  { key: "pic", label: "Pilot in Command" },
  { key: "type", label: "Type hours (AW139)" },
  { key: "offshore", label: "Offshore" },
  { key: "multi", label: "Multiengine" }
];

// Anyone who isn't a Captain is scored on the Co-pilot table (SFO and FO are
// both Co-pilot ranks - see PilotExperienceBuilder's POSITIONS).
export function bandsForPosition(position) {
  return position === "Captain" ? CAPTAIN_BANDS : COPILOT_BANDS;
}

function scoreFactor(bands, hours) {
  // null/undefined/"" mean "not recorded", NOT zero - Number(null) is 0,
  // which would silently score the lowest band and produce a plausible but
  // wrong level for a pilot whose record simply isn't filled in yet.
  if (hours == null || hours === "") return null;
  const h = Number(hours);
  if (!isFinite(h) || h < 0) return null;
  for (const [upper, value] of bands) {
    if (h <= upper) return value;
  }
  return 4;
}

export function levelForSum(sum) {
  if (sum == null) return null;
  if (sum >= 20) return 4;
  if (sum >= 16) return 3;
  if (sum >= 12) return 2;
  return 1;
}

// hours: { totalTime, pic, type, offshore, multi } in decimal hours.
// Returns { level, sum, values } - or level:null if a factor is missing,
// because a level computed from incomplete data would be misleadingly low.
export function computeExperienceLevel(position, hours) {
  const bands = bandsForPosition(position);
  const values = {};
  let sum = 0;
  for (const factor of EXPERIENCE_FACTORS) {
    const value = scoreFactor(bands[factor.key], hours?.[factor.key]);
    if (value == null) return { level: null, sum: null, values, missing: factor.key };
    values[factor.key] = value;
    sum += value;
  }
  return { level: levelForSum(sum), sum, values };
}

// --- Pairing --------------------------------------------------------------

export const MIN_PAIR_LEVEL_SUM = 4;

// Are these two pilots an acceptable pairing? Levels are added; unknown
// levels are NOT assumed to be acceptable, but they are reported separately
// so the caller can tell "not allowed" from "can't tell yet".
export function checkPairing(levelA, levelB, minSum = MIN_PAIR_LEVEL_SUM) {
  if (levelA == null || levelB == null) {
    return { ok: false, unknown: true, sum: null, minSum };
  }
  const sum = levelA + levelB;
  return { ok: sum >= minSum, unknown: false, sum, minSum };
}
