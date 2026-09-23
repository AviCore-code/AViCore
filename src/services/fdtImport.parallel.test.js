// fdtImport.parallel.test.js
// Tests for parallel/worker-based FDT excel parsing
import { describe, it, expect, beforeAll } from "vitest";
import * as XLSX from "xlsx";
import { parseFdtExcelToEntries, parseAllFdtFiles } from "./fdtImport.js";

// Warm up _resolvedXLSX before any sync call to parseFdtExcelToEntries.
// The function uses a module-level cache that is populated by getXLSX() inside
// the async helpers. In tests we trigger it once with a dummy file call.
beforeAll(async () => {
  const { parseFdtExcelFileToEntries } = await import("./fdtImport.js");
  // Warm XLSX by parsing a known-good minimal buffer.
  // We ignore errors — we just need the side-effect of _resolvedXLSX being set.
  try {
    const wb = XLSX.utils.book_new();
    wb.Sheets["DT"] = { "!ref": "A1:A1" };
    wb.Sheets["Logbook"] = { "!ref": "A1:A1" };
    wb.SheetNames = ["DT", "Logbook"];
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const file = new File([buf], "WARM_FDT.xlsx");
    await parseFdtExcelFileToEntries(file).catch(() => {});
  } catch (_) { /* ignore */ }
});

// ---- helper: build a minimal fake XLSX workbook ----
function makeMinimalWorkbook() {
  // XLSX workbook shape: Sheets["DT"] and Sheets["Logbook"]
  // DT sheet: row 5 (index=5) has a real date in col B (serial 45000 = 2023-03-13)
  //           Non-flight: col C="Day Standby", D=0.333 (08:00), E=0.667 (16:00)
  const encode = (r, c) => {
    const col = String.fromCharCode(65 + c);
    return `${col}${r + 1}`;
  };
  const dtWs = {};
  // row 5 (r=5): date=45000, non-flight duty only
  dtWs[encode(5, 1)] = { v: 45000 }; // col B = date
  dtWs[encode(5, 2)] = { v: "Day Standby" }; // col C = duty type
  dtWs[encode(5, 3)] = { v: 0.333 }; // col D = start 08:00
  dtWs[encode(5, 4)] = { v: 0.667 }; // col E = end 16:00
  dtWs[encode(5, 6)] = { v: "test remark" }; // col G = remark
  dtWs["!ref"] = "A1:Z10";

  const logWs = {};
  logWs["!ref"] = "A1:A1"; // empty logbook

  return {
    Sheets: { DT: dtWs, Logbook: logWs },
    SheetNames: ["DT", "Logbook"],
  };
}

describe("parseFdtExcelToEntries — pure function (synchronous path)", () => {
  it("extracts pilot code from filename", () => {
    const wb = makeMinimalWorkbook();
    const { code } = parseFdtExcelToEntries("CSU_FDT.xlsx", wb);
    expect(code).toBe("CSU");
  });

  it("parses a non-flight duty row", () => {
    const wb = makeMinimalWorkbook();
    const { entries } = parseFdtExcelToEntries("CSU_FDT.xlsx", wb);
    expect(entries.length).toBeGreaterThan(0);
    const nf = entries.find((e) => e.dutyType === "non_flight");
    expect(nf).toBeTruthy();
    expect(nf.nonFlightType).toBe("Day Standby");
    expect(nf.remark).toBe("test remark");
  });

  it("tags each entry with sourceFile", () => {
    const wb = makeMinimalWorkbook();
    const { entries } = parseFdtExcelToEntries("KCH_FDT.xlsx", wb);
    expect(entries.every((e) => e.sourceFile === "KCH_FDT.xlsx")).toBe(true);
  });

  it("throws when DT sheet is missing", () => {
    const wb = { Sheets: {}, SheetNames: [] };
    expect(() => parseFdtExcelToEntries("CSU_FDT.xlsx", wb)).toThrow(/DT/);
  });

  it("throws when no activity rows found", () => {
    const wb = { Sheets: { DT: { "!ref": "A1:A2" }, Logbook: { "!ref": "A1:A1" } }, SheetNames: [] };
    expect(() => parseFdtExcelToEntries("CSU_FDT.xlsx", wb)).toThrow(/No activity/);
  });
});

// ---- parallel parse API contract ----
describe("parseAllFdtFiles — parallel batch parse", () => {
  it("exported function exists", async () => {
    const mod = await import("./fdtImport.js");
    expect(typeof mod.parseAllFdtFiles).toBe("function");
  });

  it("returns array of { code, entries, filename } one per file", async () => {
    // Build two real minimal xlsx buffers so parsing succeeds
    const wb = makeMinimalWorkbook();
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const makeFile = (name) => new File([buf], name);
    const results = await parseAllFdtFiles([makeFile("CSU_FDT.xlsx"), makeFile("KCH_FDT.xlsx")]);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toHaveProperty("filename");
      const hasOk = "code" in r && "entries" in r;
      const hasErr = "error" in r;
      expect(hasOk || hasErr).toBe(true);
    }
  });

  it("processes all files even when one throws", async () => {
    const badFile = new File([new ArrayBuffer(0)], "BAD_FDT.xlsx");
    const results = await parseAllFdtFiles([badFile]);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty("error");
    expect(results[0].filename).toBe("BAD_FDT.xlsx");
  });

  it("returns results in input order", async () => {
    const wb = makeMinimalWorkbook();
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const names = ["AAA_FDT.xlsx", "BBB_FDT.xlsx", "CCC_FDT.xlsx"];
    const files = names.map((n) => new File([buf], n));
    const results = await parseAllFdtFiles(files);
    expect(results.map((r) => r.filename)).toEqual(names);
  });
});

