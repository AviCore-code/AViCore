// Combines the Pilot Experience PDF baseline (a snapshot as of its "Update"
// date) with everything logged in Daily Duty since that date, so totals
// shown to users reflect flight hours up to today - not just the baseline.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// A 2-digit year here means +2000 (a PES "Update" date is always recent).
// See parseHbdDate below for the OPPOSITE assumption, deliberately - a
// birthdate's 2-digit year means +1900, not +2000.
export function parseUpdateDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return new Date(year, mon, Number(m[1]));
}

// Same "D-Mon-YY" shape as parseUpdateDate, but for a pilot's date of birth
// (HBD) - a 2-digit year here means +1900, the opposite assumption from
// parseUpdateDate above. A pilot born "1-Mar-73" must resolve to 1973, not
// 2073 - do not reuse parseUpdateDate for this field.
export function parseHbdDate(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon == null) return null;
  let year = Number(m[3]);
  if (year < 100) year += 1900;
  return new Date(year, mon, Number(m[1]));
}

// Age as "Y M" (e.g. "53 Y 4 M") as of a given date, matching the company's
// existing report format. Standard month-borrowing: if today's day-of-month
// hasn't reached the birth day-of-month yet, this month doesn't count as a
// full month yet, so borrow one from the year.
export function formatAgeYM(hbdDate, asOf = new Date()) {
  if (!hbdDate) return "";
  let years = asOf.getFullYear() - hbdDate.getFullYear();
  let months = asOf.getMonth() - hbdDate.getMonth();
  if (asOf.getDate() < hbdDate.getDate()) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  if (years < 0) return "";
  return `${years} Y ${months} M`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatUpdateDate(date) {
  if (!date) return "";
  return `${date.getDate()}-${MONTH_NAMES[date.getMonth()]}-${date.getFullYear()}`;
}

// The "Update" date shown to users should reflect the most recent flight
// actually on file (imported from an FDT Excel sheet, or entered directly in
// Daily Duty) rather than staying frozen at the PES PDF's own snapshot date -
// so it falls back to the PDF's date only when no later flight is logged.
// This is display-only: combineExperience/combineAircraftRows/combineSpecialty
// keep using the PDF's own date as the baseline cutoff so "added since" math
// stays correct.
export function getEffectiveUpdateDate(record, dutyEntries) {
  const baselineDate = parseUpdateDate(record?.profile?.update);
  const flightDates = (dutyEntries || [])
    .filter((e) => e.dutyType === "flight" && e.date)
    .map((e) => new Date(e.date))
    .filter((d) => !isNaN(d));
  const latestFlight = flightDates.length ? new Date(Math.max(...flightDates)) : null;
  if (!baselineDate) return latestFlight;
  if (!latestFlight) return baselineDate;
  return latestFlight > baselineDate ? latestFlight : baselineDate;
}

function hhmmToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}
export function decimalToHHMM(dec) {
  const totalMin = Math.round((dec || 0) * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}
function roleHours(entry, role) {
  return (entry.roles || [])
    .filter((r) => r.role === role)
    .reduce((sum, r) => sum + hhmmToDecimal(r.dayHours) + hhmmToDecimal(r.nightHours), 0);
}

// record: a Pilot Experience record ({ profile, experienceBase }) or null.
// dutyEntries: this pilot's Daily Duty entries (flight + non_flight).
export function combineExperience(record, dutyEntries) {
  const updateDate = parseUpdateDate(record?.profile?.update);
  const since = (dutyEntries || []).filter((e) => e.dutyType === "flight" && (!updateDate || new Date(e.date) > updateDate));

  const addedPic = since.reduce((s, e) => s + roleHours(e, "PIC"), 0);
  const addedPicus = since.reduce((s, e) => s + roleHours(e, "PICUS"), 0);
  const addedSic = since.reduce((s, e) => s + roleHours(e, "SIC"), 0);
  const addedFt = since.reduce((s, e) => s + hhmmToDecimal(e.totalFlightTime), 0);

  const baseline = record?.experienceBase?.totals || {};
  const baselinePic = hhmmToDecimal(baseline.pic);
  const baselinePicus = hhmmToDecimal(baseline.picus);
  const baselineSic = hhmmToDecimal(baseline.sic);
  const baselineGrand = hhmmToDecimal(baseline.grand);

  return {
    hasBaseline: !!record,
    updateDate,
    sinceCount: since.length,
    baseline: { pic: baselinePic, picus: baselinePicus, sic: baselineSic, grand: baselineGrand },
    added: { pic: addedPic, picus: addedPicus, sic: addedSic, grand: addedFt },
    current: {
      pic: baselinePic + addedPic,
      picus: baselinePicus + addedPicus,
      sic: baselineSic + addedSic,
      grand: baselineGrand + addedFt
    }
  };
}

// Per-aircraft-type combine: matches Daily Duty flight entries to a baseline
// aircraft row by "Aircraft Type" (e.g. "AW139"), and adds their PIC/PICUS/
// SIC hours on top of that row's baseline - so e.g. the AW139 row reflects
// hours flown on AW139 since the PES Update date, not just what was on the
// original PDF. Entries with no aircraftType set (older manual entries, or
// Excel imports where the source file has no type column) can't be matched
// to a row and are simply not counted here.
// Whitespace-insensitive so "AW 139" (how some PES PDFs/baseline rows spell
// a type, with a space) still matches "AW139" (the app's own Daily Duty /
// Import FDT convention - see DEFAULT_AIRCRAFT_TYPE). Before this, a baseline
// row spelled with an internal space would exact-match nothing, silently
// leaving that row (and the fleet-wide "Total of Helicopter") stuck at its
// PES-snapshot value forever, no matter how much was imported afterwards -
// with no error shown anywhere, since combineAircraftRows just returns an
// empty "matching" array rather than failing.
function normalizeType(v) {
  return (v || "").replace(/\s+/g, "").toUpperCase();
}

export function combineAircraftRows(rows, dutyEntries, updateDate) {
  const since = (dutyEntries || []).filter((e) => e.dutyType === "flight" && (!updateDate || new Date(e.date) > updateDate));

  return (rows || []).map((row) => {
    const type = normalizeType(row[0]);
    const matching = type ? since.filter((e) => normalizeType(e.aircraftType) === type) : [];

    const addPic = matching.reduce((s, e) => s + roleHours(e, "PIC"), 0);
    const addPicus = matching.reduce((s, e) => s + roleHours(e, "PICUS"), 0);
    const addSic = matching.reduce((s, e) => s + roleHours(e, "SIC"), 0);

    const curPic = hhmmToDecimal(row[1]) + addPic;
    const curPicus = hhmmToDecimal(row[2]) + addPicus;
    const curSic = hhmmToDecimal(row[3]) + addSic;
    const curTotal = curPic + curPicus + curSic;

    return {
      row: [row[0], decimalToHHMM(curPic), decimalToHHMM(curPicus), decimalToHHMM(curSic), decimalToHHMM(curTotal)],
      addedCount: matching.length,
      totalDecimal: curTotal
    };
  });
}

export function sumCombinedTotal(combinedRows) {
  return decimalToHHMM((combinedRows || []).reduce((s, r) => s + r.totalDecimal, 0));
}

// Specialty Hours (IFR(IMC)/Night/Offshore/TRI/TRE) combine: baseline from
// the PES record's specialty table PLUS what's logged in Daily Duty flight
// entries since the Update date. Night hours come from summing every role's
// nightHours on an entry (not tied to a specific role); TRI/TRE come from
// summing hours logged under those roles specifically.
export const SPECIALTY_LABELS = ["IFR(IMC)", "Night", "Offshore", "TRI", "TRE"];

function entryNightHours(entry) {
  return (entry.roles || []).reduce((sum, r) => sum + hhmmToDecimal(r.nightHours), 0);
}

export function combineSpecialty(record, dutyEntries, updateDate) {
  const since = (dutyEntries || []).filter((e) => e.dutyType === "flight" && (!updateDate || new Date(e.date) > updateDate));
  const baselineMap = {};
  for (const [label, hours] of record?.experienceBase?.specialty || []) baselineMap[label] = hhmmToDecimal(hours);

  const addedMap = {
    "IFR(IMC)": since.reduce((s, e) => s + hhmmToDecimal(e.ifrHours), 0),
    "Night": since.reduce((s, e) => s + entryNightHours(e), 0),
    "Offshore": since.reduce((s, e) => s + hhmmToDecimal(e.offshoreHours), 0),
    "TRI": since.reduce((s, e) => s + roleHours(e, "TRI"), 0),
    "TRE": since.reduce((s, e) => s + roleHours(e, "TRE"), 0)
  };

  return SPECIALTY_LABELS.map((label) => {
    const baseline = baselineMap[label] || 0;
    const added = addedMap[label] || 0;
    return { label, baseline, added, current: baseline + added };
  });
}
