// Daily Duty - Pairing & Copy (Capt. Weera, 16 Nov 2026).
//
// The pilot entering a flight day (e.g. WJU) usually flew with someone else in
// the other seat (e.g. TYO). Instead of TYO typing the same day again:
//   - Copy: on Save, TYO gets the flights they flew WITH WJU, every field
//     copied except T/O, LDG and I.App (each pilot logs their own) and Role
//     (Captain by Experience rank = PIC, the other = SIC). Saved straight away,
//     marked pairCopy = { from: "WJU" }.
//   - Pairing Check: if TYO has already logged that day, nothing is
//     overwritten - both entries are shown side by side with differences
//     marked, and WJU can add / edit / delete / save TYO's flights (marked
//     pairEdit = { by: "WJU" }).
// Pure functions only - the screens are in PairingPanel.jsx.

import { totalsFromLegs, hhmmToMin } from "./legTotals.js";

// Each pilot logs their own take-offs, landings and approaches.
export const PAIR_NO_COPY = ["toDay", "toNight", "landDay", "landNight", "iApp"];

// Fields compared between the two pilots' copies of the same flight.
export const PAIR_COMPARE_FIELDS = [
  { f: "flightType", label: "Type" },
  { f: "aircraftType", label: "A/C" },
  { f: "registration", label: "Reg" },
  { f: "route", label: "Route" },
  { f: "dayHours", label: "Day", time: true },
  { f: "nightHours", label: "Night", time: true },
  { f: "ifrRulesHours", label: "IFR", time: true },
  { f: "ifrHours", label: "IMC", time: true },
  { f: "onshoreHours", label: "Onshore", time: true },
  { f: "offshoreHours", label: "Offshore", time: true }
];
export const PAIR_DAY_FIELDS = [
  { f: "schDep", label: "Sch Dep", time: true },
  { f: "stop", label: "Last Engine Stop", time: true }
];

export const upCode = (v) => String(v || "").trim().toUpperCase();

// "Captain", "Capt", "CPT", "Captain (TRI)" ... - anything else (FO, SFO,
// blank) is not a captain.
export const isCaptain = (position) => /capt|cpt/i.test(String(position || ""));

// The other seat of a flight, or "" when `me` isn't seated on it.
export function partnerOf(leg, me) {
  const m = upCode(me);
  const rs = upCode(leg?.rs);
  const ls = upCode(leg?.ls);
  if (!m) return "";
  if (rs === m && ls && ls !== m) return ls;
  if (ls === m && rs && rs !== m) return rs;
  return "";
}

// Partner code -> 0-based indexes of the flights flown with them, in order.
export function partnersOf(legs, me) {
  const out = new Map();
  (legs || []).forEach((leg, i) => {
    const p = partnerOf(leg, me);
    if (!p) return;
    if (!out.has(p)) out.set(p, []);
    out.get(p).push(i);
  });
  return out;
}

// Roles for a pair: the Captain (Experience rank) is PIC, the other SIC. Two
// captains (or two non-captains): the pilot entering is PIC.
export function pairRoles(me, partner, positions) {
  const pos = (c) => (positions instanceof Map ? positions.get(upCode(c)) : positions?.[upCode(c)]) || "";
  const capMe = isCaptain(pos(me));
  const capPartner = isCaptain(pos(partner));
  if (capPartner && !capMe) return { mine: "SIC", theirs: "PIC" };
  return { mine: "PIC", theirs: "SIC" };
}

// The entry-level fields that mirror the flights (same as the form does).
export function dayFieldsFromLegs(legs) {
  const list = legs || [];
  return {
    flightsPerDay: list.length ? String(list.length) : "",
    flightType: list[0]?.flightType || "",
    aircraftType: list[0]?.aircraftType || "",
    registration: list[0]?.registration || "",
    route: list.filter((l) => l.route).map((l) => l.route).join("/"),
    ...totalsFromLegs(list)
  };
}

// One of my flights as the partner's copy: same flight, their role, their own
// T/O, LDG and I.App left blank.
export function partnerLeg(leg, theirRole) {
  const out = { ...leg, role: theirRole };
  for (const f of PAIR_NO_COPY) out[f] = "";
  return out;
}

// The partner's whole entry for the day, built from mine.
export function buildPartnerEntry(entry, me, partner, legIndexes, theirRole, nowIso = new Date().toISOString()) {
  const { id: _id, pending: _p, pendingError: _pe, pairCopy: _pc, pairEdit: _ped, ...rest } = entry || {};
  const legs = (legIndexes || []).map((i) => partnerLeg(entry.legs[i], theirRole));
  return {
    ...rest,
    pilotCode: upCode(partner),
    legs,
    ...dayFieldsFromLegs(legs),
    pairCopy: { from: upCode(me), at: nowIso }
  };
}

const norm = (v, time) => (time ? (String(v ?? "").trim() === "" ? 0 : hhmmToMin(v)) : upCode(v));

// Compare my flights with a partner and theirs with me, flight by flight in
// order. Returns per-pair differing fields plus the flights only one side has.
export function comparePair(myLegs, theirLegs) {
  const n = Math.max(myLegs.length, theirLegs.length);
  const pairs = [];
  let diffCount = 0;
  for (let k = 0; k < n; k++) {
    const a = myLegs[k];
    const b = theirLegs[k];
    if (!a || !b) { pairs.push({ k, mine: a || null, theirs: b || null, diffs: [] }); diffCount++; continue; }
    const diffs = PAIR_COMPARE_FIELDS.filter((c) => norm(a[c.f], c.time) !== norm(b[c.f], c.time)).map((c) => c.f);
    // Who sat where must agree too (RS / LS swapped is a difference).
    if (upCode(a.rs) !== upCode(b.rs)) diffs.push("rs");
    if (upCode(a.ls) !== upCode(b.ls)) diffs.push("ls");
    diffCount += diffs.length;
    pairs.push({ k, mine: a, theirs: b, diffs });
  }
  return { pairs, diffCount };
}

export function compareDay(mine, theirs) {
  return PAIR_DAY_FIELDS.filter((c) => norm(mine?.[c.f], c.time) !== norm(theirs?.[c.f], c.time)).map((c) => c.f);
}
