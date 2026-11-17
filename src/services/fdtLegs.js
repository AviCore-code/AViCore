// FDT Excel import -> one Daily Duty row per flight (`legs`), Capt. Weera,
// 17 Nov 2026. The Logbook sheet keeps one row per day: who sat RS / LS on
// Flight 1-3 (cols D-I), one free-text Route Details cell (J) such as
//   "VTSH-EDRIL1-VTSH(2:22)/VTSH-RT17-VTSH(2:36)"
// and day totals for roles, IFR, IMC, off/onshore, T/O, LDG and I.App.
// Rules agreed with the Capt:
//   - Number of flights = RS/LS pairs filled in (none -> 1 flight).
//   - Route: split on a single "/" ("//" stays inside one flight's route);
//     when the parts don't match the flights, the whole text goes on flight 1.
//   - Flight time per flight = the "(h:mm)" in each route part, only when
//     every flight has one and they add up to the day's total; otherwise the
//     whole day's flight time goes on flight 1.
//   - IFR / IMC / Offshore / Onshore and Day / Night are shared out in
//     proportion to each flight's time; T/O, LDG and I.App (counts) go on
//     flight 1.
// The day totals themselves are untouched - legs only add the per-flight view.

const pad2 = (n) => String(n).padStart(2, "0");
export const minToHHMM = (m) => `${Math.floor(m / 60)}:${pad2(m % 60)}`;
export const hhmmToMin = (s) => {
  const m = String(s ?? "").trim().match(/^(\d+)[:;.](\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

// "1.VTSH-AQP-VTSH(2:20)/2. VTSH-QPS-VTSH(2:13)" -> two parts, numbering
// dropped. A single "/" separates flights; "//" is part of a route.
export function splitRouteParts(route) {
  const text = String(route || "").trim();
  if (!text) return [];
  let parts = text.split(/(?<!\/)\/(?!\/)/);
  // "1.VTSH-..(2:20)  2.VTSH-..(2:13)" written without a slash.
  if (parts.length === 1) parts = text.split(/\s+(?=\d\.\s*[A-Za-z])/);
  return parts.map((p) => p.trim().replace(/^\d\.\s*/, "").trim()).filter(Boolean);
}

// The "(h:mm)" flight time written in one route part, in minutes, or null.
export function partMinutes(part) {
  const m = String(part).match(/\((\d{1,2})[:;](\d{2})\)/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// "HS-UOL/N" -> ["HS-UOL", "HS-UON"]; "HS-UOK/D" -> ["HS-UOK", "HS-UOD"].
export function splitRegistrations(reg) {
  const parts = String(reg || "").split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return parts;
  const base = parts[0];
  return [base, ...parts.slice(1).map((s) => (s.length < base.length ? base.slice(0, base.length - s.length) + s : s))];
}

// Whole minutes shared out by weight, adding up exactly to `total`.
export function shareMinutes(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  if (!sum) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  // Largest remainders get the leftover minutes.
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

const count = (n) => (Number(n) > 0 ? String(n) : "");

/**
 * @param day {
 *   crew: [{rs, ls}], route, registration, flightType,
 *   roles: [{role, dayHours, nightHours}] (H:MM strings),
 *   totalMin, ifrRulesMin, ifrMin, offshoreMin, onshoreMin,
 *   toDay, toNight, landDay, landNight, iApp
 * }
 * @returns { legs, split: "per-flight" | "first-flight" }
 */
export function buildFdtLegs(day) {
  const crew = (day.crew || []).filter((c) => c.rs || c.ls);
  const n = Math.max(1, crew.length);
  const parts = splitRouteParts(day.route);
  const routes = parts.length === n ? parts : [String(day.route || "").trim(), ...Array(n - 1).fill("")];

  const total = day.totalMin || 0;
  const times = parts.length === n ? parts.map(partMinutes) : null;
  const perFlight = n > 1 && times && times.every((t) => t != null) && Math.abs(times.reduce((a, b) => a + b, 0) - total) <= 1;
  let mins = perFlight ? times.slice() : [total, ...Array(n - 1).fill(0)];
  if (perFlight) mins[n - 1] += total - mins.reduce((a, b) => a + b, 0);   // absorb a 1-minute rounding gap

  const regs = splitRegistrations(day.registration);
  const regAt = (i) => regs[Math.min(i, regs.length - 1)] || "";

  // Day / night: the day's split, in proportion to each flight's time.
  const roles = (day.roles || []).map((r) => ({ role: r.role, day: hhmmToMin(r.dayHours), night: hhmmToMin(r.nightHours) }));
  const dayTotal = roles.reduce((s, r) => s + r.day, 0);
  const nightTotal = roles.reduce((s, r) => s + r.night, 0);
  // Roles can overlap (TRI and PIC for the same flight), so use the day /
  // night ratio, not the role sums themselves.
  const dayPart = dayTotal + nightTotal ? Math.round((total * dayTotal) / (dayTotal + nightTotal)) : total;
  const dayMins = shareMinutes(dayPart, mins);
  const nightMins = mins.map((m, i) => Math.max(0, m - dayMins[i]));

  // Role per flight: one role all day -> every flight; several -> each flight
  // takes the role with the most time still left (an exact match first).
  const left = roles.map((r) => ({ role: r.role, min: r.day + r.night }));
  const roleFor = (m) => {
    if (left.length <= 1) return left[0]?.role || "PIC";
    const exact = left.find((r) => r.min === m && m > 0);
    const pick = exact || left.reduce((a, b) => (b.min > a.min ? b : a));
    pick.min -= m;
    return pick.role;
  };

  const ifrRules = shareMinutes(day.ifrRulesMin || 0, mins);
  const ifr = shareMinutes(day.ifrMin || 0, mins);
  const off = shareMinutes(day.offshoreMin || 0, mins);
  const on = shareMinutes(day.onshoreMin || 0, mins);

  const legs = mins.map((m, i) => ({
    flightType: day.flightType || "",
    aircraftType: "",
    registration: regAt(i),
    rs: (crew[i]?.rs || "").toUpperCase(),
    ls: (crew[i]?.ls || "").toUpperCase(),
    route: routes[i] || "",
    role: roleFor(m),
    dayHours: dayMins[i] ? minToHHMM(dayMins[i]) : "",
    nightHours: nightMins[i] ? minToHHMM(nightMins[i]) : "",
    ifrRulesHours: ifrRules[i] ? minToHHMM(ifrRules[i]) : "",
    ifrHours: ifr[i] ? minToHHMM(ifr[i]) : "",
    offshoreHours: off[i] ? minToHHMM(off[i]) : "",
    onshoreHours: on[i] ? minToHHMM(on[i]) : "",
    toDay: i === 0 ? count(day.toDay) : "",
    toNight: i === 0 ? count(day.toNight) : "",
    landDay: i === 0 ? count(day.landDay) : "",
    landNight: i === 0 ? count(day.landNight) : "",
    iApp: i === 0 ? count(day.iApp) : ""
  }));
  return { legs, split: n === 1 || perFlight ? "per-flight" : "first-flight" };
}
