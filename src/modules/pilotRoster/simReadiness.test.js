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
  it("S/T -> S -> S -> S/T is one 4-day trip starting on the first S/T", () => {
    const r = roster({ "2026-11-16": "S/T", "2026-11-17": "S", "2026-11-18": "S", "2026-11-19": "S/T", "2026-11-20": "O" });
    expect(simTrips(r, today)).toEqual([{ from: "2026-11-16", to: "2026-11-19", days: 4 }]);
  });

  it("looks 14 days ahead only, and not at a trip already under way", () => {
    const r = roster({ "2026-11-14": "S/T", "2026-11-15": "S", "2026-11-16": "S/T", "2026-11-29": "S/T" });
    expect(simTrips(r, today)).toEqual([]);
  });
});

describe("simReadiness: DT >= 60, FT >= 12, 168h lasts the trip", () => {
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

  it("flags roster duty in the 7 days before travel and a 168h that runs out mid-trip", () => {
    // Recovery Rest on record ended 12 Nov 07:30 (rest 10-12 Nov) -> 168h ends 19 Nov 07:30.
    const entries = [flight("2026-11-10", "07:00", "09:52", "1:00"), flight("2026-11-12", "08:30", "10:00", "0:30"),
      flight("2026-11-13", "08:00", "10:00", "1:00"), flight("2026-11-14", "08:00", "10:00", "1:00")];
    const r = roster({ "2026-11-17": "O", "2026-11-18": "S/T", "2026-11-19": "S", "2026-11-20": "S", "2026-11-21": "S/T" });
    const h = pilotHistory(entries, limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    const s = simReadiness(h, trip, limits, r, today);
    expect(s.dutyBefore.map((d) => d.iso)).toEqual(["2026-11-17"]);
    expect(s.cycleNeedHours).toBe(96);
    expect(s.cycleOk).toBe(false);
    expect(s.notes.join(" ")).toMatch(/Roster duty 17 Nov O/);
    expect(s.notes.join(" ")).toMatch(/Recovery Rest/);
  });

  it("ready after a rested week with 2 days off right before travel", () => {
    const r = roster({ "2026-11-20": "RR", "2026-11-21": "RR", "2026-11-22": "S/T", "2026-11-23": "S", "2026-11-24": "S/T" });
    const h = pilotHistory([flight("2026-11-02")], limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    const s = simReadiness(h, trip, limits, r, today);
    expect(s).toMatchObject({ dtOk: true, ftOk: true, cycleOk: true, status: "ok" });
  });
});
