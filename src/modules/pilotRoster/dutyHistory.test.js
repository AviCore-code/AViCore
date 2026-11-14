import { describe, expect, it } from "vitest";
import { pilotHistory, pastDays, nonFlightShort, cycleOnDay, worst, remarkLabel, rosterRemark, preOffRrDays } from "./dutyHistory.js";
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

describe("roster remark for the next 7 days", () => {
  const roster = (pairs) => new Map(pairs);
  // today = 2026-11-14 -> window 15..21 Nov

  it("labels non-duty codes; plain duty days are not mentioned", () => {
    expect(remarkLabel("O")).toBeNull();
    expect(remarkLabel("N")).toBeNull();
    expect(remarkLabel("X")).toEqual({ label: "OFF", category: "off" });
    expect(remarkLabel("O,X")).toEqual({ label: "OFF", category: "off" });
    expect(remarkLabel("rr")).toEqual({ label: "RR", category: "rest" });
    expect(remarkLabel("VL")).toEqual({ label: "VL", category: "leave" });
    expect(remarkLabel("S")).toEqual({ label: "S", category: "training" });
  });

  it("groups RR RR then a 7-day OFF block, showing each block's full length", () => {
    const days = { "2026-11-15": "RR", "2026-11-16": "RR" };
    for (let d = 17; d <= 23; d++) days[`2026-11-${d}`] = "X";
    const r = rosterRemark(roster(Object.entries(days)), today, 7);
    expect(r.map((b) => b.text)).toEqual(["RR 15/11–16/11 (2d) → OFF 17/11–23/11 (7d) · รวม 9d"]);
    expect(r[0].segments.map((x) => x.label)).toEqual(["RR", "OFF"]);
  });

  it("includes a leave block that started before the window", () => {
    const days = {};
    for (let d = 10; d <= 16; d++) days[`2026-11-${d}`] = "VL";
    days["2026-11-20"] = "SL";
    const r = rosterRemark(roster(Object.entries(days)), today, 7);
    expect(r.map((b) => b.text)).toEqual(["VL 10/11–16/11 (7d)", "SL 20/11"]);
  });

  it("is empty when the pilot is on duty all week or the roster is blank", () => {
    const days = {};
    for (let d = 15; d <= 21; d++) days[`2026-11-${d}`] = "O";
    expect(rosterRemark(roster(Object.entries(days)), today, 7)).toEqual([]);
    expect(rosterRemark(new Map(), today, 7)).toEqual([]);
  });
});

describe("RR pair before the 7-day OFF block", () => {
  const map = (o) => new Map(Object.entries(o));
  const off7 = (from) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [`2026-11-${String(from + i).padStart(2, "0")}`, "X"]));

  it("flags the two RR days immediately before a 7-day OFF", () => {
    const set = preOffRrDays(map({ "2026-11-15": "RR", "2026-11-16": "RR", ...off7(17) }));
    expect([...set].sort()).toEqual(["2026-11-15", "2026-11-16"]);
  });

  it("ignores an RR pair inside the work block", () => {
    const set = preOffRrDays(map({ "2026-11-02": "RR", "2026-11-03": "RR", "2026-11-04": "O" }));
    expect(set.size).toBe(0);
  });

  it("still flags the RR pair when OT made the OFF block shorter than 7 days", () => {
    const set = preOffRrDays(map({ "2026-11-08": "RR", "2026-11-09": "RR", "2026-11-10": "X", "2026-11-11": "X", "2026-11-12": "O" }));
    expect([...set].sort()).toEqual(["2026-11-08", "2026-11-09"]);
  });

  it("works when the OFF block starts with O,X and with a single RR", () => {
    const days = { "2026-11-16": "RR", ...off7(17) };
    days["2026-11-17"] = "O,X";
    expect([...preOffRrDays(map(days))]).toEqual(["2026-11-16"]);
  });
});

describe("remark chains of time away", () => {
  const map = (o) => new Map(Object.entries(o));
  const run = (code, fromDay, n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-11-${String(fromDay + i).padStart(2, "0")}`, code]));

  it("RR 2 -> OFF 7 -> VL reads as one chain with a total", () => {
    const r = rosterRemark(map({ ...run("RR", 15, 2), ...run("X", 17, 7), ...run("VL", 24, 4) }), today, 7);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe("RR 15/11–16/11 (2d) → OFF 17/11–23/11 (7d) → VL 24/11–27/11 (4d) · รวม 13d");
  });

  it("VL -> OFF -> VL, with the OFF shortened by OT, shows the real lengths", () => {
    const r = rosterRemark(map({ ...run("VL", 13, 3), ...run("X", 16, 4), ...run("VL", 20, 2), ...run("O", 22, 3) }), today, 7);
    expect(r[0].text).toBe("VL 13/11–15/11 (3d) → OFF 16/11–19/11 (4d) → VL 20/11–21/11 (2d) · รวม 9d");
  });

  it("keeps training apart from a time-off chain", () => {
    const r = rosterRemark(map({ ...run("S", 15, 2), ...run("RR", 17, 2), ...run("X", 19, 7) }), today, 7);
    expect(r.map((it) => it.text)).toEqual(["S 15/11–16/11 (2d)", "RR 17/11–18/11 (2d) → OFF 19/11–25/11 (7d) · รวม 9d"]);
  });
});
