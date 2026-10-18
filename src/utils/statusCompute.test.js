import { describe, it, expect } from "vitest";
import {
  hhmmToDecimal,
  hoursBetweenClock,
  spanHours,
  decimalToHHMM,
  withinDays,
  classify,
  entryDutyHours,
  entryFlightHours,
  computeStats,
  computeTomorrowAvailability
} from "./statusCompute.js";
import { DEFAULT_FTL_LIMITS } from "./ftlLimits.js";

const L = DEFAULT_FTL_LIMITS;

describe("hhmmToDecimal / decimalToHHMM round-trip", () => {
  it("converts H:MM to decimal hours", () => {
    expect(hhmmToDecimal("1:30")).toBeCloseTo(1.5, 5);
    expect(hhmmToDecimal("")).toBe(0);
    expect(hhmmToDecimal(null)).toBe(0);
  });
  it("converts decimal hours back to H:MM", () => {
    expect(decimalToHHMM(1.5)).toBe("1:30");
    expect(decimalToHHMM(0)).toBe("0:00");
  });
});

describe("hoursBetweenClock", () => {
  it("computes a same-day span", () => {
    expect(hoursBetweenClock("08:00", "10:30")).toBeCloseTo(2.5, 5);
  });
  it("wraps midnight when end < start", () => {
    expect(hoursBetweenClock("23:00", "01:00")).toBeCloseTo(2, 5);
  });
});

describe("spanHours (cross-day aware)", () => {
  it("matches hoursBetweenClock when there is no distinct endDate", () => {
    expect(spanHours("2026-07-01", "08:00", "2026-07-01", "10:00")).toBeCloseTo(2, 5);
  });
  it("honors an explicit multi-day endDate (Night Standby 17:30->05:30)", () => {
    expect(spanHours("2026-07-01", "17:30", "2026-07-02", "05:30")).toBeCloseTo(12, 5);
  });
});

describe("classify", () => {
  it("is ok below warn", () => {
    expect(classify(10, { warn: 20, max: 30 })).toBe("ok");
  });
  it("is warn at or above warn but at/below max", () => {
    expect(classify(20, { warn: 20, max: 30 })).toBe("warn");
    expect(classify(30, { warn: 20, max: 30 })).toBe("warn");
  });
  it("is exc strictly above max", () => {
    expect(classify(30.01, { warn: 20, max: 30 })).toBe("exc");
  });
});

describe("entryDutyHours", () => {
  it("credits Day/Night Standby at stbyCreditPercent of actual duration", () => {
    const e = { dutyType: "non_flight", nonFlightType: "Night Standby", date: "2026-07-01", start: "17:30", end: "05:30", endDate: "2026-07-02" };
    // 12h actual * 25% = 3h
    expect(entryDutyHours(e, L)).toBeCloseTo(12 * (L.stbyCreditPercent / 100), 5);
  });
  it("credits non-standby non-flight duty at full duration", () => {
    const e = { dutyType: "non_flight", nonFlightType: "Meeting", date: "2026-07-01", start: "09:00", end: "17:00" };
    expect(entryDutyHours(e, L)).toBeCloseTo(8, 5);
  });
  it("uses schDep/stop for flight duty", () => {
    const e = { dutyType: "flight", schDep: "07:00", stop: "13:00" };
    expect(entryDutyHours(e, L)).toBeCloseTo(6, 5);
  });
});

describe("entryFlightHours", () => {
  it("reads totalFlightTime only for flight entries", () => {
    expect(entryFlightHours({ dutyType: "flight", totalFlightTime: "2:15" })).toBeCloseTo(2.25, 5);
    expect(entryFlightHours({ dutyType: "non_flight", totalFlightTime: "2:15" })).toBe(0);
  });
});

describe("withinDays", () => {
  // Daily Duty stores dates as LOCAL calendar days, so that is what these
  // tests use. The old tests here built dates with toISOString() (UTC), which
  // east of Greenwich is a different calendar day - that is precisely how a
  // window that silently dropped its oldest day went unnoticed.
  const localIso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  it("includes today as day 1 of the rolling window", () => {
    expect(withinDays(localIso(0), 7)).toBe(true);
  });

  it("excludes a date older than the window", () => {
    expect(withinDays(localIso(30), 7)).toBe(false);
  });

  it("covers exactly `days` calendar days - today plus the days-1 before it", () => {
    // The bug Capt. Weera found via PDE: "DT 7 days" was covering six, so every
    // rolling FTL total on FDT Monitor, All Status, the Dashboard and the
    // Fatigue page read LOW. Pinned per-day rather than as a count so a future
    // off-by-one names the day it lost.
    for (let n = 0; n <= 6; n++) {
      expect(withinDays(localIso(n), 7), `${n} days ago should be inside a 7-day window`).toBe(true);
    }
    expect(withinDays(localIso(7), 7), "7 days ago is outside a 7-day window").toBe(false);
  });

  it("does the same for the 14 and 28 day windows", () => {
    expect(withinDays(localIso(13), 14)).toBe(true);
    expect(withinDays(localIso(14), 14)).toBe(false);
    expect(withinDays(localIso(27), 28)).toBe(true);
    expect(withinDays(localIso(28), 28)).toBe(false);
  });

  it("normalises a full ISO timestamp to its own local day", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 3);
    expect(withinDays(recent.toISOString(), 7)).toBe(true);
    const old = new Date();
    old.setDate(old.getDate() - 10);
    expect(withinDays(old.toISOString(), 7)).toBe(false);
  });

  it("rejects an unparseable date instead of counting it", () => {
    expect(withinDays("", 7)).toBe(false);
    expect(withinDays(null, 7)).toBe(false);
    expect(withinDays("not a date", 7)).toBe(false);
  });
});

describe("computeStats", () => {
  it("sums flight time and duty time within the 7-day window only", () => {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const recent = new Date(today); recent.setDate(recent.getDate() - 1);
    const old = new Date(today); old.setDate(old.getDate() - 40);
    const entries = [
      { dutyType: "flight", date: iso(recent), schDep: "07:00", stop: "10:00", totalFlightTime: "3:00", toDay: 1, landDay: 1, iApp: 0, ifrRulesHours: "1:00" },
      { dutyType: "flight", date: iso(old), schDep: "07:00", stop: "10:00", totalFlightTime: "3:00", toDay: 1, landDay: 1, iApp: 0, ifrRulesHours: "1:00" }
    ];
    const stats = computeStats(entries, L);
    expect(stats.ft7d).toBeCloseTo(3, 5);
    expect(stats.ft28d).toBeCloseTo(3, 5);
    expect(stats.ft365d).toBeCloseTo(6, 5);
    // Both entries fall within the 90-day window used for T/O counts.
    expect(stats.toDay90).toBe(2);
  });

  it("computes Duty Time rolling sums from Actual Duty Periods (report -1:00 through Last Engine Stop +0:30), not raw schDep/stop", () => {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const recent = new Date(today); recent.setDate(recent.getDate() - 1);
    const old = new Date(today); old.setDate(old.getDate() - 40);
    const entries = [
      // schDep 07:00 -> stop 10:00 is 3h raw, but the Actual Duty Period is
      // 06:00 (07:00 - dutyReportOffsetMinutes) -> 10:30 (10:00 Last Engine
      // Stop + dutyPostFlightOffsetMinutes) = 4.5h.
      { dutyType: "flight", date: iso(recent), schDep: "07:00", stop: "10:00", totalFlightTime: "3:00" },
      { dutyType: "flight", date: iso(old), schDep: "07:00", stop: "10:00", totalFlightTime: "3:00" }
    ];
    const stats = computeStats(entries, L);
    expect(stats.dt7d).toBeCloseTo(4.5, 5);
    expect(stats.dt14d).toBeCloseTo(4.5, 5);
    expect(stats.dt28d).toBeCloseTo(4.5, 5);
  });

  it("credits a never-escalated Standby at stbyCreditPercent in the Duty Time rolling sums", () => {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    const recent = new Date(today); recent.setDate(recent.getDate() - 1);
    const entries = [
      { dutyType: "non_flight", nonFlightType: "Day Standby", date: iso(recent), start: "08:00", end: "16:00" } // 8h * 25% = 2h
    ];
    const stats = computeStats(entries, L);
    expect(stats.dt7d).toBeCloseTo(2, 5);
  });
});

describe("computeTomorrowAvailability", () => {
  const iso = (d) => d.toISOString().slice(0, 10);

  it("with an empty log, is bounded by the single-day caps for a duty ending 17:30 (Max FDP 11h, flight 8h)", () => {
    const a = computeTomorrowAvailability([], L, { endTime: "17:30" });
    expect(a.dailyMaxFdp).toBeCloseTo(11, 5); // report ~06:30 -> 11h FDP landing 17:30
    expect(a.dailyMaxFt).toBeCloseTo(8, 5);
    expect(a.flightAvailable).toBeCloseTo(8, 5);
    expect(a.flightLimiter).toBe("Daily flight cap");
    expect(a.dutyAvailable).toBeCloseTo(11, 5);
    expect(a.dutyLimiter).toBe("Max FDP");
  });

  it("rolling FT headroom binds when the pilot has flown heavily this week", () => {
    const today = new Date();
    const entries = [];
    // 4 x 7h flights on the last 4 days = 28h; FT7D max is 34 -> 6h left.
    for (let i = 1; i <= 4; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      entries.push({ dutyType: "flight", date: iso(d), schDep: "07:00", stop: "14:00", totalFlightTime: "7:00" });
    }
    const a = computeTomorrowAvailability(entries, L, { endTime: "17:30" });
    expect(a.flightAvailable).toBeCloseTo(6, 5);
    expect(a.flightLimiter).toBe("FT 7D");
  });
});

// IFR flight-rules time and IMC (time in cloud) are two different figures kept in
// two different fields. The 180-day recency number on My Status is the IFR one.
// Getting this wrong is not cosmetic: it feeds a CAAT recency requirement.
describe("IFR recency (180 days) vs IMC", () => {
  const iso = (d) => d.toISOString().slice(0, 10);
  const recent = () => { const d = new Date(); d.setDate(d.getDate() - 1); return iso(d); };
  const flight = (extra) => ({
    dutyType: "flight", date: recent(), schDep: "07:00", stop: "10:00",
    totalFlightTime: "3:00", toDay: 1, landDay: 1, iApp: 0, ...extra
  });

  it("counts IFR-rules time, not time in cloud", () => {
    const stats = computeStats([flight({ ifrRulesHours: "2:30", ifrHours: "0:20" })], L);
    expect(stats.ifr180).toBeCloseTo(2.5, 5);
  });

  // A flight flown IFR with no cloud: IMC is blank, and that must not drag the
  // recency figure down to zero.
  it("counts IFR-rules time when IMC is blank", () => {
    const stats = computeStats([flight({ ifrRulesHours: "3:00", ifrHours: "" })], L);
    expect(stats.ifr180).toBeCloseTo(3, 5);
  });

  // An entry saved with IFR deliberately left blank means zero IFR - it must NOT
  // fall back to that flight's IMC time, which would overstate recency.
  it("treats a blank IFR field as zero rather than falling back to IMC", () => {
    const stats = computeStats([flight({ ifrRulesHours: "", ifrHours: "1:00" })], L);
    expect(stats.ifr180).toBeCloseTo(0, 5);
  });

  // Entries predating the split stored IFR-rules time in ifrHours, because the
  // single form field was labelled "IFR Hours". Those must still count.
  it("falls back to the old field for entries saved before IFR and IMC were split", () => {
    const stats = computeStats([flight({ ifrHours: "2:00" })], L);
    expect(stats.ifr180).toBeCloseTo(2, 5);
  });
});
