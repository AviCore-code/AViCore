import { describe, expect, it } from "vitest";
import { entryFlightCount, entryFlightTypes } from "./flightLegs.js";
import { scoreDaysForPilot } from "./fatigueMonitor.js";
import { monthlyFleetTotals } from "./fdtStatistics.js";

const multi = {
  dutyType: "flight", date: "2026-10-30", schDep: "07:30", stop: "15:10", totalFlightTime: "4:35",
  flightType: "Revenue Flight", route: "VTSH-CPOC-VTSH/VTSH-BQP-VTSH/VTSH-VTSH",
  legs: [
    { flightType: "Revenue Flight", registration: "HS-UOM", route: "VTSH-CPOC-VTSH" },
    { flightType: "Revenue Flight", registration: "HS-UOM", route: "VTSH-BQP-VTSH" },
    { flightType: "Training", registration: "HS-UOA", route: "VTSH-VTSH" }
  ]
};

describe("flights inside one duty entry", () => {
  it("counts legs, falling back to one flight per entry", () => {
    expect(entryFlightCount(multi)).toBe(3);
    expect(entryFlightCount({ dutyType: "flight" })).toBe(1);
    expect(entryFlightCount({ dutyType: "flight", legs: [] })).toBe(1);
    expect(entryFlightCount({ dutyType: "non_flight" })).toBe(0);
  });

  it("lists the flight types flown, without repeats", () => {
    expect(entryFlightTypes(multi)).toEqual(["Revenue Flight", "Training"]);
    expect(entryFlightTypes({ flightType: "Ferry Flight" })).toEqual(["Ferry Flight"]);
  });

  it("Fatigue Monitor scores every flight in the entry, not one per entry", () => {
    const [day] = scoreDaysForPilot([multi]);
    expect(day.flights).toBe(3);
    expect(day.sectors).toBe(5);
  });

  it("FDT Statistics counts every flight in the entry", () => {
    const [m] = monthlyFleetTotals({ rows: [{ pilot: { code: "WJU" }, entries: [multi] }], limits: undefined, months: ["2026-10"] });
    expect(m.flights).toBe(3);
  });
});
