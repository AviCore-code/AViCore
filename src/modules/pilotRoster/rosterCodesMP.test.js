import { describe, expect, it } from "vitest";
import { getCodeInfo, rosterDayInfo } from "./rosterCodes.js";
import { ITEM_ROSTER_CODES, trainingCodeFor } from "./weeklyPlanTrainingQueue.js";

describe("codes on 'RR 2026_Add Training (MP)'", () => {
  it("G, DG, CRM, PBN, ESE are training days that occupy the pilot", () => {
    for (const c of ["G", "DG", "CRM", "PBN", "ESE"]) {
      expect(getCodeInfo(c).category).toBe("training");
      expect(rosterDayInfo(c).occupied).toBe("day");
      expect(rosterDayInfo(c).onDuty).toBe(false);
    }
    expect(rosterDayInfo("O,PBN").occupied).toBe("day");
  });
  it("retired T and N show as what they count as, not grey", () => {
    expect(getCodeInfo("T").category).toBe("training");
    expect(getCodeInfo("N").category).toBe("duty");
    expect(getCodeInfo("O,T").label).toMatch(/Flight Training/);
  });
  it("these codes satisfy their training items; bookings still use the first code", () => {
    expect(ITEM_ROSTER_CODES.ground).toEqual(["G"]);
    expect(ITEM_ROSTER_CODES.dgs).toEqual(["DG"]);
    expect(ITEM_ROSTER_CODES.ese).toEqual(["ESE"]);
    expect(ITEM_ROSTER_CODES.crm).toContain("CRM");
    expect(trainingCodeFor("crm")).toBe("CR");
    expect(trainingCodeFor("pbn")).toBe("S");
  });
  it("still unknown until confirmed: UTP, A, CAT, INSP", () => {
    for (const c of ["UTP", "A", "CAT", "INSP"]) expect(getCodeInfo(c).category).toBe("unknown");
  });
});
