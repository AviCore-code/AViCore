export const STAFF_TRAINING_KEYS = Object.freeze({
  courses: "staff_training_courses_v1",
  personnel: "staff_training_personnel_v1",
  records: "staff_training_records_v1",
});

export const TRAINING_TYPES = Object.freeze([
  { key: "mandatory", label: "Mandatory / ภาคบังคับ" },
  { key: "performance", label: "Performance Enhancement / เพิ่มประสิทธิภาพ" },
  { key: "development", label: "Development / การพัฒนา" },
]);

export const CREW_GROUPS = Object.freeze([
  { key: "flight", label: "Flight Crew" },
  { key: "ground", label: "Ground Crew" },
]);

export const SCHEDULE_TYPES = Object.freeze([
  { key: "recurring", label: "Recurring / อบรมซ้ำตามรอบ" },
  { key: "once_on_hire", label: "Once on Hire / ครั้งเดียวเมื่อเริ่มงาน" },
  { key: "on_demand", label: "On Demand / อบรมเมื่อจำเป็น" },
]);

export const DEFAULT_ROLES = Object.freeze([
  "Pilot",
  "Flight Operations Officer",
  "Senior Flight Operations Officer",
  "Check-In Officer",
  "Ground Operations Officer",
  "Helper",
  "Base Manager",
  "FO Admin",
]);

const COURSE_SEEDS = [
  ["FOO-LIC", "FOO License", ["Flight Operations Officer", "Senior Flight Operations Officer"], 5, "years", 90],
  ["FOO-INSTR", "FOO Instructor Assessment", ["Flight Operations Officer", "Senior Flight Operations Officer"], 3, "years", 90],
  ["FOO-PH1", "FOO Phase 1 — Basic Knowledge (Modules 1–15)", ["Flight Operations Officer", "Senior Flight Operations Officer"], 12, "months", 90],
  ["FOO-PH2", "FOO Phase 2 — Practical and Familiarization Flight", ["Flight Operations Officer", "Senior Flight Operations Officer"], 12, "months", 90],
  ["ERP-SMS", "ERP and SMS (Modules 16–17)", ["Flight Operations Officer", "Senior Flight Operations Officer"], 2, "years", 90],
  ["AVSEC", "Aviation Security (AVSEC)", ["Flight Operations Officer", "Senior Flight Operations Officer", "Check-In Officer", "Ground Operations Officer", "Helper"], 2, "years", 90],
  ["QMS", "Quality Management System (QMS)", ["Flight Operations Officer", "Senior Flight Operations Officer"], null, "none", 90],
  ["DG-FOO", "Dangerous Goods for FOO", ["Flight Operations Officer", "Senior Flight Operations Officer"], 2, "years", 90],
  ["CRM", "Crew Resource Management (CRM)", ["Flight Operations Officer", "Senior Flight Operations Officer", "Check-In Officer", "Ground Operations Officer", "Helper"], 1, "years", 90],
  ["DISP-90", "Dispatch Flight Currency", ["Flight Operations Officer", "Senior Flight Operations Officer"], 90, "days", 30],
  ["FIRST-AID", "First Aid", ["Check-In Officer", "Ground Operations Officer", "Helper"], 3, "years", 90],
  ["FIRE", "Basic Fire Fighting", ["Check-In Officer", "Ground Operations Officer", "Helper"], 3, "years", 90],
  ["CHECKIN", "Basic Check-In Operating Procedure", ["Check-In Officer"], null, "none", 90],
  ["HELIPORT", "Knowledge of Heliport", ["Check-In Officer"], null, "none", 90],
  ["DGR-PS", "DGR Passenger Service", ["Check-In Officer"], 2, "years", 90],
  ["DG-CHECKIN", "Dangerous Goods for Check-In (SFS)", ["Check-In Officer"], 2, "years", 90],
  ["OHS", "Basic Occupational Health and Safety", ["Check-In Officer", "Ground Operations Officer", "Helper"], 2, "years", 90],
  ["HF", "Human Factor Refresher", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["TH-AIRLAW", "Thailand Aviation Laws and Regulations", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["COMP-PROC", "Company Procedure Refresher", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["SMS-REF", "Safety Management System Refresher", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["RAMP", "Driving on Ramp", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["DG-AWARE", "Dangerous Goods Awareness", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["HELI-HAND", "Basic Helicopter Handling", ["Ground Operations Officer", "Helper"], null, "none", 90],
  ["BAGGAGE", "Baggage Handling", ["Ground Operations Officer", "Helper"], 2, "years", 90],
  ["TECH-ENG", "Technical English / TOEIC", ["Ground Operations Officer", "Helper"], null, "none", 90],
  ["BBS", "Behavior Based Safety (BBS)", ["Ground Operations Officer", "Helper"], null, "none", 90],
  ["ORIENT", "Orientation", ["Ground Operations Officer", "Helper"], null, "none", 90],
];

export const DEFAULT_COURSES = Object.freeze(COURSE_SEEDS.map(([code, name, roles, validityAmount, validityUnit, warningDays], index) => Object.freeze({
  id: `seed_${index + 1}`,
  code,
  name,
  itemType: "course",
  trainingType: "mandatory",
  crewGroups: ["ground"],
  roles,
  validityAmount,
  validityUnit,
  scheduleType: validityUnit === "none" ? (code === "ORIENT" ? "once_on_hire" : "on_demand") : "recurring",
  dueOffsetDays: validityUnit === "none" ? 0 : -1,
  warningDays,
  active: true,
  source: "Training Matrix reference",
})));

export const EMPTY_COURSE = Object.freeze({
  code: "", name: "", itemType: "course", trainingType: "mandatory", crewGroups: ["ground"], roles: [],
  scheduleType: "recurring", validityAmount: 2, validityUnit: "years", dueMode: "offset", dueOffsetDays: -1, warningDays: 90, active: true,
});

export const EMPTY_PERSON = Object.freeze({ employeeId: "", name: "", crewGroup: "ground", role: "Helper", active: true });
export const EMPTY_RECORD = Object.freeze({ personId: "", courseId: "", dateDone: "", dueDateMode: "auto", manualDueDate: "", result: "Completed", certificateNo: "", notes: "" });

export function changeCourseSchedule(course, scheduleType) {
  if (scheduleType === "recurring") {
    return {
      ...course,
      scheduleType,
      validityUnit: ["days", "months", "years"].includes(course.validityUnit) ? course.validityUnit : "years",
      validityAmount: Number(course.validityAmount) > 0 ? course.validityAmount : 1,
    };
  }
  return { ...course, scheduleType, validityUnit: "none", validityAmount: null };
}

export function createId(prefix = "item") {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeCourses(value) {
  const source = Array.isArray(value) ? value : DEFAULT_COURSES;
  return source.filter((item) => item?.id && item?.name).map((item) => ({
    itemType: "course", trainingType: "mandatory", crewGroups: ["ground"], roles: [], validityAmount: null,
    validityUnit: "none", dueOffsetDays: 0, warningDays: 90, active: true,
    scheduleType: item.scheduleType || DEFAULT_COURSES.find((seed) => seed.code === item.code)?.scheduleType || (item.validityUnit && item.validityUnit !== "none" ? "recurring" : "on_demand"),
    ...item,
  }));
}

export function normalizePersonnel(value) {
  return Array.isArray(value)
    ? value.filter((item) => item?.id && item?.name).map((item) => ({ crewGroup: "ground", role: "", active: true, ...item }))
    : [];
}

export function normalizeRecords(value) {
  return Array.isArray(value) ? value.filter((item) => item?.id && item?.personId && item?.courseId) : [];
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function formatDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addPeriod(date, amount, unit) {
  const result = new Date(date);
  if (unit === "days") {
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
  }
  const day = result.getUTCDate();
  const targetMonth = result.getUTCMonth() + (unit === "years" ? amount * 12 : amount);
  result.setUTCDate(1);
  result.setUTCMonth(targetMonth);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function calculateDueDate(dateDone, course) {
  if (!dateDone || !course || course.scheduleType !== "recurring" || course.validityUnit === "none") return "";
  const amount = Number(course.validityAmount);
  const date = parseDate(dateDone);
  if (!date || !Number.isFinite(amount) || amount <= 0 || !["days", "months", "years"].includes(course.validityUnit)) return "";
  const result = addPeriod(date, amount, course.validityUnit);
  if (course.dueMode === "eomonth") {
    result.setUTCMonth(result.getUTCMonth() + 1, 0);
  } else if (course.dueMode === "minusday") {
    result.setUTCDate(result.getUTCDate() - 1);
  } else {
    result.setUTCDate(result.getUTCDate() + (Number(course.dueOffsetDays) || 0));
  }
  return formatDate(result);
}

export function effectiveDueDate(record, course) {
  return record?.dueDateMode === "manual" ? record.manualDueDate || "" : calculateDueDate(record?.dateDone, course);
}

export function getRecordStatus(record, course, today = new Date()) {
  if (record?.result === "Planned") return { key: "planned", label: "Planned", daysRemaining: null };
  if (record?.result === "Certificate Waiting") return { key: "waiting", label: "Certificate waiting", daysRemaining: null };
  if (record?.result === "Failed") return { key: "expired", label: "Failed", daysRemaining: null };
  if (record?.result === "Exempted") return { key: "valid", label: "Exempted", daysRemaining: null };
  if (!record?.dateDone) return { key: "missing", label: "Not completed", daysRemaining: null };
  const dueDate = effectiveDueDate(record, course);
  if (!dueDate) return { key: "valid", label: "Completed", daysRemaining: null };
  const due = parseDate(dueDate);
  if (!due) return { key: "valid", label: "Completed", daysRemaining: null };
  const start = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const daysRemaining = Math.ceil((due.getTime() - start.getTime()) / 86400000);
  if (daysRemaining < 0) return { key: "expired", label: "Expired", daysRemaining };
  if (daysRemaining <= (Number(course?.warningDays) || 0)) return { key: "due", label: "Due soon", daysRemaining };
  return { key: "valid", label: "Valid", daysRemaining };
}

export function isCourseRequired(course, person) {
  if (!course?.active || !person?.active) return false;
  const groups = Array.isArray(course.crewGroups) ? course.crewGroups : [];
  const roles = Array.isArray(course.roles) ? course.roles : [];
  return (!groups.length || groups.includes(person.crewGroup)) && (!roles.length || roles.includes(person.role));
}

export function latestRecordsByPair(records) {
  const latest = new Map();
  for (const record of normalizeRecords(records)) {
    if (record.archived) continue;
    const key = `${record.personId}|${record.courseId}`;
    const previous = latest.get(key);
    if (!previous || String(record.dateDone || record.updatedAt || "") > String(previous.dateDone || previous.updatedAt || "")) latest.set(key, record);
  }
  return latest;
}

export function overallStatus(results) {
  if (!results.length) return "missing";
  if (results.some(({ status }) => status.key === "expired")) return "expired";
  if (results.some(({ status }) => status.key === "due" || status.key === "waiting")) return "due";
  if (results.some(({ status }) => status.key === "missing")) return "missing";
  return "valid";
}

export function buildStaffPlanningRows(people, courses, records, today = new Date()) {
  return buildStatusRows(people, courses, records, today).flatMap(({ person, results }) => results.map(({ course, record, status }) => ({
    id: `staff:${person.id}:${course.id}`,
    personId: person.id,
    name: person.name,
    employeeId: person.employeeId || "",
    group: person.crewGroup || "ground",
    role: person.role,
    courseKey: course.id,
    courseCode: course.code || "",
    courseName: course.name,
    dateDone: record?.dateDone || "",
    dueDate: effectiveDueDate(record, course),
    daysRemaining: status.daysRemaining,
    status: status.key,
    detail: status.label,
    source: "Staff Training",
  })));
}

export function filterStaffPlanningRows(rows, {
  group = "all",
  course = "all",
  status = "all",
  horizon = "all",
  search = "",
} = {}) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) =>
    (group === "all" || row.group === group)
    && (course === "all" || row.courseKey === course)
    && (status === "all" || (status === "needs_action" ? ["expired", "due", "missing"].includes(row.status) : row.status === status))
    && (horizon === "all" || (row.daysRemaining != null && row.daysRemaining <= Number(horizon)))
    && (!query || `${row.name} ${row.employeeId} ${row.role} ${row.courseCode} ${row.courseName}`.toLowerCase().includes(query))
  ).sort((left, right) =>
    (left.daysRemaining ?? Infinity) - (right.daysRemaining ?? Infinity)
    || left.name.localeCompare(right.name)
    || left.courseName.localeCompare(right.courseName));
}

export function buildStatusRows(people, courses, records, today = new Date()) {
  const latest = latestRecordsByPair(records);
  const activeCourses = normalizeCourses(courses).filter((course) => course.active);
  return normalizePersonnel(people).filter((person) => person.active).map((person) => {
    const results = activeCourses.filter((course) => isCourseRequired(course, person)).map((course) => {
      const record = latest.get(`${person.id}|${course.id}`);
      return { course, record, status: getRecordStatus(record, course, today) };
    });
    const counts = { expired: 0, due: 0, missing: 0 };
    for (const { status } of results) {
      if (status.key === "expired") counts.expired += 1;
      else if (status.key === "due" || status.key === "waiting") counts.due += 1;
      else if (status.key === "missing") counts.missing += 1;
    }
    return { person, results, overall: overallStatus(results), counts };
  });
}
