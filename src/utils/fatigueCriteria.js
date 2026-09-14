// The Fatigue Monitor's SCORING CRITERIA, as editable settings.
//
// ---------------------------------------------------------------------------
// READ THIS BEFORE CHANGING ANYTHING HERE
// ---------------------------------------------------------------------------
//
// These numbers are not application preferences. They are the criteria the
// CAAT approved in OPS-CM-01 §7.17.3, and the figures they produce are
// submitted to the CAAT every three months (§7.17.3.2).
//
// Capt. Weera asked for them to be editable, and agreed they should be
// editable *under control* rather than freely. That distinction is the whole
// reason this module exists, and it is enforced three ways:
//
//   1. OPS_CM_01 below is frozen and is always recoverable ("Reset").
//   2. isModified() lets any screen show that custom values are in use, so a
//      figure that disagrees with the manual can never look official.
//   3. validateCriteria() refuses input that would silently corrupt scoring -
//      a NaN threshold would score every duty as 0 and read as "no fatigue".
//
// The failure this guards against is specific: someone edits a threshold, the
// numbers quietly shift, a quarterly return goes to the regulator built on
// values nobody can trace, and re-running an old report no longer reproduces
// what was sent. Hence every change is stamped and logged (see fatigueCriteria
// settings key + FATIGUE_CRITERIA_LOG_KEY).

export const FATIGUE_CRITERIA_KEY = "fatigue_criteria";
export const FATIGUE_CRITERIA_LOG_KEY = "fatigue_criteria_log";

// ---------------------------------------------------------------------------
// The approved criteria. Frozen: this is the "known good" AviCore resets to.
// ---------------------------------------------------------------------------
//
// Every figure traced in docs/FATIGUE-MONITOR.md to either the approved PDF or
// the workbook formulas (<CODE>_FDT.xlsx, sheet DT, columns AE-AK). Where the
// two disagree, the workbook wins - on Capt. Weera's instruction, because it is
// what the Crew Scheduler actually runs.
//
// Thresholds are expressed as descending [atLeast, points] pairs, evaluated top
// to bottom: the first row whose threshold is met wins. Written this way so the
// UI can render them as a simple table and so adding a band needs no code.
export const OPS_CM_01 = Object.freeze({
  // Parameter 1 - Flight Duty Time (hours) -> points. DT!AI.
  // Floor is 1, not 0: any duty at all scores. (PDF says 0; workbook says 1.)
  dutyTime: Object.freeze([
    Object.freeze({ atLeast: 7, points: 6 }),
    Object.freeze({ atLeast: 6, points: 5 }),
    Object.freeze({ atLeast: 5, points: 4 }),
    Object.freeze({ atLeast: 4, points: 3 }),
    Object.freeze({ atLeast: 3, points: 2 }),
    Object.freeze({ atLeast: 0.0001, points: 1 })
  ]),

  // Parameter 3 - Sectors (count) -> points. DT!AG, reading DT!R.
  // ">10" in the workbook, i.e. 11+ scores 6.
  sectors: Object.freeze([
    Object.freeze({ atLeast: 11, points: 6 }),
    Object.freeze({ atLeast: 9, points: 5 }),
    Object.freeze({ atLeast: 7, points: 4 }),
    Object.freeze({ atLeast: 5, points: 3 }),
    Object.freeze({ atLeast: 4, points: 2 }),
    Object.freeze({ atLeast: 1, points: 1 })
  ]),

  // Parameter 4 - Flights per Day -> points. DT!AH.
  // NOT a descending scale: 3 flights scores 4, but 4+ flights scores 0 in the
  // workbook. Kept as an exact-match map rather than forced into the same
  // shape, because pretending it is monotonic would change the numbers.
  flightsPerDay: Object.freeze({ 1: 1, 2: 2, 3: 4 }),

  // Parameter 2 - Crews Number, from the DEPARTURE TIME band. DT!AF.
  // "from"/"to" are inclusive "HH:MM". The band that wraps midnight is marked
  // wraps:true and is matched as (t >= from OR t <= to).
  crews: Object.freeze([
    Object.freeze({ crew: 1, points: 6, from: "22:30", to: "06:59", wraps: true }),
    Object.freeze({ crew: 2, points: 5, from: "07:00", to: "07:30" }),
    Object.freeze({ crew: 3, points: 4, from: "07:31", to: "08:00" }),
    Object.freeze({ crew: 4, points: 3, from: "08:01", to: "08:30" }),
    Object.freeze({ crew: 5, points: 2, from: "08:31", to: "09:00" }),
    Object.freeze({ crew: 6, points: 1, from: "09:01", to: "22:29" })
  ]),

  limits: Object.freeze({
    daily: 22,            // one day must stay under this
    twoDay: 40,           // two consecutive days
    weeklyDutyHours: 60   // DT 1 week - also sets the DT INDEX ceiling (60/24 = 2.5)
  })
});

// Deep copy, so an editor can never mutate the frozen defaults by reference.
export function cloneCriteria(c) {
  return JSON.parse(JSON.stringify(c || OPS_CM_01));
}

export function defaultCriteria() {
  return cloneCriteria(OPS_CM_01);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
//
// Deliberately strict. A fatigue score that silently reads 0 because a
// threshold was blank is far more dangerous than a rejected edit: it shows a
// tired crew as rested. So anything not clearly valid is refused, with a
// message naming the field.
//
// Returns { ok, errors: [string] }.
export function validateCriteria(c) {
  const errors = [];
  const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

  function checkScale(name, rows, { maxPoints }) {
    if (!Array.isArray(rows) || rows.length === 0) {
      errors.push(`${name}: needs at least one band.`);
      return;
    }
    let prev = Infinity;
    rows.forEach((r, i) => {
      const at = num(r?.atLeast), pts = num(r?.points);
      if (!Number.isFinite(at)) errors.push(`${name} row ${i + 1}: threshold must be a number.`);
      if (!Number.isFinite(pts)) errors.push(`${name} row ${i + 1}: points must be a number.`);
      else if (pts < 0 || pts > maxPoints) errors.push(`${name} row ${i + 1}: points must be 0-${maxPoints}.`);
      // Descending order matters: the scale is evaluated top-down and the first
      // match wins, so an out-of-order row would be unreachable - a band that
      // silently never applies.
      if (Number.isFinite(at)) {
        if (at >= prev) errors.push(`${name} row ${i + 1}: thresholds must go from highest to lowest.`);
        prev = at;
      }
    });
  }

  checkScale("Flight Duty Time", c?.dutyTime, { maxPoints: 6 });
  checkScale("Sectors", c?.sectors, { maxPoints: 6 });

  const fpd = c?.flightsPerDay;
  if (!fpd || typeof fpd !== "object") errors.push("Flights per Day: missing.");
  else {
    for (const [k, v] of Object.entries(fpd)) {
      if (!Number.isFinite(num(k)) || num(k) < 0) errors.push(`Flights per Day: "${k}" is not a flight count.`);
      const pts = num(v);
      if (!Number.isFinite(pts) || pts < 0 || pts > 6) errors.push(`Flights per Day ${k}: points must be 0-6.`);
    }
  }

  const crews = c?.crews;
  if (!Array.isArray(crews) || crews.length === 0) errors.push("Crews: needs at least one band.");
  else {
    const hhmm = /^([01]?\d|2[0-3]):[0-5]\d$/;
    let wrapCount = 0;
    crews.forEach((b, i) => {
      if (!hhmm.test(String(b?.from || ""))) errors.push(`Crews row ${i + 1}: "from" must be HH:MM.`);
      if (!hhmm.test(String(b?.to || ""))) errors.push(`Crews row ${i + 1}: "to" must be HH:MM.`);
      const pts = num(b?.points);
      if (!Number.isFinite(pts) || pts < 0 || pts > 6) errors.push(`Crews row ${i + 1}: points must be 0-6.`);
      if (b?.wraps) wrapCount++;
    });
    // Exactly one band may cross midnight. Two would make the match order
    // ambiguous; none would leave the night hours unscored - and night is the
    // most fatiguing case, the one that must never fall through.
    if (wrapCount > 1) errors.push("Crews: only one band may cross midnight.");
  }

  const lim = c?.limits || {};
  for (const [k, label] of [["daily", "Daily limit"], ["twoDay", "Two-day limit"], ["weeklyDutyHours", "Weekly duty limit"]]) {
    const v = num(lim[k]);
    if (!Number.isFinite(v) || v <= 0) errors.push(`${label}: must be a positive number.`);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Has anything been changed away from the approved manual?
// ---------------------------------------------------------------------------
//
// Drives the warning banner. Compares by value, so re-typing a figure back to
// its OPS-CM-01 value correctly clears the warning.
export function isModified(c) {
  if (!c) return false;
  return JSON.stringify(normalise(c)) !== JSON.stringify(normalise(OPS_CM_01));
}

// Which sections differ - so the banner can say WHAT was changed, not just
// that something was.
export function modifiedSections(c) {
  if (!c) return [];
  const out = [];
  const a = normalise(c), b = normalise(OPS_CM_01);
  const labels = {
    dutyTime: "Flight Duty Time", sectors: "Sectors",
    flightsPerDay: "Flights per Day", crews: "Crews", limits: "Limits"
  };
  for (const k of Object.keys(labels)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(labels[k]);
  }
  return out;
}

// Numbers arriving from form inputs are strings ("7" vs 7), which would make a
// value-identical set of criteria compare as different and raise a false
// "modified" warning. Coerce before comparing.
function normalise(c) {
  const n = (v) => (v === "" || v === null || v === undefined ? v : Number(v));
  return {
    dutyTime: (c.dutyTime || []).map((r) => ({ atLeast: n(r.atLeast), points: n(r.points) })),
    sectors: (c.sectors || []).map((r) => ({ atLeast: n(r.atLeast), points: n(r.points) })),
    flightsPerDay: Object.fromEntries(
      Object.entries(c.flightsPerDay || {}).map(([k, v]) => [String(n(k)), n(v)])
    ),
    crews: (c.crews || []).map((b) => ({
      crew: n(b.crew), points: n(b.points), from: b.from, to: b.to, wraps: !!b.wraps
    })),
    limits: {
      daily: n(c.limits?.daily),
      twoDay: n(c.limits?.twoDay),
      weeklyDutyHours: n(c.limits?.weeklyDutyHours)
    }
  };
}

// A one-line, human-readable summary of a change, for the audit log.
export function describeCriteriaChange(before, after) {
  const secs = [];
  const a = normalise(before || OPS_CM_01), b = normalise(after || OPS_CM_01);
  const labels = {
    dutyTime: "Flight Duty Time", sectors: "Sectors",
    flightsPerDay: "Flights per Day", crews: "Crews", limits: "Limits"
  };
  for (const k of Object.keys(labels)) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) secs.push(labels[k]);
  }
  if (!secs.length) return "No change";
  return `Changed: ${secs.join(", ")}`;
}
