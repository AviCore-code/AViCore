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

// One flight's "(h:mm)", optionally with the aircraft inside and the T/O /
// LDG count after it, as some pilots write Route Details:
//   "VTSH-RT15 (UOM 2:07 ) 2/2 / VTSH-AQP-RT15 (UOM 2:33) 1/1"
//   "VTSH-RT15 (2:17) 2/1 , RT15 (2:09) 2/1, IDUN (2:30 ) 1/0"
//   "VTSH-SDE (UOA 1:58) 1/1 , VTSH-SDE (UOA 1:56) 1/1"
const FLIGHT_TIME = /\(\s*(?:([A-Z]{2,4})\s+)?(\d{1,2})\s*[:;.]\s*(\d{2})\s*\)(?:\s*(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*[:;.]\d))?/g;

// Route Details -> one item per flight: { route, minutes, reg, to, ldg }.
// When "(h:mm)" times are written, each one closes a flight (the text up to
// the next single "/" or "," still belongs to it, e.g. "(2:09)-VTSH/");
// "n/n" right after the time is that flight's T/O / LDG. Without times, fall
// back to splitting on a single "/" (minutes etc. null).
export function parseRouteFlights(route) {
  const text = String(route || "").trim();
  if (!text) return [];
  const hits = [...text.matchAll(FLIGHT_TIME)];
  if (!hits.length) return splitRouteParts(text).map((r) => ({ route: r, minutes: null, reg: "", to: null, ldg: null }));
  const out = [];
  let start = 0;
  hits.forEach((m, i) => {
    const after = m.index + m[0].length;
    const nextStart = i + 1 < hits.length ? hits[i + 1].index : text.length;
    // This flight runs to the first separator after its time (before the next flight's time).
    const rest = text.slice(after, nextStart);
    const sep = rest.search(/(?<!\/)\/(?!\/)|,/);
    const end = sep >= 0 && i + 1 < hits.length ? after + sep : (i + 1 < hits.length ? after : text.length);
    const raw = text.slice(start, end);
    out.push({
      route: raw.replace(/^[\s,/]+|[\s,/]+$/g, "").replace(/^\d\.\s*/, "").trim(),
      minutes: Number(m[2]) * 60 + Number(m[3]),
      reg: m[1] || "",
      to: m[4] != null ? Number(m[4]) : null,
      ldg: m[5] != null ? Number(m[5]) : null
    });
    start = sep >= 0 && i + 1 < hits.length ? after + sep + 1 : end;
  });
  return out;
}

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
  const total = day.totalMin || 0;
  const parts = parseRouteFlights(day.route);
  const timed = parts.length > 1 && parts.every((p) => p.minutes != null) && Math.abs(parts.reduce((a, p) => a + p.minutes, 0) - total) <= 1;
  // Flights = RS/LS pairs; when Route Details clearly lists more flights,
  // each with its time and adding up to the day, use those (the extra
  // flights keep the last pair - same crew).
  const n = Math.max(1, crew.length, timed ? parts.length : 0);
  while (crew.length && crew.length < n) crew.push({ ...crew[crew.length - 1] });
  const routes = parts.length === n ? parts.map((p) => p.route) : [String(day.route || "").trim(), ...Array(n - 1).fill("")];

  const times = parts.length === n ? parts.map((p) => p.minutes) : null;
  const perFlight = n > 1 && times && times.every((t) => t != null) && Math.abs(times.reduce((a, b) => a + b, 0) - total) <= 1;
  let mins = perFlight ? times.slice() : [total, ...Array(n - 1).fill(0)];
  if (perFlight) mins[n - 1] += total - mins.reduce((a, b) => a + b, 0);   // absorb a 1-minute rounding gap

  const regs = splitRegistrations(day.registration);
  // "(UOM 2:07)" names the aircraft of that flight: HS-UOM.
  const prefix = (regs[0] || "HS-").replace(/[A-Z0-9]+$/, "") || "HS-";
  const regAt = (i) => (parts.length === n && parts[i]?.reg ? prefix + parts[i].reg : regs[Math.min(i, regs.length - 1)] || "");

  // T/O and LDG per flight from "n/n" after each time, used only when every
  // flight has one and they add up to the day's T/O and LDG (day only or
  // night only - a mixed day keeps the counts on flight 1).
  const sumOf = (k) => parts.reduce((a, p) => a + (p[k] ?? 0), 0);
  const nn = (v) => Number(v) || 0;
  const countsPerFlight = parts.length === n && n > 1 && parts.every((p) => p.to != null && p.ldg != null) &&
    sumOf("to") === nn(day.toDay) + nn(day.toNight) && sumOf("ldg") === nn(day.landDay) + nn(day.landNight);
  const perLeg = (i, k, dayKey, nightKey) => {
    if (!countsPerFlight) return { [dayKey]: i === 0 ? count(day[dayKey]) : "", [nightKey]: i === 0 ? count(day[nightKey]) : "" };
    if (!nn(day[nightKey])) return { [dayKey]: count(parts[i][k]), [nightKey]: "" };
    if (!nn(day[dayKey])) return { [dayKey]: "", [nightKey]: count(parts[i][k]) };
    return { [dayKey]: i === 0 ? count(day[dayKey]) : "", [nightKey]: i === 0 ? count(day[nightKey]) : "" };
  };

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
    ...perLeg(i, "to", "toDay", "toNight"),
    ...perLeg(i, "ldg", "landDay", "landNight"),
    iApp: i === 0 ? count(day.iApp) : ""
  }));
  return { legs, split: n === 1 || perFlight ? "per-flight" : "first-flight" };
}
