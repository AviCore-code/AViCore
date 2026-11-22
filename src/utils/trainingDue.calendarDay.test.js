import { describe, expect, it } from "vitest";
import { classifyTrainingValue, TRAINING_ITEMS } from "./trainingDue.js";

const passport = TRAINING_ITEMS.find((item) => item.key === "passport");

describe("classifyTrainingValue calendar-day boundaries", () => {
  it("keeps a due date valid through the whole due day", () => {
    const result = classifyTrainingValue(
      passport,
      "2026-11-22",
      90,
      new Date("2026-11-22T15:55:00")
    );

    expect(result.daysRemaining).toBe(0);
    expect(result.status).toBe("warn");
  });

  it("reports adjacent calendar days without time-of-day drift", () => {
    const today = new Date("2026-11-22T23:59:59");

    expect(classifyTrainingValue(passport, "2026-11-21", 90, today).daysRemaining).toBe(-1);
    expect(classifyTrainingValue(passport, "2026-11-23", 90, today).daysRemaining).toBe(1);
  });
});
