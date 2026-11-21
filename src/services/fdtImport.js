import { buildFdtLegs, hhmmToMin, minToHHMM } from "./fdtLegs.js";
import { DEFAULT_AIRCRAFT_TYPE } from "../utils/aircraftType.js";

// xlsx is a heavy library (~800 KB uncompressed). We load it lazily so it
// doesn't inflate the initial JS bundle that every page load pays for.
// The _xlsxModule promise caches the dynamic import after the first call so
// the second file in a batch doesn't pay import overhead again.
let _xlsxModule = null;
async function getXLSX() {
  if (!_xlsxModule) _xlsxModule = import("xlsx").then((m) => m.default ?? m);
  return _xlsxModule;
}
// XLSX is resolved once at module level for the sync helper functions below.
// When called from parseFdtExcelToEntries (pure-sync), the caller must have
// already awaited getXLSX() and passed the resolved module in — OR we fall
// back to a cached reference stored in _resolvedXLSX so the helpers work.
let _resolvedXLSX = null;

// Reads the real UOA "<code>_FDT.xlsx" layout (verified against files in
// C:\FDT PILOT\*_FDT.xlsx) and converts each row into the SAME flat entry
// shape used by the Daily Duty entry form (DutyEntry.jsx), so bulk-imported
// rows and manually-typed rows are indistinguishable afterwards.
// Sheet "DT": A=weekday, B=date,
//   Non-Flight Duty Record: C=Duty, D=Start, E=Finish, F=DutyTime, G=Remark
//   Non-Flying Record:       H=Duty, I=Start, J=Finish, K=DutyTime
//   Flying Record:           L=Sch Dep (time-of-day), M=Stop (time-of-day),
//                            Q=Crews, R=Sectors, S=Flights/Day, T=Flight Time
// Sheet "Logbook": A=date, B=Flight Type, C=A/C Reg,
//   D/E, F/G, H/I = Name of Pilot (code) for Flight 1/2/3, RS / LS seat,
//   J=Route,
//   L/M=TRE Day/Night, N/O=TRI Day/Night, P/Q=PIC Day/Night,
//   R/S=PICUS Day/Night, T/U=SIC Day/Night,
//   V=IFR, W=IMC, X=Off Shore, Y=On Shore,
//   Z/AA=T-O Day/Night, AB/AC=Landing Day/Night, AD=I.App
// The PES report's "IFR(IMC)" specialty figure corresponds to column W
// (IMC), not V (IFR) - V tracks broader IFR-flight-rules time, which for an
// offshore operator is routine and far larger than actual IMC time. Verified
// against real data: summing column W for CSU exactly matches the +44:10
// increase between two dated PES snapshots of the same pilot.
const NON_FLIGHT_TYPES = ["Day Standby", "Night Standby", "Ground Training", "Meeting", "Travel", "Office", "Ground Run", "Other"];

function cellVal(ws, r, c) { const X = _resolvedXLSX; const ref = X.utils.encode_cell({ r, c }); const cell = ws[ref]; return cell ? cell.v : null; }
function cellHourOfDay(ws, r, c) { const v = cellVal(ws, r, c); return typeof v === "number" ? Math.round(v * 24 * 100) / 100 : null; }
function cellNum(ws, r, c) { const v = cellVal(ws, r, c); if (typeof v === "number") return v; const n = parseFloat(v); return isNaN(n) ? null : n; }
function cellText(ws, r, c) { const v = cellVal(ws, r, c); return v == null ? "" : String(v).trim(); }
function excelSerialToDate(v) { if (typeof v !== "number") return null; return new Date(Math.round((v - 25569) * 86400 * 1000)); }

function hourToHHMM(decHour) {
  if (decHour == null) return "";
  const h = Math.floor(decHour), m = Math.round((decHour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function normalizeNonFlightType(raw) {
  const t = (raw || "").toLowerCase();
  if (t.includes("night") && (t.includes("stby") || t.includes("standby") || t.includes("duty"))) return "Night Standby";
  if (t.includes("day") && (t.includes("stby") || t.includes("standby"))) return "Day Standby";
  if (t.includes("ground") && t.includes("run")) return "Ground Run";
  if (t.includes("train")) return "Ground Training";
  if (t.includes("meeting")) return "Meeting";
  if (t.includes("travel") || t.includes("position")) return "Travel";
  if (t.includes("office")) return "Office";
  return NON_FLIGHT_TYPES.includes(raw) ? raw : "Other";
}

function readLogbookByDate(workbook) {
  const logWs = workbook.Sheets["Logbook"];
  const logByDate = {};
  if (!logWs || !logWs["!ref"]) return logByDate;
  const lr = _resolvedXLSX.utils.decode_range(logWs["!ref"]);
  for (let r = 4; r <= lr.e.r; r++) {
    const dRaw = cellVal(logWs, r, 0);
    if (typeof dRaw !== "number") continue;
    const flightType = cellText(logWs, r, 1);
    const registration = cellText(logWs, r, 2);
    const h = (c) => cellHourOfDay(logWs, r, c) || 0;
    // Exact H:MM of a time cell (h() rounds to 0.01h and can drift a minute).
    const hm = (c) => { const v = cellVal(logWs, r, c); return minToHHMM(typeof v === "number" ? Math.round(v * 1440) : 0); };
    // Some real rows have TRE/TRI/PIC/PICUS/SIC hours filled in but Flight
    // Type and A/C Reg left blank (a data-entry gap, not a non-flying row) -
    // verified against real files: 216 such rows in one 5-year file, holding
    // 767:11 hours of PIC time alone, all silently dropped by the old
    // "skip if no flightType/registration" guard with no error anywhere.
    // Column BG (a running cumulative PIC total elsewhere in this sheet)
    // matched the true total exactly once these rows were included, and fell
    // ~767h short while they were being skipped - that mismatch is what
    // exposed this. Only skip a row now if it has neither identifying text
    // NOR any actual hours.
    const anyHours = h(11) + h(12) + h(13) + h(14) + h(15) + h(16) + h(17) + h(18) + h(19) + h(20) > 0;
    // A row with only T/O / LDG / I.App counts or IFR / IMC / off-onshore
    // time and no flight time (real: 03/Jul/22 T/O 3 LDG 2, 25/Jan/25 T/O 1
    // LDG 1 IFR 2:36) is kept as a 0:00 flight so the T/O, LDG and I.App
    // totals match the Excel (Capt. Weera, 17 Nov 2026).
    const anyOther = h(21) + h(22) + h(23) + h(24) > 0 || [25, 26, 27, 28, 29].some((c) => (cellNum(logWs, r, c) || 0) > 0);
    if (!flightType && !registration && !anyHours && !anyOther) continue;
    const d = excelSerialToDate(dRaw);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    const roles = [["TRE", 11], ["TRI", 13], ["PIC", 15], ["PICUS", 17], ["SIC", 19]]
      .filter(([, c]) => h(c) > 0 || h(c + 1) > 0)
      .map(([role, c]) => ({ role, dayHours: hm(c), nightHours: hm(c + 1) }));
    // Who flew each flight (Capt. Weera's pairing check, Reports -> Pair
    // Check): up to three flights per row, right seat / left seat pilot code.
    // Kept per flight, in order; a second Logbook row for the same date adds
    // its flights after the first row's.
    const crew = [[3, 4], [5, 6], [7, 8]]
      .map(([a, b]) => ({ rs: cellText(logWs, r, a).toUpperCase(), ls: cellText(logWs, r, b).toUpperCase() }))
      .filter((f) => f.rs || f.ls);
    logByDate[key] = {
      crew: [...(logByDate[key]?.crew || []), ...crew],
      flightType: flightType || "Revenue Flight", registration, route: cellText(logWs, r, 9),
      roles: roles.length ? roles : [{ role: "PIC", dayHours: "0:00", nightHours: "0:00" }],
      // Raw sum of this row's TRE/TRI/PIC/PICUS/SIC Day+Night hours - used as a
      // fallback totalFlightTime below when the DT sheet's own Flight Time
      // cell is blank for this date (see hasFlying below). Verified against
      // real files that this exactly matches the DT sheet's Flight Time
      // column whenever both are present, so it's a safe substitute.
      totalHours: h(11) + h(12) + h(13) + h(14) + h(15) + h(16) + h(17) + h(18) + h(19) + h(20),
      // The same TRE..SIC Day+Night sum in exact minutes (h() rounds to
      // 0.01h). Roles can overlap (an instructor logs TRI and PIC for the
      // same flight), so this is only a last-resort flight time.
      roleMin: (logByDate[key]?.roleMin || 0) + [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
        .reduce((sum, c) => { const v = cellVal(logWs, r, c); return sum + (typeof v === "number" ? Math.round(v * 1440) : 0); }, 0),
      // Logbook Total Flight Time (col K) in exact minutes.
      kMin: (logByDate[key]?.kMin || 0) + (typeof cellVal(logWs, r, 10) === "number" ? Math.round(cellVal(logWs, r, 10) * 1440) : 0),
      // ifrHours = column W (IMC), used by the PES "IFR(IMC)" specialty combine.
      // ifrRulesHours = column V (IFR flight-rules time), a separate, much
      // larger figure used for the My Status "IFR HOURS (180D)" recency
      // number (the Excel's "IFR(180)" column BA is the 180-day rolling sum
      // of this per-flight value).
      ifrHours: hm(22), ifrRulesHours: hm(21),
      onshoreHours: hm(24), offshoreHours: hm(23),
      toDay: cellNum(logWs, r, 25) || 0, toNight: cellNum(logWs, r, 26) || 0,
      landDay: cellNum(logWs, r, 27) || 0, landNight: cellNum(logWs, r, 28) || 0,
      iApp: cellNum(logWs, r, 29) || 0
    };
  }
  return logByDate;
}

export function parseFdtExcelToEntries(filename, workbook) {
  const code = filename.slice(0, 3).toUpperCase();
  const ws = workbook.Sheets["DT"];
  if (!ws || !ws["!ref"]) throw new Error(`Sheet "DT" not found in file ${filename}`);
  const range = _resolvedXLSX.utils.decode_range(ws["!ref"]);
  const logByDate = readLogbookByDate(workbook);

  const entries = [];
  let seq = 0;
  for (let r = 5; r <= range.e.r; r++) {
    const dateRaw = cellVal(ws, r, 1);
    if (typeof dateRaw !== "number") continue;
    const date = excelSerialToDate(dateRaw);
    if (!date) continue;
    const dateKey = date.toISOString().slice(0, 10);

    const nfDutyText = cellText(ws, r, 2);
    const nfStart = cellHourOfDay(ws, r, 3);
    const nfEnd = cellHourOfDay(ws, r, 4);
    if (nfDutyText && nfStart != null && nfEnd != null) {
      entries.push({
        pilotCode: code, dutyType: "non_flight", date: dateKey,
        nonFlightType: normalizeNonFlightType(nfDutyText), start: hourToHHMM(nfStart), end: hourToHHMM(nfEnd),
        remark: cellText(ws, r, 6), source: "excel", sourceFile: filename, seq: seq++
      });
    }

    const nflyDutyText = cellText(ws, r, 7);
    const nflyStart = cellHourOfDay(ws, r, 8);
    const nflyEnd = cellHourOfDay(ws, r, 9);
    if (nflyDutyText && nflyStart != null && nflyEnd != null) {
      entries.push({
        pilotCode: code, dutyType: "non_flight", date: dateKey,
        nonFlightType: normalizeNonFlightType(nflyDutyText), start: hourToHHMM(nflyStart), end: hourToHHMM(nflyEnd),
        remark: "", source: "excel", sourceFile: filename, seq: seq++
      });
    }

    const schDep = cellHourOfDay(ws, r, 11);
    const stop = cellHourOfDay(ws, r, 12);
    const lb = logByDate[dateKey];
    // A small number of real dates (verified: ~9 dates in a 5-year file) have
    // a genuine flight logged in the Logbook sheet (registration/flight type
    // present) but blank Sch Dep/Stop/Flight Time in the DT sheet - a
    // data-entry gap in the DT sheet itself, not a parsing bug. Without this
    // OR-condition those dates were silently dropped entirely (not just
    // missing role hours, but the whole flight, including its contribution
    // to Grand Total), with no error shown anywhere.
    const hasFlying = (schDep != null && stop != null && (schDep !== 0 || stop !== 0)) || !!lb;
    if (hasFlying) {
      const lbData = lb || {};
      // Flight time for the day = the Logbook's Total Flight Time, col K
      // (Capt. Weera, 17 Nov 2026 - "follow the Logbook"). On some days the
      // DT sheet's Flight Time disagrees (e.g. KCH 15/Oct/25: DT 3:31, K and
      // SIC 5:56). K blank/0 -> DT Flight Time; both blank -> the Logbook's
      // role hours (a data-entry gap; roles can overlap, so last resort).
      const dtMin = typeof cellVal(ws, r, 19) === "number" ? Math.round(cellVal(ws, r, 19) * 1440) : 0;
      const totalMinutes = lbData.kMin > 0 ? lbData.kMin : dtMin > 0 ? dtMin : (lbData.roleMin || 0);
      const roles = lbData.roles || [{ role: "PIC", dayHours: "0:00", nightHours: "0:00" }];
      // One Daily Duty row per flight (see fdtLegs.js): RS/LS, route,
      // registration and hours per flight, so an imported 2-flight day
      // opens as 2 flights in Daily Duty Entry.
      const { legs, split } = buildFdtLegs({
        crew: lbData.crew || [], route: lbData.route || "", registration: lbData.registration || "",
        flightType: lbData.flightType || "Revenue Flight", roles,
        totalMin: totalMinutes,
        ifrRulesMin: hhmmToMin(lbData.ifrRulesHours), ifrMin: hhmmToMin(lbData.ifrHours),
        offshoreMin: hhmmToMin(lbData.offshoreHours), onshoreMin: hhmmToMin(lbData.onshoreHours),
        toDay: lbData.toDay, toNight: lbData.toNight, landDay: lbData.landDay, landNight: lbData.landNight, iApp: lbData.iApp
      });
      entries.push({
        pilotCode: code, dutyType: "flight", date: dateKey,
        // The Excel has no type column: the company's type (aircraftType.js) -
        // without it Pilot Experience Summary dropped these hours (21 Nov 2026).
        flightType: lbData.flightType || "Revenue Flight", aircraftType: DEFAULT_AIRCRAFT_TYPE, registration: lbData.registration || "", route: lbData.route || "",
        schDep: hourToHHMM(schDep || 0), stop: hourToHHMM(stop || 0),
        // Column 16 in the source sheet is Crew Number. Deliberately NOT
        // imported: nothing reads it, and the Fatigue Monitor derives the Crew
        // from schDep instead (fatigueMonitor.js crewForDeparture), so carrying
        // a second, hand-maintained copy could only ever drift out of step.
        sectors: cellNum(ws, r, 17) ?? "", flightsPerDay: cellNum(ws, r, 18) ?? "",
        crew: lbData.crew || [],
        totalFlightTime: minToHHMM(totalMinutes),
        roles,
        legs: legs.map((l) => ({ ...l, aircraftType: l.aircraftType || DEFAULT_AIRCRAFT_TYPE })), legsSplit: split,
        ifrHours: lbData.ifrHours || "0:00", ifrRulesHours: lbData.ifrRulesHours || "0:00", onshoreHours: lbData.onshoreHours || "0:00", offshoreHours: lbData.offshoreHours || "0:00",
        toDay: lbData.toDay ?? 0, toNight: lbData.toNight ?? 0, landDay: lbData.landDay ?? 0, landNight: lbData.landNight ?? 0, iApp: lbData.iApp ?? 0,
        source: "excel", sourceFile: filename, seq: seq++
      });
    }
  }
  if (entries.length === 0) throw new Error(`No activity data found in file ${filename} (all rows empty)`);
  return { code, entries };
}

export async function parseFdtExcelFileToEntries(file) {
  const XLSX = await getXLSX();
  _resolvedXLSX = XLSX;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return parseFdtExcelToEntries(file.name, wb);
}

/**
 * Parse multiple FDT files in parallel (each file on its own Promise).
 * Returns an array of results in the SAME ORDER as the input files.
 * Each result is either:
 *   { filename, code, entries }  — success
 *   { filename, error }          — parse failed (continues to next file)
 *
 * xlsx is lazy-loaded once and reused for every file in the batch, so
 * only the first file pays the ~20 ms dynamic-import overhead.
 */
export async function parseAllFdtFiles(files) {
  // Warm up xlsx once before kicking off parallel parse
  const XLSX = await getXLSX();
  _resolvedXLSX = XLSX;

  return Promise.all(
    Array.from(files).map(async (file) => {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const { code, entries } = parseFdtExcelToEntries(file.name, wb);
        return { filename: file.name, code, entries };
      } catch (err) {
        return { filename: file.name, error: err.message ?? String(err) };
      }
    })
  );
}
