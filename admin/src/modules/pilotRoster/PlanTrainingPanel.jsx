import { useState } from "react";
import {
  listRoster, listRosterPilots, listTraining, listExperience, loadExperience,
  listDutyEntriesByPilot, importRosterMany, getSetting
} from "../../services/desktopDatabase.js";
import { combineExperience, combineSpecialty } from "../../utils/experienceCombine.js";
import { isInstructorFromSpecialty } from "./weeklyPlanTrainingPairs.js";
import {
  TRAINING_ITEMS, withTrainingDisabledDefaults, withTrainingDurationDefaults,
  monitoredTrainingItems, classifyTrainingValue, withTrainingThresholdDefaults
} from "../../utils/trainingDue.js";
import {
  planTrainingOntoRoster, describePlannedTraining, describeSkippedTraining,
  isoAddDays
} from "../../services/rosterTrainingPlanner.js";
import {
  NIGHT_TRAINING_CUSTOMER_APPROVAL_LEAD_WEEKS, NIGHT_TRAINING_TYPICAL_CADENCE_WEEKS
} from "./weeklyPlanRules.js";
import { todayIso } from "../../utils/dateKeys.js";

// Lays training onto the roster a long way ahead, from Training Monitor's due
// dates. The rules live in rosterTrainingPlanner.js and are documented as Rule
// 5e in docs/WEEKLY-SCHEDULE-RULES.md; this file is only the screen.
//
// ONE PRESS, no preview and no confirm: Capt. Weera - "ใส่เลยครับ ไม่ต้อง
// preview" (and earlier, "เขียน ลง อัตโนมัติ และ เจ้าหน้าที่เข้าไปแก้ไขได้").
// An earlier version of this panel asked for a Preview first; that was removed
// on instruction.
//
// What makes that safe to do in one press is the planner's own restraint
// rather than a dialog: it only ever writes on a plain duty day, so nothing it
// does can overwrite a Recovery Rest, a rest day, a day off, leave, or
// training somebody already entered. The worst case is training on a working
// day the chief pilot would rather have used differently - and every cell
// stays editable by hand, exactly as before.
//
// The result list stays on screen afterwards, because the "could not fit" half
// of it is the part that needs a human.

// How far ahead to plan. A year covers every annual recurrence once; two
// years is offered because sim slots for the far end of next year are
// genuinely booked this far out.
const HORIZONS = [
  { key: "12", label: "12 months", months: 12 },
  { key: "18", label: "18 months", months: 18 },
  { key: "24", label: "24 months", months: 24 }
];

function isoToday() {
  return todayIso();
}

function addMonthsIso(iso, months) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export default function PlanTrainingPanel({ onCancel, onGenerated, onGoToMonth }) {
  const [horizonKey, setHorizonKey] = useState("12");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { planned, skipped, written }
  const [msg, setMsg] = useState(null);

  const horizon = HORIZONS.find((h) => h.key === horizonKey) || HORIZONS[0];

  // Works out the plan AND writes it, in one press.
  async function handlePlanAndWrite() {
    setMsg(null);
    setResult(null);
    setBusy(true);
    try {
      const today = isoToday();
      const throughIso = addMonthsIso(today, horizon.months);

      const [rosterRows, pilots, training, experience, savedDisabled, savedDurations, savedThresholds] = await Promise.all([
        // Read the roster across the whole horizon: the planner can only use
        // days it can see, and a day it can't see is treated as "not a duty
        // day" (so it is never written on) rather than guessed at.
        listRoster({ from: today, to: throughIso }),
        listRosterPilots().catch(() => []),
        listTraining().catch(() => []),
        // Rank lives in pilot_experience, keyed by the same 3-letter code.
        // Needed because night training must have a Captain on it.
        listExperience().catch(() => []),
        getSetting("training_disabled_items").catch(() => null),
        getSetting("training_durations").catch(() => null),
        // Needed for nightCurrentByCode below - the same caution-window
        // number the Training page and WeeklySchedule.jsx use, so "current"
        // never disagrees between screens.
        getSetting("training_thresholds").catch(() => null)
      ]);

      const rosterByPilotDate = new Map();
      for (const r of rosterRows || []) {
        const code = String(r.pilot_code || "").toUpperCase();
        if (!code || !r.date) continue;
        rosterByPilotDate.set(`${code}|${r.date}`, r.code);
      }

      const pilotInfoByCode = {};
      for (const p of pilots || []) {
        const code = String(p.pilotCode || p.pilot_code || "").toUpperCase();
        if (!code) continue;
        pilotInfoByCode[code] = {
          pilotName: p.pilotName || p.pilot_name || "",
          base: p.base || ""
        };
      }

      const positionsByCode = {};
      for (const p of experience || []) {
        const code = String(p.code || "").toUpperCase();
        const position = p.position || p.profile?.position;
        if (code && position) positionsByCode[code] = position;
      }

      // Who already holds Night Currency right now - night training needs at
      // least one of these on the detail (Capt. Weera: "NT ต้องมี นักบินที่
      // ยังมี Night Current อย่างน้อย 1 ท่าน"). Same computation
      // WeeklySchedule.jsx uses for its own nightCurrentByCode: current = a
      // recorded due date still in the future (or a lifetime item). No date
      // recorded is NOT current - an unknown is treated as expired, same
      // reasoning as everywhere else this gets checked.
      const thresholds = withTrainingThresholdDefaults(savedThresholds);
      const nightItem = TRAINING_ITEMS.find((i) => i.key === "night");
      const nightCurrentByCode = new Set();
      for (const t of training || []) {
        const code = String(t.code || "").toUpperCase();
        if (!code) continue;
        const night = classifyTrainingValue(nightItem, t.record?.night, thresholds.night, new Date());
        if ((night.daysRemaining != null && night.daysRemaining >= 0) || night.lifetime) {
          nightCurrentByCode.add(code);
        }
      }

      // Who can instruct on the simulator. TRI/TRE hours live on each pilot's
      // full Pilot Experience record (not on the list row), so each one has to
      // be loaded - exactly as WeeklySchedule.loadExperienceLevels does it, and
      // reusing its isInstructorFromSpecialty so the two can never disagree
      // about who is an instructor.
      const instructors = new Set();
      await Promise.all((experience || []).map(async (p) => {
        const code = String(p.code || "").toUpperCase();
        if (!code) return;
        const record = await loadExperience(p.licence || code).catch(() => null);
        if (!record) return;
        const dutyEntries = await listDutyEntriesByPilot(code).catch(() => []);
        const combined = combineExperience(record, dutyEntries);
        const specialty = combineSpecialty(record, dutyEntries, combined.updateDate) || [];
        if (isInstructorFromSpecialty(specialty)) instructors.add(code);
      }));

      const disabled = withTrainingDisabledDefaults(savedDisabled);
      const monitored = new Set(monitoredTrainingItems(disabled).map((i) => i.key));

      const plan = planTrainingOntoRoster({
        records: training || [],
        items: TRAINING_ITEMS,
        monitored,
        durationsByItem: withTrainingDurationDefaults(savedDurations),
        rosterByPilotDate,
        pilotInfoByCode,
        positionsByCode,
        nightCurrentByCode,
        instructors,
        todayIso: today,
        throughIso
      });

      if (!plan.entries.length) {
        setResult({ ...plan, today, throughIso, written: 0 });
        setMsg({
          ok: true,
          text: plan.skipped.length
            ? "Nothing could be written — see the list below."
            : "Nothing to plan — every monitored course already has a slot on the roster before it is due."
        });
        return;
      }

      // Straight to the write. No confirm: what keeps this safe is that the
      // planner only ever targets plain duty days, so it cannot overwrite rest,
      // days off, leave, or training already entered.
      const n = plan.entries.length;
      const courses = plan.planned.length;
      await importRosterMany(plan.entries);

      setResult({ ...plan, today, throughIso, written: n });
      setMsg({
        ok: true,
        text: `Written ${n} training day(s) across ${courses} course(s) onto the roster. Edit any cell as usual.`
      });
      await onGenerated?.();
    } catch (err) {
      setMsg({ ok: false, text: "Could not plan training: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  const planned = result?.planned || [];
  const skipped = result?.skipped || [];
  // Real-aircraft Night Training was booked this run - unlike every other
  // course here, it isn't purely an internal scheduling decision.
  const nightPlanned = planned.some((p) => p.item === "night");

  // Which months the writes actually landed in ("2026-09"), in order. Used to
  // tell the reader where to look, since the grid shows one month at a time.
  const writtenMonths = [...new Set(
    planned.flatMap((p) => {
      const months = new Set();
      let d = p.start;
      while (d <= p.end) { months.add(d.slice(0, 7)); d = isoAddDays(d, 1); }
      return [...months];
    })
  )].sort();

  return (
    <div className="roster-import-panel">
      <div className="module-header" style={{ marginBottom: "10px" }}>
        <h3>Plan Training onto Roster</h3>
        <button onClick={onCancel}>Close</button>
      </div>

      <p className="roster-note" style={{ margin: "0 0 10px" }}>
        Reads every monitored course from Training Monitor and writes it onto
        the roster before it falls due — simulator items 1–3 months ahead,
        other courses 1–2 months ahead. Writes on a plain Duty (<code>O</code>)
        day, Recovery Rest (<code>RR</code>), a Rest Day (<code>R</code>) or an
        Off day (<code>X</code>); never on leave or a day that already has
        training. Every cell stays editable by hand afterwards.
      </p>

      <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
        <label>
          Plan ahead:{" "}
          <select
            value={horizonKey}
            onChange={(e) => { setHorizonKey(e.target.value); setResult(null); setMsg(null); }}
            disabled={busy}
          >
            {HORIZONS.map((h) => (
              <option key={h.key} value={h.key}>{h.label}</option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={handlePlanAndWrite} disabled={busy}>
          {busy ? "Planning and writing…" : "Plan and write to roster"}
        </button>
      </div>

      {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {result && (planned.length > 0 || skipped.length > 0) && (
        <div className="roster-preview">
          <p className="roster-note" style={{ margin: "0 0 8px" }}>
            Planning window: {result.today} → {result.throughIso}
          </p>

          {planned.length > 0 && (
            <>
              <h4 style={{ margin: "8px 0 6px" }}>
                Written — {planned.length} course{planned.length === 1 ? "" : "s"},{" "}
                {result.written} day{result.written === 1 ? "" : "s"}
              </h4>

              {/* Real-aircraft Night Training needs the customer's approval
                  for which platform/day, unlike every other course this panel
                  writes - this app has no approval record to check against,
                  so it can only remind, not enforce (see
                  NIGHT_TRAINING_CUSTOMER_APPROVAL_LEAD_WEEKS in
                  weeklyPlanRules.js). Shown only when this run actually
                  planned one, so it isn't noise on every other write. */}
              {nightPlanned && (
                <p className="roster-note" style={{ margin: "0 0 8px", borderLeft: "3px solid #fbbf24", paddingLeft: "8px" }}>
                  <b>Night Training was written above.</b> Real-aircraft night
                  flying needs the customer's (rig owner's) approval for which
                  platform and which day — request it{" "}
                  {NIGHT_TRAINING_CUSTOMER_APPROVAL_LEAD_WEEKS.min}–{NIGHT_TRAINING_CUSTOMER_APPROVAL_LEAD_WEEKS.max}{" "}
                  week(s) before the date shown below. Typical fleet-wide
                  cadence is one detail every{" "}
                  {NIGHT_TRAINING_TYPICAL_CADENCE_WEEKS.min}–{NIGHT_TRAINING_TYPICAL_CADENCE_WEEKS.max} weeks.
                </p>
              )}

              {/* The grid below shows ONE month; courses are written 1-3
                  months ahead of their due dates, so most of what was just
                  written is NOT on the month currently displayed. Without
                  saying so, the roster looks unchanged and the write looks
                  like it failed. */}
              {writtenMonths.length > 0 && (
                <p className="roster-note" style={{ margin: "0 0 8px" }}>
                  <b>These are on other months.</b> The roster grid shows one
                  month at a time, and courses are written 1–3 months ahead of
                  when they fall due. Jump to:{" "}
                  {writtenMonths.map((m, i) => (
                    <span key={m}>
                      {i > 0 && ", "}
                      {onGoToMonth ? (
                        <button
                          className="roster-chip"
                          style={{ cursor: "pointer", padding: "1px 6px" }}
                          onClick={() => onGoToMonth(m)}
                        >
                          {m}
                        </button>
                      ) : <b>{m}</b>}
                    </span>
                  ))}
                </p>
              )}

              <div className="roster-preview-list">
                {planned.map((p) => (
                  <div key={`${p.pilotCode}-${p.item}-${p.start}`} className="roster-chip">
                    {describePlannedTraining(p)}
                  </div>
                ))}
              </div>
            </>
          )}

          {skipped.length > 0 && (
            <>
              {/* Deliberately as prominent as the successes. An item that
                  could NOT be fitted is the one that needs a human - it is
                  heading for its due date with nowhere to go. */}
              <h4 style={{ margin: "12px 0 6px", color: "#fca5a5" }}>
                Could not fit ({skipped.length}) — these need a decision
              </h4>
              <div className="roster-preview-list">
                {skipped.map((s) => (
                  <div
                    key={`${s.pilotCode}-${s.item}`}
                    className="roster-chip"
                    style={{ borderColor: "#ef4444", color: "#fca5a5" }}
                  >
                    {describeSkippedTraining(s)}
                  </div>
                ))}
              </div>
              <p className="roster-note" style={{ margin: "8px 0 0" }}>
                Nothing was moved to make room: shifting a Recovery Rest or a
                day off to fit a course in would break the rest protection it
                exists for. Free up a duty day, use a day off as overtime
                (<code>O,S</code>), or book the course outside the window by
                hand.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
