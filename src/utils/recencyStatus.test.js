import { describe, expect, it } from "vitest";
import { overallStatus, recencyShortfalls, buildRecommendations } from "./statusCompute.js";
import { DEFAULT_FTL_LIMITS } from "./ftlLimits.js";

const limits = { ...DEFAULT_FTL_LIMITS, iappMin180d: 5, takeoffLandingMin90d: 3 };
// Figures from the All Status screen of 2 Nov 2026 (FT90D set comfortably
// above the 50 h minimum so only recency decides).
const row = (to, ld, iapp) => ({ dt7d: 0, dt14d: 0, dt28d: 0, ft7d: 0, ft28d: 0, ft90d: 60, ft365d: 400,
  toDay90: to, toNight90: 0, landDay90: ld, landNight90: 0, iApp180: iapp });

describe("All Status: recency minimums count toward STATUS", () => {
  it("I.APP below the minimum is a WARNING (PKR 3/≥5, RPA 0/≥5)", () => {
    expect(overallStatus(row(66, 68, 3), limits, "ok")).toBe("warn");
    expect(overallStatus(row(49, 50, 0), limits, "ok")).toBe("warn");
  });
  it("pilots at or above every minimum stay OK (PME 11, PCH 13, TBO 8, TYO 10, WJU 13)", () => {
    for (const iapp of [11, 13, 8, 10, 13, 5]) expect(overallStatus(row(35, 35, iapp), limits, "ok")).toBe("ok");
  });
  it("T/O or L/D below the minimum is also a WARNING, never EXCEEDED", () => {
    expect(overallStatus(row(2, 35, 6), limits, "ok")).toBe("warn");
    expect(overallStatus(row(35, 0, 6), limits, "ok")).toBe("warn");
    expect(recencyShortfalls(row(0, 0, 0), limits).map((r) => r.key)).toEqual(["takeoff90d", "landing90d", "iapp180d"]);
  });
  it("Dashboard explains it", () => {
    const recs = buildRecommendations({ pilot: { code: "RPA", name: "Rawee" }, stats: row(49, 50, 0), recoveryRest: { status: "ok" }, status: "warn" }, limits);
    expect(recs.some((r) => /I\.APP \(180D\) at 0 \/ ≥5/.test(r.text))).toBe(true);
  });
});
