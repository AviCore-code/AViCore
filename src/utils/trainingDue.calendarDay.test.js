import { describe, expect, it } from "vitest";
import { classifyTrainingValue, TRAINING_ITEMS } from "./trainingDue.js";

const passport = TRAINING_ITEMS.find((item) => item.key === "passport");

describe("classifyTrainingValue calendar-day boundaries", () => {
  it("clamps an out-of-range day to the last valid day of the month", () => {
    // 2026-02-31 does not exist - treat it as 2026-02-28
    const result = classifyTrainingValue(passport, "2026-02-31", 90, new Date("2026-02-28T12:00:00"));
    expect(result.daysRemaining).toBe(0);
    expect(result.status).toBe("warn");
  });

  it("treats month 13 as unknown rather than rolling into the next year", () => {
    const result = classifyTrainingValue(passport, "2026-13-01", 90, new Date("2026-01-31T12:00:00"));
    expect(result.daysRemaining).toBeNull();
    expect(result.status).toBe("unknown");
  });

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

  it("handles a Date created from a UTC timestamp without shifting the date", () => {
    // 2026-11-22 00:00 UTC, which is 2026-11-22 07:00 Bangkok
    const due = new Date(Date.UTC(2026, 10, 22));
    const today = new Date("2026-11-22T07:00:00+07:00");

    expect(classifyTrainingValue(passport, due, 90, today).daysRemaining).toBe(0);
    expect(classifyTrainingValue(passport, "2026-11-21", 90, today).daysRemaining).toBe(-1);
  });

  it("handles a leap day without drifting across months", () => {
    // 2026 is not a leap year, so 2026-02-29 is invalid and must not roll
    // into 2026-03-01.
    const result = classifyTrainingValue(passport, "2026-02-29", 90, new Date("2026-02-28T12:00:00"));
    expect(result.daysRemaining).toBe(0);
    expect(result.status).toBe("warn");

    // 2024 IS a leap year, so 2024-02-29 is valid and stays in the same day.
    const leapResult = classifyTrainingValue(passport, "2024-02-29", 90, new Date("2024-02-29T12:00:00"));
    expect(leapResult.daysRemaining).toBe(0);
    expect(leapResult.status).toBe("warn");
  });
});
