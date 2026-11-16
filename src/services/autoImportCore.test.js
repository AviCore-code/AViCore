import { describe, it, expect } from "vitest";
import { dueSlots, rosterRangeFromToday, isFdtFileName, withConfigDefaults, normaliseTimes, bangkokNow } from "./autoImportCore.js";

describe("Auto Import core", () => {
  it("a set time is due once it has passed today (Bangkok) and has not run today", () => {
    const now = { date: "2026-11-15", time: "18:05" };
    expect(dueSlots(["06:00", "18:00", "21:00"], now, {})).toEqual(["06:00", "18:00"]);
    expect(dueSlots(["06:00", "18:00"], now, { "06:00": "2026-11-15" })).toEqual(["18:00"]);
    expect(dueSlots(["bad"], now, {})).toEqual([]);
  });

  it("works out Bangkok time whatever the server zone", () => {
    expect(bangkokNow(new Date("2026-11-15T23:30:00Z"))).toEqual({ date: "2026-11-16", time: "06:30" });
  });

  it("roster imports from today to the end of the sheet", () => {
    expect(rosterRangeFromToday({ from: "2026-01-01", to: "2026-12-31" }, "2026-11-15")).toEqual({ from: "2026-11-15", to: "2026-12-31" });
    expect(rosterRangeFromToday({ from: "2026-01-01", to: "2026-10-31" }, "2026-11-15")).toBeNull();
  });

  it("takes only *_FDT.xlsx files, not Excel lock files", () => {
    expect(isFdtFileName("KPO_FDT.xlsx")).toBe(true);
    expect(isFdtFileName("~$KPO_FDT.xlsx")).toBe(false);
    expect(isFdtFileName("Roster.xlsx")).toBe(false);
  });

  it("fills defaults and checks the time list", () => {
    expect(withConfigDefaults(null).paths).toEqual({ fdt: "", roster: "", training: "", staff: [] });
    expect(withConfigDefaults({ paths: { fdt: "C:\FDT" } }).paths.fdt).toBe("C:\FDT");
    expect(normaliseTimes("6:00, 18.30 6:00")).toEqual(["06:00", "18:30"]);
    expect(normaliseTimes("25:00")).toBeNull();
  });
});
