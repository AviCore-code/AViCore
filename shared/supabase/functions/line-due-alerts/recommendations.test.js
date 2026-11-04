import { describe, expect, it } from "vitest";
import { DEFAULT_FTL_LIMITS } from "../../../../src/utils/ftlLimits.js";
import {
  buildLineFtlRecommendations,
  recommendationsForAudience,
  updateFirstSeenWarnings,
  selectNewRecommendations
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

  it("establishes a silent baseline on the first 05:00 run", () => {
    const recs = [
      { key: "CP1|ft7d", category: "ftl", status: "warn", text: "FT 7d" },
      { key: "training|CP2|crm", category: "training", status: "exc", text: "CRM" }
    ];
    const result = selectNewRecommendations(recs, null);
    expect(result.recommendations).toEqual([]);
    expect(result.snapshot).toEqual({
      "CP1|ft7d": "ftl|warn",
      "training|CP2|crm": "training|exc"
    });
    expect(result.initialized).toBe(false);
  });

  it("returns only new warnings or warn-to-exceeded transitions after the previous run", () => {
    const recs = [
      { key: "CP1|ft7d", category: "ftl", status: "warn", text: "count changed but state did not" },
      { key: "training|CP2|crm", category: "training", status: "exc", text: "CRM expired" },
      { key: "CP3|dt14d", category: "ftl", status: "warn", text: "new warning" },
      { key: "training|CP4|dg", category: "training", status: "warn", text: "downgraded" }
    ];
    const result = selectNewRecommendations(recs, {
      "CP1|ft7d": "ftl|warn",
      "training|CP2|crm": "training|warn",
      "RESOLVED|ft28d": "ftl|exc",
      "training|CP4|dg": "training|exc"
    });
    expect(result.recommendations.map((item) => item.key)).toEqual([
      "training|CP2|crm",
      "CP3|dt14d"
    ]);
    expect(result.snapshot["training|CP4|dg"]).toBe("training|warn");
    expect(result.snapshot).not.toHaveProperty("RESOLVED|ft28d");
    expect(result.initialized).toBe(true);
  });

  it("alerts again after a silent exceeded-to-warning downgrade later becomes exceeded", () => {
    const downgraded = selectNewRecommendations(
      [{ key: "training|CP4|dg", category: "training", status: "warn" }],
      { "training|CP4|dg": "training|exc" }
    );
    expect(downgraded.recommendations).toEqual([]);
    const exceededAgain = selectNewRecommendations(
      [{ key: "training|CP4|dg", category: "training", status: "exc" }],
      downgraded.snapshot
    );
    expect(exceededAgain.recommendations.map((item) => item.key)).toEqual(["training|CP4|dg"]);
  });

  it("treats malformed persisted snapshots as an uninitialized silent baseline", () => {
    const recs = [{ key: "CP1|ft7d", category: "ftl", status: "warn" }];
    for (const malformed of [{ garbage: true }, { "CP1|ft7d": "unknown" }, []]) {
      const result = selectNewRecommendations(recs, malformed);
      expect(result.recommendations).toEqual([]);
      expect(result.initialized).toBe(false);
    }
  });
});
