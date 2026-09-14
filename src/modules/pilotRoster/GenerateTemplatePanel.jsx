import { useMemo, useState } from "react";
import { generateCycleEntries, continueCycleEntries, detectPattern, ROSTER_PATTERNS, buildCustomPattern } from "../../services/rosterTemplate.js";
import { listRoster, importRosterMany, deleteRosterEntry } from "../../services/desktopDatabase.js";
import "./PilotRoster.css";

const normalizeCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Local calendar "today" as YYYY-MM-DD - used by Detect-pattern mode so a
// confirmed detection never backfills days already in the past (it starts
// writing from today or the detected anchor date, whichever is later).
function toIsoDateNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SKIP_REASON_LABEL = {
  "no-history": "no existing schedule yet",
  "no-anchor-codes": "no Duty/RR/Off days found to detect cycle position",
  "already-covers-range": "already up to date through the Through date"
};

// Fills a repeating duty cycle (see rosterTemplate.js — 21/7 is the
// company's own base rotation, Duty 6 / RR 2 / Duty 6 / RR 2 / Duty 5 /
// Off 7; 20/10 and Custom are covered there too). Four modes:
//   - One pilot: pick a Start date (day 1 of the pattern) manually, or use
//     "Continue from last entry" to auto-detect where that pilot's cycle
//     currently is.
//   - New pilot: same as above, for a pilot not in the roster yet.
//   - All pilots in roster: "Continue" every pilot in one pass, each keeping
//     their own cycle phase (detected independently from their own
//     history) - there's no single company-wide "day 1" to anchor off of,
//     so this is always a continuation, never a fresh Start date. All
//     pilots continue on the SAME pattern selected below.
//   - Detect pattern (all pilots): unlike the three modes above, this does
//     NOT take the pattern selected below as given - it works out WHICH
//     named pattern (21/7 / 20/10 / 5/2) each pilot's own recent roster
//     actually looks like (or "custom" if none fit), scanning roughly 3
//     months back and 3 months forward from today for each pilot
//     independently (detectPattern in rosterTemplate.js). Capt. Weera: run
//     this to re-stamp a pilot's future roster from whatever cycle they're
//     really on, once confirmed - a pure pattern stamp over the selected
//     range, replacing whatever was there before rather than skipping days
//     that already have data (the other three modes' behaviour).
// Days that already have data for a pilot in the written range are always
// left untouched in the first three modes (checked via a listRoster fetch
// right before writing) - EXCEPT in Detect-pattern mode, which overwrites on
// purpose once the detected pattern for each pilot has been confirmed.
export default function GenerateTemplatePanel({ pilots, onCancel, onGenerated, initialPilotCode }) {
  const [mode, setMode] = useState("existing"); // "existing" | "new" | "all" | "detect"
  const [selectedCode, setSelectedCode] = useState(initialPilotCode || pilots[0]?.pilotCode || "");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newBase, setNewBase] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // { groups: [{ target, entries, skipped, continued?, confidence?, fromDate? }], skippedPilots: [{pilotCode,pilotName,reason}] }
  const [preview, setPreview] = useState(null);

  // Detect-pattern mode's own two-stage flow: detections first (one row per
  // pilot, editable/confirmable before anything is generated), THEN the
  // normal preview-before-save once confirmed. Kept separate from `preview`
  // above so "Detect" and "Preview/Continue" never collide if the admin
  // switches modes mid-flow.
  // detections: [{ pilotCode, pilotName, base, result: detectPattern()'s
  //   return value or null, accepted: bool }]
  const [detections, setDetections] = useState(null);
  const [detectThrough, setDetectThrough] = useState("");

  // Which repeating pattern to use. "21/7" is the company's own base
  // rotation and stays the default; the other two are picked explicitly.
  const [patternKey, setPatternKey] = useState("21/7"); // "21/7" | "20/10" | "5/2" | "custom"
  const [customDutyDays, setCustomDutyDays] = useState(14);
  const [customOffDays, setCustomOffDays] = useState(7);

  const activePattern = useMemo(() => {
    if (patternKey === "custom") return buildCustomPattern(customDutyDays, customOffDays);
    return ROSTER_PATTERNS[patternKey]?.sequence || ROSTER_PATTERNS["21/7"].sequence;
  }, [patternKey, customDutyDays, customOffDays]);

  const patternSummary = patternKey === "custom"
    ? `${Math.max(0, Math.floor(Number(customDutyDays) || 0))} duty day(s) then ${Math.max(0, Math.floor(Number(customOffDays) || 0))} off, repeating — no Recovery Rest inserted automatically.`
    : patternKey === "21/7"
      ? "Duty 6 → RR 2 → Duty 6 → RR 2 → Duty 5 → Off 7, repeating (the company's own base rotation)."
      : patternKey === "20/10"
        ? "Duty 6 → RR 2 → Duty 6 → RR 2 → Duty 4 → Off 10, repeating. Not from a company document — built to follow the same 168-hour Recovery Rest shape as 21/7; check it against a real schedule before relying on it."
        : "Duty 5 → Off 2, repeating.";

  const selectedPilot = useMemo(() => pilots.find((p) => p.pilotCode === selectedCode), [pilots, selectedCode]);

  function currentTarget() {
    if (mode === "existing") {
      return selectedPilot ? { pilotCode: selectedPilot.pilotCode, pilotName: selectedPilot.pilotName, base: selectedPilot.base } : null;
    }
    const code = normalizeCode(newCode);
    if (!code) return null;
    return { pilotCode: code, pilotName: newName.trim(), base: newBase.trim() };
  }

  async function handlePreview() {
    setMsg(null);
    setPreview(null);
    const target = currentTarget();
    if (!target) {
      setMsg({ ok: false, text: mode === "existing" ? "Pick a pilot first." : "Enter a pilot code first." });
      return;
    }
    if (!startDate || !endDate) {
      setMsg({ ok: false, text: "Pick both a start and end date." });
      return;
    }
    if (endDate < startDate) {
      setMsg({ ok: false, text: "End date must be on or after the start date." });
      return;
    }

    setBusy(true);
    try {
      const generated = generateCycleEntries(startDate, endDate, 0, activePattern);
      const existingRows = await listRoster({ from: startDate, to: endDate });
      const existingDates = new Set(existingRows.filter((r) => r.pilot_code === target.pilotCode).map((r) => r.date));
      const toWrite = generated.filter((g) => !existingDates.has(g.date));
      setPreview({
        groups: [{ target, entries: toWrite, skipped: generated.length - toWrite.length }],
        skippedPilots: []
      });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // "One click" continue: reads this pilot's whole history (any date range),
  // works out where they are in the 28-day cycle from their own O/RR/X days,
  // and fills forward from the day after their last known entry through
  // `endDate` - no manual Start date needed, and no need to run this once
  // per year: picking a "Through" date in 2028 continues straight across
  // 2026/2027/2028 in one go.
  async function handleContinue() {
    setMsg(null);
    setPreview(null);
    if (mode !== "existing" || !selectedPilot) {
      setMsg({ ok: false, text: "Pick an existing pilot first." });
      return;
    }

    setBusy(true);
    try {
      const allRows = await listRoster({});
      const history = allRows
        .filter((r) => r.pilot_code === selectedPilot.pilotCode)
        .map((r) => ({ date: r.date, code: r.code }));

      if (history.length === 0) {
        setMsg({ ok: false, text: "No existing schedule found for this pilot yet - set a Start date manually instead." });
        return;
      }

      let through = endDate;
      if (!through) {
        const last = history.reduce((m, e) => (e.date > m ? e.date : m), history[0].date);
        through = `${Number(last.slice(0, 4)) + 2}-12-31`;
        setEndDate(through);
      }

      const result = continueCycleEntries(history, through, activePattern);
      if (result.reason === "no-anchor-codes") {
        setMsg({ ok: false, text: "Couldn't find any Duty/RR/Off days in this pilot's history to detect the cycle position - set a Start date manually instead." });
        return;
      }
      if (result.reason === "already-covers-range") {
        setMsg({ ok: false, text: `This pilot already has data through ${result.lastDate}, on or after ${through}. Pick a later "Through" date.` });
        return;
      }

      const existingRows = await listRoster({ from: result.startDate, to: through });
      const existingDates = new Set(existingRows.filter((r) => r.pilot_code === selectedPilot.pilotCode).map((r) => r.date));
      const toWrite = result.entries.filter((e) => !existingDates.has(e.date));

      setStartDate(result.startDate);
      setPreview({
        groups: [{
          target: { pilotCode: selectedPilot.pilotCode, pilotName: selectedPilot.pilotName, base: selectedPilot.base },
          entries: toWrite,
          skipped: result.entries.length - toWrite.length,
          continued: true,
          confidence: result.confidence,
          fromDate: result.lastDate
        }],
        skippedPilots: []
      });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Same idea as handleContinue, but for every pilot currently in the
  // roster in one pass. Each pilot keeps their own cycle phase (detected
  // independently from their own history) - this is NOT "everyone starts
  // on the same day". One shared listRoster({}) fetch covers every pilot
  // instead of one round-trip per pilot. Pilots with no history, no
  // detectable cycle position, or already up to date are skipped and
  // listed with a reason rather than silently dropped.
  async function handleContinueAll() {
    setMsg(null);
    setPreview(null);
    if (pilots.length === 0) {
      setMsg({ ok: false, text: "No pilots in the roster yet." });
      return;
    }

    setBusy(true);
    try {
      const allRows = await listRoster({});
      const byCode = new Map();
      for (const r of allRows) {
        if (!byCode.has(r.pilot_code)) byCode.set(r.pilot_code, []);
        byCode.get(r.pilot_code).push({ date: r.date, code: r.code });
      }

      let through = endDate;
      if (!through) {
        let latest = "";
        for (const list of byCode.values()) {
          for (const e of list) if (e.date > latest) latest = e.date;
        }
        through = latest ? `${Number(latest.slice(0, 4)) + 2}-12-31` : `${new Date().getFullYear() + 2}-12-31`;
        setEndDate(through);
      }

      const groups = [];
      const skippedPilots = [];

      for (const p of pilots) {
        const history = byCode.get(p.pilotCode) || [];
        if (history.length === 0) {
          skippedPilots.push({ pilotCode: p.pilotCode, pilotName: p.pilotName, reason: "no-history" });
          continue;
        }
        const result = continueCycleEntries(history, through, activePattern);
        if (result.reason === "no-anchor-codes" || result.reason === "already-covers-range") {
          skippedPilots.push({ pilotCode: p.pilotCode, pilotName: p.pilotName, reason: result.reason });
          continue;
        }
        const existingDates = new Set(
          history.filter((e) => e.date >= result.startDate && e.date <= through).map((e) => e.date)
        );
        const toWrite = result.entries.filter((e) => !existingDates.has(e.date));
        if (toWrite.length === 0) {
          skippedPilots.push({ pilotCode: p.pilotCode, pilotName: p.pilotName, reason: "already-covers-range" });
          continue;
        }
        groups.push({
          target: { pilotCode: p.pilotCode, pilotName: p.pilotName, base: p.base },
          entries: toWrite,
          skipped: result.entries.length - toWrite.length,
          continued: true,
          confidence: result.confidence,
          fromDate: result.lastDate
        });
      }

      if (groups.length === 0) {
        setMsg({ ok: false, text: `Nothing to generate - every pilot either has no history yet or is already up to date through ${through}.` });
        return;
      }

      setPreview({ groups, skippedPilots });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Stage 1 of Detect-pattern mode: runs detectPattern() against every
  // pilot's own roster history (independently - each pilot can land on a
  // different named pattern, or "custom") and shows the result as a list to
  // review, WITHOUT writing or previewing anything yet. Capt. Weera: "ขึ้น
  // รายละเอียดให้รับทราบ กด OK" - this is that step. A pilot with no O/RR/X
  // history at all gets a null result and is shown as "no data to detect
  // from" rather than silently skipped, since the admin should know why.
  async function handleDetectAll() {
    setMsg(null);
    setPreview(null);
    setDetections(null);
    if (pilots.length === 0) {
      setMsg({ ok: false, text: "No pilots in the roster yet." });
      return;
    }

    setBusy(true);
    try {
      const allRows = await listRoster({});
      const byCode = new Map();
      for (const r of allRows) {
        if (!byCode.has(r.pilot_code)) byCode.set(r.pilot_code, []);
        byCode.get(r.pilot_code).push({ date: r.date, code: r.code });
      }

      const rows = pilots.map((p) => {
        const history = byCode.get(p.pilotCode) || [];
        const result = history.length ? detectPattern(history) : null;
        return {
          pilotCode: p.pilotCode,
          pilotName: p.pilotName,
          base: p.base,
          result,
          // Only pre-accept detections the algorithm itself is confident
          // about - a "custom" result (no named pattern fit well) starts
          // unaccepted so a below-threshold guess is never bulk-applied
          // without the admin looking at it first.
          accepted: !!result && result.patternKey !== "custom"
        };
      });

      setDetections(rows);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Stage 2: once the admin has reviewed/adjusted which detections to apply
  // (handleDetectAll above) and picked a Through date, builds the actual
  // write preview for every ACCEPTED pilot - generateCycleEntries from each
  // pilot's own detected anchor date (or today, whichever is later - never
  // backfills days already in the past) through Through, using each pilot's
  // own detected pattern. This is a PURE STAMP: every entry generated
  // overwrites whatever code sits on that date already, because the whole
  // point of confirming a detected pattern is to make the roster match it
  // going forward - unlike Continue/Continue-all above, existing days in
  // range are NOT filtered out here.
  function handleConfirmDetections() {
    setMsg(null);
    const accepted = (detections || []).filter((d) => d.accepted && d.result);
    if (accepted.length === 0) {
      setMsg({ ok: false, text: "No pilots selected - tick at least one detected pattern to apply." });
      return;
    }
    if (!detectThrough) {
      setMsg({ ok: false, text: "Pick a Through date for the pilots you're applying this to." });
      return;
    }

    const today = toIsoDateNow();
    const groups = [];
    const skippedPilots = [];
    for (const d of accepted) {
      const from = d.result.anchorDate > today ? d.result.anchorDate : today;
      if (from > detectThrough) {
        skippedPilots.push({ pilotCode: d.pilotCode, pilotName: d.pilotName, reason: "already-covers-range" });
        continue;
      }
      const entries = generateCycleEntries(from, detectThrough, 0, d.result.sequence);
      groups.push({
        target: { pilotCode: d.pilotCode, pilotName: d.pilotName, base: d.base },
        entries,
        skipped: 0,
        overwrite: true,
        detectedPattern: d.result.patternKey,
        confidence: d.result.confidence,
        fromDate: from
      });
    }

    if (groups.length === 0) {
      setMsg({ ok: false, text: `Nothing to generate through ${detectThrough} for the selected pilot(s).` });
      return;
    }

    setPreview({ groups, skippedPilots, overwrite: true });
  }

  async function handleConfirm() {
    if (!preview) return;
    setBusy(true);
    try {
      const payload = preview.groups.flatMap((g) =>
        g.entries.map((e) => ({
          pilotCode: g.target.pilotCode,
          pilotName: g.target.pilotName,
          base: g.target.base,
          date: e.date,
          code: e.code
        }))
      );
      await importRosterMany(payload);
      const totalSkipped = preview.groups.reduce((s, g) => s + (g.skipped || 0), 0);
      setMsg({
        ok: true,
        text: preview.overwrite
          ? `Applied the detected pattern to ${payload.length} day(s) across ${preview.groups.length} pilot(s) - every day in range was overwritten, matching the confirmed pattern.`
          : preview.groups.length > 1
            ? `Generated ${payload.length} day(s) across ${preview.groups.length} pilot(s)${totalSkipped ? ` (left ${totalSkipped} existing day(s) untouched)` : ""}.`
            : `Generated ${payload.length} day(s) for ${preview.groups[0].target.pilotCode}${preview.groups[0].skipped ? ` (left ${preview.groups[0].skipped} existing day(s) untouched)` : ""}.`
      });
      setPreview(null);
      setDetections(null);
      await onGenerated?.();
    } catch (err) {
      setMsg({ ok: false, text: "Generate failed: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  // Clears one pilot's roster over the Start/Through range already set
  // above - the undo for "generated the wrong pattern" or "this pilot's
  // rotation changed, wipe the old one before setting the new one".
  //
  // ALWAYS confirmed first (Capt. Weera: "ต้อง confirm ก่อนทุกครั้ง") - this
  // deletes for real, one date at a time (deleteRosterEntry has no bulk
  // form), and unlike Generate it can't be undone by simply not pressing
  // Save. Scoped to ONE pilot only ("แต่ละคน"), never a bulk clear across
  // everyone - that is a different, much larger blast radius and isn't what
  // was asked for.
  //
  // Deletes EVERY code in the range, not just O/RR/X - the range is exactly
  // what's on screen (Start..Through), and a day of leave or training sitting
  // inside it is still a real roster row the admin is choosing to remove. The
  // confirm text says so explicitly rather than quietly only touching
  // "pattern" days, which would silently leave stray codes behind.
  async function handleClear() {
    if (mode !== "existing" || !selectedPilot) {
      setMsg({ ok: false, text: "Pick an existing pilot first." });
      return;
    }
    if (!startDate || !endDate) {
      setMsg({ ok: false, text: "Pick both a start and end date to clear." });
      return;
    }
    if (endDate < startDate) {
      setMsg({ ok: false, text: "End date must be on or after the start date." });
      return;
    }

    setMsg(null);
    setPreview(null);
    setBusy(true);
    let rows;
    try {
      const existingRows = await listRoster({ from: startDate, to: endDate });
      rows = existingRows.filter((r) => r.pilot_code === selectedPilot.pilotCode);
    } catch (err) {
      setBusy(false);
      setMsg({ ok: false, text: err.message });
      return;
    }
    setBusy(false);

    if (rows.length === 0) {
      setMsg({ ok: false, text: `Nothing to clear for ${selectedPilot.pilotCode} between ${startDate} and ${endDate}.` });
      return;
    }

    const otherCodes = rows.filter((r) => !["O", "RR", "X"].includes(String(r.code || "").toUpperCase()));
    const warn = otherCodes.length
      ? `\n\nNote: ${otherCodes.length} of these day(s) are NOT plain Duty/RR/Off (could be leave, training or a check) - this clears every code in the range, not only the pattern.`
      : "";
    const confirmed = window.confirm(
      `Clear ${rows.length} day(s) for ${selectedPilot.pilotCode} between ${startDate} and ${endDate}?\n\nThis cannot be undone.${warn}`
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      for (const r of rows) {
        await deleteRosterEntry({ pilotCode: selectedPilot.pilotCode, date: r.date });
      }
      setMsg({ ok: true, text: `Cleared ${rows.length} day(s) for ${selectedPilot.pilotCode} (${startDate} → ${endDate}).` });
      await onGenerated?.();
    } catch (err) {
      setMsg({ ok: false, text: "Clear failed: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  const totalEntries = preview ? preview.groups.reduce((s, g) => s + g.entries.length, 0) : 0;

  return (
    <div className="roster-import-panel">
      <div className="module-header" style={{ marginBottom: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "16px" }}>Set Work Pattern</h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12.5px" }}>
            {patternSummary} Days that already have data are always left as-is.
          </p>
        </div>
        <button onClick={onCancel}>Close</button>
      </div>

      <div className="roster-import-row">
        <label>
          <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> One pilot
        </label>
        <label style={{ marginLeft: "16px" }}>
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New pilot
        </label>
        <label style={{ marginLeft: "16px" }}>
          <input type="radio" checked={mode === "all"} onChange={() => setMode("all")} /> All pilots in roster
        </label>
        <label style={{ marginLeft: "16px" }}>
          <input type="radio" checked={mode === "detect"} onChange={() => { setMode("detect"); setPreview(null); setDetections(null); setMsg(null); }} /> Detect pattern (all pilots)
        </label>
      </div>

      {mode !== "detect" && (
      <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
        <label>Pattern</label>
        {Object.entries(ROSTER_PATTERNS).map(([key, def]) => (
          <label key={key} style={{ marginLeft: "10px" }}>
            <input type="radio" checked={patternKey === key} onChange={() => setPatternKey(key)} /> {def.label}
          </label>
        ))}
        <label style={{ marginLeft: "10px" }}>
          <input type="radio" checked={patternKey === "custom"} onChange={() => setPatternKey("custom")} /> Custom
        </label>
        {patternKey === "custom" && (
          <>
            <input
              type="number" min="1" value={customDutyDays}
              onChange={(e) => setCustomDutyDays(e.target.value)}
              style={{ width: "60px", marginLeft: "10px" }} title="Duty days"
            />
            <span style={{ margin: "0 4px", color: "#94a3b8" }}>duty /</span>
            <input
              type="number" min="0" value={customOffDays}
              onChange={(e) => setCustomOffDays(e.target.value)}
              style={{ width: "60px" }} title="Off days"
            />
            <span style={{ margin: "0 0 0 4px", color: "#94a3b8" }}>off</span>
          </>
        )}
      </div>
      )}

      {mode === "existing" && (
        <div className="roster-import-row">
          <label>Pilot</label>
          <select value={selectedCode} onChange={(e) => setSelectedCode(e.target.value)}>
            {pilots.length === 0 && <option value="">-- no pilots in the roster yet --</option>}
            {pilots.map((p) => (
              <option key={p.pilotCode} value={p.pilotCode}>{p.pilotCode} — {p.pilotName || "(no name)"}</option>
            ))}
          </select>
        </div>
      )}

      {mode === "new" && (
        <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
          <label>Code</label>
          <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. WJU" style={{ width: "90px" }} />
          <label>Name</label>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" />
          <label>Base</label>
          <input value={newBase} onChange={(e) => setNewBase(e.target.value)} placeholder="e.g. SKL" style={{ width: "90px" }} />
        </div>
      )}

      {mode === "all" && (
        <p className="roster-note" style={{ margin: "0 0 4px" }}>
          Continues every one of the {pilots.length} pilot(s) currently in the roster from their own last known day - each keeps their own cycle position. Pilots with no history yet, or already up to date, are listed separately and skipped.
        </p>
      )}

      {mode === "detect" && (
        <p className="roster-note" style={{ margin: "0 0 4px" }}>
          Works out which pattern (21/7, 20/10, 5/2, or "custom") each of the {pilots.length} pilot(s) is actually on, scanning each pilot's own roster roughly 3 months back and 3 months forward from today. Review the detected pattern for each pilot below, then confirm before anything is written — confirming OVERWRITES every day in the range with the pattern, replacing whatever was there before (unlike the other three modes, which always leave existing days untouched).
        </p>
      )}

      {mode !== "detect" && (
      <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
        {mode !== "all" && (
          <>
            <label>Start date (Duty day 1)</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </>
        )}
        <label>Through</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        {mode !== "all" && (
          <button className="primary" onClick={handlePreview} disabled={busy}>Preview</button>
        )}
        {mode === "existing" && (
          <button onClick={handleContinue} disabled={busy || !selectedPilot} title="Auto-detects this pilot's cycle position from their existing schedule and fills forward - no Start date needed. Set Through to a future year (e.g. 2028-12-31) to cover multiple years in one click.">
            Continue from last entry →
          </button>
        )}
        {mode === "existing" && (
          <button
            className="roster-danger-btn"
            onClick={handleClear}
            disabled={busy || !selectedPilot || !startDate || !endDate}
            title="Clears this pilot's roster between Start and Through - every code in the range, not only the pattern. Always asks to confirm first."
          >
            Clear this range
          </button>
        )}
        {mode === "all" && (
          <button className="primary" onClick={handleContinueAll} disabled={busy || pilots.length === 0} title="Continues every pilot in the roster from their own last known day - each keeps their own cycle position.">
            Continue ALL pilots →
          </button>
        )}
      </div>
      )}

      {mode === "detect" && !detections && (
        <div className="roster-import-row">
          <button className="primary" onClick={handleDetectAll} disabled={busy || pilots.length === 0}>
            {busy ? "Detecting..." : "Detect pattern for every pilot"}
          </button>
        </div>
      )}

      {mode === "detect" && detections && (
        <div className="roster-detect-list">
          <div className="roster-import-row" style={{ flexWrap: "wrap" }}>
            <label>Apply through</label>
            <input type="date" value={detectThrough} onChange={(e) => setDetectThrough(e.target.value)} />
            <button onClick={handleDetectAll} disabled={busy}>Re-detect</button>
          </div>
          <table className="roster-detect-table">
            <thead>
              <tr>
                <th></th>
                <th>Pilot</th>
                <th>Detected pattern</th>
                <th>Confidence</th>
                <th>First day of this cycle</th>
              </tr>
            </thead>
            <tbody>
              {detections.map((d, i) => (
                <tr key={d.pilotCode} className={!d.result ? "roster-detect-nodata" : d.result.patternKey === "custom" ? "roster-detect-custom" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={d.accepted}
                      disabled={!d.result}
                      onChange={(e) => setDetections((prev) => prev.map((row, ri) => (ri === i ? { ...row, accepted: e.target.checked } : row)))}
                    />
                  </td>
                  <td>{d.pilotCode} — {d.pilotName || "(no name)"}</td>
                  <td>
                    {!d.result
                      ? "no data to detect from"
                      : d.result.patternKey === "custom"
                        ? `custom (observed ~${d.result.observed?.dutyDays ?? "?"} duty / ${d.result.observed?.offDays ?? "?"} off)`
                        : ROSTER_PATTERNS[d.result.patternKey]?.label || d.result.patternKey}
                  </td>
                  <td>{d.result?.confidence != null ? `${Math.round(d.result.confidence * 100)}%` : "—"}</td>
                  <td>{d.result?.anchorDate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="roster-note" style={{ margin: "10px 0" }}>
            Un-ticked pilots (including every "custom" result, which starts un-ticked) are left alone. Tick a pilot to include them, or untick one you don't want touched — nothing is written until you confirm below.
          </p>
          <div className="roster-import-row">
            <button className="primary" onClick={handleConfirmDetections} disabled={busy}>
              Review pilots to apply →
            </button>
            <button onClick={() => { setDetections(null); setMsg(null); }} disabled={busy}>Start over</button>
          </div>
        </div>
      )}

      {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {preview && (
        <div className="roster-preview">
          <h2>
            {totalEntries} day(s) will be written
            {preview.groups.length > 1 ? ` across ${preview.groups.length} pilot(s)` : ` for ${preview.groups[0].target.pilotCode}`}
          </h2>

          {preview.overwrite && (
            <p style={{ margin: "0 0 10px", color: "#fbbf24", fontSize: "12.5px", fontWeight: 700 }}>
              ⚠ This OVERWRITES every day in range for these pilots with the confirmed pattern - whatever code is currently sitting on each of those dates (including hand-typed entries, leave, or training) is replaced. This does not merge or skip existing days, unlike the other modes.
            </p>
          )}

          {preview.overwrite && (
            <div className="roster-preview-list">
              {preview.groups.map((g) => (
                <span
                  key={g.target.pilotCode}
                  className="roster-chip"
                  title={`Pattern: ${g.detectedPattern}, from ${g.fromDate}${g.confidence != null ? `, confidence: ${Math.round(g.confidence * 100)}%` : ""}`}
                >
                  {g.target.pilotCode} {g.detectedPattern} +{g.entries.length}d
                </span>
              ))}
            </div>
          )}

          {!preview.overwrite && preview.groups.length === 1 && preview.groups[0].continued && (
            <p style={{ margin: "0 0 6px", color: "#7dd3fc", fontSize: "12.5px" }}>
              Continuing automatically from {preview.groups[0].fromDate} (cycle position matched at {Math.round((preview.groups[0].confidence || 0) * 100)}% confidence
              {preview.groups[0].confidence < 0.8 ? " - low confidence, double-check the first few generated days before confirming" : ""}).
            </p>
          )}

          {!preview.overwrite && preview.groups.length > 1 && (
            <div className="roster-preview-list">
              {preview.groups.map((g) => (
                <span
                  key={g.target.pilotCode}
                  className="roster-chip"
                  title={g.confidence != null ? `From ${g.fromDate}, cycle match confidence: ${Math.round(g.confidence * 100)}%` : ""}
                >
                  {g.target.pilotCode} +{g.entries.length}d
                </span>
              ))}
            </div>
          )}

          {preview.skippedPilots.length > 0 && (
            <p style={{ margin: "0 0 10px", color: "#94a3b8", fontSize: "12px" }}>
              Skipped {preview.skippedPilots.length} pilot(s): {preview.skippedPilots.map((s) => `${s.pilotCode} (${SKIP_REASON_LABEL[s.reason] || s.reason})`).join(", ")}
            </p>
          )}

          {!preview.overwrite && (
            <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: "12.5px" }}>
              {preview.groups.some((g) => g.skipped > 0)
                ? `${preview.groups.reduce((s, g) => s + (g.skipped || 0), 0)} day(s) across these pilot(s) already have data and will be left untouched.`
                : "No existing days in range for these pilot(s) - nothing will be skipped."}
            </p>
          )}

          <div className="roster-preview-actions">
            <button className={preview.overwrite ? "roster-danger-btn" : "primary"} onClick={handleConfirm} disabled={busy}>
              {busy ? "Generating..." : preview.overwrite ? `Overwrite ${totalEntries} day(s)` : `Generate ${totalEntries} day(s)`}
            </button>
            <button onClick={() => setPreview(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
