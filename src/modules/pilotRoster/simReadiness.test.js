import { describe, expect, it } from "vitest";
import { pilotHistory, simTrips, simReadiness } from "./dutyHistory.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";

const limits = withFtlDefaults(DEFAULT_FTL_LIMITS);
const roster = (o) => new Map(Object.entries(o));
const today = "2026-11-14";

// A flight day: dep 08:00, stop 16:00 (report 1h before), 4h of flying.
const flight = (date, dep = "08:00", stop = "16:00", ft = "4:00") =>
  ({ dutyType: "flight", date, schDep: dep, stop, totalFlightTime: ft });

describe("simTrips: the roster's S/T marks a sim trip", () => {
  it("the first S/T is day 1 of a 5-day trip (the roster's own run kept for reference)", () => {
    const r = roster({ "2026-11-16": "S/T", "2026-11-17": "S", "2026-11-18": "S", "2026-11-19": "S/T", "2026-11-20": "O" });
    expect(simTrips(r, today)).toEqual([{ from: "2026-11-16", to: "2026-11-20", days: 5, rosterTo: "2026-11-19" }]);
  });

  it("looks 14 days ahead only, and not at a trip already under way", () => {
    const r = roster({ "2026-11-14": "S/T", "2026-11-15": "S", "2026-11-16": "S/T", "2026-11-29": "S/T" });
    expect(simTrips(r, today)).toEqual([]);
  });
});

describe("simReadiness: DT 7D >= 60, FT 7D >= 12, RR right before S/T", () => {
  it("not ready when recent duty leaves less than 60h DT on the travel day", () => {
    const entries = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].map(flight);
    const r = roster({ "2026-11-16": "S/T", "2026-11-17": "S", "2026-11-18": "S/T" });
    const h = pilotHistory(entries, limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    const s = simReadiness(h, trip, limits, r, today);
    expect(s.dtOk).toBe(false);
    expect(s.dtLeft).toBeLessThan(60);
    expect(s.ftOk).toBe(true);
    expect(s.status).toBe("exc");
    expect(s.readyFrom).toBeTruthy();
    expect(s.notes.join(" ")).toMatch(/short/);
  });

  it("flags roster duty in the 7 days before travel and no RR before S/T", () => {
    // Recovery Rest on record ended 12 Nov 07:30 (rest 10-12 Nov) -> 168h ends 19 Nov 07:30.
    const entries = [flight("2026-11-10", "07:00", "09:52", "1:00"), flight("2026-11-12", "08:30", "10:00", "0:30"),
      flight("2026-11-13", "08:00", "10:00", "1:00"), flight("2026-11-14", "08:00", "10:00", "1:00")];
    const r = roster({ "2026-11-17": "O", "2026-11-18": "S/T", "2026-11-19": "S", "2026-11-20": "S", "2026-11-21": "S/T" });
    const h = pilotHistory(entries, limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    const s = simReadiness(h, trip, limits, r, today);
    expect(s.dutyBefore.map((d) => d.iso)).toEqual(["2026-11-17"]);
    expect(s.cycleNeedHours).toBe(120);
    expect(s.rrBeforeOk).toBe(false);
    expect(s.status).toBe("exc");
    expect(s.notes.join(" ")).toMatch(/Roster duty 17 Nov O/);
    expect(s.notes.join(" ")).toMatch(/No RR before S\/T - put RR \(2 days\) on 16 Nov–17 Nov/);
  });

  it("ready after a rested week with 2 days off right before travel", () => {
    const r = roster({ "2026-11-20": "RR", "2026-11-21": "RR", "2026-11-22": "S/T", "2026-11-23": "S", "2026-11-24": "S/T" });
    const h = pilotHistory([flight("2026-11-02")], limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    const s = simReadiness(h, trip, limits, r, today);
    expect(s).toMatchObject({ dtOk: true, ftOk: true, rrBeforeOk: true, status: "ok", rrText: "RR 20–21 Nov" });
  });
});

it("a single RR day before S/T is not a Recovery Rest", () => {
  const r = roster({ "2026-11-21": "RR", "2026-11-22": "S/T", "2026-11-23": "S" });
  const h = pilotHistory([flight("2026-11-02")], limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
  const [trip] = simTrips(r, today);
  expect(simReadiness(h, trip, limits, r, today).rrBeforeOk).toBe(false);
});

import { simDayMarks } from "./dutyHistory.js";
import { nextWeekScore } from "./DutyHistory.jsx";

describe("Next 7 days before S/T", () => {
  const r = roster({ "2026-11-16": "O", "2026-11-17": "O", "2026-11-18": "S/T", "2026-11-19": "S" });
  const h = pilotHistory([flight("2026-11-02")], limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
  const sims = simTrips(r, today).map((t) => simReadiness(h, t, limits, r, today));
  const marks = simDayMarks(sims);

  it("marks the 7 days before S/T as keep-free and the trip days as SIM d1..d5", () => {
    expect(marks.get("2026-11-17")).toMatchObject({ kind: "lead", daysTo: 1, keepFree: true });
    expect(marks.get("2026-11-11")).toMatchObject({ kind: "lead", daysTo: 7 });
    expect(marks.get("2026-11-18")).toMatchObject({ kind: "trip", n: 1 });
    expect(marks.get("2026-11-22")).toMatchObject({ kind: "trip", n: 5 });
  });

  it("those days are not counted as green days to fly", () => {
    const plain = nextWeekScore(h, r, new Set());
    const withSim = nextWeekScore(h, r, new Set(), marks);
    expect(plain.green).toBe(7);
    expect(withSim.green).toBe(0);
    expect(withSim.off).toBe(7);
  });
});
