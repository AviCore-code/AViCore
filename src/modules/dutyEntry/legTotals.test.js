import { describe, it, expect } from "vitest";
import { totalsFromLegs, legsWithHours, legsOverOnOffshore } from "./legTotals.js";

describe("Daily Duty totals from flights", () => {
  it("sums each field and groups role hours", () => {
    const t = totalsFromLegs([
      { role: "PIC", dayHours: "1:50", nightHours: "", ifrRulesHours: "0:40", toDay: "2", rs: "wju", ls: "ksu" },
      { role: "PIC", dayHours: "1:00", nightHours: "0:42", ifrRulesHours: "0:30", toDay: "2", rs: "WJU", ls: "KSU" }
    ]);
    expect(t.totalFlightTime).toBe("3:32");
    expect(t.roles).toEqual([{ role: "PIC", dayHours: "2:50", nightHours: "0:42" }]);
    expect(t.ifrRulesHours).toBe("1:10");
    expect(t.ifrHours).toBe("");     // never typed - stays blank, not 0:00
    expect(t.toDay).toBe("4");
    expect(t.crew).toEqual([{ rs: "WJU", ls: "KSU" }, { rs: "WJU", ls: "KSU" }]);
  });

  it("puts an old entry's day totals on flight 1 when the flights carry no hours", () => {
    const entry = { totalFlightTime: "3:00", roles: [{ role: "SIC", dayHours: "2:30", nightHours: "0:30" }], ifrRulesHours: "3:00", offshoreHours: "2:00", toDay: 3 };
    const legs = legsWithHours(entry, [{ route: "A" }, { route: "B" }]);
    expect(legs[0]).toMatchObject({ role: "SIC", dayHours: "2:30", nightHours: "0:30", ifrRulesHours: "3:00", offshoreHours: "2:00", toDay: 3 });
    expect(legs[1]).toMatchObject({ route: "B", role: "SIC" });
    expect(totalsFromLegs(legs).totalFlightTime).toBe("3:00");
  });

  it("flags a flight whose Onshore + Offshore is more than its time", () => {
    expect(legsOverOnOffshore([{ dayHours: "1:00", onshoreHours: "0:30", offshoreHours: "0:30" }, { dayHours: "1:00", offshoreHours: "1:10" }])).toEqual([2]);
  });
});
