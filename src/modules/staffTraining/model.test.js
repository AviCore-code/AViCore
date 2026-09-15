import { describe, expect, it } from "vitest";
import {
  STAFF_TRAINING_KEYS,
  DEFAULT_COURSES,
  DEFAULT_ROLES,
  calculateDueDate,
  effectiveDueDate,
  getRecordStatus,
  isCourseRequired,
  latestRecordsByPair,
  buildStatusRows,
  buildStaffPlanningRows,
  filterStaffPlanningRows,
  changeCourseSchedule,
} from "./model.js";

describe("staff training model", () => {
  it("preserves the v1.0.267 setting keys and representative catalog seeds", () => {
    expect(STAFF_TRAINING_KEYS).toEqual({
      courses: "staff_training_courses_v1",
      personnel: "staff_training_personnel_v1",
      records: "staff_training_records_v1",
    });
    expect(DEFAULT_ROLES).toContain("Senior Flight Operations Officer");
    expect(DEFAULT_ROLES).toContain("Helper");
    expect(DEFAULT_COURSES.length).toBeGreaterThanOrEqual(25);
    expect(DEFAULT_COURSES.find((course) => course.code === "FOO-LIC")).toMatchObject({
      validityAmount: 5,
      validityUnit: "years",
      warningDays: 90,
      scheduleType: "recurring",
    });
    expect(DEFAULT_COURSES.find((course) => course.code === "ORIENT")).toMatchObject({
      scheduleType: "once_on_hire",
      validityUnit: "none",
    });
  });

  it("repairs validity when the course form changes to recurring", () => {
    expect(changeCourseSchedule({ scheduleType: "on_demand", validityUnit: "none", validityAmount: null }, "recurring")).toMatchObject({
      scheduleType: "recurring",
      validityUnit: "years",
      validityAmount: 1,
    });
    expect(changeCourseSchedule({ scheduleType: "recurring", validityUnit: "months", validityAmount: 6 }, "on_demand")).toMatchObject({
      scheduleType: "on_demand",
      validityUnit: "none",
      validityAmount: null,
    });
  });

  it("calculates recurring due dates with month-end clamping and offset modes", () => {
    expect(calculateDueDate("2024-02-29", {
      scheduleType: "recurring",
      validityAmount: 1,
      validityUnit: "years",
      dueOffsetDays: -1,
    })).toBe("2025-02-27");
    expect(calculateDueDate("2024-01-31", {
      scheduleType: "recurring",
      validityAmount: 1,
      validityUnit: "months",
      dueMode: "eomonth",
    })).toBe("2024-02-29");
    expect(calculateDueDate("2024-01-31", {
      scheduleType: "recurring",
      validityAmount: 1,
      validityUnit: "months",
      dueMode: "minusday",
    })).toBe("2024-02-28");
    expect(calculateDueDate("2024-01-31", { scheduleType: "on_demand" })).toBe("");
  });

  it("honors manual dates and classifies record states", () => {
    const course = {
      scheduleType: "recurring",
      validityAmount: 1,
      validityUnit: "years",
      dueOffsetDays: -1,
      warningDays: 90,
    };
    const manual = { dateDone: "2024-01-01", dueDateMode: "manual", manualDueDate: "2026-03-01" };
    expect(effectiveDueDate(manual, course)).toBe("2026-03-01");
    expect(getRecordStatus({ result: "Planned" }, course, new Date("2026-01-01T12:00:00"))).toMatchObject({ key: "planned" });
    expect(getRecordStatus({ result: "Certificate Waiting" }, course, new Date("2026-01-01T12:00:00"))).toMatchObject({ key: "waiting" });
    expect(getRecordStatus({ result: "Failed" }, course, new Date("2026-01-01T12:00:00"))).toMatchObject({ key: "expired" });
    expect(getRecordStatus(null, course, new Date("2026-01-01T12:00:00"))).toMatchObject({ key: "missing" });
    expect(getRecordStatus(manual, course, new Date("2026-01-01T12:00:00"))).toEqual({ key: "due", label: "Due soon", daysRemaining: 59 });
  });

  it("builds staff-only planning rows for due and missing requirements", () => {
    const people = [{ id: "person_1", employeeId: "G001", name: "Grace", crewGroup: "ground", role: "Helper", active: true }];
    const courses = [
      { id: "due", code: "HF", name: "Human Factor", crewGroups: ["ground"], roles: ["Helper"], active: true, scheduleType: "recurring", validityAmount: 1, validityUnit: "years", warningDays: 90 },
      { id: "missing", code: "FIRE", name: "Fire Fighting", crewGroups: ["ground"], roles: ["Helper"], active: true, scheduleType: "recurring", validityAmount: 1, validityUnit: "years", warningDays: 90 },
    ];
    const records = [{ id: "record_1", personId: "person_1", courseId: "due", dateDone: "2024-03-01", result: "Completed" }];

    const rows = buildStaffPlanningRows(people, courses, records, new Date("2026-01-01T12:00:00Z"));
    const actionable = filterStaffPlanningRows(rows, { status: "needs_action", search: "grace" });

    expect(actionable).toEqual([
      expect.objectContaining({ name: "Grace", courseName: "Human Factor", status: "expired", source: "Staff Training" }),
      expect.objectContaining({ name: "Grace", courseName: "Fire Fighting", status: "missing", dueDate: "" }),
    ]);
  });

  it("builds the matrix from required courses and the latest non-archived record", () => {
    const people = [{ id: "person_1", name: "Ada", crewGroup: "ground", role: "Helper", active: true }];
    const courses = [
      { id: "course_1", name: "Fire", crewGroups: ["ground"], roles: ["Helper"], active: true, scheduleType: "recurring", validityAmount: 1, validityUnit: "years", warningDays: 30 },
      { id: "course_2", name: "Pilot only", crewGroups: ["flight"], roles: ["Pilot"], active: true },
    ];
    const records = [
      { id: "old", personId: "person_1", courseId: "course_1", dateDone: "2024-01-01", updatedAt: "2024-01-01" },
      { id: "new", personId: "person_1", courseId: "course_1", dateDone: "2025-01-20", updatedAt: "2025-01-20" },
      { id: "archived", personId: "person_1", courseId: "course_1", dateDone: "2026-01-01", archived: true },
    ];
    expect(isCourseRequired(courses[0], people[0])).toBe(true);
    expect(isCourseRequired(courses[1], people[0])).toBe(false);
    expect(latestRecordsByPair(records).get("person_1|course_1").id).toBe("new");
    expect(buildStatusRows(people, courses, records, new Date("2026-01-01T12:00:00"))).toEqual([
      expect.objectContaining({
        person: people[0],
        overall: "due",
        counts: { expired: 0, due: 1, missing: 0 },
        results: [expect.objectContaining({ course: expect.objectContaining({ id: "course_1" }), record: records[1], status: expect.objectContaining({ key: "due" }) })],
      }),
    ]);
  });
});
