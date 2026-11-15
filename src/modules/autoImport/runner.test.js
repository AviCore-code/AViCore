import { describe, it, expect } from "vitest";
import { dueSlots, rosterRangeFromToday, isFdtFileName } from "./runner.js";

describe("Auto Import helpers", () => {
  it("a set time is due once it has passed today and has not run today", () => {
    const now = new Date(2026, 10, 15, 18, 5);
    expect(dueSlots(["06:00", "18:00", "21:00"], now, {})).toEqual(["06:00", "18:00"]);
    expect(dueSlots(["06:00", "18:00"], now, { "06:00": "2026-11-15" })).toEqual(["18:00"]);
    expect(dueSlots(["06:00"], now, { "06:00": "2026-11-14" })).toEqual(["06:00"]);
    expect(dueSlots(["bad", "6:00"], now, {})).toEqual([]);
  });

  it("roster imports from today to the end of the sheet", () => {
    expect(rosterRangeFromToday({ from: "2026-01-01", to: "2026-12-31" }, "2026-11-15")).toEqual({ from: "2026-11-15", to: "2026-12-31" });
    expect(rosterRangeFromToday({ from: "2026-12-01", to: "2026-12-31" }, "2026-11-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(rosterRangeFromToday({ from: "2026-01-01", to: "2026-10-31" }, "2026-11-15")).toBeNull();
  });

  it("takes only *_FDT.xlsx files, not Excel lock files", () => {
    expect(isFdtFileName("KPO_FDT.xlsx")).toBe(true);
    expect(isFdtFileName("kpo_fdt.XLSX")).toBe(true);
    expect(isFdtFileName("~$KPO_FDT.xlsx")).toBe(false);
    expect(isFdtFileName("Roster.xlsx")).toBe(false);
  });
});
