import { useState } from "react";
import {
  listRoster, listRosterPilots, listTraining, listExperience, loadExperience,
  listDutyEntriesByPilot, importRosterMany, getSetting
} from "../../services/desktopDatabase.js";
import { combineExperience, combineSpecialty } from "../../utils/experienceCombine.js";
import { isInstructorFromSpecialty } from "./weeklyPlanTrainingPairs.js";
import {
  TRAINING_ITEMS, withTrainingDisabledDefaults, withTrainingDurationDefaults,
  monitoredTrainingItems
} from "../../utils/trainingDue.js";
import {
  planTrainingOntoRoster, describePlannedTraining, describeSkippedTraining,
  isoAddDays
} from "../../services/rosterTrainingPlanner.js";
import { todayIso } from "../../utils/dateKeys.js";

// Lays training onto the roster a long way ahead, from Training Monitor's due
// dates. The rules live in rosterTrainingPlanner.js and are documented as Rule
// 5e in docs/WEEKLY-SCHEDULE-RULES.md; this file is only the screen.
//
// LOCKED FOR NOW - preview first, write only on confirm. Capt. Weera, Nov
// 2026: the roster is imported exactly as the company's workbook has it, and
// training is not to be arranged automatically yet ("import roster ก็ copy มา
// ตามนั้นเลย ยังไม่ต้องไปจัด training แบบ auto"). So the button only works out
// the plan and shows it; nothing reaches the roster until "Write N days to
// roster" is pressed. (It used to write in one press - "ใส่เลยครับ ไม่ต้อง
// preview" - and can go back to that by calling handleConfirmWrite straight
// after the plan.)
//
// The planner itself is unchanged and still only ever targets a plain duty
// day, so even a confirmed write cannot overwrite a Recovery Rest, a rest day,
// a day off, leave, or training somebody already entered.
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
  const [pending, setPending] = useState(null); // a worked-out plan not yet written
  const [msg, setMsg] = useState(null);

  const horizon = HORIZONS.find((h) => h.key === horizonKey) || HORIZONS[0];

  // Works out the plan and shows it. Writes nothing (see the note at the top).
  async function handlePlanPreview() {
    setMsg(null);
    setResult(null);
    setPending(null);
    setBusy(true);
    try {
      const today = isoToday();
      const throughIso = addMonthsIso(today, horizon.months);

      const [rosterRows, pilots, training, experience, savedDisabled, savedDurations] = await Promise.all([
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
        getSetting("training_durations").catch(() => null)
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

      setResult({ ...plan, today, throughIso, written: 0 });
      setPending({ ...plan, today, throughIso });
      setMsg({
        ok: true,
        text: `Preview only - nothing has been written. ${plan.entries.length} training day(s) across ${plan.planned.length} course(s) would go onto the roster.`
      });
    } catch (err) {
      setMsg({ ok: false, text: "Could not plan training: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  // The only place this panel writes to the roster.
  async function handleConfirmWrite() {
    if (!pending?.entries?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const n = pending.entries.length;
      await importRosterMany(pending.entries);
      setResult({ ...pending, written: n });
      setPending(null);
      setMsg({
        ok: true,
        text: `Written ${n} training day(s) across ${pending.planned.length} course(s) onto the roster. Edit any cell as usual.`
      });
      await onGenerated?.();
    } catch (err) {
      setMsg({ ok: false, text: "Could not write the plan: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  const planned = result?.planned || [];
  const skipped = result?.skipped || [];

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
        Reads every monitored course from Training Monitor and plans it onto
        the roster before it falls due. <b>Preview first</b> — nothing is
        written until you press <b>Write … to roster</b>. Simulator items go
        1–3 months ahead, other courses 1–2 months ahead. Writes <b>only on plain Duty
        (<code>O</code>) days</b>; never on <code>RR</code>, <code>R</code>,{" "}
        <code>X</code>, leave, or a day that already has training. Every cell
        stays editable by hand afterwards.
      </p>

      <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
        <label>
          Plan ahead:{" "}
          <select
            value={horizonKey}
            onChange={(e) => { setHorizonKey(e.target.value); setResult(null); setPending(null); setMsg(null); }}
            disabled={busy}
          >
            {HORIZONS.map((h) => (
              <option key={h.key} value={h.key}>{h.label}</option>
            ))}
          </select>
        </label>
        <button onClick={handlePlanPreview} disabled={busy}>
          {busy && !pending ? "Planning…" : "Preview plan"}
        </button>
        {pending?.entries?.length > 0 && (
          <>
            <button className="primary" onClick={handleConfirmWrite} disabled={busy}>
              {busy ? "Writing…" : `Write ${pending.entries.length} day(s) to roster`}
            </button>
            <button onClick={() => { setPending(null); setResult(null); setMsg(null); }} disabled={busy}>
              Discard
            </button>
          </>
        )}
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
                {pending ? "Would write" : "Written"} — {planned.length} course{planned.length === 1 ? "" : "s"},{" "}
                {pending ? pending.entries.length : result.written} day{(pending ? pending.entries.length : result.written) === 1 ? "" : "s"}
                {pending && " (not written yet)"}
              </h4>

              {/* The grid below shows ONE month; courses are written 1-3
                  months ahead of their due dates, so most of what was just
                  written is NOT on the month currently displayed. Without
                  saying so, the roster looks unchanged and the write looks
                  like it failed. */}
              {!pending && writtenMonths.length > 0 && (
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
