import { describe, expect, it } from "vitest";
import { buildDutyPeriods } from "../../utils/dutyPeriods.js";
import { DEFAULT_FTL_LIMITS as L } from "../../utils/ftlLimits.js";
import { dailyMonitor, limitStatus } from "./dailyMonitor.js";

const nightStby = { id: "s", dutyType: "non_flight", nonFlightType: "Night Standby", date: "2026-11-16", start: "17:30", end: "05:30", endDate: "2026-11-17" };
const flight = (o) => ({ id: "f", dutyType: "flight", date: "2026-11-17", schDep: "06:30", stop: "08:00", totalFlightTime: "1:20", ...o });
const byKey = (card) => Object.fromEntries(card.bars.map((b) => [b.key, b]));

describe("Daily Duty Monitor", () => {
  it("Night Standby called out to fly: standby, reduced FDP, flight time, standby + FDP", () => {
    const periods = buildDutyPeriods([nightStby, flight()], L);
    for (const date of ["2026-11-16", "2026-11-17"]) {
      const [c] = dailyMonitor(periods, date, L);
      expect(c.kind).toBe("flight");
      const b = byKey(c);
      expect(b.stby).toMatchObject({ used: 12, limit: 12, status: "warn" });
      expect(b.fdp).toMatchObject({ used: 2.5, limit: 4, status: "ok" });
      expect(c.reducedBy).toBe(6);
      expect(b.ft).toMatchObject({ limit: 7, status: "ok" });
      expect(b.ft.used).toBeCloseTo(1.333, 2);
      expect(b.awake).toMatchObject({ used: 14.5, limit: 18 });
      expect(c.notes[0].at.getHours()).toBe(9); // report 05:30 + 4:00
      expect(c.notes[0].at.getMinutes()).toBe(30);
    }
  });

  it("FDP over Max FDP: warn within the 2h extension, exceeded beyond", () => {
    const warn = dailyMonitor(buildDutyPeriods([nightStby, flight({ stop: "10:30" })], L), "2026-11-17", L)[0];
    expect(byKey(warn).fdp.status).toBe("warn");
    const exc = dailyMonitor(buildDutyPeriods([nightStby, flight({ stop: "12:00" })], L), "2026-11-17", L)[0];
    expect(byKey(exc).fdp.status).toBe("exc");
    expect(exc.status).toBe("exc");
  });

  it("quiet standby and plain flying day", () => {
    const [q] = dailyMonitor(buildDutyPeriods([nightStby], L), "2026-11-16", L);
    expect(q.kind).toBe("standby");
    expect(byKey(q).stby).toMatchObject({ used: 12, limit: 12 });
    const [f] = dailyMonitor(buildDutyPeriods([flight({ date: "2026-11-18", schDep: "07:30", stop: "12:00", totalFlightTime: "3:30" })], L), "2026-11-18", L);
    expect(byKey(f).fdp).toMatchObject({ used: 5.5, limit: 11, remaining: 5.5 });
    expect(byKey(f).ft).toMatchObject({ used: 3.5, limit: 8 });
    expect(byKey(f).stby).toBeUndefined();
    expect(dailyMonitor([], "2026-11-18", L)).toEqual([]);
  });

  it("Mixed Duty: flight then ground duty within 8h is one duty, held to Max FDP", () => {
    const fl = flight({ date: "2026-11-17", schDep: "06:00", stop: "14:06", totalFlightTime: "6:19" });
    const office = { id: "o", dutyType: "non_flight", nonFlightType: "Office", date: "2026-11-17", start: "15:00", end: "18:30" };
    const periods = buildDutyPeriods([fl, office], L);
    expect(periods).toHaveLength(1);
    const [c] = dailyMonitor(periods, "2026-11-17", L);
    expect(c.kind).toBe("mixed");
    expect(c.start.getHours()).toBe(5);                       // Sch Dep 06:00 - 1:00
    const b = byKey(c);
    expect(b.fdp).toMatchObject({ used: 9.1, limit: 10 });    // FDP to rotors stop 14:06
    expect(b.mix).toMatchObject({ used: 13.5, limit: 10, status: "exc" }); // 05:00 -> 18:30
    expect(c.status).toBe("exc");
    expect(byKey(c).ft.used).toBeCloseTo(6.317, 2);
  });

  it("Mixed Duty: ground duty then a flight - FDP starts at the ground duty -1h", () => {
    const office = { id: "o", dutyType: "non_flight", nonFlightType: "Office", date: "2026-11-17", start: "08:00", end: "11:00" };
    const fl = flight({ date: "2026-11-17", schDep: "13:00", stop: "15:00", totalFlightTime: "1:50" });
    const [p] = buildDutyPeriods([office, fl], L);
    expect(p.start.getHours()).toBe(7);
    expect(p.fdpHours).toBe(8);
    expect(p.maxFdp).toBe(12);                                 // report 07:00 row
    expect(p.mixed).toBe(true);
    expect(p.status).toBe("ok");
  });

  it("ground duty 8h or more from the flight stays a separate duty", () => {
    const fl = flight({ date: "2026-11-17", schDep: "06:00", stop: "08:00" });
    const office = { id: "o", dutyType: "non_flight", nonFlightType: "Office", date: "2026-11-17", start: "17:00", end: "18:00" };
    expect(buildDutyPeriods([fl, office], L)).toHaveLength(2);   // 08:30 -> 17:00 = 8:30 rest
    const near = { ...office, start: "16:00" };                   // 7:30 gap -> one duty
    expect(buildDutyPeriods([fl, near], L)).toHaveLength(1);
  });

  it("status thresholds", () => {
    expect(limitStatus(5, 10)).toBe("ok");
    expect(limitStatus(9, 10)).toBe("warn");
    expect(limitStatus(11, 10)).toBe("exc");
    expect(limitStatus(11, 10, 12)).toBe("warn");
    expect(limitStatus(3, null)).toBe("info");
  });
});
