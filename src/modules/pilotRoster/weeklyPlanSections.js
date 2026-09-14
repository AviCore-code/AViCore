// The fixed row structure of the weekly plan, shared by the page
// (WeeklySchedule.jsx), the Excel parser (weeklyPlanImport.js) and the
// database rows (sql/weekly-plan-setup.sql).
//
// It mirrors the source spreadsheet "SKL WeeklySchedulePlan 2026 (V3).xlsm",
// sheet "SKL Weekly Plan": a grid with one column per day and a fixed set of
// labelled row groups down the left. Each group here is a "section"; each
// line within a group is a "slot". A line crew is two slots because it's
// always a Captain + a Co-pilot flying together.
//
// `excelLabel` is the text that appears in column A of the sheet at the FIRST
// row of that group - that's how the importer finds each group's rows without
// hard-coding row numbers (the sheet has been re-cut several times and the
// row offsets have moved with it).

// `duty` describes when the line works.
//
// For a day crew the time quoted on the schedule is the **scheduled
// departure** (schDep), NOT the report time. Duty starts one hour earlier -
// the standard report buffer, dutyReportOffsetMinutes in the FTL settings
// (OPS-CM-01 7.9.2, same rule Daily Duty applies). So Crew 1 departing 06:30
// is on duty from 05:30, and the whole day-crew ladder is an hour earlier
// than the departure times suggest.
//
// This matters more than it looks: rest is measured to the REPORT time, and
// duty hours are counted from it, so getting it wrong understates every day
// crew by an hour.
//
// The night lines quote actual duty times, not a departure, so they carry
// `start` directly and no report buffer is applied.
export const WEEKLY_SECTIONS = [
  { key: "crew1", label: "Crew 1", excelLabel: "Crew 1", slots: 2, kind: "crew", duty: { schDep: "06:30", end: "17:30" } },
  { key: "crew2", label: "Crew 2", excelLabel: "Crew 2", slots: 2, kind: "crew", duty: { schDep: "07:00", end: "17:30" } },
  { key: "crew3", label: "Crew 3", excelLabel: "Crew 3", slots: 2, kind: "crew", duty: { schDep: "07:30", end: "17:30" } },
  { key: "crew4", label: "Crew 4", excelLabel: "Crew 4", slots: 2, kind: "crew", duty: { schDep: "08:00", end: "17:30" } },
  { key: "crew5", label: "Crew 5", excelLabel: "Crew 5", slots: 2, kind: "crew", duty: { schDep: "08:30", end: "17:30" } },
  { key: "crew6", label: "Crew 6", excelLabel: "Crew 6", slots: 2, kind: "crew", duty: { schDep: "09:00", end: "17:30" } },
  // "OPC Training" is in the source spreadsheet but is NOT a line here.
  // Removed at Capt. Weera's instruction: OPC is booked through Training
  // Monitor, not planned as a weekly row, and an always-empty row on the
  // board is noise. Training that does belong on the board goes in the
  // "Training" / "Night Training" rows below.
  {
    key: "nightStandby1",
    label: "Night Standby",
    sublabel: "17:30-05:30",
    // The Excel label still carries the old "/Duty Crew" wording, so the
    // importer must keep matching it - only the on-screen label changed.
    excelLabel: "Night Standby/Duty Crew",
    // Caption rows the SHEET puts directly under the group label. They are
    // part of this group, not the start of the next one, and the importer
    // skips them when clamping. Kept separate from `sublabel` on purpose:
    // renaming what we DISPLAY must never change what we MATCH in the file -
    // that coupling once truncated every night crew to a single pilot.
    excelSublabels: ["17:30-05:00 / 19:30-05:30", "17:30-05:30"],
    slots: 2,
    kind: "night",
    // Both pilots on this line must hold valid night currency.
    requiresNightCurrency: true,
    duty: { start: "17:30", end: "05:30", endsNextDay: true }
  },
  // "Night Standby Crew 2" (18:00-06:00) exists in the source spreadsheet but
  // is NOT planned here: there aren't enough pilots to man a second night
  // pair (the roster averages ~5 crews a day in total), so it was only ever
  // an empty row. Left out rather than shown permanently blank. If the fleet
  // grows, re-add it here with slots:2 and duty 18:00-06:00 and everything
  // else - import, checks, auto-fill - picks it up automatically.
  { key: "nightTraining", label: "Night Training", excelLabel: "NIGHT TRAINING", slots: 3, kind: "training" },
  { key: "training", label: "Training", excelLabel: "Training", slots: 2, kind: "training" },
  // OFF CREW is just a list of who is off that day - the order carries no
  // meaning. Four rows, matching the block in the source sheet (rows 18-21,
  // between "OFF CREW" and "NIGHT TRAINING"); the importer additionally
  // clamps every group to stop before the next labelled row, so a mis-set
  // count here can never swallow the group below it.
  { key: "off", label: "OFF Crew", excelLabel: "OFF CREW", slots: 4, kind: "off" }
];

export const SECTION_BY_KEY = new Map(WEEKLY_SECTIONS.map((s) => [s.key, s]));

// Minimum rest between the end of one duty and the report time of the next.
// Coming off the night line (ends 05:30) this puts the earliest next report
// at 17:30 - i.e. a night pilot can go straight back onto night, but cannot
// be given a day crew the following morning. Same rule in both directions.
export const MIN_REST_HOURS = 12;

const MS_PER_HOUR = 3600000;

function parseIsoDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function withTime(iso, hhmm, addDays = 0) {
  const [h, min] = String(hhmm || "00:00").split(":").map(Number);
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + addDays);
  d.setHours(h || 0, min || 0, 0, 0);
  return d;
}

// The real clock window a section occupies on a given date. Returns null for
// sections with no fixed hours (OFF Crew, ad-hoc Training), which therefore
// take no part in the rest calculation.
// reportOffsetMinutes is dutyReportOffsetMinutes from the FTL settings (60).
// A line quoted by SCHEDULED DEPARTURE reports that much earlier; a line
// quoted by duty time (the night lines) starts exactly as written.
export function dutyWindow(sectionKey, dateIso, reportOffsetMinutes = 60) {
  const section = SECTION_BY_KEY.get(sectionKey);
  if (!section?.duty) return null;
  const start = section.duty.schDep
    ? new Date(withTime(dateIso, section.duty.schDep).getTime() - reportOffsetMinutes * 60000)
    : withTime(dateIso, section.duty.start);
  return {
    start,
    end: withTime(dateIso, section.duty.end, section.duty.endsNextDay ? 1 : 0),
    schDep: section.duty.schDep ? withTime(dateIso, section.duty.schDep) : null
  };
}

// The time printed on the schedule for this line: the scheduled departure for
// a day crew, the duty start for a night line.
export function displayTime(sectionKey) {
  const section = SECTION_BY_KEY.get(sectionKey);
  return section?.duty?.schDep || section?.duty?.start || "";
}

export function restHoursBetween(previousEnd, nextStart) {
  if (!previousEnd || !nextStart) return null;
  return (nextStart.getTime() - previousEnd.getTime()) / MS_PER_HOUR;
}

// DUTY TIME a planned assignment is expected to consume - what the rolling
// 7/14/28-day limits are measured against.
//
// A day crew books its whole window. Crew 1 departs 06:30, so it REPORTS at
// 05:30 and books 05:30-17:30 = 12h - which is the single-duty-period maximum
// exactly. Night
// standby is 12 clock hours but only 25% is credited as duty (OPS-CM-01
// 7.9.2), so it books 3h. That single difference is why a pilot can sit
// night after night indefinitely while a pilot on day crews exhausts the
// 60h/7-day allowance in five Crew-1 duties - and it's why there is no separate
// "maximum consecutive nights" rule.
//
// If a night standby is called out, the FDP actually flown is added on top;
// planning can't know that ahead of time, so the plan books the 3h and the
// real number arrives later from Daily Duty.
export function plannedDutyHours(sectionKey, dateIso, stbyCreditPercent = 25, reportOffsetMinutes = 60) {
  const section = SECTION_BY_KEY.get(sectionKey);
  if (!section?.duty) return 0;
  const window = dutyWindow(sectionKey, dateIso, reportOffsetMinutes);
  if (!window) return 0;
  const clockHours = (window.end - window.start) / MS_PER_HOUR;
  if (section.kind === "night") return clockHours * (stbyCreditPercent / 100);
  return clockHours;
}

// Sections a pilot is actually WORKING in. Used for the double-booking check
// and for the "on duty but rostered off" warning - being listed under OFF
// Crew is not an assignment, so it's excluded.
export const WORKING_SECTION_KEYS = WEEKLY_SECTIONS
  .filter((s) => s.kind !== "off")
  .map((s) => s.key);

// Cells are written as "WJU(3)" in the sheet: the pilot's 3-letter code plus
// their experience level in brackets (see the "NIGHT CURRENT" sheet, column
// "Ex.Level"). Both parts are optional - a hand-typed cell is often just the
// bare code - so this never throws, it just returns what it could find.
export function parsePlanCell(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text === "-") return null;
  const match = text.match(/^([A-Za-z]{2,4})\s*(?:\((\d+)\))?$/);
  if (!match) return { code: text.toUpperCase(), level: null, unrecognized: true };
  return { code: match[1].toUpperCase(), level: match[2] ? Number(match[2]) : null };
}

export function formatPlanCell(code, level) {
  if (!code) return "";
  return level ? `${code}(${level})` : String(code);
}
