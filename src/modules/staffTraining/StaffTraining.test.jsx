import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AllStaffTraining, STAFF_TRAINING_KEYS } from "./index.js";

const initialData = {
  people: [{ id: "person_1", employeeId: "E001", name: "Ada Example", crewGroup: "ground", role: "Helper", active: true }],
  courses: [{ id: "course_1", code: "FIRE", name: "Basic Fire Fighting", itemType: "course", trainingType: "mandatory", crewGroups: ["ground"], roles: ["Helper"], scheduleType: "recurring", validityAmount: 1, validityUnit: "years", dueOffsetDays: -1, warningDays: 90, active: true }],
  records: [{ id: "record_1", personId: "person_1", courseId: "course_1", dateDone: "2025-06-01", dueDateMode: "auto", result: "Completed", updatedAt: "2025-06-01" }],
};

function render(props = {}) {
  return renderToStaticMarkup(<AllStaffTraining initialData={initialData} today={new Date("2026-05-01T12:00:00Z")} {...props} />);
}

describe("AllStaffTraining", () => {
  it("exports the stable storage contract and renders the standalone navigation", () => {
    expect(STAFF_TRAINING_KEYS.records).toBe("staff_training_records_v1");
    const html = render();
    expect(html).toContain("All Staff Training Status");
    expect(html).toContain("Course Catalog");
    expect(html).toContain("Personnel");
    expect(html).toContain("Training Records");
    expect(html).toContain("Planning");
    expect(html).toContain("Import Excel");
  });

  it("renders the status matrix and summary from the latest training data", () => {
    const matrix = render({ activeTab: "matrix" });
    expect(matrix).toContain("All Staff Training Status — Track Record");
    expect(matrix).toContain("Ada Example");
    expect(matrix).toContain("Basic Fire Fighting");
    expect(matrix).toContain("Due soon");
    const summary = render({ activeTab: "summary" });
    expect(summary).toContain("All Staff Training Status — Summary");
    expect(summary).toContain("Expired");
    expect(summary).toContain("Due Soon");
    expect(summary).toContain("No Data");
  });

  it("renders maintainable CRUD screens for courses, personnel, and records", () => {
    const courses = render({ activeTab: "courses" });
    expect(courses).toContain("Add document / course");
    expect(courses).toContain("Item code");
    expect(courses).toContain("Due-date calculation");
    expect(courses).toContain("Edit");
    expect(courses).toContain("Delete");

    const people = render({ activeTab: "people" });
    expect(people).toContain("Add person");
    expect(people).toContain("Employee ID");
    expect(people).toContain("Name–Surname");

    const records = render({ activeTab: "records" });
    expect(records).toContain("Add training record");
    expect(records).toContain("Date Done");
    expect(records).toContain("Manual Override");
    expect(records).toContain("Certificate No.");
      });

  it("renders a staff-only planning view for missing and due training", () => {
    const planning = render({ activeTab: "planning" });
    expect(planning).toContain("Staff Training Planning");
    expect(planning).toContain("Non-pilot staff only");
    expect(planning).toContain("Personnel in scope");
    expect(planning).toContain("Course");
        expect(planning).toContain("Ada Example");
  });

  it("renders the FOO, Helpers, and GOO Excel import workflow", () => {
    const html = render({ activeTab: "import" });
    expect(html).toContain("Import Staff Training Excel");
    expect(html).toContain("FOO/Check-In");
    expect(html).toContain("Helpers");
    expect(html).toContain("GOO");
    expect(html).toContain('accept=".xlsx,.xlsm,.xls"');
  });
});
