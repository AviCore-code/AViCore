import { describe, expect, it } from "vitest";
import { buildFdtLegs, splitRouteParts, splitRegistrations, shareMinutes, partMinutes, parseRouteFlights } from "./fdtLegs.js";

const day = (o) => ({ crew: [{ rs: "TYO", ls: "WJU" }, { rs: "TYO", ls: "WJU" }], route: "", registration: "HS-UOM", flightType: "Revenue",
  roles: [{ role: "PIC", dayHours: "5:37", nightHours: "0:00" }], totalMin: 337, ifrRulesMin: 337, ifrMin: 0, offshoreMin: 337, onshoreMin: 0,
  toDay: 3, toNight: 0, landDay: 3, landNight: 0, iApp: 0, ...o });

describe("FDT import - one row per flight", () => {
  it("splits routes on a single slash, keeps // inside a route, drops 1. 2. numbering", () => {
    expect(splitRouteParts("VTSH-AQP-VTSH(2:20)/VTSH-KAMAA-QPS//WISDOM-VTSH(3:29)")).toEqual(["VTSH-AQP-VTSH(2:20)", "VTSH-KAMAA-QPS//WISDOM-VTSH(3:29)"]);
    expect(splitRouteParts("1.VTSH-AQP-VTSH(2:20)  2.VTSH-QPS-VTSH(2:13)")).toEqual(["VTSH-AQP-VTSH(2:20)", "VTSH-QPS-VTSH(2:13)"]);
    expect(splitRouteParts("1. VTSH-EDRIL-VTSH (2:28) /2. VTSH-WB300-VTSH (2:09)")).toEqual(["VTSH-EDRIL-VTSH (2:28)", "VTSH-WB300-VTSH (2:09)"]);
    expect(partMinutes("VTSH-SDETH-VTSH(2;29)")).toBe(149);
    expect(splitRegistrations("HS-UOL/N")).toEqual(["HS-UOL", "HS-UON"]);
    expect(shareMinutes(5, [1, 1])).toEqual([3, 2]);
  });

  it("2 flights with (h:mm) per route: RS/LS, route, registration and hours per flight; counts on flight 1", () => {
    const { legs, split } = buildFdtLegs(day({ route: "VTSH-EDRIL2-VTSH(2:09)/VTSH-WSDOM-VTSH(3:28)", registration: "HS-UOL/N" }));
    expect(split).toBe("per-flight");
    expect(legs).toHaveLength(2);
    expect(legs[0]).toMatchObject({ rs: "TYO", ls: "WJU", registration: "HS-UOL", route: "VTSH-EDRIL2-VTSH(2:09)", role: "PIC", dayHours: "2:09", offshoreHours: "2:09", toDay: "3", landDay: "3" });
    expect(legs[1]).toMatchObject({ registration: "HS-UON", route: "VTSH-WSDOM-VTSH(3:28)", dayHours: "3:28", ifrRulesHours: "3:28", toDay: "", landDay: "" });
  });

  it("times missing or not adding up: whole day on flight 1, routes kept together", () => {
    const { legs, split } = buildFdtLegs(day({ route: "VTSH-PLLQ2-VTSH" }));
    expect(split).toBe("first-flight");
    expect(legs[0]).toMatchObject({ route: "VTSH-PLLQ2-VTSH", dayHours: "5:37", offshoreHours: "5:37" });
    expect(legs[1]).toMatchObject({ rs: "TYO", route: "", dayHours: "" });
  });

  it("no RS/LS -> one flight; mixed day/night and two roles shared out", () => {
    expect(buildFdtLegs(day({ crew: [], route: "VTSH-A-VTSH/VTSH-B-VTSH" })).legs).toHaveLength(1);
    // Route lists timed flights adding up to the day -> that many flights.
    expect(buildFdtLegs(day({ crew: [], route: "VTSH-A-VTSH(2:00)/VTSH-B-VTSH(3:37)" })).legs).toHaveLength(2);
    const { legs } = buildFdtLegs(day({ route: "VTSH-A-VTSH(2:00)/VTSH-B-VTSH(3:37)",
      roles: [{ role: "PIC", dayHours: "3:37", nightHours: "0:00" }, { role: "SIC", dayHours: "1:00", nightHours: "1:00" }] }));
    // 1:00 of 5:37 role time is night -> 60 of 337 min stays night here (ratio 60/337 of 337).
    expect(legs.map((l) => l.role)).toEqual(["SIC", "PIC"]);
    const mins = (s) => (s ? Number(s.split(":")[0]) * 60 + Number(s.split(":")[1]) : 0);
    expect(legs.reduce((a, l) => a + mins(l.dayHours) + mins(l.nightHours), 0)).toBe(337);
    expect(legs.reduce((a, l) => a + mins(l.nightHours), 0)).toBe(60);
  });

  it("instructor logs TRI and PIC for the same flight: flight time not doubled", () => {
    const { legs } = buildFdtLegs(day({ crew: [{ rs: "KPO", ls: "XYZ" }], route: "VTSH-VTSH", totalMin: 147,
      roles: [{ role: "TRI", dayHours: "2:27", nightHours: "0:00" }, { role: "PIC", dayHours: "2:27", nightHours: "0:00" }] }));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ dayHours: "2:27", nightHours: "" });
  });

  it("reads '(UOA 1:58) 1/1 , ...': aircraft, time and T/O / LDG per flight", () => {
    expect(parseRouteFlights("VTSH-SDE (UOA 1:58) 1/1 , VTSH-SDE (UOA 1:56) 1/1").map((p) => [p.minutes, p.reg, p.to, p.ldg]))
      .toEqual([[118, "UOA", 1, 1], [116, "UOA", 1, 1]]);
    const { legs, split } = buildFdtLegs(day({ crew: [{ rs: "PKR", ls: "CSU" }, { rs: "PKR", ls: "CSU" }], registration: "HS-UOA",
      route: "VTSH-SDE (UOA 1:58) 1/1 , VTSH-SDE (UOA 1:56) 1/1", totalMin: 234, offshoreMin: 234, ifrRulesMin: 0, toDay: 2, landDay: 2 }));
    expect(split).toBe("per-flight");
    expect(legs.map((l) => [l.registration, l.route, l.dayHours, l.toDay, l.landDay])).toEqual([
      ["HS-UOA", "VTSH-SDE (UOA 1:58) 1/1", "1:58", "1", "1"],
      ["HS-UOA", "VTSH-SDE (UOA 1:56) 1/1", "1:56", "1", "1"]]);
  });

  it("three flights with commas and n/n; counts that don't add up stay on flight 1", () => {
    const route = "VTSH-RT15 (2:17) 2/1 , RT15 (2:09) 2/1, IDUN (2:30 ) 1/0";
    const crew = [{ rs: "CSU", ls: "SBO" }];
    const ok = buildFdtLegs(day({ crew, route, totalMin: 416, toDay: 5, landDay: 2 })).legs;
    expect(ok).toHaveLength(3);                                  // route has 3 timed flights = the day's 6:56
    expect(ok.map((l) => [l.rs, l.dayHours, l.toDay, l.landDay])).toEqual([["CSU", "2:17", "2", "1"], ["CSU", "2:09", "2", "1"], ["CSU", "2:30", "1", ""]]);
    const off = buildFdtLegs(day({ crew, route, totalMin: 416, toDay: 6, landDay: 2 })).legs;
    expect(off.map((l) => l.toDay)).toEqual(["6", "", ""]);
  });
});
