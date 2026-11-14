import { describe, expect, it } from "vitest";
import { pilotHistory, pastDays, nonFlightShort, cycleOnDay, worst } from "./dutyHistory.js";
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
    expect(h.ahead[0].ftStatus).toBe("warn");  // 32h is past the 30h caution line
    expect(h.ahead).toHaveLength(7);
  });

  it("shows zero left, in red, when a limit is already used up", () => {
    const entries = ["2026-11-12", "2026-11-13", "2026-11-14"].map((d) => flight(d, "12:00", "05:00", "19:00"));
    const h = pilotHistory(entries, limits, { todayIso: today, asOf });
    expect(h.ahead[0]).toMatchObject({ left: 0, ftStatus: "exc", status: "exc" });
  });
});

describe("next-7-day DT left and 168h cycle", () => {
  it("DT left is the tightest of the 7/14/28-day duty windows", () => {
    const h = pilotHistory([flight("2026-11-14", "2:00", "06:00", "18:00")], limits, { todayIso: today, asOf });
    const dtUsed = h.day("2026-11-14").dt;
    expect(h.ahead[0].dtLeft).toBeCloseTo(limits.dt7d.max - dtUsed, 5);
    expect(h.ahead[0].dtStatus).toBe("ok");
  });

  it("counts down to the Recovery Rest deadline and turns red once it passes", () => {
    const deadline = new Date(2026, 10, 16, 12, 0, 0);          // 16 Nov 12:00
    const running = { kind: "running", deadline };
    expect(cycleOnDay(running, "2026-11-15", limits)).toMatchObject({ label: "36h", status: "ok" });
    expect(cycleOnDay(running, "2026-11-16", limits)).toMatchObject({ label: "12h", status: "warn" });
    expect(cycleOnDay(running, "2026-11-17", limits)).toMatchObject({ label: "RR due", status: "exc" });
  });

  it("shows RR ✓ while resting, nothing for a pilot with no records", () => {
    expect(cycleOnDay({ kind: "resting" }, "2026-11-15", limits)).toMatchObject({ label: "RR ✓", status: "ok" });
    expect(cycleOnDay({ kind: "none" }, "2026-11-15", limits)).toMatchObject({ label: "", status: "ok" });
    const empty = pilotHistory([], limits, { todayIso: today, asOf });
    expect(empty.ahead.every((a) => a.status === "ok")).toBe(true);
  });

  it("finds the cycle from real duty: two nights off then work", () => {
    // Off 9-11 Nov (rest through two local nights), flying 12-14 Nov.
    const entries = [flight("2026-11-08", "3:00"), flight("2026-11-12", "3:00"), flight("2026-11-13", "3:00"), flight("2026-11-14", "3:00")];
    const h = pilotHistory(entries, limits, { todayIso: today, asOf });
    expect(h.cycle.kind).toBe("running");
    expect(h.ahead[0].cycle.hoursLeft).toBeGreaterThan(0);
  });

  it("a cell is only as good as its worst line", () => {
    expect(worst(["ok", "warn", "ok"])).toBe("warn");
    expect(worst(["ok", "exc", "warn"])).toBe("exc");
    expect(worst(["ok", "ok", "ok"])).toBe("ok");
  });
});
