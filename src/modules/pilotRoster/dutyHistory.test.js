import { describe, expect, it } from "vitest";
import { pilotHistory, pastDays, nonFlightShort } from "./dutyHistory.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";

const limits = withFtlDefaults(DEFAULT_FTL_LIMITS);
const today = "2026-11-14";
const asOf = new Date(2026, 10, 14, 12, 0, 0);

const flight = (date, ft, dep = "08:00", stop = "16:00") =>
  ({ dutyType: "flight", date, schDep: dep, stop, totalFlightTime: ft });

describe("pastDays", () => {
  it("lists the window oldest first, ending today", () => {
    expect(pastDays(today, 3)).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
  });
});

describe("pilotHistory", () => {
  it("puts each day's flight time and duty time in its own cell", () => {
    const h = pilotHistory([flight("2026-11-13", "3:20"), flight("2026-11-13", "1:10", "17:00", "18:30")], limits, { todayIso: today, asOf });
    const d = h.day("2026-11-13");
    expect(d.ft).toBeCloseTo(4.5, 5);
    expect(d.dt).toBeGreaterThan(8);          // one merged duty period, report buffer included
    expect(h.day("2026-11-12")).toMatchObject({ ft: 0, dt: 0, flew: false, nonFlight: [] });
  });

  it("labels non-flight duty days with a short code", () => {
    const h = pilotHistory([{ dutyType: "non_flight", date: "2026-11-10", nonFlightType: "Night Standby", start: "17:30", end: "05:30", endDate: "2026-11-11" }], limits, { todayIso: today, asOf });
    expect(h.day("2026-11-10").nonFlight).toEqual(["NSB"]);
    expect(nonFlightShort("Ground Training")).toBe("GT");
  });

  it("totals match FDT Monitor and say how much is left", () => {
    const h = pilotHistory([flight("2026-11-14", "5:00")], limits, { todayIso: today, asOf });
    const ft7 = h.totals.find((t) => t.key === "ft7d");
    expect(ft7.used).toBeCloseTo(5, 5);
    expect(ft7.left).toBeCloseTo(limits.ft7d.max - 5, 5);
    expect(ft7.status).toBe("ok");
  });

  it("FT left grows on coming days as old flights drop out of the 7-day window", () => {
    // 8h flown on each of the last 4 days = 32h in 7D (limit 34).
    const entries = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].map((d) => flight(d, "8:00", "06:00", "18:00"));
    const h = pilotHistory(entries, limits, { todayIso: today, asOf });
    const left = h.ahead.map((a) => a.left);
    // Nov 15-17: all four days still inside the window ending that day.
    expect(left[0]).toBeCloseTo(limits.ft7d.max - 32, 5);
    // Nov 18: Nov 11 drops out (window 12-18).
    expect(left[3]).toBeCloseTo(limits.ft7d.max - 24, 5);
    expect(h.ahead[0].status).toBe("warn");    // 32h is past the 30h caution line
    expect(h.ahead).toHaveLength(7);
  });

  it("shows zero left, in red, when a limit is already used up", () => {
    const entries = ["2026-11-12", "2026-11-13", "2026-11-14"].map((d) => flight(d, "12:00", "05:00", "19:00"));
    const h = pilotHistory(entries, limits, { todayIso: today, asOf });
    expect(h.ahead[0]).toMatchObject({ left: 0, status: "exc" });
  });
});
