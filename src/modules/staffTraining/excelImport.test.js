import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { DEFAULT_COURSES } from "./model.js";
import {
  mergeStaffTrainingImport,
  parseStaffTrainingWorkbook,
} from "./excelImport.js";

function workbookWithSheet(name, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return workbook;
}

describe("staff training Excel import", () => {
  it("reads GOO personnel, completion dates, and persisted Excel due dates", () => {
    const rows = Array.from({ length: 9 }, () => []);
    rows[5][1] = "Employee ID";
    rows[5][2] = "NAME-SURNAME";
    rows[5][3] = "POSITION";
    rows[8][1] = "G001";
    rows[8][2] = "Grace Ground";
    rows[8][3] = "Ground Operation Officer";
    rows[8][4] = "01-Jan-2026"; // HF date done (E)
    rows[8][5] = "31-Dec-2027"; // HF due date (F)

    const parsed = parseStaffTrainingWorkbook(workbookWithSheet("GOO", rows), "GOO.xlsx");

    expect(parsed.recognised).toEqual(["GOO"]);
    expect(parsed.people).toEqual([
      expect.objectContaining({ employeeId: "G001", name: "Grace Ground", role: "Ground Operations Officer" }),
    ]);
    expect(parsed.coveredPairs).toContainEqual(expect.objectContaining({ courseCode: "HF" }));
    expect(parsed.records).toContainEqual(expect.objectContaining({
      courseCode: "HF",
      dateDone: "2026-01-01",
      dueDateMode: "manual",
      manualDueDate: "2027-12-31",
    }));
  });

  it("replaces covered pairs, keeps blank cells meaningful, and preserves attachments", () => {
    const courses = DEFAULT_COURSES.filter(({ code }) => ["HF", "AVSEC"].includes(code));
    const people = [{ id: "person_existing", employeeId: "G001", name: "Grace Ground", role: "Ground Operations Officer", crewGroup: "ground", active: true }];
    const records = [
      { id: "old_hf", personId: "person_existing", courseId: courses.find(({ code }) => code === "HF").id, dateDone: "2026-01-01", documentPath: "/docs/hf.pdf", documentName: "hf.pdf" },
      { id: "old_avsec", personId: "person_existing", courseId: courses.find(({ code }) => code === "AVSEC").id, dateDone: "2025-01-01", documentPath: "/docs/avsec.pdf", documentName: "avsec.pdf" },
    ];
    const imported = {
      people: [{ id: "temp_person", employeeId: "G001", name: "Grace Ground", role: "Ground Operations Officer", crewGroup: "ground", active: true }],
      coveredPairs: [
        { personId: "temp_person", courseCode: "HF" },
        { personId: "temp_person", courseCode: "AVSEC" },
      ],
      records: [{ id: "new_hf", personId: "temp_person", courseCode: "HF", dateDone: "2026-01-01", dueDateMode: "auto", result: "Completed" }],
      recognised: ["GOO"],
    };

    const merged = mergeStaffTrainingImport(courses, people, records, imported);

    expect(merged.people).toHaveLength(1);
    expect(merged.records.find(({ id }) => id === "new_hf")).toMatchObject({
      personId: "person_existing",
      documentPath: "/docs/hf.pdf",
      documentName: "hf.pdf",
    });
    expect(merged.records.find(({ id }) => id === "old_avsec")).toMatchObject({ archived: true });
    expect(merged.records.some(({ id }) => id === "old_hf")).toBe(false);
    expect(merged.replacedRecords).toBe(2);
  });
});
