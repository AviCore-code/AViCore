// Date ranges for the logbook's Print / Export.
//
// Split out of MyLogbook.jsx so the maths can be tested without dragging in the
// component's Capacitor/database imports - and because these spans end up on a
// document a pilot hands to a regulator for a licence renewal, so they are
// worth testing directly.
//
// Capt. Weera asked for a selectable number of months up to 36, counted either
// back from today or to month ends ("นับจากวันนี้ ย้อนหลังไป หรือ เลือกติ๊ก
// end of month"). Those are two genuinely different documents:
//
//   Whole months   1 Jan - 31 Mar. Complete months, so the monthly subtotals
//                  are real monthly totals. What a renewal or an audit asks for.
//   To today       29 Apr back to 30 Jan. Ends today; its first month is a
//                  PART month, so the first subtotal is not a full month -
//                  correct for "my hours over the last 3 months", wrong to hand
//                  to an auditor as a monthly return.

export const MAX_EXPORT_MONTHS = 36;
export const DEFAULT_EXPORT_MONTHS = 12;

// One-press presets. 12M is the default because it is what a renewal asks for;
// anything else up to 36 is typed into the box beside them.
export const RANGE_PRESETS = [
  { months: 3, label: "3M" },
  { months: 6, label: "6M" },
  { months: 12, label: "12M" },
  { months: 24, label: "24M" },
  { months: 36, label: "36M" }
];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The last N WHOLE months up to and including the current one. Anchored to
// month boundaries so the first and last pages are complete months and the
// monthly subtotals mean something.
export function lastWholeMonths(n, todayDate = new Date()) {
  const now = todayDate;
  const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of this month
  return { from: iso(start), to: iso(end) };
}

// The same N months counted back from TODAY.
export function lastMonthsToToday(n, todayDate = new Date()) {
  const now = todayDate;
  const d = now.getDate();

  // Step back n months, CLAMPING the day to the target month's length.
  //
  // `new Date(y, m - n, d + 1)` looks right and is not: on 31 March, month-1
  // day-32 overflows into April and "1 month back" came out as 4 March - a
  // 27-day "month" on a legal record. The same trap catches the 29th/30th/31st
  // of any month whose predecessor is shorter, and bites hardest at 31 March
  // because February is the shortest month.
  const targetMonth = new Date(now.getFullYear(), now.getMonth() - n, 1);
  const daysInTarget = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  const start = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(d, daysInTarget));
  start.setDate(start.getDate() + 1);   // the day AFTER, so both ends are inclusive

  return { from: iso(start), to: iso(now) };
}

export function rangeForMonths(n, wholeMonths, todayDate = new Date()) {
  return wholeMonths
    ? lastWholeMonths(n, todayDate)
    : lastMonthsToToday(n, todayDate);
}

// Clamped rather than validated on submit: 36 months is the agreed ceiling, and
// a silently-accepted 120 would produce a document that looks official and
// covers a span nobody asked for.
export function clampMonths(v) {
  return Math.max(1, Math.min(MAX_EXPORT_MONTHS, Math.round(Number(v) || 1)));
}

// The default filename for an exported logbook PDF.
//
// Capt. Weera: "ให้ default ชื่อไฟล์ ตาม code 3 ตัวชื่อ พร้อมกับจำนวนเดือน".
// So: PDE_12M_Logbook.pdf
//
// The END DATE is kept on the name as well. Two 12-month extracts taken in
// different months are different documents with identical hours-to-date
// nowhere in the title, and a folder of "PDE_12M_Logbook.pdf" copies with
// (1), (2), (3) appended is unusable as a record - the reader cannot tell
// which is current without opening each one. Ending it with the last date
// covered also sorts the folder chronologically.
//
//   PDE_12M_to_2026-07-31.pdf      whole calendar months
//   PDE_12M_to_2026-07-29.pdf      counted back from today
//
// The mode is not spelled out in the name because the date already implies it
// (a month end vs a mid-month date), and the document's own header states the
// exact span.
export function logbookFileName(pilotCode, months, wholeMonths, range) {
  // Sanitise the CODE only, then fall back - doing it the other way round
  // upper-cased the fallback into "LOGBOOK".
  const code = String(pilotCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "Logbook";
  const n = clampMonths(months);
  const end = range?.to || "";
  return end ? `${code}_${n}M_to_${end}.pdf` : `${code}_${n}M.pdf`;
}
