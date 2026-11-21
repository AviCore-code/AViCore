import { describe, expect, it } from "vitest";
import { entryAircraftType, DEFAULT_AIRCRAFT_TYPE } from "./aircraftType.js";
import { combineAircraftRows } from "./experienceCombine.js";
import { monthFtOnType } from "../modules/reports/reportUtils.js";

// Capt. Weera, 21 Nov 2026: FDT flights carry no aircraft type, so their
// AW139 hours dropped out of Pilot Experience Summary. A flight with no type
// counts as the company's type.
const flight = (o) => ({ dutyType: "flight", date: "2026-11-17", totalFlightTime: "6:19",
  roles: [{ role: "PIC", dayHours: "6:19", nightHours: "0:00" }], ...o });

describe("aircraft type of a flight", () => {
  it("own type, else first flight row's, else the company's (AW139)", () => {
    expect(DEFAULT_AIRCRAFT_TYPE).toBe("AW139");
    expect(entryAircraftType(flight({ aircraftType: "BELL412" }))).toBe("BELL412");
    expect(entryAircraftType(flight({ aircraftType: "", legs: [{ aircraftType: "" }, { aircraftType: "S76C++" }] }))).toBe("S76C++");
    expect(entryAircraftType(flight({ aircraftType: "" }))).toBe("AW139");
  });

  it("Pilot Experience: FDT flights with no type are added to the AW139 row, not to other types", () => {
    const rows = [["AW139", "974:46", "0:00", "71:27"], ["BELL412", "1575:00", "0:00", "25:00"]];
    const entries = [flight({ aircraftType: "" }), flight({ aircraftType: "", date: "2026-11-18", roles: [{ role: "SIC", dayHours: "2:00", nightHours: "0:00" }] }),
      flight({ aircraftType: "BELL412", date: "2026-11-19", roles: [{ role: "PIC", dayHours: "1:00", nightHours: "0:00" }] })];
    const [aw, bell] = combineAircraftRows(rows, entries, new Date(2026, 10, 1));
    expect(aw.row).toEqual(["AW139", "981:05", "0:00", "73:27", "1054:32"]);
    expect(aw.addedCount).toBe(2);
    expect(bell.row[1]).toBe("1576:00");
  });

  it("Report: monthly FT on AW139 counts flights with no type", () => {
    expect(monthFtOnType([flight({ aircraftType: "" }), flight({ aircraftType: "AW 139", totalFlightTime: "1:00" })], "AW139", "2026-11-01", "2026-11-30")).toBeCloseTo(7.3167, 3);
  });
});
