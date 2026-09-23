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
// Sheet "Logbook": A=date, B=Flight Type, C=A/C Reg, J=Route,
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
function decimalToBigHHMM(dec) {
  const totalMin = Math.round((dec || 0) * 60);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
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
    if (!flightType && !registration && !anyHours) continue;
    const d = excelSerialToDate(dRaw);
    if (!d) continue;
    const key = d.toISOString().slice(0, 10);
    const roles = [
      { role: "TRE", dayHours: h(11), nightHours: h(12) },
      { role: "TRI", dayHours: h(13), nightHours: h(14) },
      { role: "PIC", dayHours: h(15), nightHours: h(16) },
      { role: "PICUS", dayHours: h(17), nightHours: h(18) },
      { role: "SIC", dayHours: h(19), nightHours: h(20) }
    ].filter((r) => r.dayHours > 0 || r.nightHours > 0)
      .map((r) => ({ role: r.role, dayHours: decimalToBigHHMM(r.dayHours), nightHours: decimalToBigHHMM(r.nightHours) }));
    logByDate[key] = {
      flightType: flightType || "Revenue Flight", registration, route: cellText(logWs, r, 9),
      roles: roles.length ? roles : [{ role: "PIC", dayHours: "0:00", nightHours: "0:00" }],
      // Raw sum of this row's TRE/TRI/PIC/PICUS/SIC Day+Night hours - used as a
      // fallback totalFlightTime below when the DT sheet's own Flight Time
      // cell is blank for this date (see hasFlying below). Verified against
      // real files that this exactly matches the DT sheet's Flight Time
      // column whenever both are present, so it's a safe substitute.
      totalHours: h(11) + h(12) + h(13) + h(14) + h(15) + h(16) + h(17) + h(18) + h(19) + h(20),
      // ifrHours = column W (IMC), used by the PES "IFR(IMC)" specialty combine.
      // ifrRulesHours = column V (IFR flight-rules time), a separate, much
      // larger figure used for the My Status "IFR HOURS (180D)" recency
      // number (the Excel's "IFR(180)" column BA is the 180-day rolling sum
      // of this per-flight value).
      ifrHours: decimalToBigHHMM(h(22)), ifrRulesHours: decimalToBigHHMM(h(21)),
      onshoreHours: decimalToBigHHMM(h(24)), offshoreHours: decimalToBigHHMM(h(23)),
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
      const dtFlightTime = cellHourOfDay(ws, r, 19);
      // Fall back to the Logbook row's own role-hours sum when the DT
      // sheet's Flight Time cell is blank (same gap as above) - keeps Grand
      // Total (sums totalFlightTime) consistent with the PIC/PICUS/SIC
      // breakdown (sums per-role Logbook hours) for these dates.
      const totalFt = dtFlightTime != null ? dtFlightTime : (lbData.totalHours || 0);
      entries.push({
        pilotCode: code, dutyType: "flight", date: dateKey,
        flightType: lbData.flightType || "Revenue Flight", aircraftType: "", registration: lbData.registration || "", route: lbData.route || "",
        schDep: hourToHHMM(schDep || 0), stop: hourToHHMM(stop || 0),
        // Column 16 in the source sheet is Crew Number. Deliberately NOT
        // imported: nothing reads it, and the Fatigue Monitor derives the Crew
        // from schDep instead (fatigueMonitor.js crewForDeparture), so carrying
        // a second, hand-maintained copy could only ever drift out of step.
        sectors: cellNum(ws, r, 17) ?? "", flightsPerDay: cellNum(ws, r, 18) ?? "",
        totalFlightTime: decimalToBigHHMM(totalFt || 0),
        roles: lbData.roles || [{ role: "PIC", dayHours: "0:00", nightHours: "0:00" }],
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
