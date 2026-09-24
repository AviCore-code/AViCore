import { useEffect, useMemo, useState } from "react";
import {
  CREW_GROUPS,
  DEFAULT_ROLES,
  EMPTY_COURSE,
  EMPTY_PERSON,
  EMPTY_RECORD,
  SCHEDULE_TYPES,
  TRAINING_TYPES,
  buildStatusRows,
  effectiveDueDate,
  normalizeCourses,
  normalizePersonnel,
  normalizeRecords,
} from "./model.js";
import { staffTrainingRepository } from "./repository.js";
import "./staffTraining.css";
import { buildStaffPlanningRows, filterStaffPlanningRows } from "./model.js";
import { validateStaffDocument, staffDocumentToDataUrl } from "./documents.js";
import { mergeStaffTrainingImport, parseStaffTrainingExcelFile } from "./excelImport.js";

const TABS = [
  ["matrix", "All Staff Training Status"],
  ["courses", "Course Catalog"],
  ["people", "Personnel"],
  ["records", "Training Records"],
  ["planning", "Planning"],
  ["import", "Import Excel"],
];

const STATUS_LABELS = { valid: "VALID", due: "DUE SOON", expired: "EXPIRED", missing: "NO DATA" };

function copyForm(value) {
  return { ...value, crewGroups: value.crewGroups ? [...value.crewGroups] : undefined, roles: value.roles ? [...value.roles] : undefined };
}

function StatusBadge({ status, overall = false }) {
  const key = typeof status === "string" ? status : status.key;
  const label = overall ? STATUS_LABELS[key] || key : status.label;
  return <span className={`${overall ? "staff-overall" : "staff-status"} ${overall ? "staff-overall" : "staff-status"}-${key}`}>{label}</span>;
}

function StaffStatus({ people, courses, records, today, onOpenRecord, initialView = "matrix" }) {
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [crewGroup, setCrewGroup] = useState("all");
  const rows = useMemo(() => buildStatusRows(people, courses, records, today), [people, courses, records, today]);
  const activeCourses = useMemo(() => normalizeCourses(courses).filter((course) => course.active), [courses]);
  const filtered = rows.filter(({ person }) => {
    const text = `${person.employeeId || ""} ${person.name} ${person.role}`.toLowerCase();
    return (crewGroup === "all" || person.crewGroup === crewGroup) && text.includes(query.trim().toLowerCase());
  }).sort((a, b) => a.person.name.localeCompare(b.person.name));

  return <section className="staff-all-status">
    <div className="staff-all-controls no-print">
      <input className="trainingdue-filter" aria-label="Filter staff" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name, Employee ID or position..." />
      <select aria-label="Crew group" value={crewGroup} onChange={(event) => setCrewGroup(event.target.value)}>
        <option value="all">All crew groups</option>
        {CREW_GROUPS.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}
      </select>
      <div className="trainingall-viewtoggle">
        <button type="button" className={view === "matrix" ? "active" : ""} onClick={() => setView("matrix")}>Track Record</button>
        <button type="button" className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>Summary</button>
      </div>
      <button type="button" disabled={!filtered.length} onClick={() => window.print()}>Print / Save PDF</button>
    </div>
    {!filtered.length ? <div className="staff-empty">No Staff Training data matches this filter.</div> : <div className="staff-all-print-area">
      <div className="staff-all-title">All Staff Training Status — {view === "matrix" ? "Track Record" : "Summary"}</div>
      {view === "matrix" ? <div className="staff-table-wrap staff-matrix">
        <table>
          <thead><tr><th>Employee</th><th>Employee ID</th><th>Position</th><th>Overall</th>{activeCourses.map((course) => <th key={course.id} title={course.name}>{course.code || course.name}</th>)}</tr></thead>
          <tbody>
            {filtered.map(({ person, results, overall }) => {
              const byCourse = new Map(results.map((result) => [result.course.id, result]));
              return <tr key={person.id}>
                <th>{person.name}</th><td>{person.employeeId || "—"}</td><td>{person.role}</td><td><StatusBadge status={overall} overall /></td>
                {activeCourses.map((course) => {
                  const result = byCourse.get(course.id);
                  if (!result) return <td className="staff-na staff-course-cell" key={course.id}>N/A</td>;
                  const dueDate = effectiveDueDate(result.record, course);
                  return <td key={course.id} className={`staff-matrix-cell staff-course-cell staff-matrix-${result.status.key}`} onClick={() => onOpenRecord(person, course, result.record)}>
                    <b className="staff-matrix-date">{dueDate || (result.record?.dateDone ? (course.scheduleType === "once_on_hire" ? "For life" : "Completed") : "—")}</b>
                    <small>{result.status.label}{result.status.daysRemaining == null ? "" : ` · ${result.status.daysRemaining < 0 ? `${Math.abs(result.status.daysRemaining)}d overdue` : `${result.status.daysRemaining}d left`}`}</small>
                  </td>;
                })}
              </tr>;
            })}
            <tr className="staff-matrix-caution"><th>Caution</th><td>—</td><td>—</td><td>—</td>{activeCourses.map((course) => <td key={course.id}>{course.scheduleType === "recurring" ? `${Number(course.warningDays) || 0} Days` : "—"}</td>)}</tr>
          </tbody>
        </table>
      </div> : <div className="staff-summary-list">
        <div className="staff-summary-row staff-summary-head"><span>Staff</span><span>Position</span><span>Status</span><span>Expired</span><span>Due Soon</span><span>No Data</span></div>
        {filtered.map(({ person, overall, counts }) => <div className="staff-summary-row" key={person.id}><span>{person.name}</span><span>{person.role}</span><span><StatusBadge status={overall} overall /></span><span>{counts.expired}</span><span>{counts.due}</span><span>{counts.missing}</span></div>)}
      </div>}
    </div>}
  </section>;
}

function CheckboxList({ values = [], options, onChange }) {
  const selected = new Set(values);
  return <div className="staff-check-list">{options.map((option) => {
    const value = typeof option === "string" ? option : option.key;
    const label = typeof option === "string" ? option : option.label;
    return <label key={value}><input type="checkbox" checked={selected.has(value)} onChange={(event) => {
      const next = new Set(selected);
      if (event.target.checked) next.add(value); else next.delete(value);
      onChange([...next]);
    }} /> {label}</label>;
  })}</div>;
}

function CourseCatalog({ courses, roles, form, setForm, editing, onSave, onEdit, onDelete, onCancel }) {
  const recurring = form.scheduleType === "recurring";
  return <>
    <form className="staff-card staff-form" onSubmit={onSave}>
      <h3>{editing ? "Edit document / course" : "Add document / course"}</h3>
      <label>Item type<select value={form.itemType || "course"} onChange={(event) => setForm({ ...form, itemType: event.target.value })}><option value="course">Course</option><option value="document">Document</option></select></label>
      <label>Item code<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="e.g. AVSEC" /></label>
      <label className="staff-wide">Item name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Training category<select value={form.trainingType} onChange={(event) => setForm({ ...form, trainingType: event.target.value })}>{TRAINING_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
      <label>Training schedule<select value={form.scheduleType} onChange={(event) => setForm({ ...form, scheduleType: event.target.value })}>{SCHEDULE_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
      <fieldset><legend>Crew group</legend><CheckboxList values={form.crewGroups} options={CREW_GROUPS} onChange={(crewGroups) => setForm({ ...form, crewGroups })} /></fieldset>
      <fieldset className="staff-wide"><legend>Required positions (none = all positions in selected group)</legend><CheckboxList values={form.roles} options={roles} onChange={(nextRoles) => setForm({ ...form, roles: nextRoles })} /></fieldset>
      {recurring && <>
        <label>Validity unit<select value={form.validityUnit} onChange={(event) => setForm({ ...form, validityUnit: event.target.value })}><option value="days">Days</option><option value="months">Months</option><option value="years">Years</option></select></label>
        <label>Validity amount<input type="number" min="1" value={form.validityAmount ?? ""} onChange={(event) => setForm({ ...form, validityAmount: event.target.value })} /></label>
        <label>Due-date calculation<select value={form.dueMode || "offset"} onChange={(event) => setForm({ ...form, dueMode: event.target.value })}><option value="offset">Exact date + day adjustment</option><option value="eomonth">End of month</option><option value="minusday">Minus one day</option></select></label>
        {(!form.dueMode || form.dueMode === "offset") && <label>Due-date adjustment (days)<input type="number" value={form.dueOffsetDays} onChange={(event) => setForm({ ...form, dueOffsetDays: event.target.value })} /></label>}
      </>}
      <label>Warning before due (days)<input type="number" min="0" value={form.warningDays} onChange={(event) => setForm({ ...form, warningDays: event.target.value })} /></label>
      <label className="staff-inline"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
      <div className="staff-actions"><button type="submit">Save Item</button>{editing && <button type="button" onClick={onCancel}>Cancel</button>}</div>
    </form>
    <div className="staff-table-wrap"><table><thead><tr><th>Code</th><th>Document / Course</th><th>Category</th><th>Positions</th><th>Schedule</th><th>Warning</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {courses.map((course) => <tr key={course.id}><td>{course.code || "—"}</td><td>{course.name}</td><td>{TRAINING_TYPES.find((type) => type.key === course.trainingType)?.label || course.trainingType}</td><td>{course.roles?.join(", ") || "All selected groups"}</td><td>{SCHEDULE_TYPES.find((type) => type.key === course.scheduleType)?.label || course.scheduleType}</td><td>{course.warningDays} days</td><td>{course.active ? "Active" : "Inactive"}</td><td><div className="staff-row-actions"><button type="button" onClick={() => onEdit(course)}>Edit</button><button type="button" className="staff-delete" onClick={() => onDelete(course)}>Delete</button></div></td></tr>)}
    </tbody></table></div>
  </>;
}

function Personnel({ people, roles, form, setForm, editing, onSave, onEdit, onDelete, onCancel }) {
  return <>
    <form className="staff-card staff-form" onSubmit={onSave}>
      <h3>{editing ? "Edit person" : "Add person"}</h3>
      <label>Employee ID<input value={form.employeeId} onChange={(event) => setForm({ ...form, employeeId: event.target.value })} /></label>
      <label className="staff-wide">Name–Surname<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Crew group<select value={form.crewGroup} onChange={(event) => setForm({ ...form, crewGroup: event.target.value })}>{CREW_GROUPS.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>
      <label>Position<input required list="staff-role-list" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} /><datalist id="staff-role-list">{roles.map((role) => <option value={role} key={role} />)}</datalist></label>
      <label className="staff-inline"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
      <div className="staff-actions"><button type="submit">{editing ? "Save Changes" : "Add Person"}</button>{editing && <button type="button" onClick={onCancel}>Cancel</button>}</div>
    </form>
    <div className="staff-table-wrap"><table><thead><tr><th>Employee ID</th><th>Name</th><th>Group</th><th>Position</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {people.map((person) => <tr key={person.id}><td>{person.employeeId || "—"}</td><td>{person.name}</td><td>{CREW_GROUPS.find((group) => group.key === person.crewGroup)?.label}</td><td>{person.role}</td><td>{person.active ? "Active" : "Inactive"}</td><td><div className="staff-row-actions"><button type="button" onClick={() => onEdit(person)}>Edit</button><button type="button" className="staff-delete" onClick={() => onDelete(person)}>Delete</button></div></td></tr>)}
    </tbody></table></div>
  </>;
}

function TrainingRecords({ people, courses, records, form, setForm, editing, onSave, onEdit, onDelete, onCancel }) {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const personMap = new Map(people.map((person) => [person.id, person]));
  const selectedCourse = courseMap.get(form.courseId);
  const dueDate = effectiveDueDate(form, selectedCourse);
  return <>
    <form className="staff-card staff-form" onSubmit={onSave}>
      <h3>{editing ? "Edit training record" : "Add training record"}</h3>
      <label>Person<select value={form.personId} onChange={(event) => setForm({ ...form, personId: event.target.value })}><option value="">Select…</option>{people.filter((person) => person.active || person.id === form.personId).map((person) => <option key={person.id} value={person.id}>{person.name} — {person.role}</option>)}</select></label>
      <label className="staff-wide">Document / Course<select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}><option value="">Select…</option>{courses.filter((course) => course.active || course.id === form.courseId).map((course) => <option key={course.id} value={course.id}>{course.code ? `${course.code} — ` : ""}{course.name}</option>)}</select></label>
      <label>Result<select value={form.result} onChange={(event) => setForm({ ...form, result: event.target.value })}>{["Completed", "Planned", "Certificate Waiting", "Failed", "Exempted"].map((result) => <option key={result}>{result}</option>)}</select></label>
      <label>Date Done (required when completed)<input type="date" value={form.dateDone} onChange={(event) => setForm({ ...form, dateDone: event.target.value })} /></label>
      <label>Due Date mode<select value={form.dueDateMode} onChange={(event) => setForm({ ...form, dueDateMode: event.target.value })}><option value="auto">Automatic from course rule</option><option value="manual">Manual Override</option></select></label>
      {form.dueDateMode === "manual" && <label>Manual Due Date<input type="date" value={form.manualDueDate} onChange={(event) => setForm({ ...form, manualDueDate: event.target.value })} /></label>}
      <label>Effective Due Date<input readOnly value={dueDate || "No expiry / waiting for Date Done"} /></label>
      <label>Certificate No.<input value={form.certificateNo} onChange={(event) => setForm({ ...form, certificateNo: event.target.value })} /></label>
      <label className="staff-wide">Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <div className="staff-actions"><button type="submit">Save Record</button>{editing && <button type="button" onClick={onCancel}>Cancel</button>}</div>
    </form>
    <div className="staff-table-wrap"><table><thead><tr><th>Person</th><th>Document / Course</th><th>Result</th><th>Date Done</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {[...records].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).map((record) => <tr key={record.id}><td>{personMap.get(record.personId)?.name || "Unknown"}</td><td>{courseMap.get(record.courseId)?.name || "Unknown"}</td><td>{record.result}</td><td>{record.dateDone || "—"}</td><td>{effectiveDueDate(record, courseMap.get(record.courseId)) || "No expiry"}</td><td>{record.archived ? "Archived" : record.dueDateMode === "manual" ? "Manual Override" : "Automatic"}</td><td><div className="staff-row-actions"><button type="button" onClick={() => onEdit(record)}>Edit</button><button type="button" className="staff-delete" onClick={() => onDelete(record)}>Delete</button></div></td></tr>)}
    </tbody></table></div>
  </>;
}

function StaffPlanning({ people, courses, records, today }) {
  const [group, setGroup] = useState("all");
  const [status, setStatus] = useState("needs_action");
  const [search, setSearch] = useState("");
  const rows = useMemo(() => filterStaffPlanningRows(buildStaffPlanningRows(people, courses, records, today), { group, status, search }), [people, courses, records, today, group, status, search]);
  const groups = useMemo(() => [...new Set(rows.map((row) => row.group))].sort(), [rows]);
  return <section className="staff-training">
    <header className="staff-training-head"><h2>Staff Training Planning</h2><p>Non-pilot staff only — plan missing and due training for flight and ground crews.</p></header>
    <div className="staff-all-controls no-print">
      <select aria-label="Crew group" value={group} onChange={(event) => setGroup(event.target.value)}>
        <option value="all">All groups</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="needs_action">Needs action</option><option value="all">All statuses</option>
      </select>
      <input aria-label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by name or position..." />
    </div>
    <div className="staff-all-print-area">
      <h3>Personnel in scope — {rows.length}</h3>
      <div className="staff-table-wrap"><table><thead><tr><th>Course</th><th>People</th><th>Groups</th></tr></thead><tbody>
        {[...new Map(rows.map((row) => [row.courseCode, row])).values()].map((row) => <tr key={row.courseCode}><td><b>{row.courseName}</b></td><td>{rows.filter((r) => r.courseCode === row.courseCode).length}</td><td>{(new Set(rows.filter((r) => r.courseCode === row.courseCode).map((r) => r.group))).size}</td></tr>)}
      </tbody></table></div>
      <div className="staff-table-wrap"><table><thead><tr><th>Name</th><th>Position</th><th>Course</th><th>Due date</th><th>Status</th><th>Days left</th></tr></thead><tbody>
        {rows.length ? rows.map((row) => <tr key={row.id}><th>{row.name}</th><td>{row.role}</td><td>{row.courseName}</td><td>{row.dueDate || "—"}</td><td><span className={`staff-status staff-status-${row.status}`}>{row.detail}</span></td><td>{row.daysRemaining == null ? "—" : row.daysRemaining < 0 ? `${Math.abs(row.daysRemaining)}d overdue` : `${row.daysRemaining}d`}</td></tr>) : <tr><td colSpan={6} className="staff-empty">No staff training records match these filters.</td></tr>}
      </tbody></table></div>
    </div>
  </section>;
}

function StaffImport({ repository, onImported }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  async function handleImport() {
    if (!files.length || uploading) return;
    setUploading(true); setMessage(null);
    try {
      const parsed = await Promise.all(Array.from(files).map((file) => parseStaffTrainingExcelFile(file)));
      const recognised = [...new Set(parsed.flatMap((p) => p.recognised))];
      let addedPeople = 0, addedRecords = 0;
      for (const imported of parsed) {
        const result = await repository.importData(imported);
        addedPeople += result.addedPeople; addedRecords += result.addedRecords;
      }
      setMessage({ ok: true, text: `Imported ${addedPeople} personnel and ${addedRecords} staff training records (${recognised.join(", ")}).` });
      setFiles([]); await onImported();
    } catch (error) {
      setMessage({ ok: false, text: "Import failed: " + error.message });
    } finally { setUploading(false); }
  }
  return <section className="staff-training">
    <header className="staff-training-head"><h2>Import Staff Training Excel</h2><p>Supports the UOA INPUT DATA sheets for FOO/Check-In, Helpers and GOO workbooks. GOO due dates are preserved from Excel.</p></header>
    <div className="staff-card staff-import">
      <div><h3>Import Staff Training Excel</h3><p>Supports the UOA <b>INPUT DATA</b> sheets for FOO/Check-In, <b>Helpers</b> and <b>GOO</b> workbooks. GOO due dates are preserved from Excel. Each import replaces existing training records for the personnel and courses in the file, including blank dates.</p></div>
      <input type="file" multiple accept=".xlsx,.xlsm,.xls" onChange={(event) => setFiles([...event.target.files])} disabled={uploading} />
      <button type="button" disabled={!files.length || uploading} onClick={handleImport}>{uploading ? "Importing…" : `Import ${files.length} Excel File${files.length === 1 ? "" : "s"}`}</button>
      {message && <div role="status" className={`settings-msg ${message.ok ? "success" : "error"}`}>{message.text}</div>}
    </div>
  </section>;
}

export function AllStaffTraining({ activeTab, onTabChange, repository = staffTrainingRepository, initialData = null, today = new Date() }) {
  const [internalTab, setInternalTab] = useState("matrix");
  const tab = activeTab || internalTab;
  const [data, setData] = useState(() => initialData ? { courses: normalizeCourses(initialData.courses), people: normalizePersonnel(initialData.people), records: normalizeRecords(initialData.records) } : null);
  const [message, setMessage] = useState(null);
  const [courseForm, setCourseForm] = useState(() => copyForm(EMPTY_COURSE));
  const [personForm, setPersonForm] = useState(() => copyForm(EMPTY_PERSON));
  const [recordForm, setRecordForm] = useState(() => copyForm(EMPTY_RECORD));

  async function refresh() {
    setData(await repository.load());
  }

  useEffect(() => {
    if (initialData) return undefined;
    let current = true;
    repository.load().then((loaded) => { if (current) setData(loaded); }).catch((error) => { if (current) setMessage({ ok: false, text: error.message }); });
    return () => { current = false; };
  }, [initialData, repository]);

  function changeTab(next) {
    setInternalTab(next);
    onTabChange?.(next);
  }

  async function mutate(action, successText) {
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage({ ok: true, text: successText });
      return true;
    } catch (error) {
      setMessage({ ok: false, text: error.message });
      return false;
    }
  }

  if (!data) return <div className="staff-training"><p>{message?.text || "Loading staff training…"}</p></div>;

  const roles = [...new Set([...DEFAULT_ROLES, ...data.people.map((person) => person.role), ...data.courses.flatMap((course) => course.roles || [])].filter(Boolean))].sort();
  const shownTab = tab === "summary" ? "matrix" : tab;
  const headings = { matrix: "Staff training status", courses: "Staff documents & courses", people: "Employee / Staff", records: "Staff records & documents", planning: "Staff Training Planning" };
  const confirmAction = (text) => typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(text);

  return <div className="staff-training">
    <header className="staff-training-head"><h2>{headings[shownTab]}</h2><p>Flight and Ground personnel · Documents · Training history</p></header>
    {!activeTab && <nav className="training-tabs">{TABS.map(([key, label]) => <button type="button" key={key} className={`training-tab${shownTab === key ? " active" : ""}`} onClick={() => changeTab(key)}>{label}</button>)}</nav>}
    {message && <div role="status" className={`settings-msg ${message.ok ? "success" : "error"}`}>{message.text}</div>}
    {shownTab === "matrix" && <StaffStatus people={data.people} courses={data.courses} records={data.records} today={today} initialView={tab === "summary" ? "summary" : "matrix"} onOpenRecord={(person, course, record) => {
      setRecordForm(copyForm(record || { ...EMPTY_RECORD, personId: person.id, courseId: course.id }));
      changeTab("records");
    }} />}
    {shownTab === "courses" && <CourseCatalog courses={data.courses} roles={roles} form={courseForm} setForm={setCourseForm} editing={Boolean(courseForm.id)} onSave={async (event) => {
      event.preventDefault();
      if (await mutate(() => repository.saveCourse(courseForm), "Saved.")) setCourseForm(copyForm(EMPTY_COURSE));
    }} onEdit={(course) => setCourseForm(copyForm(course))} onDelete={(course) => confirmAction(`Delete ${course.name}?`) && mutate(() => repository.deleteCourse(course.id), "Deleted.")} onCancel={() => setCourseForm(copyForm(EMPTY_COURSE))} />}
    {shownTab === "people" && <Personnel people={data.people} roles={roles} form={personForm} setForm={setPersonForm} editing={Boolean(personForm.id)} onSave={async (event) => {
      event.preventDefault();
      if (await mutate(() => repository.savePerson(personForm), "Saved.")) setPersonForm(copyForm(EMPTY_PERSON));
    }} onEdit={(person) => setPersonForm(copyForm(person))} onDelete={(person) => confirmAction(`Delete ${person.name}? Their Staff Training records will also be deleted.`) && mutate(() => repository.deletePerson(person.id), "Deleted.")} onCancel={() => setPersonForm(copyForm(EMPTY_PERSON))} />}
    {shownTab === "records" && <TrainingRecords people={data.people} courses={data.courses} records={data.records} form={recordForm} setForm={setRecordForm} editing={Boolean(recordForm.id)} onSave={async (event) => {
      event.preventDefault();
      if (await mutate(() => repository.saveRecord(recordForm), "Saved.")) setRecordForm(copyForm(EMPTY_RECORD));
    }} onEdit={(record) => setRecordForm(copyForm(record))} onDelete={(record) => confirmAction("Delete this training record?") && mutate(() => repository.deleteRecord(record.id), "Deleted.")} onCancel={() => setRecordForm(copyForm(EMPTY_RECORD))} />}
    {shownTab === "planning" && <StaffPlanning people={data.people} courses={data.courses} records={data.records} today={today} />}
    {shownTab === "import" && <StaffImport repository={repository} onImported={refresh} />}
  </div>;
}

export default AllStaffTraining;
