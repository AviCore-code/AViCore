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
  it("S/T S S S/T is a 4-day trip, as the roster says", () => {
    const r = roster({ "2026-11-16": "S/T", "2026-11-17": "S", "2026-11-18": "S", "2026-11-19": "S/T", "2026-11-20": "O" });
    expect(simTrips(r, today)).toEqual([{ from: "2026-11-16", to: "2026-11-19", days: 4 }]);
  });

  it("S/T S S S S S/T is a 6-day trip", () => {
    const r = roster({ "2026-11-16": "S/T", "2026-11-17": "S", "2026-11-18": "S", "2026-11-19": "S", "2026-11-20": "S", "2026-11-21": "S/T" });
    expect(simTrips(r, today)).toEqual([{ from: "2026-11-16", to: "2026-11-21", days: 6 }]);
  });

  it("looks 21 days ahead only (the 14-day table + 7 days before S/T), and not at a trip already under way", () => {
    const r = roster({ "2026-11-14": "S/T", "2026-11-15": "S", "2026-11-16": "S/T", "2026-12-06": "S/T" });
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
    expect(s.cycleNeedHours).toBe(96);
    expect(s.rrBeforeOk).toBe(false);
    expect(s.status).toBe("exc");
    expect(s.notes.join(" ")).toMatch(/Roster duty 17 Nov O/);
    expect(s.notes.join(" ")).toMatch(/168h cycle: the 4-day trip needs 96h from S\/T, 31h left on 18 Nov - put RR \(2 days\) ending between 16 Nov and 17 Nov/);
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
  const marks = simDayMarks(sims, r);

  it("marks the 7 days before S/T as keep-free and the trip days with their roster code", () => {
    expect(marks.get("2026-11-17")).toMatchObject({ kind: "lead", daysTo: 1, keepFree: true });
    expect(marks.get("2026-11-11")).toMatchObject({ kind: "lead", daysTo: 7 });
    expect(marks.get("2026-11-18")).toMatchObject({ kind: "trip", n: 1, code: "S/T" });
    expect(marks.get("2026-11-19")).toMatchObject({ kind: "trip", n: 2, code: "S" });
    expect(marks.get("2026-11-20")).toBeUndefined();
  });

  it("those days are not counted as green days to fly", () => {
    const plain = nextWeekScore(h, r, new Set());
    const withSim = nextWeekScore(h, r, new Set(), marks);
    expect(plain.green).toBe(7);
    expect(withSim.green).toBe(2);   // 20-21 Nov: after the 2-day trip on the roster
    expect(withSim.off).toBe(5);
  });
});

// Capt. Weera, 20 Nov 2026: a 4-5 day sim uses 96-120h of the 168h cycle. The
// RR before S/T can be earlier than the day before - as long as the cycle
// carries the trip AND the duty the roster still has after it, up to the next
// RR / OFF / VL. After the sim, the hours left say how much more duty fits.
describe("Sim trip and the 168h cycle", () => {
  const base = { "2026-11-15": "O", "2026-11-16": "O", "2026-11-17": "O", "2026-11-18": "O", "2026-11-19": "O" };
  const trip4 = { "2026-11-24": "S/T", "2026-11-25": "S", "2026-11-26": "S", "2026-11-27": "S/T" };
  const check = (o) => {
    const r = roster({ ...base, ...o });
    const h = pilotHistory([flight("2026-11-02")], limits, { todayIso: today, asOf: new Date(2026, 10, 14, 21), rosterDays: r });
    const [trip] = simTrips(r, today);
    return { s: simReadiness(h, trip, limits, r, today), r };
  };

  it("4-day sim, RR ending 3 days before S/T, 1 duty day after: fits, 24h left after the sim", () => {
    const { s } = check({ ...trip4, "2026-11-20": "RR", "2026-11-21": "RR", "2026-11-22": "O", "2026-11-23": "O", "2026-11-28": "O", "2026-11-29": "X", "2026-11-30": "X" });
    expect(s).toMatchObject({ rrBeforeOk: true, cycleNeedHours: 120, cycleHoursAtStart: 120, afterLeft: 24, rrText: "RR 20–21 Nov" });
    expect(s.afterDuty.map((d) => d.iso)).toEqual(["2026-11-28"]);
    expect(s.notes.join(" ")).toMatch(/After the sim: 24h of the 168h cycle left - duty possible up to 28 Nov, then RR \(roster: OFF 29–30 Nov\)/);
  });

  it("RR ending 4 days before S/T is too early when there is duty after the sim", () => {
    const { s, r } = check({ ...trip4, "2026-11-19": "RR", "2026-11-20": "RR", "2026-11-21": "O", "2026-11-22": "O", "2026-11-23": "O", "2026-11-28": "O", "2026-11-29": "X", "2026-11-30": "X" });
    expect(s.rrBeforeOk).toBe(false);
    expect(s.status).toBe("exc");
    expect(s.rrWindow).toMatchObject({ earliestEnd: "2026-11-21", to: "2026-11-23" });
    expect(s.notes.join(" ")).toMatch(/needs 120h from S\/T, 96h left on 24 Nov - put RR \(2 days\) ending between 21 Nov and 23 Nov/);
    const marks = simDayMarks([s], r);
    expect(marks.get("2026-11-22")).toMatchObject({ kind: "lead", rrOk: true });
    expect(marks.get("2026-11-18")).toMatchObject({ kind: "lead", rrOk: false });
  });

  it("the same early RR is fine when OFF comes right after the sim - OFF counts as the RR", () => {
    const { s, r } = check({ ...trip4, "2026-11-19": "RR", "2026-11-20": "RR", "2026-11-21": "O", "2026-11-22": "O", "2026-11-23": "O", "2026-11-28": "X", "2026-11-29": "X" });
    expect(s).toMatchObject({ rrBeforeOk: true, cycleNeedHours: 96, afterLeft: 0 });
    expect(s.notes.join(" ")).toMatch(/RR right after the sim \(roster: OFF 28–29 Nov ✓\)/);
    expect(simDayMarks([s], r).get("2026-11-28")).toBeUndefined();
  });

  it("5-day sim with 1 duty day after: RR may end 2 days before S/T", () => {
    const trip5 = { "2026-11-24": "S/T", "2026-11-25": "S", "2026-11-26": "S", "2026-11-27": "S", "2026-11-28": "S/T", "2026-11-29": "O", "2026-11-30": "X", "2026-12-01": "X" };
    const ok = check({ ...trip5, "2026-11-21": "RR", "2026-11-22": "RR", "2026-11-23": "O" }).s;
    expect(ok).toMatchObject({ rrBeforeOk: true, cycleNeedHours: 144, afterLeft: 24 });
    const early = check({ ...trip5, "2026-11-20": "RR", "2026-11-21": "RR", "2026-11-22": "O", "2026-11-23": "O" }).s;
    expect(early.rrBeforeOk).toBe(false);
    expect(early.rrWindow.earliestEnd).toBe("2026-11-22");
  });

  it("marks the duty days after the sim with the hours left", () => {
    const { s, r } = check({ ...trip4, "2026-11-20": "RR", "2026-11-21": "RR", "2026-11-22": "O", "2026-11-23": "O", "2026-11-28": "O", "2026-11-29": "X", "2026-11-30": "X" });
    const marks = simDayMarks([s], r);
    expect(marks.get("2026-11-28")).toMatchObject({ kind: "after", left: 24 });
    expect(marks.get("2026-11-29")).toBeUndefined();
  });
});
