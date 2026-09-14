// Training pairings: "this pilot must fly with this instructor until this
// date".
//
// Line training, a return to line after a long absence, a post-OPC
// consolidation - all of them mean a particular pilot has to be crewed with
// a particular person, or at least with *an* instructor, for a while. That
// isn't a standing rule, it's a temporary instruction with an end date, so
// it's entered as data rather than written into the planner.
//
// Stored in app_settings under "weekly_plan_training_pairs" (so it syncs to
// every device like the FTL limits do, with no schema change), as:
//
//   [{ pilotCode, withCode, from, to, note }]
//
// withCode may be a specific pilot's code, or ANY_INSTRUCTOR to mean "any
// instructor will do". Directives expire on their own - once `to` has passed
// the pilot goes back to being planned normally, with nothing to remember to
// delete.

export const TRAINING_PAIRS_SETTING_KEY = "weekly_plan_training_pairs";
export const ANY_INSTRUCTOR = "ANY_INSTRUCTOR";

// An instructor is a pilot who holds TRI or TRE hours on their Pilot
// Experience record - the company already records those in the Specialty
// Hours table, so there is no new field to maintain and no list to keep in
// step. TRI = Type Rating Instructor, TRE = Type Rating Examiner.
export function isInstructorFromSpecialty(specialtyRows) {
  for (const row of specialtyRows || []) {
    const label = String(row?.label ?? row?.[0] ?? "").toUpperCase().trim();
    if (label !== "TRI" && label !== "TRE") continue;
    const hours = Number(row?.current ?? row?.currentDecimal ?? 0);
    if (hours > 0) return true;
  }
  return false;
}

export function normalizePair(entry) {
  if (!entry) return null;
  const pilotCode = String(entry.pilotCode || "").toUpperCase().trim();
  if (!pilotCode) return null;
  const withCode = String(entry.withCode || ANY_INSTRUCTOR).toUpperCase().trim();
  return {
    pilotCode,
    withCode: withCode === ANY_INSTRUCTOR ? ANY_INSTRUCTOR : withCode,
    from: entry.from || "",
    to: entry.to || "",
    note: entry.note || ""
  };
}

export function activePairsOn(pairs, iso) {
  return (pairs || [])
    .map(normalizePair)
    .filter(Boolean)
    .filter((p) => (!p.from || iso >= p.from) && (!p.to || iso <= p.to));
}

// Does this crew satisfy the directive on `pilotCode`?
//   mates       - the other pilots already seated on the line
//   instructors - Set of codes that hold TRI/TRE hours
//
// An empty crew (the pilot is the first into the line) can't be judged yet -
// it returns `pending`, and the requirement is enforced when the second seat
// is filled instead. That way a trainee may still be placed first without
// the planner having to look ahead.
export function checkTrainingPair({ pilotCode, mates, pairs, iso, instructors }) {
  const active = activePairsOn(pairs, iso).filter((p) => p.pilotCode === pilotCode);
  if (!active.length) return { required: false, ok: true };

  if (!mates?.length) return { required: true, ok: true, pending: true, directives: active };

  for (const directive of active) {
    const satisfied = directive.withCode === ANY_INSTRUCTOR
      ? mates.some((m) => instructors?.has?.(m))
      : mates.includes(directive.withCode);
    if (!satisfied) {
      return {
        required: true,
        ok: false,
        directive,
        reason: directive.withCode === ANY_INSTRUCTOR
          ? `${pilotCode} must fly with an instructor until ${directive.to || "further notice"}${directive.note ? ` (${directive.note})` : ""}`
          : `${pilotCode} must fly with ${directive.withCode} until ${directive.to || "further notice"}${directive.note ? ` (${directive.note})` : ""}`
      };
    }
  }
  return { required: true, ok: true, directives: active };
}

// Same question asked from the other side: a candidate joining a line where
// somebody already seated is under a directive.
export function crewSatisfiesSeatedDirectives({ candidate, seated, pairs, iso, instructors }) {
  for (const mate of seated || []) {
    const result = checkTrainingPair({
      pilotCode: mate,
      mates: [candidate],
      pairs,
      iso,
      instructors
    });
    if (result.required && !result.ok) return result;
  }
  return { required: false, ok: true };
}
