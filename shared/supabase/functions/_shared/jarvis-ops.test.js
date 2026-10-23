import { describe, expect, it } from "vitest";
import { authorizedJarvisRequest, sanitizeOpsSnapshot } from "./jarvis-ops.js";
import { classifyTrainingValue, TRAINING_ITEMS } from "../../../../src/utils/trainingDue.js";
import { withinDays } from "../../../../src/utils/statusCompute.js";

describe("JARVIS live operations bridge", () => {
  const secret = "a".repeat(48);

  it("requires an exact server-to-server bearer secret", () => {
    expect(authorizedJarvisRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(authorizedJarvisRequest(`Bearer ${"b".repeat(48)}`, secret)).toBe(false);
    expect(authorizedJarvisRequest(undefined, secret)).toBe(false);
    expect(authorizedJarvisRequest(`Bearer ${secret}`, "short")).toBe(false);
  });

  it("returns only allowlisted operational fields", () => {
    const result = sanitizeOpsSnapshot({
      generatedAt: "2026-10-21T12:00:00Z",
      roster: [{ pilot_code: "WJU", pilot_name: "Captain W", date: "2026-10-22", code: "OFF", base: "SKL", email: "private@example.com", record_json: { secret: "x" } }],
      ftlAlerts: [{ key: "WJU|dt28d", pilot: "WJU — Captain W", status: "exc", text: "Duty Time 28D exceeded", privateNote: "hidden" }],
      trainingAlerts: [{ key: "WJU|opc", pilot: "WJU — Captain W", status: "warn", text: "OPC due soon", attachment: "hidden" }],
    });

    expect(result.roster).toEqual([{ pilot_id: "WJU", pilot_name: "Captain W", date: "2026-10-22", assignment: "OFF", base: "SKL" }]);
    expect(result.ftl_alerts[0]).toEqual({ key: "WJU|dt28d", kind: "ftl", status: "exc", pilot: "WJU — Captain W", text: "Duty Time 28D exceeded" });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("privateNote");
    expect(JSON.stringify(result)).not.toContain("attachment");
  });

  it("keeps a Bangkok date-only training item valid for the whole due date", () => {
    const item = TRAINING_ITEMS.find(row => row.key === "medical");
    const result = classifyTrainingValue(item, "2026-10-22", 90, new Date(2026, 9, 22, 10, 0, 0));
    expect(result.daysRemaining).toBe(0);
    expect(result.status).toBe("warn");
  });

  it("anchors rolling windows on the supplied Bangkok operational day", () => {
    const bangkokWallClockInUtcRuntime = new Date("2026-10-22T01:00:00Z");
    expect(withinDays("2026-10-15", 7, bangkokWallClockInUtcRuntime)).toBe(false);
    expect(withinDays("2026-10-16", 7, bangkokWallClockInUtcRuntime)).toBe(true);
  });

  it("fails closed instead of silently truncating oversized snapshots", () => {
    expect(() => sanitizeOpsSnapshot({ generatedAt: new Date(), roster: Array.from({ length: 2001 }, () => ({})) })).toThrow(/exceeds safe response limits/);
  });
});
