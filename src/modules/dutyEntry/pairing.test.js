import { describe, expect, it } from "vitest";
import { partnersOf, pairRoles, buildPartnerEntry, comparePair, compareDay, isCaptain } from "./pairing.js";

const leg = (o) => ({ flightType: "Revenue Flight", aircraftType: "AW139", registration: "HS-UOL", route: "VTSH-CPOC-VTSH", role: "PIC",
  dayHours: "1:50", nightHours: "", ifrRulesHours: "1:50", ifrHours: "0:10", onshoreHours: "0:20", offshoreHours: "1:30",
  toDay: "2", toNight: "", landDay: "2", landNight: "", iApp: "1", ...o });

describe("pairing", () => {
  it("finds who flew each flight with me", () => {
    const m = partnersOf([leg({ rs: "WJU", ls: "TYO" }), leg({ rs: "KSU", ls: "wju" }), leg({ rs: "WJU", ls: "TYO" }), leg({ rs: "WJU", ls: "" })], "WJU");
    expect([...m.entries()]).toEqual([["TYO", [0, 2]], ["KSU", [1]]]);
  });

  it("Captain by Experience rank is PIC, the other SIC; two captains -> the one entering is PIC", () => {
    const pos = new Map([["WJU", "FO"], ["TYO", "Captain"], ["KSU", "Captain"]]);
    expect(pairRoles("WJU", "TYO", pos)).toEqual({ mine: "SIC", theirs: "PIC" });
    expect(pairRoles("TYO", "WJU", pos)).toEqual({ mine: "PIC", theirs: "SIC" });
    expect(pairRoles("KSU", "TYO", pos)).toEqual({ mine: "PIC", theirs: "SIC" });
    expect(isCaptain("Capt.")).toBe(true);
    expect(isCaptain("SFO")).toBe(false);
  });

  it("builds the partner's entry: only shared flights, their role, no T/O LDG I.App, totals re-summed", () => {
    const mine = { id: "x", pilotCode: "WJU", dutyType: "flight", date: "2026-11-16", schDep: "05:30", stop: "09:32", totalDuty: "4:02",
      legs: [leg({ rs: "WJU", ls: "TYO" }), leg({ rs: "WJU", ls: "KSU", route: "VTSH-ERLQ2-VTSH", dayHours: "1:00" })] };
    const out = buildPartnerEntry(mine, "WJU", "TYO", [0], "SIC", "2026-11-16T10:00:00Z");
    expect(out.id).toBeUndefined();
    expect(out.pilotCode).toBe("TYO");
    expect(out.schDep).toBe("05:30");
    expect(out.legs).toHaveLength(1);
    expect(out.legs[0]).toMatchObject({ role: "SIC", rs: "WJU", ls: "TYO", dayHours: "1:50", toDay: "", landDay: "", iApp: "" });
    expect(out.totalFlightTime).toBe("1:50");
    expect(out.roles).toEqual([{ role: "SIC", dayHours: "1:50", nightHours: "0:00" }]);
    expect(out.route).toBe("VTSH-CPOC-VTSH");
    expect([out.toDay, out.landDay, out.iApp]).toEqual(["", "", ""]);
    expect(out.pairCopy).toEqual({ from: "WJU", at: "2026-11-16T10:00:00Z" });
  });

  it("compares flight by flight and the day times", () => {
    const a = [leg({ rs: "WJU", ls: "TYO" }), leg({ rs: "WJU", ls: "TYO" })];
    const b = [leg({ rs: "TYO", ls: "WJU", dayHours: "01:50", toDay: "5", role: "SIC" }), leg({ rs: "WJU", ls: "TYO", route: "VTSH-BQP-VTSH" })];
    const r = comparePair(a, b);
    expect(r.pairs[0].diffs).toEqual(["rs", "ls"]);         // seats swapped; T/O and Role aren't compared; 1:50 == 01:50
    expect(r.pairs[1].diffs).toEqual(["route"]);
    expect(comparePair(a, b.slice(0, 1)).diffCount).toBe(3); // rs + ls + one flight missing
    expect(compareDay({ schDep: "05:30", stop: "09:32" }, { schDep: "5:30", stop: "09:40" })).toEqual(["stop"]);
  });
});
