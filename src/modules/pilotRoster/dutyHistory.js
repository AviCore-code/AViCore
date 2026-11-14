// Duty & Flight History - the numbers behind the Pilot Roster tab of the
// same name: what each pilot has actually flown and been on duty, day by day,
// and how much they can still be given over the coming week.
//
// Built on exactly the same calculations as FDT Monitor so the two can never
// disagree:
//   * flight time per day  = entryFlightHours, keyed by the entry's date
//   * duty time per day    = buildDutyPeriods + periodDutyCreditHours, keyed by
//                            the period's report day (as computeStats does)
//   * rolling totals       = computeStats as of today
// The forward view counts RECORDED flying only - nothing is invented for the
// future - so "FT left" on a coming day is what the 7/28/365-day limits still
// allow once older flights have dropped out of each window.

import { computeStats, entryFlightHours, classify } from "../../utils/statusCompute.js";
import { buildDutyPeriods, periodDutyCreditHours, checkRecoveryRest168 } from "../../utils/dutyPeriods.js";
import { isoAddDays, rollingSum } from "./weeklyPlanHeadroom.js";
import { CODE_LEGEND_MAP } from "./rosterCodes.js";

export const FT_WINDOWS = [
  { key: "ft7d", days: 7, label: "FT 7D" },
  { key: "ft28d", days: 28, label: "FT 28D" },
  { key: "ft365d", days: 365, label: "FT 365D" }
];
export const DT_WINDOWS = [
  { key: "dt7d", days: 7, label: "DT 7D" },
  { key: "dt14d", days: 14, label: "DT 14D" },
  { key: "dt28d", days: 28, label: "DT 28D" }
];

const NON_FLIGHT_SHORT = {
  "Day Standby": "DSB", "Night Standby": "NSB", "Positioning": "POS",
  "Ground Training": "GT", "Meeting": "MTG", "Travel": "TRV",
  "Office": "OFF", "Ground Run": "GR", "Other": "OTH"
};

export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Days from (todayIso - count + 1) through todayIso, oldest first.
export function pastDays(todayIso, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(isoAddDays(todayIso, -i));
  return out;
}

export function nonFlightShort(type) {
  return NON_FLIGHT_SHORT[type] || String(type || "").slice(0, 3).toUpperCase();
}

// One pilot's history. entries: that pilot's duty entries (any dates).
export function pilotHistory(entries, limits, { todayIso, asOf = new Date(), aheadDays = 7, rosterDays = null }) {
  const flightByDate = new Map();
  const nonFlightTypes = new Map();     // iso -> Set of non-flight types
  for (const e of entries || []) {
    if (!e?.date) continue;
    if (e.dutyType === "flight") {
      flightByDate.set(e.date, (flightByDate.get(e.date) || 0) + entryFlightHours(e));
    } else if (e.dutyType === "non_flight") {
      if (!nonFlightTypes.has(e.date)) nonFlightTypes.set(e.date, new Set());
      nonFlightTypes.get(e.date).add(e.nonFlightType || "Other");
    }
  }

  const dutyByDate = new Map();
  for (const p of buildDutyPeriods(entries || [], limits)) {
    const key = localIso(p.start);
    dutyByDate.set(key, (dutyByDate.get(key) || 0) + periodDutyCreditHours(p, limits));
  }

  const day = (iso) => {
    const ft = flightByDate.get(iso) || 0;
    const dt = dutyByDate.get(iso) || 0;
    const types = [...(nonFlightTypes.get(iso) || [])];
    return {
      ft, dt,
      flew: ft > 0 || flightByDate.has(iso),
      nonFlight: types.map(nonFlightShort),
      nonFlightFull: types
    };
  };

  const stats = computeStats(entries || [], limits, asOf);
  const totals = [...FT_WINDOWS, ...DT_WINDOWS].map((w) => {
    const used = stats[w.key] || 0;
    const limit = limits?.[w.key];
    return {
      key: w.key, label: w.label, used,
      max: limit?.max ?? null,
      left: limit?.max != null ? limit.max - used : null,
      status: limit ? classify(used, limit) : "ok"
    };
  });

  const cycle = cycleDeadline(entries || [], limits, asOf);

  // For each coming day: flight time and duty time still allowed (the
  // tightest window of each, recorded history only) and the 168h cycle.
  const ahead = [];
  for (let i = 1; i <= aheadDays; i++) {
    const iso = isoAddDays(todayIso, i);
    const ft = windowLeft(flightByDate, FT_WINDOWS, limits, iso);
    const dt = windowLeft(dutyByDate, DT_WINDOWS, limits, iso);
    const rr = cycleOnDayWithRoster(cycle, iso, limits, rosterDays, todayIso);
    ahead.push({
      iso,
      left: ft.left, ftStatus: ft.status,           // `left` kept for FT (older callers)
      dtLeft: dt.left, dtStatus: dt.status,
      cycle: rr,
      status: worst([ft.status, dt.status, rr.status])
    });
  }

  // Hours left in EACH window at the start of `iso` (recorded duty only) -
  // used by the sim-training check, which needs the per-window figures.
  const leftOn = (iso) => ({
    ft: perWindowLeft(flightByDate, FT_WINDOWS, limits, iso),
    dt: perWindowLeft(dutyByDate, DT_WINDOWS, limits, iso)
  });

  return { day, totals, ahead, cycle, leftOn };
}

function perWindowLeft(byDate, windows, limits, iso) {
  const out = {};
  for (const w of windows) {
    const limit = limits?.[w.key];
    if (limit?.max == null) continue;
    out[w.key] = limit.max - rollingSum(byDate, iso, w.days);
  }
  return out;
}

// --- Remark: what the published roster says about the coming week ---------
//
// The Next-7-days numbers say what the LIMITS allow; the roster says whether
// the pilot is even there. Lists every block of non-duty days (RR, OFF, leave,
// training...) that touches the next 7 days, with the block's FULL length -
// an OFF block that started yesterday and runs past the window still reads
// "OFF 13–19/11 (7d)", which is how the 21/7 pattern is talked about.

// How far either side of the window to look, so a block's real length shows.
export const REMARK_LOOKBACK_DAYS = 13;
export const REMARK_LOOKAHEAD_DAYS = 35;

// Codes no longer offered but still on older imported months (rosterCodes.js
// LEGACY_CODES): N / ND read as duty days, T as training.
const RETIRED_CODES = { N: { category: "duty" }, ND: { category: "duty" }, T: { category: "training" } };

const REMARK_CATEGORY = { rest: "rest", off: "off", leave: "leave", training: "training", inspection: "training" };

// A roster cell -> { label, category } for the remark, or null for a plain
// duty day (O). "X" is shown as OFF (the word everyone uses); "O,X" is a
// compensate day OFF, so any X wins.
export function remarkLabel(raw) {
  const text = String(raw || "").trim().toUpperCase();
  if (!text) return null;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.includes("X")) return { label: "OFF", category: "off" };
  const info = parts.map((p) => ({ p, c: CODE_LEGEND_MAP.get(p) || RETIRED_CODES[p] }));
  const notDuty = info.filter(({ c }) => !c || c.category !== "duty");
  if (!notDuty.length) return null;
  const category = notDuty.map(({ c }) => REMARK_CATEGORY[c?.category]).find(Boolean) || "other";
  return { label: notDuty.map(({ p }) => p).join(","), category };
}

// Dates in the Remark read "15 Nov", never "15/11" (Capt. Weera: month as 3
// letters, not a number). A range in one month shares it: "15–16 Nov".
const MONTH3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMon = (iso) => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTH3.at(m - 1)}`; };
const dayMonRange = (from, to) => {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${dayMon(to)}`;
  return `${dayMon(from)}–${dayMon(to)}`;
};

// codeByDate: Map iso -> raw roster code for ONE pilot.
// Returns [{ label, category, from, to, days, text }] for blocks overlapping
// tomorrow .. tomorrow+aheadDays-1.
// Time away from the line: these run together into ONE chain, segment by
// segment - RR 2 -> OFF 7 -> VL, or VL -> OFF -> VL. The OFF part is often
// shorter than 7 days when the pilot takes OT, so a segment is shown at its
// real length, never assumed. Training days are not time off and stay
// separate items.
const AWAY = new Set(["rest", "off", "leave"]);

const segText = (s) => (s.days === 1 ? `${s.label} ${dayMon(s.from)}` : `${s.label} ${dayMonRange(s.from, s.to)} (${s.days}d)`);

// Returns the items that touch tomorrow .. tomorrow+aheadDays-1:
//   [{ segments:[{label, category, from, to, days, text}], from, to, days,
//     away: bool, continues: bool, text }]
// `continues` = the chain runs past the end of the roster read, so its
// length is "at least".
export function rosterRemark(codeByDate, todayIso, aheadDays = 7) {
  const first = isoAddDays(todayIso, 1 - REMARK_LOOKBACK_DAYS);
  const total = REMARK_LOOKBACK_DAYS + REMARK_LOOKAHEAD_DAYS;
  const last = isoAddDays(first, total - 1);
  const winStart = isoAddDays(todayIso, 1);
  const winEnd = isoAddDays(todayIso, aheadDays);

  // 1. Runs of the same label on consecutive days.
  const segs = [];
  let cur = null;
  for (let i = 0; i < total; i++) {
    const iso = isoAddDays(first, i);
    const lab = remarkLabel(codeByDate?.get(iso));
    if (lab && cur && cur.label === lab.label && cur.to === isoAddDays(iso, -1)) {
      cur.to = iso;
      cur.days++;
    } else {
      cur = lab ? { ...lab, from: iso, to: iso, days: 1 } : null;
      if (cur) segs.push(cur);
    }
  }

  // 2. Back-to-back time-away runs join into one chain.
  const items = [];
  for (const s of segs) {
    const prev = items.at(-1);
    const joins = prev?.away && AWAY.has(s.category) && isoAddDays(prev.to, 1) === s.from;
    if (joins) {
      prev.segments.push(s);
      prev.to = s.to;
      prev.days += s.days;
    } else {
      items.push({ segments: [s], from: s.from, to: s.to, days: s.days, away: AWAY.has(s.category) });
    }
  }

  return items
    .filter((it) => it.to >= winStart && it.from <= winEnd)
    .map((it) => {
      const segments = it.segments.map((s) => ({ ...s, text: segText(s) }));
      const continues = it.to === last;
      const total = segments.length > 1 ? ` · รวม ${it.days}${continues ? "+" : ""}d` : "";
      return { ...it, segments, continues, text: segments.map((s) => s.text).join(" → ") + total };
    });
}

// The RR pair that the 21/7 pattern puts immediately before the 7-day OFF
// block (Capt. Weera: "จัด RR 2 วัน ก่อน พัก 7 วัน"). Only THOSE RR days are
// flagged in red on the Next-7-days grid - an RR elsewhere in the cycle is an
// ordinary rest inside the work block, not the start of the pilot's time off.
// The OFF block is not required to be a full 7 days: a pilot who takes OT
// has a shorter OFF, and the RR pair before it is still the start of time
// off. A mid-cycle RR is followed by duty (O), not OFF, so it never matches.
// codeByDate: Map iso -> raw roster code. Returns a Set of iso dates.
export function preOffRrDays(codeByDate, { offMinDays = 1, rrDays = 2 } = {}) {
  const out = new Set();
  if (!codeByDate) return out;
  const isOff = (iso) => remarkLabel(codeByDate.get(iso))?.category === "off";
  const isRr = (iso) => (remarkLabel(codeByDate.get(iso))?.label || "").split(",").includes("RR");
  for (const iso of codeByDate.keys()) {
    if (!isOff(iso) || isOff(isoAddDays(iso, -1))) continue;   // only the first day of an OFF block
    let len = 0;
    while (len < offMinDays && isOff(isoAddDays(iso, len))) len++;
    if (len < offMinDays) continue;                            // a short OFF run is not "พัก 7 วัน"
    for (let k = 1; k <= rrDays; k++) {
      const d = isoAddDays(iso, -k);
      if (!isRr(d)) break;
      out.add(d);
    }
  }
  return out;
}

const RANK = { ok: 0, warn: 1, exc: 2 };
export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
}

// Hours still allowed on `iso` across a set of rolling windows: the smallest
// (max - used) of them, with ok / warn (past the caution line) / exc (none left).
function windowLeft(byDate, windows, limits, iso) {
  let left = Infinity;
  let warn = false;
  for (const w of windows) {
    const limit = limits?.[w.key];
    if (limit?.max == null) continue;
    const used = rollingSum(byDate, iso, w.days);
    left = Math.min(left, limit.max - used);
    if (limit.warn != null && used >= limit.warn) warn = true;
  }
  if (left === Infinity) return { left: null, status: "ok" };
  return { left: Math.max(0, left), status: left <= 0 ? "exc" : warn ? "warn" : "ok" };
}

// The 168h Duty Cycle (OPS-CM-01 7.12.4) from the same check FDT Monitor runs:
// a 36h / 2-local-night Recovery Rest must START within 168h of the end of the
// last one. Returns one of:
//   { kind: "none" }                      no duty records - nothing to say
//   { kind: "resting" }                   in a qualifying Recovery Rest now;
//                                         the next cycle starts at the next report
//   { kind: "unknown" }                   records exist but no Recovery Rest in them
//   { kind: "running", deadline: Date }   the rest must start before `deadline`
export function cycleDeadline(entries, limits, asOf) {
  if (!entries.length) return { kind: "none" };
  const rr = checkRecoveryRest168(entries, limits, asOf);
  if (rr.ongoing) return { kind: "resting" };
  if (!rr.lastQualifyingRestEnd) return { kind: "unknown" };
  const maxH = limits?.recoveryRestCycleMaxHours ?? 168;
  return { kind: "running", deadline: new Date(rr.lastQualifyingRestEnd.getTime() + maxH * 3600000) };
}

// --- The roster's days away count as rest for the 168h cycle --------------
//
// Capt. Weera: VL, SL and the like are not duty - they are time off; and when
// a run of days off meets the Recovery Rest condition it IS a Recovery Rest.
// The recorded-duty check above only sees the past, so the coming week is
// read from the roster:
//   * a run of 2+ consecutive days that are not duty (RR, R, OFF/X, VL, SL…)
//     covers at least 36h and two local nights -> a Recovery Rest: those days
//     show "RR ✓" and a fresh 168h cycle starts the morning after the run;
//   * a single day off is short of 36h + 2 nights: the cycle runs on.
// Day-level, like the rest of the roster - it flags the week, it does not
// replace FDT Monitor's exact clock-time check on recorded duty.
export const RR_MIN_DAYS_OFF = 2;

function isAwayDay(rosterDays, iso) {
  const cat = remarkLabel(rosterDays?.get(iso))?.category;
  return cat === "rest" || cat === "off" || cat === "leave";
}

// The qualifying away-run that contains `iso`, as { from, to }, else null.
export function awayRunAt(rosterDays, iso, minDays = RR_MIN_DAYS_OFF) {
  if (!rosterDays || !isAwayDay(rosterDays, iso)) return null;
  let from = iso, to = iso;
  while (isAwayDay(rosterDays, isoAddDays(from, -1))) from = isoAddDays(from, -1);
  while (isAwayDay(rosterDays, isoAddDays(to, 1))) to = isoAddDays(to, 1);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return days >= minDays ? { from, to, days } : null;
}

// The 168h status on `iso` once the roster's rest is taken into account:
// inside a qualifying away-run -> RR ✓; after one (between it and `iso`) ->
// counted from the morning after the run; otherwise as recorded.
// Only roster rest that ends today or later counts: the past is what was
// actually flown, so a Recovery Rest found in the recorded duty (FDT) wins
// over an older roster run (KPO: roster RR 6-7 Nov, but the recorded rest
// 10 Nov 10:22 -> 12 Nov 07:30 restarted the cycle). When both give a
// deadline, the later one is the true one.
export function cycleOnDayWithRoster(cycle, iso, limits, rosterDays, todayIso = null) {
  if (!rosterDays) return cycleOnDay(cycle, iso, limits);
  const run = awayRunAt(rosterDays, iso);
  if (run) return { label: "RR ✓", hoursLeft: null, status: "ok", fromRoster: true };
  // The latest qualifying run that ended before this day (look back 14 days).
  for (let k = 1; k <= 14; k++) {
    const d = isoAddDays(iso, -k);
    if (todayIso && d < todayIso) break;
    const before = awayRunAt(rosterDays, d);
    if (before) {
      const [y, m, dd] = isoAddDays(before.to, 1).split("-").map(Number);
      const deadline = new Date(new Date(y, m - 1, dd, 0, 0, 0, 0).getTime() + (limits?.recoveryRestCycleMaxHours ?? 168) * 3600000);
      if (cycle?.kind === "running" && cycle.deadline > deadline) break;
      return { ...cycleOnDay({ kind: "running", deadline }, iso, limits), afterRosterRest: before.to };
    }
  }
  return cycleOnDay(cycle, iso, limits);
}

// Hours left in the cycle at the START of `iso`, if the pilot keeps working.
// warn once fewer hours remain than a Recovery Rest itself needs (36h): the
// rest has to begin that day or the next.
export function cycleOnDay(cycle, iso, limits) {
  if (cycle.kind === "none") return { label: "", hoursLeft: null, status: "ok" };
  if (cycle.kind === "resting") return { label: "RR ✓", hoursLeft: null, status: "ok" };
  if (cycle.kind === "unknown") return { label: "no RR", hoursLeft: null, status: "warn" };
  const [y, m, d] = iso.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const hoursLeft = (cycle.deadline - dayStart) / 3600000;
  const restH = limits?.recoveryRestMinHours ?? 36;
  const status = hoursLeft <= 0 ? "exc" : hoursLeft < restH ? "warn" : "ok";
  return { label: hoursLeft <= 0 ? "RR due" : `${Math.floor(hoursLeft)}h`, hoursLeft, status };
}


// --- Sim training: ready on the travel day? --------------------------------
//
// Capt. Weera: a pilot going to the simulator must arrive with at least 60h
// of DUTY and 12h of FLIGHT time still allowed, and the 168h cycle must last
// the whole trip. The roster marks the trip: "S/T" = the travel day (the
// first S/T starts the trip), "S" = sim days, a closing S/T = travel home.
// Looked for over the next 14 days. The app only checks and suggests - the
// admin and crew scheduler change the roster.
export const SIM_LOOKAHEAD_DAYS = 14;
export const SIM_MIN_DT_LEFT = 60;
export const SIM_MIN_FT_LEFT = 12;

const rosterParts = (raw) => String(raw || "").toUpperCase().split(",").map((p) => p.trim()).filter(Boolean);
const isSimTravel = (raw) => rosterParts(raw).includes("S/T");
const isSimDay = (raw) => { const p = rosterParts(raw); return p.includes("S") || p.includes("S/T"); };

// Trips that START in tomorrow .. tomorrow+lookahead-1:
// [{ from, to, days }] - from = the first S/T, to = the last S / S/T day of
// the run (the closing S/T included).
export function simTrips(rosterDays, todayIso, lookahead = SIM_LOOKAHEAD_DAYS) {
  const out = [];
  if (!rosterDays) return out;
  for (let i = 1; i <= lookahead; i++) {
    const iso = isoAddDays(todayIso, i);
    if (!isSimTravel(rosterDays.get(iso))) continue;
    if (isSimDay(rosterDays.get(isoAddDays(iso, -1)))) continue;   // inside a trip already
    let to = iso;
    let sawSim = false;
    for (;;) {
      const next = isoAddDays(to, 1);
      const raw = rosterDays.get(next);
      if (!isSimDay(raw)) break;
      to = next;
      if (rosterParts(raw).includes("S")) sawSim = true;
      else if (sawSim) break;                // the S/T after the sim days: travel home
    }
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86400000) + 1;
    out.push({ from: iso, to, days });
  }
  return out;
}

const fmtH = (h) => {
  const neg = h < 0;
  const m = Math.round(Math.abs(h) * 60);
  return `${neg ? "-" : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

// One trip checked against what the pilot has recorded plus the roster.
// history: pilotHistory(...) result (needs leftOn + cycle).
export function simReadiness(history, trip, limits, rosterDays, todayIso, {
  minDt = SIM_MIN_DT_LEFT, minFt = SIM_MIN_FT_LEFT
} = {}) {
  const { ft, dt } = history.leftOn(trip.from);
  const minOf = (o) => { const v = Object.values(o); return v.length ? Math.min(...v) : null; };
  const dtLeft = minOf(dt);
  const ftLeft = minOf(ft);
  const dtOk = dtLeft == null || dtLeft >= minDt;
  const ftOk = ftLeft == null || ftLeft >= minFt;

  // 168h at the START of the travel day must cover every day of the trip.
  const rr = cycleOnDayWithRoster(history.cycle, trip.from, limits, rosterDays, todayIso);
  const needH = trip.days * 24;
  const cycleOk = rr.hoursLeft == null ? rr.status === "ok" : rr.hoursLeft >= needH;

  // Duty on the roster in the 7 days before travel (from tomorrow): every
  // hour of it comes off the DT 7D figure the trip needs.
  const dutyBefore = [];
  for (let k = 7; k >= 1; k--) {
    const d = isoAddDays(trip.from, -k);
    if (d <= todayIso) continue;
    const raw = rosterDays?.get(d);
    if (!raw) continue;
    const cat = remarkLabel(raw)?.category;
    if (cat === "rest" || cat === "off" || cat === "leave") continue;
    dutyBefore.push({ iso: d, code: String(raw).trim() });
  }

  // Flight / duty time that can still be added before travel and keep the
  // trip's minimum (the tightest window).
  const dtSpare = dtLeft == null ? null : dtLeft - minDt;
  const ftSpare = ftLeft == null ? null : ftLeft - minFt;

  // First day (from travel, up to 21 days on) the recorded duty alone would
  // leave enough - "ready from" - for when the trip could move.
  let readyFrom = null;
  if (!dtOk || !ftOk) {
    for (let k = 1; k <= 21; k++) {
      const d = isoAddDays(trip.from, k);
      const l = history.leftOn(d);
      const dOk = (minOf(l.dt) ?? Infinity) >= minDt;
      const fOk = (minOf(l.ft) ?? Infinity) >= minFt;
      if (dOk && fOk) { readyFrom = d; break; }
    }
  }
  const dutyText = dutyBefore.map((x) => `${dayMon(x.iso)} ${x.code}`).join(", ");

  const notes = [];
  if (!dtOk) notes.push(`DT left ${fmtH(dtLeft)} on ${dayMon(trip.from)} - needs ${fmtH(minDt)}, short ${fmtH(minDt - dtLeft)} from duty already flown`);
  if (!ftOk) notes.push(`FT left ${fmtH(ftLeft)} on ${dayMon(trip.from)} - needs ${fmtH(minFt)}, short ${fmtH(minFt - ftLeft)} from flying already done`);
  if (readyFrom) notes.push(`Enough DT/FT from ${dayMon(readyFrom)} on recorded duty alone`);
  if (!cycleOk) {
    notes.push(rr.hoursLeft == null
      ? "168h: no Recovery Rest on record - check Daily Duty"
      : `168h: ${Math.max(0, Math.floor(rr.hoursLeft))}h left at travel, the trip needs ${needH}h - give a Recovery Rest (2+ days off) right before S/T`);
  }
  if (dutyBefore.length && (!dtOk || (dtSpare != null && dtSpare <= 0))) {
    notes.push(`Roster duty ${dutyText} in the 7 days before travel takes DT ${dtOk ? "below" : "further below"} ${fmtH(minDt)}`);
  } else if (dutyBefore.length) {
    notes.push(`Roster duty ${dutyText} before travel: keep it within ${fmtH(dtSpare)} DT${ftSpare != null ? ` and ${fmtH(ftSpare)} FT` : ""}`);
  }

  const status = !dtOk || !ftOk || !cycleOk ? "exc" : notes.length ? "warn" : "ok";
  return {
    trip, dtLeft, ftLeft, dtOk, ftOk, dtSpare, ftSpare,
    cycle: rr, cycleNeedHours: needH, cycleOk,
    dutyBefore, readyFrom, notes, status,
    tripText: trip.days > 1 ? `S/T ${dayMonRange(trip.from, trip.to)} (${trip.days}d)` : `S/T ${dayMon(trip.from)}`
  };
}
