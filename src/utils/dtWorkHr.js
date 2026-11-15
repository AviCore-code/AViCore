// DT Work for HR (Reports): each pilot's roster code per day over a chosen
// period, with the day counts HR pays on - the web version of the "HR (3)"
// sheet in NEW Pilot Schedule 2026.xlsx. The sheet's formulas are
//   Normal DAYs    = days in the period - (X + SL + VL) - OVER TIME DAYs
//   OVER TIME DAYs = count of OT + OTS
//   Total          = Normal DAYs + OVER TIME DAYs
// Capt. Weera (15 Nov 2026): "ไม่นับ X, x, SL, VL นอกนั้นนับหมด" - every
// roster code is a work day EXCEPT X (any case, also "O,X"), SL and VL, as in
// the sheet. OT / OTS go to OVER TIME DAYs.
// A day with NO roster code is not counted (the sheet counts a blank, which
// gave pilots with an empty roster 31 days); pilots with no roster at all in
// the period are left out.

import { periodDays } from "./ftMonthlyHr.js";

const parts = (raw) => String(raw || "").toUpperCase().split(",").map((p) => p.trim()).filter(Boolean);

export function classifyDay(raw) {
  const p = parts(raw);
  if (!p.length) return "blank";
  if (p.includes("OT") || p.includes("OTS")) return "ot";
  if (p.includes("X") || p.includes("SL") || p.includes("VL")) return "off";
  return "normal";
}

// rosterRows: listRoster({ from, to }) rows - { pilot_code, pilot_name, date, code }.
export function buildDtWorkHr(rosterRows, from, to) {
  const days = periodDays(from, to);
  const inRange = new Set(days);
  const byPilot = new Map();
  for (const r of rosterRows || []) {
    const code = String(r.pilot_code || r.pilotCode || "").trim().toUpperCase();
    if (!code || !inRange.has(r.date) || !String(r.code || "").trim()) continue;
    if (!byPilot.has(code)) byPilot.set(code, { code, name: String(r.pilot_name || r.pilotName || "").trim(), byDate: new Map() });
    const p = byPilot.get(code);
    if (!p.name && (r.pilot_name || r.pilotName)) p.name = String(r.pilot_name || r.pilotName).trim();
    p.byDate.set(r.date, String(r.code).trim().toUpperCase());
  }
  const pilots = [...byPilot.values()]
    .sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code))
    .map((p, i) => {
      const perDay = days.map((d) => p.byDate.get(d) || "");
      let normal = 0;
      let ot = 0;
      for (const c of perDay) {
        const k = classifyDay(c);
        if (k === "normal") normal++;
        else if (k === "ot") ot++;
      }
      return { no: i + 1, code: p.code, name: p.name, perDay, normal, ot, total: normal + ot };
    });
  return { days, pilots };
}

// Rows for an Excel sheet laid out like HR (3).
export function dtWorkHrSheetRows(report, { dayLabel, from, to }) {
  return [
    ["", "", "Start", dayLabel(from)],
    ["", "", "End", dayLabel(to)],
    ["No.", "Name", "Code", ...report.days.map(dayLabel), "Normal DAYs", "OVER TIME DAYs", "Total"],
    ...report.pilots.map((p) => [p.no, p.name, p.code, ...p.perDay, p.normal, p.ot, p.total]),
    [],
    [],
    ["", "Approved by ______________________________ (FOM)"]
  ];
}
