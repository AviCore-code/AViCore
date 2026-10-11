import { describe, expect, it } from "vitest";
import { DEFAULT_FTL_LIMITS } from "../../../../src/utils/ftlLimits.js";
import {
  buildLineFtlRecommendations,
  recommendationsForAudience,
  updateFirstSeenWarnings
} from "./recommendations.js";

function isoDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function flightEntries() {
  return Array.from({ length: 6 }, (_, index) => ({
    dutyType: "flight", date: isoDaysAgo(index), schDep: "08:00", stop: "15:00", totalFlightTime: "06:00"
  }));
}

function dutyEntries() {
  return Array.from({ length: 7 }, (_, index) => ({
    dutyType: "non_flight", nonFlightType: "Office", date: isoDaysAgo(index), start: "08:00", end: "18:00"
  }));
}

function dateDaysBefore(day, days) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

describe("LINE combined Training + FTL recommendations", () => {
  it("adds rolling Flight Time and Duty Time limit alerts to training due alerts", () => {
    const recommendations = buildLineFtlRecommendations({
      experience: [
        { code: "CP1", name: "Flight Pilot", licence: "LIC1" },
        { code: "CP2", name: "Duty Pilot", licence: "LIC2" }
      ],
      duty: [
        ...flightEntries().map((entry) => ({ pilot_code: "cp1", entry_json: entry })),
        ...dutyEntries().map((entry) => ({ pilot_code: "CP2", entry_json: entry }))
      ],
      limits: DEFAULT_FTL_LIMITS
    });

    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "ftl", key: "CP1|ft7d", status: "exc" }),
      expect.objectContaining({ category: "ftl", key: "CP2|dt7d", status: "exc" })
    ]));
  });

  it("limits LINE FTL notices to rolling FT/DT limits, excluding currency and recovery-rest advisories", () => {
    const recommendations = buildLineFtlRecommendations({
      experience: [{ code: "CP1", name: "Flight Pilot", licence: "LIC1" }],
      duty: flightEntries().map((entry) => ({ pilot_code: "CP1", entry_json: entry })),
      limits: DEFAULT_FTL_LIMITS
    });

    const keys = recommendations.map((item) => item.key);
    expect(keys).toContain("CP1|ft7d");
    expect(keys).not.toContain("CP1|ft90d");
    expect(keys).not.toContain("CP1|recoveryRest");
  });

  it("covers all six configured rolling Flight Time and Duty Time limits", () => {
    const asOfDay = "2026-09-07";
    const flight = Array.from({ length: 167 }, (_, index) => ({
      pilot_code: "CP1",
      entry_json: { dutyType: "flight", date: dateDaysBefore(asOfDay, index), schDep: "08:00", stop: "15:00", totalFlightTime: "06:00" }
    }));
    const office = Array.from({ length: 20 }, (_, index) => ({
      pilot_code: "CP2",
      entry_json: { dutyType: "non_flight", nonFlightType: "Office", date: dateDaysBefore(asOfDay, index), start: "08:00", end: "18:00" }
    }));
    const recommendations = buildLineFtlRecommendations({
      experience: [{ code: "CP1" }, { code: "CP2" }],
      duty: [...flight, ...office],
      limits: DEFAULT_FTL_LIMITS,
      asOfDay
    });
    const keys = new Set(recommendations.map((item) => item.key));
    for (const key of [
      "CP1|ft7d", "CP1|ft28d", "CP1|ft365d",
      "CP2|dt7d", "CP2|dt14d", "CP2|dt28d"
    ]) expect(keys.has(key), `${key} should be reported`).toBe(true);
  });

  it("parses legacy string payloads and falls back to duty row date/type columns", () => {
    const recommendations = buildLineFtlRecommendations({
      experience: [{ code: "CP1", name: "Legacy Pilot", licence: "LIC1" }],
      duty: Array.from({ length: 6 }, (_, index) => ({
        pilot_code: "CP1",
        date: `2026-09-0${7 - index}`,
        duty_type: "flight",
        entry_json: JSON.stringify({ schDep: "08:00", stop: "15:00", totalFlightTime: "06:00" })
      })),
      limits: DEFAULT_FTL_LIMITS,
      asOfDay: "2026-09-07"
    });

    expect(recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "ftl", key: "CP1|ft7d", status: "exc" })
    ]));
  });

  it("keeps FTL data in the configured pilot group while preserving training fan-out", () => {
    const recs = [
      { category: "training", key: "training|CP1|crm" },
      { category: "ftl", key: "CP1|ft7d" }
    ];
    expect(recommendationsForAudience(recs, "primary")).toEqual(recs);
    expect(recommendationsForAudience(recs, "secondary")).toEqual([recs[0]]);
  });

  it("prunes resolved first-seen keys so a later recurrence starts fresh", () => {
    const recs = [{ key: "CP1|ft7d" }];
    const seen = updateFirstSeenWarnings(recs, { "OLD|ft7d": "2026-08-01" }, "2026-09-07", new Date("2026-09-07T05:00:00+07:00"));
    expect(seen).toEqual({ "CP1|ft7d": "2026-09-07" });
    expect(recs[0].overdue).toBe(false);
  });
});
