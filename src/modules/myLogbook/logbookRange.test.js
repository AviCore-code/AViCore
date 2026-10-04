import { describe, expect, it } from "vitest";
import {
  logbookFileName,
  resolveLogbookExportRange,
  isLogbookPresetActive,
} from "./logbookRange.js";

describe("custom logbook export ranges", () => {
  it("exports the exact selected dates instead of replacing them with a month preset", () => {
    expect(resolveLogbookExportRange({
      mode: "custom",
      fromDate: "2026-01-17",
      toDate: "2026-03-09",
      exportMonths: 12,
      wholeMonths: true,
      todayDate: new Date(2026, 9, 4),
    })).toEqual({ from: "2026-01-17", to: "2026-03-09" });
  });

  it("still resolves a month preset when month mode is selected", () => {
    expect(resolveLogbookExportRange({
      mode: "months",
      fromDate: "2026-01-17",
      toDate: "2026-03-09",
      exportMonths: 3,
      wholeMonths: true,
      todayDate: new Date(2026, 9, 4),
    })).toEqual({ from: "2026-08-01", to: "2026-10-31" });
  });

  it("does not mark a month preset active while selected-date mode is active", () => {
    expect(isLogbookPresetActive("custom", 12, 12)).toBe(false);
    expect(isLogbookPresetActive("months", 12, 12)).toBe(true);
    expect(isLogbookPresetActive("months", 6, 12)).toBe(false);
  });

  it("names a custom export with its selected date range", () => {
    expect(logbookFileName(
      "PDE",
      12,
      true,
      { from: "2026-01-17", to: "2026-03-09" },
      "custom",
    )).toBe("PDE_2026-01-17_to_2026-03-09_Logbook.pdf");
  });
});
