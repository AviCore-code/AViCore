import * as XLSX from "xlsx";
import { DEFAULT_COURSES, createId } from "./model.js";

const FOO_COLUMNS = [
  ["FOO-LIC", 5], ["FOO-INSTR", 7], ["FIRE", 8], ["FIRST-AID", 9],
  ["OHS", 10], ["FOO-PH1", 11], ["FOO-PH2", 12], ["ERP-SMS", 13],
  ["AVSEC", 14], ["QMS", 15], ["DG-FOO", 16], ["CRM", 17],
  ["DISP-90", 18], ["DG-CHECKIN", 19],
];
const CHECKIN_COLUMNS = [
  ["TH-AIRLAW", 4], ["SMS-REF", 5], ["HELIPORT", 6], ["FIRE", 7],
  ["FIRST-AID", 8], ["OHS", 9], ["CHECKIN", 10], ["DGR-PS", 11],
  ["CRM", 12], ["AVSEC", 13],
];
const HELPER_COLUMNS = [
  ["HF", 7], ["TH-AIRLAW", 10], ["SMS-REF", 12], ["COMP-PROC", 14],
  ["RAMP", 16], ["DG-AWARE", 18], ["HELI-HAND", 23], ["BAGGAGE", 24],
  ["TECH-ENG", 27], ["AVSEC", 28], ["BBS", 30], ["ORIENT", 31],
  ["OHS", 32], ["FIRST-AID", 33], ["FIRE", 34],
];
const GOO_COLUMNS = [
  ["HF", 5, 6], ["SMS-REF", 7, 8], ["COMP-PROC", 9, 10],
  ["RAMP", 11, 12], ["DG-AWARE", 13, 14], ["HELI-HAND", 15],
  ["BAGGAGE", 16, 17], ["TECH-ENG", 18], ["AVSEC", 19, 20],
  ["BBS", 21], ["ORIENT", 22], ["OHS", 23], ["FIRST-AID", 24],
  ["FIRE", 25],
];

function text(value) {
  return String(value ?? "").trim();
}

function keyText(value) {
  return text(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function cell(sheet, row, column) {
  return sheet?.[XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })]?.v;
}

export function excelDate(value) {
  const validDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1950 && year <= 2100 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : "";
  };
  if (value instanceof Date && !Number.isNaN(value.getTime())) return validDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? validDate(parsed.y, parsed.m, parsed.d) : "";
  }
  if (typeof value === "string") {
    const input = value.trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    match = /^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/.exec(input);
    if (match) {
      const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase()) + 1;
      return validDate(Number(match[3]), month, Number(match[1]));
    }
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
    if (match) return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  return "";
}

function addPerson(context, input) {
  const name = text(input.name);
  if (!name) return null;
  const lookupKey = input.employeeId ? `id:${text(input.employeeId)}` : `name:${keyText(name)}`;
  let person = context.peopleByKey.get(lookupKey) || context.peopleByName.get(keyText(name));
  if (person) {
    if (!person.employeeId && input.employeeId) person.employeeId = text(input.employeeId);
    return person;
  }
  person = {
    id: createId("person"),
    employeeId: text(input.employeeId),
    name,
    crewGroup: "ground",
    role: text(input.role) || "Ground Operations Officer",
    active: true,
    source: input.source,
  };
  context.people.push(person);
  context.peopleByKey.set(lookupKey, person);
  context.peopleByName.set(keyText(name), person);
  return person;
}

function addRecord(context, person, courseCode, rawDate, source, rawDueDate) {
  if (person) context.coveredPairs.push({ personId: person.id, courseCode });
  const dateDone = excelDate(rawDate);
  if (!person || !dateDone) return;
  const recordKey = `${person.id}|${courseCode}|${dateDone}`;
  if (context.recordKeys.has(recordKey)) return;
  context.recordKeys.add(recordKey);
  const dueDate = excelDate(rawDueDate);
  context.records.push({
    id: createId("record"), personId: person.id, courseCode, dateDone,
    dueDateMode: dueDate ? "manual" : "auto", manualDueDate: dueDate,
    result: "Completed", certificateNo: "", notes: "", source,
    updatedAt: new Date().toISOString(),
  });
}

function parseInputData(workbook, context, source) {
  const sheet = workbook.Sheets["INPUT DATA"];
  if (!sheet) return false;
  for (let row = 30; row <= 38; row += 1) {
    const name = cell(sheet, row, 2);
    const position = text(cell(sheet, row, 3));
    if (!Number.isFinite(Number(cell(sheet, row, 1))) || !name) continue;
    const person = addPerson(context, {
      name, source,
      role: /senior/i.test(position) ? "Senior Flight Operations Officer"
        : /check.?in/i.test(position) ? "Check-In Officer"
          : /base manager/i.test(position) ? "Base Manager"
            : /admin/i.test(position) ? "FO Admin" : "Flight Operations Officer",
    });
    for (const [code, column] of FOO_COLUMNS) addRecord(context, person, code, cell(sheet, row, column), source);
  }
  for (let row = 44; row <= 53; row += 1) {
    const name = cell(sheet, row, 2);
    const position = text(cell(sheet, row, 3));
    if (!Number.isFinite(Number(cell(sheet, row, 1))) || !name || /name/i.test(text(name))) continue;
    const person = addPerson(context, { name, source, role: /admin/i.test(position) ? "FO Admin" : "Check-In Officer" });
    for (const [code, column] of CHECKIN_COLUMNS) addRecord(context, person, code, cell(sheet, row, column), source);
  }
  return true;
}

function parseHelpers(workbook, context, source) {
  const sheet = workbook.Sheets.Helpers;
  if (!sheet) return false;
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  for (let row = 9; row <= Math.min(range.e.r + 1, 250); row += 1) {
    const name = cell(sheet, row, 4);
    const position = text(cell(sheet, row, 5));
    if (!name || !position) continue;
    const person = addPerson(context, { employeeId: cell(sheet, row, 3), name, role: /helper/i.test(position) ? "Helper" : position, source });
    for (const [code, column] of HELPER_COLUMNS) addRecord(context, person, code, cell(sheet, row, column), source);
  }
  return true;
}

function parseGoo(workbook, context, source) {
  const sheet = workbook.Sheets.GOO;
  if (!sheet) return false;
  if (keyText(cell(sheet, 6, 2)) !== "employeeid" || keyText(cell(sheet, 6, 3)) !== "namesurname" || keyText(cell(sheet, 6, 4)) !== "position") {
    throw new Error("Unsupported GOO layout. Expected Employee ID, NAME-SURNAME and POSITION in B6:D6.");
  }
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
  for (let row = 9; row <= range.e.r + 1; row += 1) {
    const employeeId = cell(sheet, row, 2);
    const name = cell(sheet, row, 3);
    const position = text(cell(sheet, row, 4));
    if (!text(employeeId) || !text(name) || !position) continue;
    const person = addPerson(context, {
      employeeId, name, source,
      role: /^ground operations? officer$/i.test(position) ? "Ground Operations Officer" : position,
    });
    for (const [code, doneColumn, dueColumn] of GOO_COLUMNS) {
      addRecord(context, person, code, cell(sheet, row, doneColumn), source, dueColumn ? cell(sheet, row, dueColumn) : "");
    }
  }
  return true;
}

export function parseStaffTrainingWorkbook(workbook, source = "Excel import") {
  const context = { people: [], records: [], coveredPairs: [], peopleByKey: new Map(), peopleByName: new Map(), recordKeys: new Set() };
  const recognised = [];
  if (parseInputData(workbook, context, source)) recognised.push("FOO / Check-In");
  if (parseHelpers(workbook, context, source)) recognised.push("Helpers");
  if (parseGoo(workbook, context, source)) recognised.push("GOO");
  if (!recognised.length) throw new Error('Unsupported workbook. Expected "INPUT DATA", "Helpers" or "GOO" sheet.');
  return { people: context.people, records: context.records, coveredPairs: context.coveredPairs, recognised };
}

export async function parseStaffTrainingExcelFile(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return parseStaffTrainingWorkbook(workbook, file.name);
}

export function mergeStaffTrainingImport(existingCourses, existingPeople, existingRecords, imported) {
  const courses = existingCourses.map((course) => ({ ...course }));
  const courseByCode = new Map(courses.map((course) => [course.code, course]));
  for (const seed of DEFAULT_COURSES) {
    if (!courseByCode.has(seed.code)) {
      courses.push(seed);
      courseByCode.set(seed.code, seed);
    }
  }
  for (const code of ["FIRE", "FIRST-AID", "OHS"]) {
    const course = courseByCode.get(code);
    const importedRoles = imported.records
      .filter((record) => record.courseCode === code)
      .map((record) => imported.people.find((person) => person.id === record.personId)?.role)
      .filter(Boolean);
    if (course?.roles?.length && importedRoles.length) {
      const replacement = { ...course, roles: [...new Set([...course.roles, ...importedRoles])] };
      courses[courses.indexOf(course)] = replacement;
      courseByCode.set(code, replacement);
    }
  }

  const people = existingPeople.map((person) => ({ ...person }));
  const existingByKey = new Map();
  for (const person of people) {
    if (person.employeeId) existingByKey.set(`id:${text(person.employeeId)}`, person);
    existingByKey.set(`name:${keyText(person.name)}`, person);
  }
  const personIdMap = new Map();
  for (const incoming of imported.people) {
    const existing = (incoming.employeeId && existingByKey.get(`id:${text(incoming.employeeId)}`)) || existingByKey.get(`name:${keyText(incoming.name)}`);
    if (existing) {
      personIdMap.set(incoming.id, existing.id);
      people[people.indexOf(existing)] = { ...existing, ...incoming, id: existing.id, employeeId: incoming.employeeId || existing.employeeId };
    } else {
      people.push(incoming);
      personIdMap.set(incoming.id, incoming.id);
    }
  }

  const covered = new Set((imported.coveredPairs || imported.records).map((pair) => {
    const courseId = courseByCode.get(pair.courseCode)?.id;
    return courseId ? `${personIdMap.get(pair.personId)}|${courseId}` : null;
  }).filter(Boolean));
  const records = existingRecords.filter((record) => !covered.has(`${record.personId}|${record.courseId}`)).map((record) => ({ ...record }));
  const replacedRecords = existingRecords.length - records.length;
  const beforeAdd = records.length;
  const recordKeys = new Set(records.map((record) => `${record.personId}|${record.courseId}|${record.dateDone}`));
  for (const incoming of imported.records) {
    const personId = personIdMap.get(incoming.personId);
    const courseId = courseByCode.get(incoming.courseCode)?.id;
    if (!personId || !courseId) continue;
    const recordKey = `${personId}|${courseId}|${incoming.dateDone}`;
    if (recordKeys.has(recordKey)) continue;
    const { courseCode: _courseCode, ...record } = incoming;
    records.push({ ...record, personId, courseId });
    recordKeys.add(recordKey);
  }

  for (const previous of existingRecords.filter((record) => record.documentPath && covered.has(`${record.personId}|${record.courseId}`))) {
    const replacement = !previous.archived && records.find((record) => !record.archived && record.personId === previous.personId && record.courseId === previous.courseId && record.dateDone === previous.dateDone);
    if (replacement) {
      replacement.documentPath = previous.documentPath;
      replacement.documentName = previous.documentName;
    } else {
      records.push({ ...previous, archived: true });
    }
  }

  return {
    courses, people, records,
    addedPeople: people.length - existingPeople.length,
    addedRecords: records.slice(beforeAdd).filter((record) => !record.archived).length,
    replacedRecords,
  };
}
