import { describe, expect, it, vi } from "vitest";
import { STAFF_TRAINING_KEYS } from "./model.js";
import { createStaffTrainingRepository } from "./repository.js";

function fixture(initial = {}) {
  const data = {
    [STAFF_TRAINING_KEYS.courses]: null,
    [STAFF_TRAINING_KEYS.personnel]: [],
    [STAFF_TRAINING_KEYS.records]: [],
    ...initial,
  };
  const getSetting = vi.fn(async (key) => data[key]);
  const saveSetting = vi.fn(async (key, value) => {
    data[key] = value;
    return { ok: true };
  });
  const repository = createStaffTrainingRepository({
    getSetting,
    saveSetting,
    now: () => "2026-09-15T10:00:00.000Z",
    idFactory: (prefix) => `${prefix}_new`,
  });
  return { data, getSetting, saveSetting, repository };
}

describe("staff training repository", () => {
  it("loads all three setting collections and seeds courses only when absent", async () => {
    const { repository, getSetting } = fixture();
    const result = await repository.load();
    expect(getSetting.mock.calls.map(([key]) => key)).toEqual([
      STAFF_TRAINING_KEYS.courses,
      STAFF_TRAINING_KEYS.personnel,
      STAFF_TRAINING_KEYS.records,
    ]);
    expect(result.courses.length).toBeGreaterThanOrEqual(25);
    expect(result.people).toEqual([]);
    expect(result.records).toEqual([]);
  });

  it("creates and updates courses while rejecting duplicate codes", async () => {
    const existing = [{ id: "course_1", code: "CRM", name: "CRM", active: true }];
    const { repository, data } = fixture({ [STAFF_TRAINING_KEYS.courses]: existing });
    await repository.saveCourse({ code: "avsec", name: " Aviation Security ", scheduleType: "recurring", validityAmount: "2", validityUnit: "years", warningDays: "60", active: true });
    expect(data[STAFF_TRAINING_KEYS.courses][1]).toMatchObject({ id: "course_new", code: "AVSEC", name: "Aviation Security", validityAmount: 2, warningDays: 60 });
    await repository.saveCourse({ ...data[STAFF_TRAINING_KEYS.courses][1], name: "AVSEC recurrent" });
    expect(data[STAFF_TRAINING_KEYS.courses]).toHaveLength(2);
    expect(data[STAFF_TRAINING_KEYS.courses][1].name).toBe("AVSEC recurrent");
    await expect(repository.saveCourse({ code: "crm", name: "Duplicate" })).rejects.toThrow("Course code CRM already exists");
  });

  it("defaults a recurring transition to years and rejects unsupported validity units", async () => {
    const existing = [{
      id: "course_1",
      code: "QMS",
      name: "QMS",
      scheduleType: "on_demand",
      validityAmount: null,
      validityUnit: "none",
      active: true,
    }];
    const { repository, data } = fixture({ [STAFF_TRAINING_KEYS.courses]: existing });

    await repository.saveCourse({ ...existing[0], scheduleType: "recurring", validityAmount: "2" });
    expect(data[STAFF_TRAINING_KEYS.courses][0]).toMatchObject({
      scheduleType: "recurring",
      validityAmount: 2,
      validityUnit: "years",
    });

    await expect(repository.saveCourse({
      ...existing[0],
      scheduleType: "recurring",
      validityAmount: 2,
      validityUnit: "weeks",
    })).rejects.toThrow("Validity unit must be days, months, or years");
  });

  it("prevents deleting a course with history", async () => {
    const { repository } = fixture({
      [STAFF_TRAINING_KEYS.courses]: [{ id: "course_1", code: "CRM", name: "CRM" }],
      [STAFF_TRAINING_KEYS.records]: [{ id: "record_1", personId: "person_1", courseId: "course_1" }],
    });
    await expect(repository.deleteCourse("course_1")).rejects.toThrow("training history");
  });

  it("creates personnel, rejects duplicate employee IDs, and cascades personnel deletion", async () => {
    const { repository, data, saveSetting } = fixture({
      [STAFF_TRAINING_KEYS.personnel]: [{ id: "person_1", employeeId: "E001", name: "Ada", role: "Helper", active: true }],
      [STAFF_TRAINING_KEYS.records]: [{ id: "record_1", personId: "person_1", courseId: "course_1" }],
    });
    await repository.savePerson({ employeeId: " e002 ", name: " Grace ", role: " Ground Operations Officer ", crewGroup: "ground", active: true });
    expect(data[STAFF_TRAINING_KEYS.personnel][1]).toMatchObject({ id: "person_new", employeeId: "e002", name: "Grace", role: "Ground Operations Officer" });
    await expect(repository.savePerson({ employeeId: "E001", name: "Duplicate", role: "Helper" })).rejects.toThrow("Employee ID E001 already exists");
    const result = await repository.deletePerson("person_1");
    expect(result.deletedRecords).toBe(1);
    expect(data[STAFF_TRAINING_KEYS.personnel]).toHaveLength(1);
    expect(data[STAFF_TRAINING_KEYS.records]).toEqual([]);
    expect(saveSetting).toHaveBeenCalledWith(STAFF_TRAINING_KEYS.records, []);
  });

  it("imports parsed staff workbooks through the repository storage boundary", async () => {
    const { repository, data, saveSetting } = fixture({
      [STAFF_TRAINING_KEYS.courses]: [{ id: "course_hf", code: "HF", name: "Human Factor", active: true }],
    });
    const imported = {
      people: [{ id: "temp", employeeId: "G001", name: "Grace", role: "Ground Operations Officer", crewGroup: "ground", active: true }],
      coveredPairs: [{ personId: "temp", courseCode: "HF" }],
      records: [{ id: "record_import", personId: "temp", courseCode: "HF", dateDone: "2026-01-01", result: "Completed" }],
      recognised: ["GOO"],
    };

    const result = await repository.importData(imported);

    expect(result).toMatchObject({ addedPeople: 1, addedRecords: 1, replacedRecords: 0 });
    expect(data[STAFF_TRAINING_KEYS.personnel]).toHaveLength(1);
    expect(data[STAFF_TRAINING_KEYS.records][0]).toMatchObject({ courseId: "course_hf", personId: "temp" });
    expect(saveSetting).toHaveBeenCalledWith(STAFF_TRAINING_KEYS.courses, expect.any(Array));
    expect(saveSetting).toHaveBeenCalledWith(STAFF_TRAINING_KEYS.personnel, expect.any(Array));
    expect(saveSetting).toHaveBeenCalledWith(STAFF_TRAINING_KEYS.records, expect.any(Array));
  });

  it("validates, creates, updates, and deletes training records", async () => {
    const { repository, data } = fixture();
    await expect(repository.saveRecord({ personId: "person_1", courseId: "course_1", result: "Completed" })).rejects.toThrow("Date Done is required");
    await expect(repository.saveRecord({ personId: "person_1", courseId: "course_1", result: "Planned", dueDateMode: "manual" })).rejects.toThrow("manual Due Date");
    const created = await repository.saveRecord({ personId: "person_1", courseId: "course_1", result: "Completed", dateDone: "2026-09-01", dueDateMode: "auto", notes: "ok" });
    expect(created).toMatchObject({ id: "record_new", updatedAt: "2026-09-15T10:00:00.000Z" });
    await repository.saveRecord({ ...created, notes: "updated" });
    expect(data[STAFF_TRAINING_KEYS.records]).toHaveLength(1);
    expect(data[STAFF_TRAINING_KEYS.records][0].notes).toBe("updated");
    await repository.deleteRecord(created.id);
    expect(data[STAFF_TRAINING_KEYS.records]).toEqual([]);
  });
});
