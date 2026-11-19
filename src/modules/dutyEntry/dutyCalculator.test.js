import { describe, expect, it } from "vitest";
import { DEFAULT_FTL_LIMITS as L } from "../../utils/ftlLimits.js";
import { calcFromStart, calcStandby } from "./dutyCalculator.js";

const base = new Date(2026, 10, 17);
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

describe("Duty Time Calculator", () => {
  it("1. flying only: start = report, Max FDP / FT by report time as hours and clock time", () => {
    expect(calcFromStart("flight", "", L, base)).toBeNull();
    const r = calcFromStart("flight", "05:00", L, base);
    expect(r).toMatchObject({ maxFdp: 10, maxFt: 7 });
    expect(hm(r.fdpEnd)).toBe("15:00");
    expect(hm(r.extEnd)).toBe("17:00");
    expect(hm(r.dutyEnd)).toBe("15:30");
    expect(calcFromStart("flight", "22:00", L, base)).toMatchObject({ maxFdp: 9, maxFt: 6 });
  });

  it("2. mixed: ground first reports 1h before the ground duty", () => {
    const g = calcFromStart("ground-flight", "08:00", L, base);
    expect(hm(g.report)).toBe("07:00");
    expect(g.maxFdp).toBe(12);
    expect(hm(g.fdpEnd)).toBe("19:00");
    const f = calcFromStart("flight-ground", "08:00", L, base);
    expect(hm(f.report)).toBe("08:00");
  });

  it("3. standby: a row per call-out time, Max FDP reduced after 6h, capped by Standby + FDP 18h", () => {
    const s = calcStandby("17:30", L, base);
    expect(hm(s.standbyEnd)).toBe("05:30");
    expect(hm(s.awakeEnd)).toBe("11:30");
    expect(s.rows).toHaveLength(12);
    const r6 = s.rows[5];                       // called 23:30, 6h standby
    expect(r6.reduction).toBe(0);
    expect(r6.maxFdp).toBe(9);                  // 2100-0459 row
    const r12 = s.rows[11];                     // called 05:30
    expect(hm(r12.report)).toBe("05:30");
    expect(r12).toMatchObject({ reduction: 6, maxFdp: 4 });
    expect(hm(r12.latestStop)).toBe("09:30");
    expect(hm(r12.callout)).toBe("04:30");
    expect(hm(s.latestCallout)).toBe("04:30");     // report by 05:30 = 17:30 + 12h
    expect(hm(s.freeReport)).toBe("23:30");        // 17:30 + 6h, no reduction
    expect(hm(s.freeCallout)).toBe("22:30");
    // Duty period: report to engine stop + 30 min post-flight.
    expect(hm(s.rows[0].report) + "-" + hm(s.rows[0].dutyEnd)).toBe("18:30-05:00");
    expect(hm(r12.dutyEnd)).toBe("10:00");
    // A standby starting at 23:00 doesn't count the night: no cut until 07:00 + 6h... capped by 12h.
    const n = calcStandby("23:00", L, base);
    expect(hm(n.freeReport)).toBe("11:00");
  });
});
