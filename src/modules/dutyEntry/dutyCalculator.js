// Duty Time Calculator (Capt. Weera, 17 Nov 2026) - type only the start
// time and see the limits, as hours and as clock times. Nothing is saved.
//   1. Flight only        - start = report: Max FDP, Max flight time
//   2. Mixed Duty         - Ground -> Flight: report = ground start -1h;
//                           Flight -> Ground: start = report. Max DP = Max FDP.
//   3. Standby + Flight   - start = standby start; the limits depend on when
//                           the call comes, so a row per call-out time.
// Same rules as the app (maxFdpForReportTime / standbyReductionHours).

import { maxFdpForReportTime, standbyReductionHours } from "../../utils/dutyPeriods.js";

const isTime = (v) => /^\d{1,2}:\d{2}$/.test(String(v || "").trim());
const addH = (d, h) => new Date(d.getTime() + h * 3600000);

// "HH:MM" on `base` (a Date - its day is used).
export function atTime(base, hhmm) {
  if (!isTime(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);
}

// Limits for a duty reported at `report`, Max FDP optionally reduced.
export function limitsAtReport(report, limits, reduction = 0) {
  const row = maxFdpForReportTime(report, limits);
  const maxFdp = Math.max(0, row.maxFdp - reduction);
  const ext = limits.dutyPeriodUnforeseenExtensionHours ?? 2;
  return {
    report, maxFdp, maxFt: row.maxFt, tableFdp: row.maxFdp, reduction,
    fdpEnd: addH(report, maxFdp), extHours: ext, extEnd: addH(report, maxFdp + ext)
  };
}

// 1 + 2: one result. order: "flight" | "ground-flight" | "flight-ground".
export function calcFromStart(order, startHHMM, limits, base = new Date()) {
  const start = atTime(base, startHHMM);
  if (!start) return null;
  // Ground first: the flight's FDP starts at the ground duty -1h.
  const report = order === "ground-flight" ? addH(start, -(limits.dutyReportOffsetMinutes ?? 60) / 60) : start;
  return { start, ...limitsAtReport(report, limits) };
}

// 3: standby from `startHHMM`; one row per report time, every hour up to the
// standby maximum (12h). Call-out = report - response time (7.9.2(j), 1h).
// Call-out limits: the latest call-out at all (report by standby start +
// 12h), and the latest call-out that doesn't reduce Max FDP (found minute by
// minute, since a standby starting 23:00-07:00 doesn't count the night).
export function calcStandby(startHHMM, limits, base = new Date()) {
  const start = atTime(base, startHHMM);
  if (!start) return null;
  const maxStby = limits.standbyMaxHours ?? 12;
  const awakeEnd = addH(start, limits.standbyPlusFdpMaxAwakeHours ?? 18);
  const rows = [];
  for (let k = 1; k <= maxStby; k++) {
    const report = addH(start, k);
    const l = limitsAtReport(report, limits, standbyReductionHours(start, report, limits));
    // Standby + FDP (7.9.2(b)) may end the duty earlier than Max FDP.
    const capped = awakeEnd < l.fdpEnd;
    rows.push({ ...l, standbyHours: k, latestStop: capped ? awakeEnd : l.fdpEnd, cappedByAwake: capped });
  }
  const respH = (limits.standbyResponseTimeMinutes ?? 60) / 60;
  for (const r of rows) r.callout = addH(r.report, -respH);
  let freeReport = start;
  for (let m = 1; m <= maxStby * 60; m++) {
    const rep = new Date(start.getTime() + m * 60000);
    if (standbyReductionHours(start, rep, limits) > 0) break;
    freeReport = rep;
  }
  return {
    start, standbyEnd: addH(start, maxStby), awakeEnd, freeHours: limits.standbyFdpReductionFreeHours ?? 6, rows,
    responseHours: respH,
    latestCallout: addH(start, maxStby - respH), latestReport: addH(start, maxStby),
    freeCallout: addH(freeReport, -respH), freeReport
  };
}
