// Shared helpers for Report B (Monthly Flight Time / Pilot Recency) - month-
// scoped sums, distinct from experienceCombine.js's baseline+since-update-
// date combine pattern used elsewhere in this app.

function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}

// "YYYY-MM" -> {from: "YYYY-MM-01", to: "YYYY-MM-<lastDay>"}, both inclusive
// ISO date strings - safe to compare lexically against entry.date.
export function singleMonthRange(month) {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

// Sums a pilot's flight entries for one role, split Day/Night, restricted to
// entries whose date falls within [from, to] inclusive.
export function monthRoleHoursDayNight(dutyEntries, role, from, to) {
  let day = 0, night = 0;
  for (const e of dutyEntries || []) {
    if (e.dutyType !== "flight" || e.date < from || e.date > to) continue;
    for (const r of e.roles || []) {
      if (r.role !== role) continue;
      day += hhmmToDecimal(r.dayHours);
      night += hhmmToDecimal(r.nightHours);
    }
  }
  return { day, night };
}

// FT(AW139) monthly column: sum of totalFlightTime for in-month flights on
// the given aircraft type specifically (not all types combined).
// Whitespace-insensitive match (e.g. "AW 139" vs "AW139") - see normalizeType
// in experienceCombine.js for why a plain exact match isn't safe here.
function normalizeType(v) {
  return (v || "").replace(/\s+/g, "").toUpperCase();
}
export function monthFtOnType(dutyEntries, aircraftType, from, to) {
  const type = normalizeType(aircraftType);
  return (dutyEntries || [])
    .filter((e) => e.dutyType === "flight" && e.date >= from && e.date <= to && normalizeType(e.aircraftType) === type)
    .reduce((sum, e) => sum + hhmmToDecimal(e.totalFlightTime), 0);
}
