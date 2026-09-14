import { useEffect, useMemo, useState } from "react";
import { listWeeklyPlan, saveWeeklyPlanMany, listRoster, importRosterMany, listExperience, loadExperience, listDutyEntriesByPilot, listTraining, getSetting, saveSetting, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { loadAllPilotStatusRows, hhmmToDecimal } from "../../utils/statusCompute.js";
import { buildDutyPeriods, periodDutyCreditHours } from "../../utils/dutyPeriods.js";
import { DEFAULT_PLAN_DUTY_LIMITS } from "./weeklyPlanRules.js";
import { combineExperience, combineAircraftRows, combineSpecialty } from "../../utils/experienceCombine.js";
import { normalizeAircraftRow } from "../../utils/timeMath.js";
import { computeExperienceLevel } from "../../utils/experienceLevel.js";
import { pilotAvailability, underFlownPilots, checkCycleOffDays } from "./weeklyPlanAvailability.js";
import { headroomAsOf, projectRecoveryRestCycle, rollingSum, isoAddDays } from "./weeklyPlanHeadroom.js";
import { MIN_FLIGHT_HOURS_PER_CYCLE, WORK_CYCLE_DAYS, WORK_DAYS_PER_CYCLE, OFF_DAYS_PER_CYCLE, LINE_ROTATION_PATTERN, MAX_NIGHT_DAYS_PER_CYCLE } from "./weeklyPlanRules.js";
import { trainingToBook, describeTrainingToBook, suggestTrainingSlot, describeSuggestion, trainingCodeFor } from "./weeklyPlanTrainingQueue.js";
import { TRAINING_ITEMS, classifyTrainingValue, withTrainingThresholdDefaults, withTrainingDisabledDefaults, withTrainingDurationDefaults, monitoredTrainingItems, describeTrainingDuration } from "../../utils/trainingDue.js";
import { WEEKLY_SECTIONS, parsePlanCell, formatPlanCell, MIN_REST_HOURS, dutyWindow, displayTime, plannedDutyHours } from "./weeklyPlanSections.js";
import { checkWeeklyPlan } from "./weeklyPlanChecks.js";
import { autoFillWeek } from "./weeklyPlanAutoFill.js";
import { deriveFdtOffWrites, deriveTrainingBookWrites, describeWritebackEntry } from "./weeklyPlanWriteback.js";
import WeeklyPlanImportPanel from "./WeeklyPlanImportPanel.jsx";
import TrainingPairsPanel from "./TrainingPairsPanel.jsx";
import WeeklyPlanChat from "./WeeklyPlanChat.jsx";
import { TRAINING_PAIRS_SETTING_KEY, isInstructorFromSpecialty } from "./weeklyPlanTrainingPairs.js";
import { isDemoSession } from "../../services/desktopDatabase.js";
import { todayIso } from "../../utils/dateKeys.js";
import "./PilotRoster.css";

// The weekly PLANNING board, modelled on the company's own spreadsheet
// ("SKL WeeklySchedulePlan 2026 (V3).xlsm", sheet "SKL Weekly Plan"): one
// column per day, a fixed set of labelled row groups down the side (Crew
// 1-6, Night Standby, Night Training, Training,
// OFF Crew - see weeklyPlanSections.js), and each cell holding a pilot code
// with their experience level, e.g. "WJU(3)".
//
// Unlike the spreadsheet, it cross-checks every assignment as you type: a
// pilot booked twice on one day, planned over a rest/leave day on the
// published Duty Schedule, or already at a rolling FTL limit is flagged in
// the grid and listed underneath (see weeklyPlanChecks.js). That's the
// whole reason for bringing this into the app rather than leaving it in
// Excel, where none of those three things are visible while planning.
//
// Editing is STAGED: cells are held locally until Save, so a week can be
// rearranged in one pass and committed together - same pattern as Duty
// Schedule's batch edit.

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n) { return String(n).padStart(2, "0"); }

function toIso(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

// The source sheet runs its weeks Tuesday -> Monday (see its weekday header
// row), which is how the company's 21/7 rotation lines up. Snapping to that
// keeps this page and the spreadsheet showing the same week.
const WEEK_START_DOW = 2; // Tuesday

function weekStartFor(iso) {
  const d = parseIso(iso);
  const shift = (d.getDay() - WEEK_START_DOW + 7) % 7;
  d.setDate(d.getDate() - shift);
  return toIso(d);
}

function cellKey(date, section, slot) { return `${date}|${section}|${slot}`; }

// Where the automatic-writeback history lives - a settings key rather than
// its own table, matching how everything else this small in the app is
// stored. Capped on write so it stays a "what happened recently" list, not
// an ever-growing table nobody can read.
const ROSTER_WRITEBACK_LOG_KEY = "roster_auto_writeback_log";
const ROSTER_WRITEBACK_LOG_MAX = 200;
// A standing preference, not a per-run choice: whether Plan 30 Days /
// Re-plan should work out roster suggestions at all. Capt. Weera asked for
// this as its own permanent tick, separate from the per-suggestion ticks in
// the review list ("ไม่เห็นมีช่องให้ติ๊กว่าจะ crosscheck ให้ หรือทำเองโดย
// แอดมิน... อยากได้ปุ่ม/ช่องติ๊กแบบถาวร"). ON by default; switching it off
// goes back to exactly the old behaviour (blank seats only, no suggestions).
const WRITEBACK_ENABLED_SETTING_KEY = "roster_writeback_enabled";

// combineAircraftRows returns rows carrying totalDecimal; the OPS-CM-01
// experience factors need one decimal-hours number per group.
function sumRowsDecimal(rows) {
  return (rows || []).reduce((s, r) => s + (r.totalDecimal || 0), 0);
}

export default function WeeklySchedule() {
  const [weekStart, setWeekStart] = useState(() => weekStartFor(toIso(new Date())));
  const [rows, setRows] = useState([]);
  const [rosterRows, setRosterRows] = useState([]);
  const [priorRosterRows, setPriorRosterRows] = useState([]);
  // Night duties already planned in the previous cycle, so the six-per-cycle
  // cap counts across runs instead of resetting each time.
  const [priorNightDates, setPriorNightDates] = useState({});
  // Crews already flown in the last cycle, so pairing variety continues
  // across runs instead of restarting each time.
  const [priorPairings, setPriorPairings] = useState([]);
  const [statusByCode, setStatusByCode] = useState(new Map());
  const [positionsByCode, setPositionsByCode] = useState({});
  const [nightCurrentByCode, setNightCurrentByCode] = useState(new Set());
  const [trainingOverdueByCode, setTrainingOverdueByCode] = useState(new Map());
  // Raw training records + the company's own caution windows, kept so the
  // "book a slot" list can be recomputed against the roster without
  // re-reading the Training module.
  const [trainingSource, setTrainingSource] = useState(null);
  // The roster far beyond this week. The training queue asks questions that
  // reach months ahead ("is an LPC slot booked before 30 September?"), and
  // the week's own roster rows can't answer them.
  const [horizonRosterRows, setHorizonRosterRows] = useState([]);
  const [bookingMsg, setBookingMsg] = useState(null);
  // Pilots whose Night Currency has lapsed - they still fly day crews;
  // this is the list of who needs night re-training.
  const [nightExpiredList, setNightExpiredList] = useState([]);
  const [autoFillReport, setAutoFillReport] = useState(null);
  // What Plan 30 Days / Re-plan just wrote to the roster on its own -
  // rostered OFF for a pilot near an FDT limit, or a training slot for one
  // coming due. These are PROPOSALS ONLY - "เราแค่ แนะนำ", Capt. Weera's own
  // words: the chief pilot ticks the ones he agrees with and books them
  // himself ("เงื่อนไข crosscheck มี tick ให้ crosscheck กับ admin ทำเอง
  // วางแผนเอง"). Nothing here is written to the roster until he presses
  // "Book ticked". writebackChecked is keyed by suggestion id, ticked by
  // default (they're already screened against the same thresholds FDT
  // Monitor / Training Due show) so the normal flow is review-and-deselect
  // rather than hunt-and-tick. writebackLog is only appended to ONCE
  // something is actually booked, and kept in ROSTER_WRITEBACK_LOG_KEY so
  // it's still visible later, not just in the moment.
  const [writebackSuggestions, setWritebackSuggestions] = useState([]);
  const [writebackChecked, setWritebackChecked] = useState(new Set());
  const [writebackMsg, setWritebackMsg] = useState(null);
  const [writebackBooking, setWritebackBooking] = useState(false);
  const [writebackLog, setWritebackLog] = useState([]);
  // The standing on/off tick - true means "work out suggestions when I plan",
  // false means "leave the roster alone, I'll crosscheck and book it myself"
  // with nothing computed at all. Persisted, so it holds across sessions.
  const [writebackEnabled, setWritebackEnabled] = useState(true);
  // Duty already recorded in Daily Duty, and the company's FTL limits - both
  // needed so the plan's rolling 7/14/28-day totals continue from reality
  // rather than starting at zero each week.
  const [priorDutyHours, setPriorDutyHours] = useState({});
  // Flight hours already recorded, per date - checked as of each planned
  // date rather than only today (see weeklyPlanHeadroom.js).
  const [priorFlightHours, setPriorFlightHours] = useState({});
  const [headroomReport, setHeadroomReport] = useState(null);
  const [ftlLimits, setFtlLimits] = useState(DEFAULT_PLAN_DUTY_LIMITS);
  // Pilot code -> Experience Level 1-4 (OPS-CM-01 7.17.4), for the pairing rule.
  const [levelByCode, setLevelByCode] = useState(new Map());
  // Pilot code -> availability from FDT Monitor (DT/FT limits + 168h cycle).
  const [availabilityByCode, setAvailabilityByCode] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [pendingEdits, setPendingEdits] = useState(new Map());
  const [editingCell, setEditingCell] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showPairs, setShowPairs] = useState(false);
  const [showChat, setShowChat] = useState(false);
  // Temporary "must fly with" instructions, and who counts as an instructor
  // (anyone holding TRI or TRE hours on their Experience record).
  const [trainingPairs, setTrainingPairs] = useState([]);
  const [instructors, setInstructors] = useState(new Set());
  const [fullScreen, setFullScreen] = useState(false);
  const [branding, setBranding] = useState(null);

  const readOnly = isDemoSession();
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const days = useMemo(() => {
    const today = todayIso();
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(weekStart, i);
      const d = parseIso(iso);
      const dow = d.getDay();
      return {
        iso,
        dayNum: d.getDate(),
        weekday: WEEKDAY_ABBR[dow],
        isWeekend: dow === 0 || dow === 6,
        isToday: iso === today
      };
    });
  }, [weekStart]);

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [weekStart]);
  useEffect(() => {
    getSetting("customer_branding").then((b) => setBranding(b || null)).catch(() => {});
    getSetting(TRAINING_PAIRS_SETTING_KEY)
      .then((p) => setTrainingPairs(Array.isArray(p) ? p : []))
      .catch(() => setTrainingPairs([]));
    getSetting(ROSTER_WRITEBACK_LOG_KEY)
      .then((log) => setWritebackLog(Array.isArray(log) ? log : []))
      .catch(() => setWritebackLog([]));
    getSetting(WRITEBACK_ENABLED_SETTING_KEY)
      .then((v) => setWritebackEnabled(v === false ? false : true)) // unset = on, by default
      .catch(() => setWritebackEnabled(true));
  }, []);

  // The standing tick, saved as soon as it's changed - not tied to Save/the
  // next plan run. Switching it off also clears whatever is currently being
  // reviewed, so an old suggestion can't be booked after the admin has said
  // "I'll do this myself."
  async function handleWritebackEnabledChange(next) {
    setWritebackEnabled(next);
    if (!next) {
      setWritebackSuggestions([]);
      setWritebackChecked(new Set());
      setWritebackMsg(null);
    }
    try {
      await saveSetting(WRITEBACK_ENABLED_SETTING_KEY, next);
    } catch {
      // Not sticking is a minor inconvenience (re-toggle next visit), not
      // worth interrupting the admin over.
    }
  }

  // Appends to the persisted writeback history and keeps local state in
  // step with it, so the panel updates immediately without a re-fetch.
  async function logAutoWriteback(entries) {
    if (!entries?.length) return;
    const stamped = entries.map((e) => ({ ...e, at: new Date().toISOString() }));
    setWritebackLog((prev) => {
      const next = [...stamped, ...prev].slice(0, ROSTER_WRITEBACK_LOG_MAX);
      saveSetting(ROSTER_WRITEBACK_LOG_KEY, next).catch(() => {});
      return next;
    });
  }

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) { if (e.key === "Escape") setFullScreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refresh() {
    setLoading(true);
    try {
      // The roster and FTL status are only needed for the warnings, so a
      // failure there must not stop the plan itself from loading - a
      // planner with no warnings is still better off than a blank page.
      // The day BEFORE the week is loaded too: the 12-hour rest rule has to
      // look back across the week boundary, or a pilot who was on night on
      // the Monday would appear free for Tuesday's early crew.
      const [plan, roster, priorRoster, cyclePlan] = await Promise.all([
        listWeeklyPlan({ from: weekStart, to: weekEnd }),
        listRoster({ from: weekStart, to: weekEnd }).catch(() => []),
        listWeeklyPlan({ from: addDays(weekStart, -1), to: addDays(weekStart, -1) }).catch(() => []),
        // A full cycle back, only for counting night duties.
        listWeeklyPlan({ from: addDays(weekStart, -WORK_CYCLE_DAYS), to: addDays(weekStart, -1) }).catch(() => [])
      ]);
      setRows(plan || []);
      setRosterRows(roster || []);
      loadHorizonRoster();
      setPriorRosterRows(priorRoster || []);
      const nightDates = {};
      // Crews from the previous cycle, for the CRM pairing-variety
      // preference - who has already flown with whom, and when.
      const crewsByKey = new Map();
      for (const r of cyclePlan || []) {
        if (!r.pilot_code) continue;
        const code = String(r.pilot_code).toUpperCase();
        const kind = WEEKLY_SECTIONS.find((sec) => sec.key === r.section)?.kind;
        if (kind === "night") (nightDates[code] ??= []).push(r.date);
        if (kind === "off") continue;
        const key = `${r.date}|${r.section}`;
        if (!crewsByKey.has(key)) crewsByKey.set(key, { date: r.date, codes: [] });
        crewsByKey.get(key).codes.push(code);
      }
      setPriorNightDates(nightDates);
      setPriorPairings([...crewsByKey.values()].filter((c) => c.codes.length > 1));
      setPendingEdits(new Map());
      setAutoFillReport(null);
      loadPilotReference();
      loadAllPilotStatusRows()
        .then(({ rows: statusRows, limits }) => {
          const map = new Map();
          // Duty already RECORDED (Daily Duty), per pilot per date. The plan
          // adds on top of this, so the rolling 7/14/28-day figures the
          // planner enforces are the same ones FDT Monitor shows - a pilot
          // who has already flown a heavy week can't then be planned into a
          // breach.
          const prior = {};
          const priorFlight = {};
          const availability = new Map();
          for (const r of statusRows || []) {
            const code = r.pilot?.code ? String(r.pilot.code).toUpperCase() : null;
            if (!code) continue;
            map.set(code, {
              status: r.status,
              stats: r.stats,
              // End of the last qualifying Recovery Rest - the point the
              // 168h cycle is measured from when projecting forward.
              recoveryRestEnd: r.recoveryRest?.lastQualifyingRestEnd || null
            });
            availability.set(code, pilotAvailability(r, limits));
            const flightByDate = {};
            for (const e of r.entries || []) {
              if (e.dutyType !== "flight" || !e.date) continue;
              const hours = hhmmToDecimal(e.flightTime ?? e.blockTime ?? e.totalTime);
              if (hours) flightByDate[e.date] = (flightByDate[e.date] || 0) + hours;
            }
            if (Object.keys(flightByDate).length) priorFlight[code] = flightByDate;

            const byDate = {};
            for (const p of buildDutyPeriods(r.entries || [], limits)) {
              const start = p.start instanceof Date ? p.start : new Date(p.start);
              if (isNaN(start.getTime())) continue;
              const iso = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
              byDate[iso] = (byDate[iso] || 0) + periodDutyCreditHours(p, limits);
            }
            if (Object.keys(byDate).length) prior[code] = byDate;
          }
          setStatusByCode(map);
          setAvailabilityByCode(availability);
          setPriorDutyHours(prior);
          setPriorFlightHours(priorFlight);
          if (limits) setFtlLimits(limits);
        })
        .catch(() => setStatusByCode(new Map()));
    } catch (err) {
      setMsg({ ok: false, text: "Could not load the weekly plan: " + err.message });
    } finally {
      setLoading(false);
    }
  }

  // Rank (for crew composition), night currency and overdue training - the
  // three things the plan has to respect that don't live in the plan itself.
  // Loaded separately from the plan so a failure here degrades to "no
  // warnings" rather than an empty page.

  // A long look forward, for the "training to book" panel only. The week's
  // own roster rows can't answer "is an LPC slot booked before 30 September?"
  const TRAINING_HORIZON_DAYS = 365;

  async function loadHorizonRoster() {
    const today = toIso(new Date());
    const rows = await listRoster({ from: today, to: addDays(today, TRAINING_HORIZON_DAYS) }).catch(() => []);
    setHorizonRosterRows(rows || []);
  }

  async function loadPilotReference() {
    try {
      const [experience, training, savedThresholds, savedDisabled, savedDurations] = await Promise.all([
        listExperience().catch(() => []),
        listTraining().catch(() => []),
        getSetting("training_thresholds").catch(() => null),
        getSetting("training_disabled_items").catch(() => null),
        getSetting("training_durations").catch(() => null)
      ]);

      const positions = {};
      for (const p of experience || []) {
        const code = String(p.code || "").toUpperCase();
        const position = p.position || p.profile?.position;
        if (code && position) positions[code] = position;
      }
      setPositionsByCode(positions);
      loadExperienceLevels(experience || [], positions);

      const thresholds = withTrainingThresholdDefaults(savedThresholds);
      const disabled = withTrainingDisabledDefaults(savedDisabled);
      const monitored = new Set(monitoredTrainingItems(disabled).map((i) => i.key));
      const nightItem = TRAINING_ITEMS.find((i) => i.key === "night");
      const today = new Date();

      const nightCurrent = new Set();
      const nightExpired = [];
      const overdue = new Map();
      for (const t of training || []) {
        const code = String(t.code || "").toUpperCase();
        if (!code) continue;
        const record = t.record || {};

        // Night currency comes straight from the Training tab's "Night
        // Currency" item (TRAINING_ITEMS key "night" - the same value the
        // Training page shows for this pilot). Current = a recorded due date
        // still in the future. classifyTrainingValue caps night at "warn"
        // even when expired (it only restricts night flying, see
        // trainingDue.js), so the real daysRemaining is what's checked here.
        // No date recorded = NOT current: an unknown is treated as expired
        // rather than assumed valid, because the consequence of getting this
        // wrong is a non-current crew on a night sector.
        const night = classifyTrainingValue(nightItem, record.night, thresholds.night, today);
        if (night.daysRemaining != null && night.daysRemaining >= 0) nightCurrent.add(code);
        else if (night.lifetime) nightCurrent.add(code);
        else if (positions[code]) {
          // Not current: still flies day crews normally, just can't be put on
          // the night line until re-trained. Collected so the planner can see
          // who to send for night re-training, rather than only noticing that
          // the night row is short-handed.
          nightExpired.push({
            code,
            expiredDays: night.daysRemaining == null ? null : Math.abs(night.daysRemaining)
          });
        }

        // Overdue = any MONITORED item genuinely past its due date, except
        // night currency (rule 1 handles that, and it doesn't ground a pilot
        // for day flying).
        const expired = [];
        for (const item of TRAINING_ITEMS) {
          if (item.key === "night" || !monitored.has(item.key)) continue;
          const result = classifyTrainingValue(item, record[item.key], thresholds[item.key], today);
          if (result.daysRemaining != null && result.daysRemaining < 0) expired.push(item.label);
        }
        if (expired.length) overdue.set(code, expired.join(", "));
      }
      setNightCurrentByCode(nightCurrent);
      nightExpired.sort((a, b) => (b.expiredDays ?? -1) - (a.expiredDays ?? -1));
      setNightExpiredList(nightExpired);
      setTrainingOverdueByCode(overdue);
      setTrainingSource({ records: training || [], thresholds, monitored, durations: withTrainingDurationDefaults(savedDurations) });
    } catch {
      setPositionsByCode({});
      setNightCurrentByCode(new Set());
      setNightExpiredList([]);
      setTrainingOverdueByCode(new Map());
    }
  }

  // Experience Level 1-4 per pilot, computed from their Pilot Experience
  // record against OPS-CM-01 7.17.4 Table 1 (five factors, each scored 1-4,
  // summed). Needs the full record per pilot - the list endpoint only
  // returns the summary - so it's loaded separately and never blocks the
  // page. A pilot whose record is too incomplete to score simply has no
  // level, and the pairing rule then reports "can't tell" rather than
  // silently passing them.
  async function loadExperienceLevels(experienceList, positions) {
    const instructorCodes = new Set();
    try {
      const entries = await Promise.all((experienceList || []).map(async (p) => {
        const code = String(p.code || "").toUpperCase();
        if (!code) return null;
        const [record, dutyEntries] = await Promise.all([
          loadExperience(p.licence || code).catch(() => null),
          listDutyEntriesByPilot(code).catch(() => [])
        ]);
        if (!record) return null;

        const combined = combineExperience(record, dutyEntries);
        const heliRows = ["rotarySingle", "rotaryMulti"].flatMap((k) => (record.experienceBase?.[k] || []).map(normalizeAircraftRow));
        const multiRows = ["rotaryMulti", "fixedMulti"].flatMap((k) => (record.experienceBase?.[k] || []).map(normalizeAircraftRow));
        const typeRows = heliRows.filter((r) => /AW139|139/i.test(String(r[0] || "")));
        const specialty = combineSpecialty(record, dutyEntries, combined.updateDate) || [];
        const offshoreRow = specialty.find((s) => /offshore/i.test(String(s.label || "")));

        const hours = {
          totalTime: combined.current?.grand,
          pic: combined.current?.pic,
          type: sumRowsDecimal(combineAircraftRows(typeRows, dutyEntries, combined.updateDate)),
          offshore: offshoreRow ? offshoreRow.current : null,
          multi: sumRowsDecimal(combineAircraftRows(multiRows, dutyEntries, combined.updateDate))
        };
        if (isInstructorFromSpecialty(specialty)) instructorCodes.add(code);
        const result = computeExperienceLevel(positions?.[code], hours);
        return result.level == null ? null : [code, result.level];
      }));
      setLevelByCode(new Map(entries.filter(Boolean)));
      setInstructors(instructorCodes);
    } catch {
      setLevelByCode(new Map());
      setInstructors(new Set());
    }
  }

  // Pre-flight check for the planning window: for every pilot, look BACK the
  // full rolling window from the LAST day being planned and ask whether they
  // still have room to be given flying. Run before planning, so a shortage is
  // visible up front rather than discovered as a pile of "couldn't place"
  // lines afterwards. Yellow = approaching, red = already out of room -
  // the same wording and thresholds as FDT Monitor / Training Monitor.
  function buildHeadroomReport(throughIso) {
    const report = [];
    const codes = new Set([
      ...Object.keys(priorDutyHours),
      ...Object.keys(positionsByCode)
    ]);
    for (const code of codes) {
      const issues = [];

      const headroom = headroomAsOf({
        dutyByDate: priorDutyHours[code],
        flightByDate: priorFlightHours[code],
        limits: ftlLimits,
        iso: throughIso
      });
      for (const m of headroom.metrics) {
        if (m.status === "ok") continue;
        issues.push({ level: m.status, text: `${m.label} ${m.used}h of ${m.max}h (${m.remaining}h left)` });
      }

      const cycle = projectRecoveryRestCycle({
        lastQualifyingRestEnd: statusByCode.get(code)?.recoveryRestEnd,
        plannedDutyDates: plannedDutyDatesByCode.get(code),
        through: throughIso,
        cycleMaxHours: ftlLimits?.recoveryRestCycleMaxHours ?? 168,
        restMinHours: ftlLimits?.recoveryRestMinHours ?? 36
      });
      if (cycle.status !== "ok") issues.push({ level: cycle.status, text: cycle.reason });

      const overdue = trainingOverdueByCode.get(code);
      if (overdue) issues.push({ level: "exc", text: `training overdue: ${overdue}` });
      const nightGone = nightExpiredList.find((n) => n.code === code);
      if (nightGone) issues.push({ level: "warn", text: "night currency expired — day flying only" });

      if (issues.length) {
        report.push({
          code,
          severity: issues.some((i) => i.level === "exc") ? "exc" : "warn",
          issues
        });
      }
    }
    report.sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === "exc" ? -1 : 1));
    return report;
  }

  // Fills from the published duty roster, applying every rule (see
  // weeklyPlanAutoFill.js). The result is STAGED, not saved - the planner
  // reviews it, adjusts, then presses Save.
  //
  // `planDays` > 7 plans a longer horizon in one pass. That is NOT the same
  // as running it once a week: the 12-hour rest rule, the load balancing and
  // the rolling 7/14/28-day windows all carry forward across the whole run,
  // so planning 30 days together produces a joined-up sequence, whereas four
  // separate runs would each start from a blank slate at the boundary.
  //
  // The working pattern is -30 / +30: the rolling windows look back over the
  // last 30 days of RECORDED duty (and 365 for annual flight time), and the
  // plan is written 30 days forward. Re-running it any day simply rolls the
  // window on - yesterday's history is now inside the lookback, and a fresh
  // 30 days is planned from today.
  //
  // Only the CURRENT week's cells are staged into the grid for review; the
  // later days are written straight to the database, since the grid shows
  // one week at a time.
  //
  // By default the run KEEPS assignments that are already planned in the
  // period and continues on from them - so "Re-plan This Week Only" followed
  // by "Plan 30 Days" does what it sounds like: the fixed week stays fixed,
  // and the next three weeks are built on top of it. The kept days seed the
  // rest, duty-hour, night-count and rotation state, so the continuation is
  // legal against them rather than computed as if the period were empty.
  //
  // { replace: true } throws the period away and re-decides it from scratch.
  async function handleAutoFill(planDays = 7, { replace = false } = {}) {
    setSaving(true);
    setMsg(null);
    try {
      const allDates = Array.from({ length: planDays }, (_, i) => addDays(weekStart, i));
      const rangeTo = allDates[allDates.length - 1];

      // Pull the roster for the whole span being planned, not just the week
      // on screen.
      const fullRoster = planDays > 7
        ? await listRoster({ from: weekStart, to: rangeTo }).catch(() => rosterRows)
        : rosterRows;
      const fullRosterMap = new Map();
      for (const r of fullRoster) {
        if (r.pilot_code && r.date) fullRosterMap.set(`${String(r.pilot_code).toUpperCase()}|${r.date}`, r.code);
      }

      const previousEnds = new Map();
      for (const r of priorRosterRows) {
        if (!r.pilot_code) continue;
        const window = dutyWindow(r.section, r.date);
        if (window) previousEnds.set(String(r.pilot_code).toUpperCase(), window.end);
      }

      // Everything already planned in the period. Kept and continued from,
      // unless this is an explicit re-plan.
      const existingCells = replace ? [] : (await listWeeklyPlan({ from: weekStart, to: rangeTo }).catch(() => []))
        .filter((r) => r.pilot_code)
        .map((r) => ({ date: r.date, section: r.section, slot: r.slot, pilotCode: String(r.pilot_code).toUpperCase() }));

      const result = autoFillWeek({
        dates: allDates,
        // Notice for a last-day night is counted from TODAY - the day the
        // plan is actually being made - not from the start of the period
        // being planned, which may be weeks in the past on a re-plan.
        noticeFromIso: todayIso(),
        existingCells,
        rosterByPilotDate: fullRosterMap,
        positionsByCode,
        nightCurrentByCode,
        trainingOverdueByCode,
        previousDutyEndByCode: previousEnds,
        priorDutyHoursByCode: priorDutyHours,
        priorFlightHoursByCode: priorFlightHours,
        priorNightDatesByCode: priorNightDates,
        priorPairings,
        trainingPairs,
        instructors,
        reportOffsetMinutes: ftlLimits?.dutyReportOffsetMinutes ?? 60,
        limits: ftlLimits,
        stbyCreditPercent: ftlLimits?.stbyCreditPercent ?? 25,
        levelByCode,
        availabilityByCode
      });

      // Look back the full rolling windows from the LAST day planned, so a
      // pilot who runs out of room mid-way through a long plan is reported.
      setHeadroomReport({
        through: rangeTo,
        rows: buildHeadroomReport(rangeTo),
        shortOfOff: checkCycleOffDays({
          rosterByPilotDate: fullRosterMap,
          pilots: Object.keys(positionsByCode),
          throughIso: rangeTo,
          cycleDays: WORK_CYCLE_DAYS,
          offDaysRequired: OFF_DAYS_PER_CYCLE,
          isoAddDaysFn: isoAddDays
        }),
        underFlown: underFlownPilots({
          flightHoursByCode: priorFlightHours,
          iso: rangeTo,
          cycleDays: WORK_CYCLE_DAYS,
          minHours: MIN_FLIGHT_HOURS_PER_CYCLE,
          rollingSumFn: rollingSum
        })
      });

      // Roster write-back SUGGESTIONS. The plan just decided two things a
      // human planner would otherwise have to notice and act on by hand: who
      // couldn't be given a line because they're near an FDT limit, and who
      // is due training soon with nothing booked. These are only ever
      // proposed here — "เราแค่ แนะนำ" — the chief pilot ticks the ones he
      // agrees with and books them himself, exactly like "Book on roster"
      // already works for training. See weeklyPlanWriteback.js for the
      // reasoning in full. Nothing is written to the database in this step.
      let writebackCount = 0;
      if (!writebackEnabled) {
        // The standing tick is off - "ทำเองโดยแอดมิน". Leave the roster
        // exactly as it was before this feature existed: no suggestions
        // computed, nothing shown.
        setWritebackSuggestions([]);
        setWritebackChecked(new Set());
      } else {
        try {
          const fdtOff = deriveFdtOffWrites({
            unplaced: result.unplaced,
            rosterByPilotDate: fullRosterMap,
            pilotInfoByCode: rosterPilotInfo
          });
          const busyDatesByPilot = new Map();
          for (const s of fdtOff) {
            if (!busyDatesByPilot.has(s.pilotCode)) busyDatesByPilot.set(s.pilotCode, new Set());
            busyDatesByPilot.get(s.pilotCode).add(s.date);
          }
          const trainingBook = deriveTrainingBookWrites({
            trainingUnbooked,
            durationsByItem: trainingSource?.durations,
            rosterByPilotDate: horizonRosterByPilotDate,
            pilotInfoByCode: rosterPilotInfo,
            todayIso: toIso(new Date()),
            busyDatesByPilot
          });
          const suggestions = [...fdtOff, ...trainingBook];
          setWritebackSuggestions(suggestions);
          // Ticked by default — they're already screened against the same
          // thresholds FDT Monitor / Training Due show, so the normal flow is
          // review-and-deselect rather than hunt-and-tick. Only items with
          // something to book get a checkbox at all (training-unslottable
          // has no `entries`).
          setWritebackChecked(new Set(suggestions.filter((s) => s.entries).map((s) => s.id)));
          setWritebackMsg(null);
          writebackCount = suggestions.filter((s) => s.entries).length;
        } catch (err) {
          // A failed suggestion pass must never take the plan itself down
          // with it — the seats above are already decided and staged.
          setWritebackSuggestions([]);
          setWritebackChecked(new Set());
          setWritebackMsg({ ok: false, text: `Couldn't work out roster suggestions: ${err.message}` });
        }
      }

      // Days beyond the week on screen are committed directly.
      if (planDays > 7) {
        const laterDates = new Set(allDates.slice(7));
        const laterCells = [];
        for (const section of WEEKLY_SECTIONS) {
          if (section.kind === "off") continue;
          for (let slot = 0; slot < section.slots; slot++) {
            for (const date of laterDates) {
              laterCells.push({ date, section: section.key, slot, pilotCode: "", level: null });
            }
          }
        }
        const byKey = new Map(laterCells.map((c) => [cellKey(c.date, c.section, c.slot), c]));
        // Don't blank a seat that is being kept - only clear what this run is
        // actually free to re-decide.
        for (const c of existingCells) {
          if (laterDates.has(c.date)) byKey.delete(cellKey(c.date, c.section, c.slot));
        }
        for (const c of result.cells) {
          if (laterDates.has(c.date)) byKey.set(cellKey(c.date, c.section, c.slot), c);
        }
        await saveWeeklyPlanMany([...byKey.values()]);
      }

      applyAutoFillToGrid(result, days.map((d) => d.iso), existingCells);
      const writebackNote = writebackCount
        ? ` Also suggests ${writebackCount} roster change${writebackCount === 1 ? "" : "s"} (near an FDT limit, or training due soon) — review and tick below, nothing is written until you press "Book ticked".`
        : "";
      setMsg({
        ok: true,
        text: (planDays > 7
          ? `Planned ${planDays} days (${weekStart} → ${rangeTo}), ${result.cells.length} new seats${existingCells.length ? `, keeping ${existingCells.length} already planned` : ""}. Days beyond this week are saved; this week is staged below — review, then press Save.`
          : `Re-planned this week: ${result.cells.length} seats — review, then press Save.`) + writebackNote
      });
    } catch (err) {
      setMsg({ ok: false, text: "Fill from roster failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  function applyAutoFillToGrid(result, gridDates, keptCells = []) {
    const dateSet = new Set(gridDates);
    const kept = new Set(keptCells.map((c) => cellKey(c.date, c.section, c.slot)));
    const staged = new Map();
    // Clear every working cell in the week first, so the result is exactly
    // what the rules produced rather than the new plan layered over an old
    // one (which would leave orphaned assignments behind).
    for (const section of WEEKLY_SECTIONS) {
      if (section.kind === "off") continue;
      for (let slot = 0; slot < section.slots; slot++) {
        for (const d of days) {
          const key = cellKey(d.iso, section.key, slot);
          if (kept.has(key)) continue; // already planned and being kept
          staged.set(key, { date: d.iso, section: section.key, slot, pilotCode: "", level: null });
        }
      }
    }
    for (const c of result.cells) {
      if (!dateSet.has(c.date)) continue; // later weeks are saved directly
      staged.set(cellKey(c.date, c.section, c.slot), c);
    }
    // Drop entries that match what's already saved, so the Save counter
    // reflects real changes only.
    const next = new Map();
    for (const [key, value] of staged) {
      const saved = rows.find((r) => r.date === value.date && r.section === value.section && r.slot === value.slot);
      const savedCode = saved?.pilot_code || "";
      if ((value.pilotCode || "") === savedCode) continue;
      next.set(key, value);
    }

    setPendingEdits(next);
    setAutoFillReport(result);
  }

  // Saved rows + staged edits, keyed by cell, so the grid and the warnings
  // both react live to unsaved changes.
  const cellsByKey = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      map.set(cellKey(r.date, r.section, r.slot), {
        date: r.date, section: r.section, slot: r.slot,
        pilotCode: r.pilot_code || "", level: r.level ?? null
      });
    }
    for (const [key, edit] of pendingEdits) map.set(key, edit);
    return map;
  }, [rows, pendingEdits]);

  // Dates each pilot is already planned to work, for the Recovery Rest
  // projection - a pilot planned every day never gets their 168h rest.
  // MUST stay below cellsByKey: it reads it, and a `const` referenced above
  // its own declaration is a temporal-dead-zone crash at render, not a
  // hoisted undefined ("Cannot access '...' before initialization").
  const plannedDutyDatesByCode = useMemo(() => {
    const map = new Map();
    for (const c of cellsByKey.values()) {
      if (!c.pilotCode) continue;
      const section = WEEKLY_SECTIONS.find((s) => s.key === c.section);
      if (!section || section.kind === "off") continue;
      if (!map.has(c.pilotCode)) map.set(c.pilotCode, new Set());
      map.get(c.pilotCode).add(c.date);
    }
    return map;
  }, [cellsByKey]);

  // Pilots on this week's board whose imported level disagrees with the one
  // computed from their Experience record - listed so the stale spreadsheet
  // figure gets corrected at source rather than quietly diverging further.
  const levelMismatches = useMemo(() => {
    const seen = new Map();
    for (const c of cellsByKey.values()) {
      if (!c.pilotCode || !c.level) continue;
      const computed = levelByCode.get(c.pilotCode);
      if (computed == null || computed === c.level) continue;
      seen.set(c.pilotCode, { code: c.pilotCode, computed, imported: c.level });
    }
    return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [cellsByKey, levelByCode]);

  // The report time for a day crew, derived from its scheduled departure.
  // Shown next to the departure so nobody has to do the subtraction, and so
  // the distinction between the two is visible on the page itself.
  function reportTimeFor(sectionKey) {
    const w = dutyWindow(sectionKey, weekStart, ftlLimits?.dutyReportOffsetMinutes ?? 60);
    if (!w) return "";
    return `${pad2(w.start.getHours())}:${pad2(w.start.getMinutes())}`;
  }


  // The assistant stages edits the same way typing in a cell does - it never
  // writes to the database, so everything it does is reviewable and undoable
  // by simply not pressing Save.
  function applyAssistantActions(actions) {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      for (const a of actions || []) {
        const key = cellKey(a.date, a.section, a.slot);
        next.set(key, {
          date: a.date, section: a.section, slot: a.slot,
          pilotCode: a.type === "clear" ? "" : a.pilotCode,
          level: null
        });
      }
      return next;
    });
  }

  // What level to show in a cell, and whether to qualify it.
  //
  // Three cases, and they matter because a wrong number here is worse than
  // no number - people believe what the grid shows:
  //   * computed        - the real 7.17.4 level; shown plain.
  //   * computed, but the spreadsheet said something else - shown computed,
  //     marked "•", with both figures in the tooltip. Usually means the
  //     imported sheet is out of date after the pilot built hours.
  //   * no computed level (Experience record too incomplete to score) -
  //     falls back to whatever was imported, marked "?" so nobody treats it
  //     as verified.
  function levelInfoFor(pilotCode, importedLevel) {
    const computed = levelByCode.get(pilotCode);
    if (computed == null) {
      return importedLevel
        ? { level: importedLevel, unverified: true, title: `Level ${importedLevel} as imported — not verified: this pilot's Pilot Experience record is missing a figure, so the OPS-CM-01 7.17.4 level can't be worked out.` }
        : { level: null };
    }
    if (importedLevel && importedLevel !== computed) {
      return {
        level: computed,
        stale: true,
        title: `Level ${computed} computed from the Pilot Experience record (OPS-CM-01 7.17.4). The imported spreadsheet says ${importedLevel} — that figure is out of date.`
      };
    }
    return { level: computed, title: `Level ${computed} — OPS-CM-01 7.17.4, computed from the Pilot Experience record.` };
  }

  const rosterByPilotDate = useMemo(() => {
    const map = new Map();
    for (const r of rosterRows) {
      if (r.pilot_code && r.date) map.set(`${String(r.pilot_code).toUpperCase()}|${r.date}`, r.code);
    }
    return map;
  }, [rosterRows]);

  // The roster a year out, keyed the same way as the week's own map.
  const horizonRosterByPilotDate = useMemo(() => {
    const map = new Map();
    for (const r of horizonRosterRows) {
      if (r.pilot_code && r.date) map.set(`${String(r.pilot_code).toUpperCase()}|${r.date}`, r.code);
    }
    return map;
  }, [horizonRosterRows]);

  // What needs a training slot booked: due soon, and nothing on the roster
  // between now and the due date that would cover it.
  const trainingQueue = useMemo(() => {
    if (!trainingSource) return [];
    return trainingToBook({
      records: trainingSource.records,
      thresholds: trainingSource.thresholds,
      monitored: trainingSource.monitored,
      items: TRAINING_ITEMS,
      rosterByPilotDate: horizonRosterByPilotDate,
      todayIso: toIso(new Date())
    });
  }, [trainingSource, horizonRosterByPilotDate]);

  const trainingUnbooked = useMemo(() => trainingQueue.filter((r) => !r.booked), [trainingQueue]);

  // Names and bases, needed to write a roster row back.
  const rosterPilotInfo = useMemo(() => {
    const map = new Map();
    for (const r of [...rosterRows, ...horizonRosterRows]) {
      const code = String(r.pilot_code || "").toUpperCase();
      if (code && !map.has(code)) map.set(code, { name: r.pilot_name || "", base: r.base || "" });
    }
    return map;
  }, [rosterRows, horizonRosterRows]);

  // Writes the suggested days onto the ROSTER, which is where training is
  // scheduled. The existing code is kept alongside the training one ("O,S"),
  // never replaced: the O is what counts the day toward the 21 working days
  // of the cycle, and overwriting it would quietly change the pilot's pay.
  async function bookTrainingSlot(row, slot) {
    if (readOnly || !slot?.start) return;
    const code = trainingCodeFor(row.item);
    if (!code) return;
    const dates = [];
    for (let d = slot.start; d <= slot.end; d = addDays(d, 1)) dates.push(d);
    const info = rosterPilotInfo.get(row.pilotCode) || {};
    const entries = dates.map((date) => {
      const existing = String(horizonRosterByPilotDate.get(`${row.pilotCode}|${date}`) || "").trim();
      const parts = existing ? existing.split(",").map((p) => p.trim()).filter(Boolean) : [];
      if (!parts.includes(code)) parts.push(code);
      return { pilotCode: row.pilotCode, pilotName: info.name, base: info.base, date, code: parts.join(",") };
    });
    setBookingMsg(null);
    try {
      await importRosterMany(entries);
      await loadHorizonRoster();
      await refresh();
      setBookingMsg({ ok: true, text: `Booked ${row.pilotCode} ${row.label}: ${dates.join(", ")} (${code}).` });
    } catch (err) {
      setBookingMsg({ ok: false, text: `Couldn't book it: ${err.message}` });
    }
  }

  function toggleWritebackChecked(id) {
    setWritebackChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Books exactly the ticked suggestions - "เราแค่ แนะนำ", so nothing from
  // deriveFdtOffWrites / deriveTrainingBookWrites reaches the database until
  // the chief pilot has crosschecked the list and pressed this. Booked
  // suggestions are removed from the review list and added to the persisted
  // history (ROSTER_WRITEBACK_LOG_KEY) so what was done stays visible later,
  // not just in the moment.
  async function confirmWriteback() {
    if (readOnly) return;
    const toBook = writebackSuggestions.filter((s) => s.entries && writebackChecked.has(s.id));
    if (!toBook.length) return;
    setWritebackBooking(true);
    setWritebackMsg(null);
    try {
      const entries = toBook.flatMap((s) => s.entries);
      await importRosterMany(entries);
      await logAutoWriteback(toBook.map((s) => ({
        kind: s.kind, pilotCode: s.pilotCode, date: s.date, code: s.code,
        reason: s.reason, item: s.item, start: s.start, end: s.end, dueIso: s.dueIso
      })));
      const bookedIds = new Set(toBook.map((s) => s.id));
      setWritebackSuggestions((prev) => prev.filter((s) => !bookedIds.has(s.id)));
      setWritebackChecked((prev) => {
        const next = new Set(prev);
        for (const id of bookedIds) next.delete(id);
        return next;
      });
      await loadHorizonRoster();
      // A targeted reload, not refresh() - refresh() clears pendingEdits,
      // and the whole point of this run is usually "Plan 30 Days, THEN book
      // a couple of these" before the staged week has been saved. Losing an
      // unsaved plan because a roster suggestion was booked would be worse
      // than the stale-roster-row problem this is fixing.
      const updatedRoster = await listRoster({ from: weekStart, to: weekEnd }).catch(() => rosterRows);
      setRosterRows(updatedRoster || []);
      setWritebackMsg({ ok: true, text: `Booked ${toBook.length} of the suggestions above.` });
    } catch (err) {
      setWritebackMsg({ ok: false, text: `Couldn't book it: ${err.message}` });
    } finally {
      setWritebackBooking(false);
    }
  }

  // Everything the assistant is allowed to answer from. Built from the live
  // page state, so it can never be out of date with what's on screen - and
  // deliberately limited to this, so it has nothing to guess with.
  const assistantContext = useMemo(() => {
    const offset = ftlLimits?.dutyReportOffsetMinutes ?? 60;
    const allCodes = Object.keys(positionsByCode).sort();

    function onDutyOn(iso) {
      return allCodes.filter((c) => ["O", "N", "ND"].includes(String(rosterByPilotDate.get(`${c}|${iso}`) || "").toUpperCase()));
    }
    function assignedOn(iso) {
      const used = new Set();
      for (const c of cellsByKey.values()) {
        if (c.date === iso && c.pilotCode) used.add(c.pilotCode);
      }
      return used;
    }
    function assignmentFor(code, iso) {
      for (const c of cellsByKey.values()) {
        if (c.date === iso && c.pilotCode === code) return c;
      }
      return null;
    }
    function cellAt(date, section, slot) {
      return cellsByKey.get(cellKey(date, section, slot)) || null;
    }
    function plannedDutyByDate(code) {
      const byDate = { ...(priorDutyHours[code] || {}) };
      for (const c of cellsByKey.values()) {
        if (c.pilotCode !== code) continue;
        const h = plannedDutyHours(c.section, c.date, ftlLimits?.stbyCreditPercent ?? 25, offset);
        if (h) byDate[c.date] = (byDate[c.date] || 0) + h;
      }
      return byDate;
    }
    function nightDaysInCycle(code, iso) {
      const dates = new Set(priorNightDates[code] || []);
      for (const c of cellsByKey.values()) {
        if (c.pilotCode === code && WEEKLY_SECTIONS.find((x) => x.key === c.section)?.kind === "night") dates.add(c.date);
      }
      let n = 0;
      for (let i = 0; i < WORK_CYCLE_DAYS; i++) if (dates.has(isoAddDays(iso, -i))) n++;
      return n;
    }

    // The text handed to a language model when one is configured. Compact on
    // purpose - it is the whole of what the model is allowed to reason from.
    function summarise() {
      const lines = [];
      lines.push(`Week on screen: ${weekStart} to ${weekEnd}.`);
      lines.push("");
      lines.push("PLAN (line — pilots per day):");
      for (const section of WEEKLY_SECTIONS) {
        if (section.kind === "off") continue;
        const perDay = days.map((d) => {
          const crew = [0, 1].map((slot) => cellAt(d.iso, section.key, slot)?.pilotCode).filter(Boolean);
          return `${d.weekday}:${crew.join("+") || "-"}`;
        });
        lines.push(`- ${section.label}${section.duty?.schDep ? ` (dep ${section.duty.schDep}, reports ${reportTimeFor(section.key)})` : ""}: ${perDay.join("  ")}`);
      }
      lines.push("");
      lines.push("PILOTS:");
      for (const code of allCodes) {
        const a = availabilityByCode.get(code);
        const bits = [
          positionsByCode[code],
          levelByCode.get(code) != null ? `L${levelByCode.get(code)}` : "level unknown",
          nightCurrentByCode.has(code) ? "night current" : "night expired",
          `${nightDaysInCycle(code, weekEnd)} nights/cycle`,
          trainingOverdueByCode.get(code) ? `TRAINING OVERDUE: ${trainingOverdueByCode.get(code)}` : "",
          a && a.severity !== "ok" ? a.reasons.map((r) => r.text).join("; ") : ""
        ].filter(Boolean);
        lines.push(`- ${code}: ${bits.join(" · ")}`);
      }
      lines.push("");
      lines.push("RULES IN FORCE (summary):");
      lines.push(`- Times on the schedule are SCHEDULED DEPARTURES; duty starts ${offset} min earlier.`);
      lines.push(`- ${MIN_REST_HOURS}h minimum rest between duty end and next report.`);
      lines.push(`- Rolling duty limits 7/14/28 days: ${ftlLimits?.dt7d?.max}/${ftlLimits?.dt14d?.max}/${ftlLimits?.dt28d?.max}h; the plan aims below the warning figures.`);
      lines.push(`- Night standby books 25% of 12h = 3h duty. Max ${MAX_NIGHT_DAYS_PER_CYCLE} nights per ${WORK_CYCLE_DAYS}-day cycle. Both night pilots need Night Currency.`);
      lines.push(`- Pairing: the two pilots' Experience Levels added must be >= 4, night or day. Never two Co-pilots.`);
      lines.push(`- First day back from the 7 days off: never night, and crewed with someone currently operating. Last day: early finish preferred; night allowed but the pilot must be told in advance.`);
      lines.push(`- Target ${MIN_FLIGHT_HOURS_PER_CYCLE}h flying per ${WORK_CYCLE_DAYS}-day cycle per pilot.`);
      if (headroomReport?.rows?.length) {
        lines.push("");
        lines.push("SHORT OF HEADROOM: " + headroomReport.rows.map((r) => `${r.code} (${r.issues.map((i) => i.text).join("; ")})`).join(" | "));
      }
      return lines.join("\n");
    }

    return {
      days, weekStart, weekEnd, allCodes,
      positionsByCode, levelByCode, nightCurrentByCode, trainingOverdueByCode,
      availabilityByCode, rosterByPilotDate, trainingPairs, instructors,
      onDutyOn, assignedOn, assignmentFor, cellAt, plannedDutyByDate, nightDaysInCycle,
      summarise
    };
  }, [days, weekStart, weekEnd, positionsByCode, levelByCode, nightCurrentByCode, trainingOverdueByCode,
      availabilityByCode, rosterByPilotDate, cellsByKey, priorDutyHours, priorNightDates, ftlLimits,
      trainingPairs, instructors, headroomReport]);

  const checks = useMemo(() => checkWeeklyPlan({
    cells: [...cellsByKey.values()].filter((c) => c.pilotCode),
    rosterByPilotDate,
    pilotStatusByCode: statusByCode,
    dates: days.map((d) => d.iso),
    nightCurrentByCode,
    trainingOverdueByCode,
    priorDutyHoursByCode: priorDutyHours,
    limits: ftlLimits,
    stbyCreditPercent: ftlLimits?.stbyCreditPercent ?? 25,
    levelByCode,
    availabilityByCode,
    priorNightDatesByCode: priorNightDates,
    reportOffsetMinutes: ftlLimits?.dutyReportOffsetMinutes ?? 60,
    // For the Night Training rule: the detail is flown together and one of the
    // pilots on it has to be a Captain.
    positionsByCode
  }), [cellsByKey, rosterByPilotDate, statusByCode, days, nightCurrentByCode, trainingOverdueByCode, priorDutyHours, ftlLimits, levelByCode, availabilityByCode, priorNightDates, positionsByCode]);

  function stageEdit(date, section, slot, rawText) {
    const key = cellKey(date, section, slot);
    const parsed = parsePlanCell(rawText);
    const next = {
      date, section, slot,
      pilotCode: parsed?.code || "",
      level: parsed?.level ?? null
    };
    setPendingEdits((prev) => {
      const map = new Map(prev);
      const saved = rows.find((r) => r.date === date && r.section === section && r.slot === slot);
      const savedCode = saved?.pilot_code || "";
      const savedLevel = saved?.level ?? null;
      if (next.pilotCode === savedCode && next.level === savedLevel) map.delete(key);
      else map.set(key, next);
      return map;
    });
  }

  async function handleSave() {
    if (!pendingEdits.size) return;
    setSaving(true);
    setMsg(null);
    try {
      await saveWeeklyPlanMany([...pendingEdits.values()]);
      setMsg({ ok: true, text: `Saved ${pendingEdits.size} change${pendingEdits.size > 1 ? "s" : ""}.` });
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handlePrint() {
    await exportLogbookPdf();
  }

  const weekLabel = `${parseIso(weekStart).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} — ${parseIso(weekEnd).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;

  return (
    <div className={`roster-page weekly-page${fullScreen ? " roster-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Weekly Schedule</h1>
          <p>Planning board — who flies, who is on night standby, who is off. Checked against the duty roster and FTL limits as you plan.</p>
        </div>
        <div className="header-tools">
          {!readOnly && (
            <button onClick={() => handleAutoFill(7, { replace: true })} disabled={loading || saving}
              title="Re-plan ONLY the week on screen, from scratch. Nothing beyond this week is touched, and nothing is written until you press Save — use it when something changes mid-week.">
              Re-plan This Week Only
            </button>
          )}
          {!readOnly && (
            <button className="primary" onClick={() => handleAutoFill(30)} disabled={loading || saving}
              title="-30 / +30 pattern: looks back over the last 30 days of recorded duty and plans the next 30 days in one joined-up pass. KEEPS whatever is already planned and continues on from it, so a week you have already fixed is never undone.">
              Plan 30 Days
            </button>
          )}
          {!readOnly && (
            <label
              className="wplan-writeback-toggle"
              title="When ticked, Re-plan / Plan 30 Days also works out roster suggestions (OFF near an FDT limit, training due soon) for you to review and tick. Untick to leave the roster alone and crosscheck it yourself, same as before this existed."
            >
              <input
                type="checkbox"
                checked={writebackEnabled}
                onChange={(e) => handleWritebackEnabledChange(e.target.checked)}
              />
              {" "}Suggest roster changes
            </label>
          )}
          <button onClick={() => setShowChat((v) => !v)} title="Ask about the plan, or tell it what to change">
            {showChat ? "Hide Assistant" : "💬 Assistant"}
          </button>
          {!readOnly && (
            <button onClick={() => setShowPairs((v) => !v)} title="Temporary 'must fly with an instructor until <date>' instructions — line training, return to line, post-OPC">
              {showPairs ? "Hide Pairings" : `Training Pairings${trainingPairs.length ? ` (${trainingPairs.length})` : ""}`}
            </button>
          )}
          {!readOnly && (
            <button onClick={() => setShowImport((v) => !v)}>
              {showImport ? "Hide Import" : "Import from Excel"}
            </button>
          )}
          {!readOnly && (
            <button className="duty-save-btn" onClick={handleSave} disabled={saving || !pendingEdits.size}>
              {saving ? "Saving..." : `Save${pendingEdits.size ? ` (${pendingEdits.size})` : ""}`}
            </button>
          )}
          <button onClick={handlePrint}>Print / Export PDF</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
          <button onClick={refresh}>Refresh</button>
        </div>
      </div>

      {showChat && (
        <WeeklyPlanChat
          context={assistantContext}
          onActions={readOnly ? undefined : applyAssistantActions}
          onClose={() => setShowChat(false)}
        />
      )}

      {showPairs && (
        <TrainingPairsPanel
          pilots={Object.keys(positionsByCode).sort()}
          instructors={instructors}
          onSaved={(saved) => { setTrainingPairs(saved); setShowPairs(false); }}
          onCancel={() => setShowPairs(false)}
        />
      )}

      {showImport && (
        <WeeklyPlanImportPanel
          weekFrom={weekStart}
          weekTo={weekEnd}
          onImported={() => { setShowImport(false); refresh(); }}
          onCancel={() => setShowImport(false)}
        />
      )}

      <div className="weekly-week-nav no-print">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>← Previous week</button>
        <button onClick={() => setWeekStart(weekStartFor(toIso(new Date())))}>This week</button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week →</button>
        {/* The arrows and "This week" keep the sheet's Tue->Mon alignment,
            but a date picked here is used EXACTLY as the first day. Planning
            often starts on a specific date ("from the 20th for three weeks")
            that isn't a Tuesday, and silently snapping it backwards produced
            a different three weeks than the one asked for. */}
        <input
          type="date" lang="en" value={weekStart}
          onChange={(e) => e.target.value && setWeekStart(e.target.value)}
          title="Sets the first day of the board exactly as picked"
        />
        <span className="weekly-week-label">{weekLabel}</span>
      </div>

      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"} no-print`} style={{ marginBottom: 12 }}>{msg.text}</div>}

      {/* Where the night line's eligibility comes from, stated on the page -
          an empty night row is otherwise indistinguishable from "nobody was
          on duty" when the real cause is missing Training data. */}
      {!loading && (
        <p className={`roster-note no-print${nightCurrentByCode.size ? "" : " weekly-note-alert"}`}>
          {nightCurrentByCode.size ? (
            <>
              <b>Night current ({nightCurrentByCode.size}):</b> {[...nightCurrentByCode].sort().join(" · ")}
              {" — from the "}<b>Training</b> tab’s Night Currency date. Only these pilots can be put on the night line.
            </>
          ) : (
            <>⚠ No pilot has a valid <b>Night Currency</b> date in the Training tab, so the night line can’t be filled. Add the dates under Training → then use Fill from Roster again.</>
          )}
          {nightExpiredList.length > 0 && (
            <> · <b>Night re-training due ({nightExpiredList.length}):</b>{" "}
              {nightExpiredList.map((n) => n.expiredDays != null ? `${n.code} (${n.expiredDays}d)` : n.code).join(" · ")}
              {" — day flying unaffected, night line only."}</>
          )}
          {trainingOverdueByCode.size > 0 && (
            <> · <b>Training overdue ({trainingOverdueByCode.size}):</b> {[...trainingOverdueByCode.keys()].sort().join(" · ")} — not assigned to fly.</>
          )}
        </p>
      )}
      {readOnly && <p className="roster-note no-print">Demo account — view only.</p>}

      <div className="weekly-print-area">
        {(branding?.logo || branding?.name) && (
          <div className="weekly-print-brand">
            {branding.logo && <img src={branding.logo} alt="" />}
            {branding.name && <span>{branding.name}</span>}
          </div>
        )}
        <div className="weekly-print-title">Weekly Schedule — {weekLabel}</div>

        <div className="roster-scroll">
          <table className="weekly-table">
            <thead>
              <tr>
                <th className="weekly-rowhead">Section</th>
                {days.map((d) => (
                  <th key={d.iso} className={[d.isWeekend ? "weekend" : "", d.isToday ? "today" : ""].filter(Boolean).join(" ")}>
                    <span className="weekly-day-num">{d.dayNum}</span>
                    <span className="weekly-day-wd">{d.weekday}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td className="weekly-rowhead">—</td><td colSpan={7}>Loading…</td></tr>
              )}
              {!loading && WEEKLY_SECTIONS.map((section) =>
                Array.from({ length: section.slots }, (_, slot) => (
                  <tr key={`${section.key}-${slot}`} className={slot === 0 ? "section-start" : ""}>
                    <td className="weekly-rowhead">
                      {slot === 0 ? (
                        <>
                          {section.label}
                          {section.duty?.schDep
                            ? <small>dep {section.duty.schDep} · report {reportTimeFor(section.key)}</small>
                            : section.sublabel && <small>{section.sublabel}</small>}
                        </>
                      ) : ""}
                    </td>
                    {days.map((d) => {
                      const key = cellKey(d.iso, section.key, slot);
                      const cell = cellsByKey.get(key);
                      const isEditing = editingCell === key;
                      const dirty = pendingEdits.has(key);
                      const severity = checks.cellSeverity.get(key);
                      const classes = [
                        d.isWeekend ? "weekend" : "",
                        d.isToday ? "today" : "",
                        dirty ? "dirty" : ""
                      ].filter(Boolean).join(" ");
                      return (
                        <td
                          key={d.iso}
                          className={classes}
                          onClick={() => !readOnly && setEditingCell(key)}
                        >
                          {isEditing ? (
                            <input
                              className="weekly-cell-input"
                              lang="en"
                              autoFocus
                              defaultValue={formatPlanCell(cell?.pilotCode, cell?.level)}
                              onBlur={(e) => { stageEdit(d.iso, section.key, slot, e.target.value); setEditingCell(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") setEditingCell(null);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : cell?.pilotCode ? (() => {
                            // The level shown is the one COMPUTED from the
                            // pilot's Experience record (OPS-CM-01 7.17.4) -
                            // the same number the pairing rule enforces. The
                            // figure carried in from the spreadsheet is only
                            // a fallback for pilots whose record is too thin
                            // to score, and is marked as unverified so it's
                            // never mistaken for the real thing.
                            const shown = levelInfoFor(cell.pilotCode, cell.level);
                            return (
                              <span
                                className={`weekly-cell ${section.kind}-cell ${severity || ""}`}
                                title={severity ? "Conflict — see the list below the table" : shown.title || section.label}
                              >
                                {cell.pilotCode}
                                {shown.level ? (
                                  <span className={`weekly-cell-level${shown.stale ? " stale" : ""}${shown.unverified ? " unverified" : ""}`}>
                                    ({shown.level}{shown.unverified ? "?" : ""}{shown.stale ? "•" : ""})
                                  </span>
                                ) : null}
                              </span>
                            );
                          })() : null}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {levelMismatches.length > 0 && (
        <div className="weekly-warnings no-print">
          <h3>Experience Level — {levelMismatches.length} differ{levelMismatches.length > 1 ? "" : "s"} from the imported spreadsheet</h3>
          <ul>
            {levelMismatches.map((m) => (
              <li key={m.code}>
                <b className="weekly-hr-warn">{m.code}</b> — computed <b>L{m.computed}</b> from the Pilot Experience record,
                spreadsheet says L{m.imported}. The grid shows the computed value (marked •); the pairing rule uses it too.
              </li>
            ))}
          </ul>
        </div>
      )}

      {headroomReport?.shortOfOff?.length > 0 && (
        <div className="weekly-warnings no-print">
          <h3>Roster — fewer than {OFF_DAYS_PER_CYCLE} days off in the {WORK_CYCLE_DAYS}-day cycle</h3>
          <ul>
            {headroomReport.shortOfOff.map((p) => (
              <li key={p.code}>
                <b className="weekly-hr-warn">{p.code}</b> — {p.dutyDays} duty days and only {p.off} off
                (the 21/7 cycle allows {WORK_DAYS_PER_CYCLE} on, {p.required} off). Fix this in the Duty Schedule, not here.
              </li>
            ))}
          </ul>
        </div>
      )}

      {headroomReport?.underFlown?.length > 0 && (
        <div className="weekly-warnings no-print">
          <h3>Under-flown — below {MIN_FLIGHT_HOURS_PER_CYCLE}h in the last {WORK_CYCLE_DAYS}-day cycle</h3>
          <ul>
            {headroomReport.underFlown.map((p) => (
              <li key={p.code}>
                <b className="weekly-hr-warn">{p.code}</b> — {p.flown}h flown, {p.short}h short of the {p.minHours}h target.
              </li>
            ))}
          </ul>
        </div>
      )}

      {headroomReport && headroomReport.rows.length > 0 && (
        <div className="weekly-warnings no-print">
          <h3>Headroom check to {headroomReport.through} — {headroomReport.rows.length} pilot{headroomReport.rows.length > 1 ? "s" : ""} short of room</h3>
          <ul>
            {headroomReport.rows.map((r) => (
              <li key={r.code}>
                <b className={r.severity === "exc" ? "weekly-hr-exc" : "weekly-hr-warn"}>{r.code}</b>
                {" — "}
                {r.issues.map((i) => i.text).join(" · ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && (
        <div className={`weekly-warnings${checks.issues.length ? "" : " clear"}`}>
          <h3>{checks.issues.length ? `${checks.issues.length} thing${checks.issues.length > 1 ? "s" : ""} to check` : "No conflicts found for this week"}</h3>
          {checks.issues.length > 0 && (
            <ul>
              {checks.issues.map((i, idx) => <li key={idx}>{i.text}</li>)}
            </ul>
          )}
        </div>
      )}

      {trainingUnbooked.length > 0 && (
        <div className="weekly-warnings no-print">
          <h3>Training to book — {trainingUnbooked.length} with no slot on the roster</h3>
          <ul>
            {trainingUnbooked.slice(0, 20).map((r, i) => {
              // How long the course takes, from Training Setting. Only shown
              // when someone has actually entered it - a blank stays blank
              // rather than being guessed at.
              const takes = describeTrainingDuration(trainingSource?.durations, r.item);
              // A proposed date, from the pilot's own duty days before the
              // item expires. Suggested only - nothing is written to the
              // roster, the chief pilot books it himself.
              const slot = suggestTrainingSlot({
                pilotCode: r.pilotCode,
                dueIso: r.dueIso,
                days: trainingSource?.durations?.[r.item]?.days || 1,
                rosterByPilotDate: horizonRosterByPilotDate,
                todayIso: toIso(new Date())
              });
              return (
                <li key={`tb${i}`}>
                  {describeTrainingToBook(r)}
                  {takes ? ` — needs ${takes}` : ""}
                  {" — "}<b>{describeSuggestion(slot)}</b>
                  {slot.start && !readOnly && (
                    <button
                      className="wplan-book"
                      onClick={() => bookTrainingSlot(r, slot)}
                      title={`Write ${trainingCodeFor(r.item)} onto the roster for these days`}
                    >Book on roster</button>
                  )}
                </li>
              );
            })}
          </ul>
          {bookingMsg && <p className={bookingMsg.ok ? "wplan-booked-ok" : "wplan-booked-err"}>{bookingMsg.text}</p>}
          <p className="roster-note">
            Due date from Training Monitor, booked date from the roster (S / T / C / H / CR …).
            Listed while the item is inside its own caution window — the same number Training
            Setting already uses, so the two pages can't disagree.
          </p>
        </div>
      )}

      {(writebackSuggestions.length > 0 || writebackLog.length > 0) && (
        <div className="weekly-warnings no-print">
          <h3>Roster suggestions — near an FDT limit, or training due soon</h3>
          <p className="roster-note">
            Only a suggestion — nothing is written until you tick the ones you agree with and press
            "Book ticked". Same idea as "Training to book" above; this list also covers the FDT side,
            and is offered automatically after "Re-plan This Week Only" / "Plan 30 Days".
          </p>
          {writebackSuggestions.length > 0 && (
            <>
              <ul className="wplan-writeback-list">
                {writebackSuggestions.map((s) => (
                  <li key={s.id} className={s.kind === "training-unslottable" ? "wplan-booked-err" : ""}>
                    {s.entries ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={writebackChecked.has(s.id)}
                          onChange={() => toggleWritebackChecked(s.id)}
                          disabled={readOnly || writebackBooking}
                        />
                        {" "}{describeWritebackEntry(s)}
                      </label>
                    ) : describeWritebackEntry(s)}
                  </li>
                ))}
              </ul>
              {!readOnly && (
                <button
                  className="wplan-book"
                  onClick={confirmWriteback}
                  disabled={writebackBooking || ![...writebackChecked].length}
                >
                  {writebackBooking ? "Booking…" : `Book ticked (${writebackChecked.size})`}
                </button>
              )}
              {writebackMsg && <p className={writebackMsg.ok ? "wplan-booked-ok" : "wplan-booked-err"}>{writebackMsg.text}</p>}
            </>
          )}
          {writebackLog.length > 0 && (
            <details>
              <summary>Booked history ({writebackLog.length})</summary>
              <ul>
                {writebackLog.slice(0, 30).map((e, i) => (
                  <li key={`wb-log-${i}`}>
                    {new Date(e.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} — {describeWritebackEntry(e)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {autoFillReport && (autoFillReport.unplaced.length > 0 || autoFillReport.notes.length > 0) && (
        <div className="weekly-warnings no-print">
          <h3>Fill from Roster — what couldn't be placed</h3>
          <ul>
            {autoFillReport.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
            {autoFillReport.unplaced.map((u, i) => (
              <li key={`u${i}`}>{u.date}: {u.pilotCode} on duty but not assigned — {u.reason}.</li>
            ))}
          </ul>
        </div>
      )}

      <p className="roster-note no-print">
        <b>Plan 30 Days</b> keeps what is already planned and continues from it;
        <b> Re-plan This Week Only</b> throws this week away and rebuilds it, touching nothing beyond.
        Both assign whoever is rostered on duty (codes O / N / ND), applying:
        night lines need Night Currency, max {MAX_NIGHT_DAYS_PER_CYCLE} nights per {WORK_CYCLE_DAYS}-day cycle · {MIN_REST_HOURS}h rest between duties (night ends 05:30, so the
        earliest next report is 17:30) · no expired training · never two Co-pilots in one crew.
        Times shown are <b>scheduled departures</b>; duty starts {ftlLimits?.dutyReportOffsetMinutes ?? 60} min earlier
        (Crew 1 departs 06:30, reports 05:30). Crew 1-6 depart 06:30 · 07:00 · 07:30 · 08:00 · 08:30 · 09:00.
        Rotation: {LINE_ROTATION_PATTERN.map((k) => (WEEKLY_SECTIONS.find((s) => s.key === k)?.label || "OFF")).join(" → ")} →
        and everyone kept above {MIN_FLIGHT_HOURS_PER_CYCLE}h flying per {WORK_CYCLE_DAYS}-day cycle where the roster allows.
      </p>

      <p className="roster-note no-print">
        Click a cell to type a pilot code (with or without the level, e.g. <code>WJU</code> or <code>WJU(3)</code>).
        Clear the cell to remove the assignment. Changes are staged until you press Save.
      </p>
    </div>
  );
}
