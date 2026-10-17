import { describe, it, expect } from "vitest";
import {
  TRAINING_ITEMS, classifyTrainingValue, computeTrainingRow, buildTrainingRecommendations,
  withTrainingThresholdDefaults, isDormantTraining
} from "./trainingDue.js";

const today = new Date("2026-10-18T00:00:00Z");
const daysFromToday = (n) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
const medical = TRAINING_ITEMS.find((i) => i.key === "medical");

describe("dormant training items (expired over 365 days)", () => {
  it("flags an item expired more than 365 days ago as dormant", () => {
    expect(isDormantTraining(classifyTrainingValue(medical, daysFromToday(-400), 90, today))).toBe(true);
  });

  it("keeps an item expired 365 days or less as a normal red item", () => {
    const r = classifyTrainingValue(medical, daysFromToday(-365), 90, today);
    expect(r.status).toBe("exc");
    expect(isDormantTraining(r)).toBe(false);
  });

  it("does not turn the overall badge red or produce a recommendation", () => {
    const thresholds = withTrainingThresholdDefaults(null);
    const record = { medical: daysFromToday(-400), passport: daysFromToday(1000) };
    expect(computeTrainingRow(record, thresholds, [], today).status).toBe("ok");
    expect(buildTrainingRecommendations({ code: "TST", name: "Test", record }, thresholds, [], today)).toEqual([]);
  });
});
