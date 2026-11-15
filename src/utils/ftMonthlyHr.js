// FT Monthly for HR (Reports): each pilot's flight time per day over a
// chosen period, with the period total - the web version of the
// "FT Monthly For HR" sheet in UOA PilotFlightTime_Monitor 2026.xlsm, which
// HR uses for the monthly flight-pay run. Capt. Weera: no fleet total or
// averages under the table - a signature block for the FOM / CP instead.
//
// The sheet: start date in B1, one column per day (start .. start+30), each
// cell = that day's flight time from the pilot's FDT file (DT sheet), Total
// Hrs = the sum (the sheet also has two average figures under the table,
// left out here). Here the admin picks both the start AND the end.
//
// Flight time is summed in whole MINUTES, entry by entry, the way the FDT
// file adds HH:MM values - summing decimal hours and rounding at the end can
// drift a minute from the sheet.

import { entryFlightHours } from "./statusCompute.js";

export const HR_MAX_DAYS = 62;

const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function isoAddDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
}

// The usual HR period: the 16th of last month to the 15th of this month.
export function defaultHrPeriod(today = new Date()) {
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 16);
  const to = new Date(today.getFullYear(), today.getMonth(), 15);
  return { from: isoOf(from), to: isoOf(to) };
}

export function periodDays(from, to) {
  if (!from || !to || from > to) return [];
  const out = [];
  for (let d = from; d <= to && out.length < HR_MAX_DAYS; d = isoAddDays(d, 1)) out.push(d);
  return out;
}

export const minutesToHhmm = (m) => `${Math.floor(Math.max(0, m) / 60)}:${pad(Math.round(Math.max(0, m) % 60))}`;

// rows: loadAllPilotStatusRows().rows ({ pilot, entries }), already in name order.
export function buildFtMonthlyHr(rows, from, to) {
  const days = periodDays(from, to);
  const inRange = new Set(days);
  const pilots = (rows || []).map(({ pilot, entries }, i) => {
    const byDate = new Map();
    for (const e of entries || []) {
      if (e?.dutyType !== "flight" || !inRange.has(e.date)) continue;
      byDate.set(e.date, (byDate.get(e.date) || 0) + Math.round(entryFlightHours(e) * 60));
    }
    const perDay = days.map((d) => byDate.get(d) || 0);
    return {
      no: i + 1,
      code: pilot?.code || "",
      name: pilot?.name || "",
      perDay,
      total: perDay.reduce((a, b) => a + b, 0)
    };
  });
  return { days, pilots };
}

// Rows for an Excel sheet laid out like the original (times as H:MM text).
export function ftMonthlyHrSheetRows(report, { dayLabel }) {
  const head1 = ["No.", "NAME", "CODE", "Hours", ...report.days.map((_, i) => i + 1), "Total Hrs."];
  const head2 = ["", "", "", "", ...report.days.map(dayLabel), ""];
  const body = report.pilots.map((p) => [p.no, p.name, p.code, minutesToHhmm(p.total), ...p.perDay.map(minutesToHhmm), minutesToHhmm(p.total)]);
  return [
    head1,
    head2,
    ...body,
    [],
    [],
    ["", "Signature ____________________________"],
    ["", "( ____________________________ )"],
    ["", "Position  FOM / CP"],
    ["", "Date ____ / ____ / ________"]
  ];
}
