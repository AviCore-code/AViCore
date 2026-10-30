// How many flights one saved Flight Duty entry stands for.
//
// Since the Daily Duty form takes "Flights / Day" first and opens one row per
// flight, a single entry can hold several flights in `legs` (each with its own
// Flight Type, A/C Type, Registration, RS/LS and Route). Anything that counts
// flights - the Fatigue Monitor's "Flights per Day" score, FDT Statistics -
// must count those rows, not the entry. Entries without legs (FDT imports,
// entries saved before legs existed) are one flight each, as before.
export function entryFlightCount(entry) {
  if (!entry || entry.dutyType !== "flight") return 0;
  const legs = Array.isArray(entry.legs) ? entry.legs : [];
  return legs.length > 0 ? legs.length : 1;
}

// Flight types flown in an entry, in leg order without repeats - for display
// ("Revenue Flight / Training"). Falls back to the entry-level flightType.
export function entryFlightTypes(entry) {
  const legs = Array.isArray(entry?.legs) ? entry.legs : [];
  const types = legs.map((l) => l?.flightType).filter(Boolean);
  const list = types.length ? types : [entry?.flightType].filter(Boolean);
  return [...new Set(list)];
}
