import { describe, it, expect } from "vitest";
import {
  entryToInterval,
  buildBusyBlocks,
  buildRestGaps,
  nightsCoveredByGap,
  maxFdpForReportTime,
  buildDutyPeriods,
  checkMinRestViolations,
  checkRecoveryRest168,
  standbyReductionHours,
  checkStandbyDurationViolations,
  periodDutyCreditHours
} from "./dutyPeriods.js";
import { DEFAULT_FTL_LIMITS } from "./ftlLimits.js";

const L = DEFAULT_FTL_LIMITS;

function flight(date, schDep, stop, extra = {}) {
  return { dutyType: "flight", date, schDep, stop, totalFlightTime: "0:00", ...extra };
}
function nonFlight(date, start, end, nonFlightType = "Meeting", endDate = null) {
  return { dutyType: "non_flight", date, start, end, nonFlightType, endDate };
}

describe("entryToInterval", () => {
  it("resolves a same-day flight to start/end Date objects", () => {
    const iv = entryToInterval(flight("2026-07-01", "08:00", "10:30"));
    expect(iv.start.getHours()).toBe(8);
    expect(iv.end.getHours()).toBe(10);
    expect(iv.end.getMinutes()).toBe(30);
  });

  it("wraps midnight when end-of-day clock time is earlier than start (no endDate)", () => {
    const iv = entryToInterval(nonFlight("2026-07-01", "23:00", "01:00"));
    expect(iv.end.getDate()).toBe(iv.start.getDate() + 1);
  });

  it("honors an explicit endDate for cross-day entries (e.g. Night Standby)", () => {
    const iv = entryToInterval(nonFlight("2026-07-01", "17:30", "05:30", "Night Standby", "2026-07-02"));
    expect(iv.start.getHours()).toBe(17);
    expect(iv.start.getMinutes()).toBe(30);
    expect(iv.end.getDate()).toBe(iv.start.getDate() + 1);
    expect(iv.end.getHours()).toBe(5);
    expect(iv.end.getMinutes()).toBe(30);
    expect((iv.end - iv.start) / 3600000).toBeCloseTo(12, 5);
  });

  it("returns null when required fields are missing", () => {
    expect(entryToInterval({ dutyType: "flight", date: "2026-07-01" })).toBeNull();
  });
});

describe("buildBusyBlocks", () => {
  it("merges touching/overlapping entries into one block", () => {
    const entries = [
      flight("2026-07-01", "08:00", "10:00"),
      flight("2026-07-01", "10:00", "12:00")
    ];
    const blocks = buildBusyBlocks(entries);
    expect(blocks.length).toBe(1);
    expect(blocks[0].entries.length).toBe(2);
  });

  it("keeps genuinely separate blocks apart", () => {
    const entries = [
      flight("2026-07-01", "08:00", "10:00"),
      flight("2026-07-02", "08:00", "10:00")
    ];
    expect(buildBusyBlocks(entries).length).toBe(2);
  });

  it("sorts unordered input chronologically before merging", () => {
    const entries = [
      flight("2026-07-02", "08:00", "10:00"),
      flight("2026-07-01", "08:00", "10:00")
    ];
    const blocks = buildBusyBlocks(entries);
    expect(blocks[0].start < blocks[1].start).toBe(true);
  });
});

describe("buildRestGaps", () => {
  it("computes the gap between two blocks in hours", () => {
    const blocks = buildBusyBlocks([
      flight("2026-07-01", "06:00", "10:00"),
      flight("2026-07-02", "06:00", "10:00")
    ]);
    const gaps = buildRestGaps(blocks);
    expect(gaps.length).toBe(1);
    expect(gaps[0].hours).toBeCloseTo(20, 5);
  });

  it("excludes the unbounded gap before the first / after the last block (empty for a single block)", () => {
    const blocks = buildBusyBlocks([flight("2026-07-01", "06:00", "10:00")]);
    expect(buildRestGaps(blocks).length).toBe(0);
  });
});

describe("nightsCoveredByGap", () => {
  it("counts 2 local nights for a clean 48h rest spanning two full nights", () => {
    const gap = { start: new Date(2026, 6, 1, 20, 0), end: new Date(2026, 6, 3, 20, 0) };
    const nights = nightsCoveredByGap(gap, L);
    expect(nights.length).toBeGreaterThanOrEqual(2);
  });

  it("counts a night truncated by an early-morning report per the confirmed operational rule", () => {
    const gap = { start: new Date(2026, 6, 1, 6, 0), end: new Date(2026, 6, 2, 5, 30), ongoing: false };
    const nights = nightsCoveredByGap(gap, L);
    const truncated = nights.find((n) => n.nightStart.getDate() === 1);
    expect(truncated).toBeTruthy();
  });

  it("does NOT apply the truncated-by-report rule to a still-ongoing rest", () => {
    const gap = { start: new Date(2026, 6, 1, 6, 0), end: new Date(2026, 6, 2, 5, 30), ongoing: true };
    const nights = nightsCoveredByGap(gap, L);
    const truncated = nights.find((n) => n.nightStart.getDate() === 1);
    expect(truncated).toBeUndefined();
  });

  it("does not count a short gap that touches no full night window", () => {
    const gap = { start: new Date(2026, 6, 1, 10, 0), end: new Date(2026, 6, 1, 14, 0), ongoing: false };
    expect(nightsCoveredByGap(gap, L).length).toBe(0);
  });
});

describe("maxFdpForReportTime (OPS-CM-01 7.4.1 table)", () => {
  it("looks up the correct row for a 0700-1259 report (12h FDP / 8h FT)", () => {
    const r = maxFdpForReportTime(new Date(2026, 6, 1, 8, 0), L);
    expect(r).toEqual({ maxFdp: 12, maxFt: 8 });
  });

  it("handles the midnight-wrapping 2100-0459 row", () => {
    const late = maxFdpForReportTime(new Date(2026, 6, 1, 23, 0), L);
    expect(late).toEqual({ maxFdp: 9, maxFt: 6 });
    const early = maxFdpForReportTime(new Date(2026, 6, 1, 3, 0), L);
    expect(early).toEqual({ maxFdp: 9, maxFt: 6 });
  });

  it("falls back to dutyPeriodMaxHours with no FT cap if the table has a gap", () => {
    const limits = { ...L, fdpByReportTime: [] };
    const r = maxFdpForReportTime(new Date(2026, 6, 1, 8, 0), limits);
    expect(r).toEqual({ maxFdp: limits.dutyPeriodMaxHours, maxFt: null });
  });
});

describe("buildDutyPeriods", () => {
  it("pads start by dutyReportOffsetMinutes and end by dutyPostFlightOffsetMinutes when the period has a flight", () => {
    const periods = buildDutyPeriods([flight("2026-07-01", "07:00", "13:00")], L);
    expect(periods.length).toBe(1);
    const p = periods[0];
    expect(p.start.getHours()).toBe(6);
    expect(p.end.getHours()).toBe(13);
    expect(p.end.getMinutes()).toBe(30);
  });

  it("does not pad the end of a no-flight-only day", () => {
    const periods = buildDutyPeriods([nonFlight("2026-07-01", "09:00", "17:00", "Meeting")], L);
    expect(periods[0].end.getHours()).toBe(17);
    expect(periods[0].end.getMinutes()).toBe(0);
  });

  it("flags status=warn when FDP exceeds the max but stays within the unforeseen 2h extension AND had a flight", () => {
    const periods = buildDutyPeriods([flight("2026-07-01", "07:00", "18:20")], L);
    const p = periods[0];
    expect(p.hasFlight).toBe(true);
    expect(p.durationHours).toBeGreaterThan(p.maxFdp);
    expect(p.status).toBe("warn");
  });

  it("flags status=exc when FDP exceeds even the unforeseen extension", () => {
    const periods = buildDutyPeriods([flight("2026-07-01", "07:00", "22:00")], L);
    expect(periods[0].status).toBe("exc");
  });

  it("re-merges adjusted blocks that only overlap after padding is applied", () => {
    const periods = buildDutyPeriods([
      flight("2026-07-01", "06:00", "08:50"),
      flight("2026-07-01", "09:15", "11:00")
    ], L);
    expect(periods.length).toBe(1);
  });

  it("flags ftStatus=exc when daily flight time exceeds the report-time flight-time cap", () => {
    const p = buildDutyPeriods([flight("2026-07-01", "07:00", "09:00", { totalFlightTime: "9:00" })], L)[0];
    expect(p.ftStatus).toBe("exc");
  });
});

describe("checkMinRestViolations (OPS-CM-01 7.17.3.1 two-tier rest)", () => {
  it("flags exc when rest is below the CAAT floor (8h)", () => {
    const entries = [
      flight("2026-07-01", "07:00", "13:00"),
      flight("2026-07-01", "20:00", "22:00")
    ];
    const v = checkMinRestViolations(entries, L);
    expect(v[0].status).toBe("exc");
  });

  it("flags warn when rest is between the CAAT floor and the customer requirement (8-12h)", () => {
    // Period 1 (flight 07:00-10:00) adjusts to 06:00-10:30. Period 2
    // (flight 21:30-23:00 same day) adjusts to a 20:30 start - exactly a
    // 10h gap, inside the 8-12h warn band.
    const entries = [
      flight("2026-07-01", "07:00", "10:00"),
      flight("2026-07-01", "21:30", "23:00")
    ];
    const v = checkMinRestViolations(entries, L);
    expect(v[0].hours).toBeCloseTo(10, 5);
    expect(v[0].status).toBe("warn");
  });

  it("flags ok when rest clears the 12h customer requirement", () => {
    const entries = [
      flight("2026-07-01", "07:00", "10:00"),
      flight("2026-07-02", "08:00", "10:00")
    ];
    const v = checkMinRestViolations(entries, L);
    expect(v[0].status).toBe("ok");
  });
});

describe("checkRecoveryRest168 (OPS-CM-01 7.12.4)", () => {
  it("reports status=exc with no data when there is no qualifying rest at all and nothing ongoing", () => {
    const entries = [flight("2026-07-01", "07:00", "10:00")];
    const r = checkRecoveryRest168(entries, L, new Date(2026, 6, 1, 12, 0));
    expect(r.status).toBe("exc");
    expect(r.lastQualifyingRestEnd).toBeNull();
  });

  it("starts the 168h cycle at the report time of the first duty after a qualifying rest", () => {
    const entries = [
      flight("2026-06-25", "07:00", "10:00"),
      flight("2026-06-28", "07:00", "10:00")
    ];
    const asOf = new Date(2026, 5, 29, 7, 0);
    const r = checkRecoveryRest168(entries, L, asOf);
    expect(r.lastQualifyingRestEnd).not.toBeNull();
    expect(r.status).toBe("ok");
  });

  it("flags exc once elapsed time since the cycle start passes 168h with only short (non-qualifying) gaps since", () => {
    // A qualifying rest (05-25 -> 05-28, ~67h/3 nights) sets the cycle
    // start. After that, daily flights only ~19.5h apart (never 36h/2
    // nights) keep the pilot "on the clock" past the 168h deadline with no
    // new qualifying Recovery Rest - this must read as exceeded, not ok.
    const entries = [flight("2026-05-25", "07:00", "10:00")];
    for (let d = 28; d <= 36; d++) {
      const date = new Date(2026, 4, d).toISOString().slice(0, 10);
      entries.push(flight(date, "07:00", "10:00"));
    }
    const last = entries[entries.length - 1];
    const asOf = new Date(new Date(last.date).getFullYear(), new Date(last.date).getMonth(), new Date(last.date).getDate(), 11, 0);
    const r = checkRecoveryRest168(entries, L, asOf);
    expect(r.ongoing).toBe(false);
    expect(r.hoursSinceLastRest).toBeGreaterThan(168);
    expect(r.status).toBe("exc");
  });

  it("treats an ongoing rest that already qualifies (36h/2 nights) as securing the next cycle", () => {
    const entries = [
      flight("2026-06-01", "07:00", "10:00"),
      flight("2026-06-04", "07:00", "10:00")
    ];
    const asOf = new Date(2026, 5, 7, 10, 0);
    const r = checkRecoveryRest168(entries, L, asOf);
    expect(r.ongoing).toBe(true);
    expect(r.status).toBe("ok");
  });
});

describe("OPS-CM-01 7.9.2 - Standby Other Than Base Airport", () => {
  it("Day Standby 08:00-16:00 escalating into a flight: standby is counted only up to the report buffer (Sch Dep - 1:00 = 15:00), not the raw Sch Dep - reduces max FDP by (7h - 6h free) = 1h", () => {
    const entries = [
      nonFlight("2026-07-01", "08:00", "16:00", "Day Standby"),
      flight("2026-07-01", "16:00", "18:00")
    ];
    const periods = buildDutyPeriods(entries, L);
    expect(periods.length).toBe(1);
    const p = periods[0];
    expect(p.standby).toBeTruthy();
    expect(p.standby.end.getHours()).toBe(15); // report buffer boundary (16:00 - 1:00), not raw Sch Dep 16:00
    expect(p.standby.hours).toBeCloseTo(7, 5); // 08:00 -> 15:00
    expect(p.standby.reductionHours).toBeCloseTo(1, 5); // 7h - 6h free
    expect(p.maxFdp).toBeCloseTo(9, 5); // 10 (1300-2059 band) - 1
    // FDP clock starts at the report (16:00 - 60min offset), not standby start (08:00)
    expect(p.start.getHours()).toBe(15);
  });

  it("call-out happens before the originally-scheduled standby window ends: pilot is called and logs Standby ending at the actual call time (08:00-12:00), not the full scheduled block - standby counted up to the report buffer (12:00 - 1:00 = 11:00)", () => {
    const entries = [
      nonFlight("2026-07-01", "08:00", "12:00", "Day Standby"),
      flight("2026-07-01", "12:00", "14:00")
    ];
    const periods = buildDutyPeriods(entries, L);
    expect(periods.length).toBe(1);
    const p = periods[0];
    expect(p.standby.end.getHours()).toBe(11); // report buffer boundary, not Sch Dep 12:00
    expect(p.standby.hours).toBeCloseTo(3, 5); // 08:00 -> 11:00
    expect(p.start.getHours()).toBe(11); // report (12:00) - 1:00
    expect(p.end.getHours()).toBe(14); expect(p.end.getMinutes()).toBe(30); // Last Engine Stop 14:00 + 0:30 post-flight
    expect(p.durationHours).toBeCloseTo(3.5, 5); // 11:00 -> 14:30
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(4.25, 5); // 3.5h FDT (incl. post-flight) + (3h standby x 25% = 0.75h)
  });

  it("worked example: Night Standby 17 Jul 17:30 - 18 Jul 05:30, called out to fly 02:00-05:30 - Standby counted 17:30 -> 01:00 (report buffer) x25%, plus FDT from report 01:00 through Last Engine Stop 05:30 + 0:30 post-flight", () => {
    const entries = [
      nonFlight("2026-07-17", "17:30", "05:30", "Night Standby", "2026-07-18"),
      flight("2026-07-18", "02:00", "05:30")
    ];
    const periods = buildDutyPeriods(entries, L);
    expect(periods.length).toBe(1);
    const p = periods[0];
    expect(p.standby.end.getHours()).toBe(1); // report buffer (02:00 - 1:00)
    expect(p.standby.hours).toBeCloseTo(7.5, 5); // 17:30 -> 01:00
    expect(p.start.getHours()).toBe(1); // report - 1:00
    expect(p.end.getHours()).toBe(6); // 05:30 Last Engine Stop + 0:30 post-flight
    expect(p.durationHours).toBeCloseTo(5, 5); // 01:00 -> 06:00
    // (7.5h standby x 25% = 1.875h) + 5h FDT (incl. post-flight) = 6.875h
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(6.875, 5);
  });

  it("Night Standby 17:30-05:30 escalating into a flight: ALL standby hours count towards the 6h free threshold (no night exclusion), so the 11h standby reduces max FDP by 5h", () => {
    const entries = [
      nonFlight("2026-07-01", "17:30", "05:30", "Night Standby", "2026-07-02"),
      flight("2026-07-02", "05:30", "07:30")
    ];
    const periods = buildDutyPeriods(entries, L);
    expect(periods.length).toBe(1);
    const p = periods[0];
    expect(p.standby).toBeTruthy();
    expect(p.standby.hours).toBeCloseTo(11, 5); // 17:30 -> report buffer 04:30
    expect(p.standby.reductionHours).toBeCloseTo(5, 5); // 11h - 6h free, night hours now counted
    expect(p.maxFdp).toBeCloseTo(4, 5); // 9 (2100-0459 band, start 04:30) - 5h reduction
  });

  it("flags exceedsMaxStandby when a standby run alone exceeds 16h", () => {
    const entries = [
      nonFlight("2026-07-01", "05:00", "23:00", "Day Standby"),
      flight("2026-07-01", "23:00", "23:59")
    ];
    const periods = buildDutyPeriods(entries, L);
    expect(periods[0].standby.hours).toBeCloseTo(17, 5); // 05:00 -> report buffer 22:00
    expect(periods[0].standby.exceedsMaxStandby).toBe(true);
    expect(periods[0].status).toBe("exc");
  });

  it("flags exceedsCombinedAwake when standby + resulting FDP together exceed 18h", () => {
    const entries = [
      nonFlight("2026-07-01", "06:00", "14:00", "Day Standby"), // counted up to report buffer 13:00 = 7h
      flight("2026-07-01", "14:00", "23:59") // ~10h FDP window
    ];
    const periods = buildDutyPeriods(entries, L);
    const p = periods[0];
    expect(p.standby.combinedAwakeHours).toBeGreaterThan(18);
    expect(p.standby.exceedsCombinedAwake).toBe(true);
    expect(p.status).toBe("exc");
  });

  it("a standby that is never escalated into further duty has no FDP reduction (standby: null)", () => {
    const periods = buildDutyPeriods([nonFlight("2026-07-01", "08:00", "16:00", "Day Standby")], L);
    expect(periods[0].standby).toBeNull();
  });

  it("standbyReductionHours: no reduction within the free 6h threshold", () => {
    const start = new Date(2026, 6, 1, 8, 0);
    const end = new Date(2026, 6, 1, 13, 0); // 5h
    expect(standbyReductionHours(start, end, L)).toBe(0);
  });
});

describe("checkStandbyDurationViolations (OPS-CM-01 7.9.2(a))", () => {
  it("flags a standalone standby entry that exceeds 16h even with no escalation", () => {
    const entries = [nonFlight("2026-07-01", "05:00", "22:00", "Day Standby")]; // 17h
    const v = checkStandbyDurationViolations(entries, L);
    expect(v.length).toBe(1);
    expect(v[0].hours).toBeCloseTo(17, 5);
    expect(v[0].status).toBe("exc");
  });

  it("does not flag a standby within the 16h limit", () => {
    const entries = [nonFlight("2026-07-01", "17:30", "05:30", "Night Standby", "2026-07-02")];
    const v = checkStandbyDurationViolations(entries, L);
    expect(v[0].status).toBe("ok");
  });

  it("ignores non-standby non-flight entries", () => {
    const entries = [nonFlight("2026-07-01", "09:00", "17:00", "Meeting")];
    expect(checkStandbyDurationViolations(entries, L).length).toBe(0);
  });
});

describe("periodDutyCreditHours (Duty Time rolling-sum credit per period)", () => {
  it("a plain flight day credits its full durationHours, INCLUDING the 0:30 post-flight buffer (confirmed to apply to every case, not just Standby days)", () => {
    const p = buildDutyPeriods([flight("2026-07-01", "07:00", "13:00")], L)[0];
    expect(p.end.getHours()).toBe(13); expect(p.end.getMinutes()).toBe(30); // 13:00 Last Engine Stop + 0:30
    expect(p.durationHours).toBeCloseTo(7.5, 5); // 06:00 -> 13:30
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(7.5, 5);
  });

  it("a Day Standby that is never escalated credits stbyCreditPercent of its raw duration (8h -> 2h)", () => {
    const p = buildDutyPeriods([nonFlight("2026-07-01", "08:00", "16:00", "Day Standby")], L)[0];
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(2, 5);
  });

  it("a Night Standby that is never escalated matches the old entryDutyHours figure (12h -> 3h)", () => {
    const p = buildDutyPeriods([nonFlight("2026-07-01", "17:30", "05:30", "Night Standby", "2026-07-02")], L)[0];
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(3, 5);
  });

  it("a Day Standby escalating into a flight credits the FDP portion (incl. post-flight buffer) in full plus 25% of the standby lead-in", () => {
    const entries = [
      nonFlight("2026-07-01", "08:00", "16:00", "Day Standby"),
      flight("2026-07-01", "16:00", "18:00")
    ];
    const p = buildDutyPeriods(entries, L)[0];
    // durationHours (report 15:00 -> Last Engine Stop 18:00 + 0:30) = 3.5h, plus
    // standby counted only to the report buffer (08:00 -> 15:00 = 7h) * 25% = 1.75h
    expect(periodDutyCreditHours(p, L)).toBeCloseTo(5.25, 5);
  });
});
