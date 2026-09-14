// Calendar-date helpers, all LOCAL.
//
// WHY THIS FILE EXISTS
//
// `new Date().toISOString().slice(0, 10)` is the obvious way to get "today as
// YYYY-MM-DD", and it is wrong everywhere east of Greenwich. toISOString()
// converts to UTC first, so in Asia/Bangkok (UTC+7) it returns YESTERDAY for
// the whole of the local morning:
//
//     local  Wed 29 Jul 2026 05:44
//     toISOString().slice(0,10)  ->  "2026-07-28"     <- a day behind
//
// Every duty record in this app is keyed by the pilot's LOCAL calendar day -
// a 05:30 report belongs to the day the pilot got up, not to the previous UTC
// day. Mixing the two conventions has already produced three separate bugs:
//
//   1. The Fatigue page bucketed duty periods by UTC day, so early Crew 1
//      duties landed on the wrong date (or fell out of the window entirely).
//   2. withinDays() compared a UTC-parsed entry date against a local midnight
//      cutoff, so "DT 7 days" quietly covered six - every rolling FTL total on
//      FDT Monitor, All Status and the Dashboard read LOW.
//   3. The Fatigue Monitor's "As of" box defaulted to the UTC day, so opening
//      the page before 07:00 showed yesterday and shifted the whole week.
//
// Each was found by Capt. Weera noticing a figure that disagreed with the
// company spreadsheet, not by a test. Hence one helper, used everywhere.

/** Today as "YYYY-MM-DD" in the user's own timezone. */
export function todayIso() {
  return toIsoDate(new Date());
}

/** Any Date (or date-ish value) as its LOCAL "YYYY-MM-DD". */
export function toIsoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Add (or subtract) whole days to a "YYYY-MM-DD" string.
 *
 * Deliberately done in UTC internally: the input and output are plain calendar
 * dates with no time, so UTC arithmetic is exact and immune to DST shifts that
 * would make a local-midnight +1 day land on 23:00 or 01:00 the same day.
 */
export function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative if toIso is earlier). */
export function isoDaysBetween(fromIso, toIso) {
  const [ay, am, ad] = String(fromIso).split("-").map(Number);
  const [by, bm, bd] = String(toIso).split("-").map(Number);
  if (!ay || !by) return NaN;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
