import { describe, it, expect } from "vitest";
import { buildDtWorkHr, classifyDay } from "./dtWorkHr.js";

const r = (pilot_code, pilot_name, date, code) => ({ pilot_code, pilot_name, date, code });

describe("DT Work for HR", () => {
  it("counts every code as a work day except X, SL and VL", () => {
    expect(classifyDay("O")).toBe("normal");
    expect(classifyDay("RR")).toBe("normal");
    expect(classifyDay("S/T")).toBe("normal");
    expect(classifyDay("X")).toBe("off");
    expect(classifyDay("O,X")).toBe("off");
    expect(classifyDay("x")).toBe("off");
    expect(classifyDay("VL")).toBe("off");
    expect(classifyDay("SL")).toBe("off");
    expect(classifyDay("vl")).toBe("off");
    expect(classifyDay("OT")).toBe("ot");
    expect(classifyDay("OTS")).toBe("ot");
    expect(classifyDay("")).toBe("blank");
  });

  it("Normal = coded days - (X+SL+VL) - OT, OT = OT+OTS, Total = Normal + OT; blanks not counted", () => {
    const rows = [
      r("KSU", "Kantep Sungkakorn", "2026-10-16", "O"),
      r("KSU", "Kantep Sungkakorn", "2026-10-17", "OT"),
      r("KSU", "Kantep Sungkakorn", "2026-10-18", "X"),
      r("KSU", "Kantep Sungkakorn", "2026-10-19", "VL"),
      r("KSU", "Kantep Sungkakorn", "2026-10-20", "RR"),
      r("KSU", "Kantep Sungkakorn", "2026-10-25", "O"),          // outside the period
      r("CSU", "Chanchai Suttiprapa", "2026-10-16", "SL"),
      r("ZZZ", "No Roster", "2026-10-16", "")                      // empty code -> pilot left out
    ];
    const rep = buildDtWorkHr(rows, "2026-10-16", "2026-10-21");
    expect(rep.days).toHaveLength(6);
    expect(rep.pilots.map((p) => p.code)).toEqual(["CSU", "KSU"]);
    const ksu = rep.pilots[1];
    expect(ksu.perDay).toEqual(["O", "OT", "X", "VL", "RR", ""]);
    expect([ksu.normal, ksu.ot, ksu.total]).toEqual([2, 1, 3]);
    expect([rep.pilots[0].normal, rep.pilots[0].total]).toEqual([0, 0]);
  });
});
