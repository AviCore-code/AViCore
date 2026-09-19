import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import {
  STAFF_TRAINING_KEYS,
  createId,
  normalizeCourses,
  normalizePersonnel,
  normalizeRecords,
} from "./model.js";
import { mergeStaffTrainingImport } from "./excelImport.js";

export function createStaffTrainingRepository({
  getSetting: readSetting,
  saveSetting: writeSetting,
  now = () => new Date().toISOString(),
  idFactory = createId,
}) {
  async function load() {
    const [courses, people, records] = await Promise.all([
      readSetting(STAFF_TRAINING_KEYS.courses),
      readSetting(STAFF_TRAINING_KEYS.personnel),
      readSetting(STAFF_TRAINING_KEYS.records),
    ]);
    return {
      courses: normalizeCourses(courses),
      people: normalizePersonnel(people),
      records: normalizeRecords(records),
    };
  }

  async function persist(key, value) {
    await writeSetting(key, value);
    return value;
  }

  async function saveCourse(input) {
    const { courses } = await load();
    const name = String(input?.name || "").trim();
    if (!name) throw new Error("Course name is required.");
    const code = String(input?.code || "").trim().toUpperCase();
    if (code && courses.some((course) => String(course.code || "").toUpperCase() === code && course.id !== input.id)) {
      throw new Error(`Course code ${code} already exists.`);
    }
    const recurring = input.scheduleType === "recurring";
    const requestedValidityUnit = input.validityUnit;
    const validityUnit = recurring && (!requestedValidityUnit || requestedValidityUnit === "none")
      ? "years"
      : requestedValidityUnit;
    if (recurring && !["days", "months", "years"].includes(validityUnit)) {
      throw new Error("Validity unit must be days, months, or years.");
    }
    const course = {
      ...input,
      id: input.id || idFactory("course"),
      code,
      name,
      itemType: input.itemType || "course",
      trainingType: input.trainingType || "mandatory",
      crewGroups: Array.isArray(input.crewGroups) ? input.crewGroups : ["ground"],
      roles: Array.isArray(input.roles) ? input.roles : [],
      scheduleType: input.scheduleType || "on_demand",
      validityAmount: recurring ? Number(input.validityAmount) : null,
      validityUnit: recurring ? validityUnit : "none",
      dueOffsetDays: recurring ? (Number(input.dueOffsetDays) || 0) : 0,
      warningDays: Number(input.warningDays) || 0,
      active: input.active !== false,
      updatedAt: now(),
    };
    if (recurring && (!Number.isFinite(course.validityAmount) || course.validityAmount <= 0)) throw new Error("Validity amount must be greater than zero.");
    const next = input.id ? courses.map((item) => item.id === input.id ? course : item) : [...courses, course];
    await persist(STAFF_TRAINING_KEYS.courses, next);
    return course;
  }

  async function deleteCourse(id) {
    const { courses, records } = await load();
    if (records.some((record) => record.courseId === id)) {
      throw new Error("This item has training history. Mark it inactive instead of deleting it.");
    }
    const next = courses.filter((course) => course.id !== id);
    await persist(STAFF_TRAINING_KEYS.courses, next);
    return { deleted: courses.length - next.length };
  }

  async function savePerson(input) {
    const { people } = await load();
    const name = String(input?.name || "").trim();
    const role = String(input?.role || "").trim();
    if (!name || !role) throw new Error("Name and position are required.");
    const employeeId = String(input?.employeeId || "").trim();
    if (employeeId && people.some((person) => person.employeeId === employeeId && person.id !== input.id)) {
      throw new Error(`Employee ID ${employeeId} already exists.`);
    }
    const person = {
      ...input,
      id: input.id || idFactory("person"),
      employeeId,
      name,
      role,
      crewGroup: input.crewGroup || "ground",
      active: input.active !== false,
      updatedAt: now(),
    };
    const next = input.id ? people.map((item) => item.id === input.id ? person : item) : [...people, person];
    await persist(STAFF_TRAINING_KEYS.personnel, next);
    return person;
  }

  async function deletePerson(id) {
    const { people, records } = await load();
    const nextPeople = people.filter((person) => person.id !== id);
    const nextRecords = records.filter((record) => record.personId !== id);
    await Promise.all([
      persist(STAFF_TRAINING_KEYS.personnel, nextPeople),
      persist(STAFF_TRAINING_KEYS.records, nextRecords),
    ]);
    return { deleted: people.length - nextPeople.length, deletedRecords: records.length - nextRecords.length };
  }

  async function importData(imported) {
    const { courses, people, records } = await load();
    const merged = mergeStaffTrainingImport(courses, people, records, imported);
    await Promise.all([
      persist(STAFF_TRAINING_KEYS.courses, merged.courses),
      persist(STAFF_TRAINING_KEYS.personnel, merged.people),
      persist(STAFF_TRAINING_KEYS.records, merged.records),
    ]);
    return merged;
  }

  async function saveRecord(input) {
    const { records } = await load();
    if (!input?.personId || !input?.courseId) throw new Error("Select a person and course.");
    if (!input.dateDone && input.result === "Completed") throw new Error("Date Done is required for a completed course.");
    if (input.dueDateMode === "manual" && !input.manualDueDate) throw new Error("Enter the manual Due Date.");
    const record = {
      ...input,
      id: input.id || idFactory("record"),
      result: input.result || "Completed",
      dueDateMode: input.dueDateMode || "auto",
      manualDueDate: input.manualDueDate || "",
      dateDone: input.dateDone || "",
      certificateNo: String(input.certificateNo || "").trim(),
      notes: String(input.notes || "").trim(),
      updatedAt: now(),
    };
    const next = input.id ? records.map((item) => item.id === input.id ? record : item) : [...records, record];
    await persist(STAFF_TRAINING_KEYS.records, next);
    return record;
  }

  async function deleteRecord(id) {
    const { records } = await load();
    const next = records.filter((record) => record.id !== id);
    await persist(STAFF_TRAINING_KEYS.records, next);
    return { deleted: records.length - next.length };
  }

  return { load, saveCourse, deleteCourse, savePerson, deletePerson, importData, saveRecord, deleteRecord };
}

export const staffTrainingRepository = createStaffTrainingRepository({ getSetting, saveSetting });
