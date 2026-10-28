import { describe, expect, it } from "vitest";
import { computeTrainingRow, trainingIssueCounts, DEFAULT_TRAINING_THRESHOLDS } from "./trainingDue.js";

const today = new Date("2026-10-18T00:00:00Z");

describe("trainingIssueCounts", () => {
  const record = {
    passport: "2026-01-01",   // expired
    medical: "2026-11-01",    // due soon
    lpc: "2028-01-01"         // ok
  };

  it("counts expired and due-soon items that are monitored", () => {
    const computed = computeTrainingRow(record, DEFAULT_TRAINING_THRESHOLDS, [], today);
    const counts = trainingIssueCounts(computed, []);
    expect(counts.exc).toBe(1);
    expect(counts.warn).toBe(1);
  });

  it("ignores a disabled item, matching the badge and the detail grid", () => {
    const computed = computeTrainingRow(record, DEFAULT_TRAINING_THRESHOLDS, ["passport"], today);
    const counts = trainingIssueCounts(computed, ["passport"]);
    expect(counts.exc).toBe(0);
    expect(counts.warn).toBe(1);
    expect(computed.status).toBe("warn");
  });
});
