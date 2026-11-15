import { describe, it, expect } from "vitest";
import { buildFtMonthlyHr, defaultHrPeriod, periodDays, minutesToHhmm, HR_MAX_DAYS } from "./ftMonthlyHr.js";

const fl = (date, totalFlightTime) => ({ dutyType: "flight", date, totalFlightTime });

describe("FT Monthly for HR", () => {
  it("defaults to the 16th of last month to the 15th of this month", () => {
    expect(defaultHrPeriod(new Date(2026, 10, 15))).toEqual({ from: "2026-10-16", to: "2026-11-15" });
    expect(defaultHrPeriod(new Date(2026, 0, 3))).toEqual({ from: "2025-12-16", to: "2026-01-15" });
  });

  it("lists every day of the period, capped", () => {
    expect(periodDays("2026-04-16", "2026-05-16")).toHaveLength(31);
    expect(periodDays("2026-01-01", "2026-12-31")).toHaveLength(HR_MAX_DAYS);
    expect(periodDays("2026-05-02", "2026-05-01")).toEqual([]);
  });

  it("sums flight time per day in minutes, ignores non-flight and days outside the period", () => {
    const rows = [
      { pilot: { code: "CSU", name: "Chanchai" }, entries: [fl("2026-04-21", "4:39"), fl("2026-04-21", "2:35"), fl("2026-04-22", "4:39"), fl("2026-04-15", "9:00"), { dutyType: "non_flight", date: "2026-04-22", nonFlightType: "Day Standby" }] },
      { pilot: { code: "SBO", name: "Sutep" }, entries: [] }
    ];
    const r = buildFtMonthlyHr(rows, "2026-04-16", "2026-04-30");
    expect(r.days).toHaveLength(15);
    expect(minutesToHhmm(r.pilots[0].perDay[5])).toBe("7:14");
    expect(minutesToHhmm(r.pilots[0].total)).toBe("11:53");
    expect(r.pilots[1].total).toBe(0);
    expect(r.pilots.map((p) => p.no)).toEqual([1, 2]);
  });
});
