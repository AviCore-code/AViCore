import { useEffect, useMemo, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import {
  FATIGUE_CRITERIA_KEY, FATIGUE_CRITERIA_LOG_KEY, OPS_CM_01,
  defaultCriteria, cloneCriteria, validateCriteria, isModified, modifiedSections,
  describeCriteriaChange
} from "../../utils/fatigueCriteria.js";
import { todayIso } from "../../utils/dateKeys.js";
import "./Settings.css";

// Editor for the Fatigue Monitor's scoring criteria.
//
// Capt. Weera asked for these to be adjustable, and agreed they should be
// adjustable UNDER CONTROL. This screen is that control, and it exists because
// of one specific risk: the figures these criteria produce are submitted to the
// CAAT every three months (OPS-CM-01 §7.17.3.2). An untracked edit would mean a
// regulatory return nobody can reproduce or explain.
//
// So the screen does four things beyond editing:
//   - states plainly what these numbers feed;
//   - refuses to save anything that fails validation (a blank threshold would
//     score every duty 0, i.e. show a tired crew as rested);
//   - restores the approved OPS-CM-01 values on one press;
//   - writes an audit entry on every save - who, when, and what changed.
//
// This tab lives only in the Admin build. The Crew app has its own Settings
// (web/CrewSettings.jsx) and never reaches here.

export default function FatigueCriteriaTab() {
  const [criteria, setCriteria] = useState(defaultCriteria());
  const [log, setLog] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [saved, savedLog] = await Promise.all([
        getSetting(FATIGUE_CRITERIA_KEY).catch(() => null),
        getSetting(FATIGUE_CRITERIA_LOG_KEY).catch(() => null)
      ]);
      setCriteria(saved ? cloneCriteria(saved) : defaultCriteria());
      setLog(Array.isArray(savedLog) ? savedLog : []);
    } finally {
      setLoading(false);
    }
  }

  const validation = useMemo(() => validateCriteria(criteria), [criteria]);
  const changed = useMemo(() => isModified(criteria), [criteria]);
  const changedSections = useMemo(() => modifiedSections(criteria), [criteria]);

  // Which minutes of the day no non-wrapping band claims, and which are claimed
  // twice. Computed minute by minute rather than by comparing endpoints,
  // because the bands are inclusive and one wraps midnight - endpoint
  // arithmetic is exactly where that goes wrong.
  const crewCoverage = useMemo(() => {
    const bands = criteria?.crews || [];
    const wrapBand = bands.find((b) => b.wraps) || null;
    const owners = new Array(1440).fill(0);

    for (const b of bands) {
      const from = hhmmToMin(b.from), to = hhmmToMin(b.to);
      if (from == null || to == null) continue;
      if (b.wraps || from > to) {
        // Crosses midnight: covers from..23:59 AND 00:00..to. Counted here so
        // the approved setup (night band 22:30-06:59) reports NO gap - a
        // warning that fires on a correct configuration is one people learn to
        // ignore, which would hide a real gap later.
        for (let m = from; m < 1440; m++) owners[m]++;
        for (let m = 0; m <= to; m++) owners[m]++;
      } else {
        for (let m = from; m <= to; m++) owners[m]++;
      }
    }
    return {
      hasWrap: !!wrapBand,
      gaps: runsOf(owners, (n) => n === 0),
      overlaps: runsOf(owners, (n) => n > 1)
    };
  }, [criteria]);

  // Edits go through one setter so every change re-runs validation.
  function edit(mutate) {
    setMsg(null);
    setCriteria((prev) => {
      const next = cloneCriteria(prev);
      mutate(next);
      return next;
    });
  }

  async function handleSave() {
    const v = validateCriteria(criteria);
    if (!v.ok) {
      setMsg({ ok: false, text: `Cannot save — ${v.errors.length} problem(s) below.` });
      return;
    }
    setBusy(true);
    try {
      const before = (await getSetting(FATIGUE_CRITERIA_KEY).catch(() => null)) || OPS_CM_01;
      await saveSetting(FATIGUE_CRITERIA_KEY, criteria);

      // Audit entry. Kept even when the values return to the manual's, because
      // "changed back to approved on 29 Jul" is itself something a regulator
      // may ask about.
      const entry = {
        at: new Date().toISOString(),
        date: todayIso(),
        summary: describeCriteriaChange(before, criteria),
        matchesManual: !isModified(criteria)
      };
      const nextLog = [entry, ...(log || [])].slice(0, 200);
      await saveSetting(FATIGUE_CRITERIA_LOG_KEY, nextLog);
      setLog(nextLog);
      setMsg({ ok: true, text: "Saved. The Fatigue Monitor will use these criteria from its next refresh." });
    } catch (err) {
      setMsg({ ok: false, text: "Could not save: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!confirm(
      "Restore the approved OPS-CM-01 §7.17.3 criteria?\n\n" +
      "This replaces every value on this page with the figures from the manual."
    )) return;
    setCriteria(defaultCriteria());
    setMsg({ ok: true, text: "Approved values restored on screen — press Save to apply them." });
  }

  if (loading) return <div className="settings-section">Loading fatigue criteria…</div>;

  return (
    <div className="fatcrit">
      <div className="settings-section">
        <h2>Fatigue Criteria</h2>

        {/* Deliberately the first thing on the page. Anyone editing these needs
            to know what they feed before they touch a number. */}
        <div className="fatcrit-warn">
          <b>These are the criteria approved in OPS-CM-01 §7.17.3.</b> The scores they
          produce are submitted to the CAAT every three months (§7.17.3.2). Changing
          them changes what is reported to the regulator, and changes past figures when
          a report is re-run. Every save is recorded below.
        </div>

        {changed && (
          <div className="fatcrit-modified">
            ⚠ <b>Not the approved values.</b> Changed: {changedSections.join(", ")}.
            The Fatigue Monitor shows a warning while this is the case.
          </div>
        )}

        <div className="fatcrit-actions">
          <button className="primary" onClick={handleSave} disabled={busy || !validation.ok}>
            {busy ? "Saving…" : "Save criteria"}
          </button>
          <button onClick={handleReset} disabled={busy}>Reset to OPS-CM-01</button>
          {!validation.ok && <span className="fatcrit-invalid">{validation.errors.length} problem(s) — see below</span>}
        </div>

        {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

        {!validation.ok && (
          <ul className="fatcrit-errors">
            {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>

      {/* 1. Flight Duty Time -------------------------------------------- */}
      <Scale
        title="1. Flight Duty Time → points"
        note="Duty hours for the day. The first row whose threshold is met wins, so rows run highest to lowest. Max 6 points."
        rows={criteria.dutyTime}
        unit="hours"
        onChange={(i, field, value) => edit((c) => { c.dutyTime[i][field] = value; })}
        onAdd={() => edit((c) => c.dutyTime.push({ atLeast: 0, points: 0 }))}
        onRemove={(i) => edit((c) => c.dutyTime.splice(i, 1))}
      />

      {/* 2. Crews ------------------------------------------------------- */}
      <div className="settings-section">
        <h3>2. Crew Number → points (by departure time)</h3>
        <p className="settings-note">
          The Crew is decided by the day's <b>first scheduled departure</b>. Bands are
          inclusive. Exactly one band may cross midnight — that is the night band, and it
          also acts as the catch-all so no departure can go unscored.
        </p>
        <table className="fatcrit-table">
          <thead>
            <tr><th>Crew</th><th>From</th><th>To</th><th>Points</th><th>Crosses midnight</th><th>Reads as</th><th /></tr>
          </thead>
          <tbody>
            {criteria.crews.map((b, i) => (
              <tr key={i}>
                <td><input className="fatcrit-n" value={b.crew}
                  onChange={(e) => edit((c) => { c.crews[i].crew = e.target.value; })} /></td>
                <td><input className="fatcrit-t" value={b.from} placeholder="HH:MM"
                  onChange={(e) => edit((c) => { c.crews[i].from = e.target.value; })} /></td>
                <td><input className="fatcrit-t" value={b.to} placeholder="HH:MM"
                  onChange={(e) => edit((c) => { c.crews[i].to = e.target.value; })} /></td>
                <td><input className="fatcrit-n" value={b.points}
                  onChange={(e) => edit((c) => { c.crews[i].points = e.target.value; })} /></td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={!!b.wraps}
                    onChange={(e) => edit((c) => { c.crews[i].wraps = e.target.checked; })} />
                </td>
                <td className="fatcrit-reads">
                  Crew {b.crew} · {b.from}–{b.to}
                  {b.wraps ? " (through midnight)" : ""} → {b.points} point{Number(b.points) === 1 ? "" : "s"}
                </td>
                <td><button className="fatcrit-del" onClick={() => edit((c) => c.crews.splice(i, 1))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => edit((c) => c.crews.push({ crew: c.crews.length + 1, points: 0, from: "00:00", to: "00:00" }))}>
          + Add band
        </button>

        {/* Coverage check. The bands are the ONLY thing standing between a
            departure time and a score, and a gap does not error - it silently
            scores 0, which reads as "not fatiguing". Since the night band is
            the catch-all, a gap usually means night points are being applied to
            a daytime departure. Either way it must be visible. */}
        {crewCoverage.gaps.length > 0 && (
          <div className="fatcrit-modified" style={{ marginTop: 10 }}>
            ⚠ <b>Times not covered by any band:</b> {crewCoverage.gaps.join(", ")}.
            {crewCoverage.hasWrap
              ? " These fall through to the midnight-crossing band, so they score its points."
              : " These would score 0 — add a band, or mark one as crossing midnight to catch them."}
          </div>
        )}
        {crewCoverage.overlaps.length > 0 && (
          <div className="fatcrit-modified" style={{ marginTop: 10 }}>
            ⚠ <b>Overlapping bands:</b> {crewCoverage.overlaps.join(", ")}. The first
            matching band in this list wins, so the later one never applies.
          </div>
        )}
      </div>

      {/* 3. Sectors ----------------------------------------------------- */}
      <Scale
        title="3. Sector / Landing → points"
        note="Sectors are counted from the hyphens in the route and summed across every flight that day. Max 6 points."
        rows={criteria.sectors}
        unit="sectors"
        whole
        onChange={(i, field, value) => edit((c) => { c.sectors[i][field] = value; })}
        onAdd={() => edit((c) => c.sectors.push({ atLeast: 0, points: 0 }))}
        onRemove={(i) => edit((c) => c.sectors.splice(i, 1))}
      />

      {/* 4. Flights per Day --------------------------------------------- */}
      <div className="settings-section">
        <h3>4. Flights per Day → points</h3>
        <p className="settings-note">
          An <b>exact match</b>, not a scale: the manual's table scores 3 flights as 4
          points, and a flight count not listed here scores 0. That is how the company
          workbook computes it.
        </p>
        <table className="fatcrit-table">
          <thead><tr><th>Flights</th><th>Points</th><th /></tr></thead>
          <tbody>
            {Object.entries(criteria.flightsPerDay).map(([flights, pts]) => (
              <tr key={flights}>
                <td>{flights}</td>
                <td><input className="fatcrit-n" value={pts}
                  onChange={(e) => edit((c) => { c.flightsPerDay[flights] = e.target.value; })} /></td>
                <td><button className="fatcrit-del"
                  onClick={() => edit((c) => { delete c.flightsPerDay[flights]; })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => edit((c) => {
          let n = 1; while (c.flightsPerDay[n] !== undefined) n++;
          c.flightsPerDay[n] = 0;
        })}>+ Add flight count</button>
      </div>

      {/* Limits ---------------------------------------------------------- */}
      <div className="settings-section">
        <h3>Limits</h3>
        <p className="settings-note">
          The weekly duty limit also sets the DT INDEX ceiling ({" "}
          <code>{criteria.limits.weeklyDutyHours} ÷ 24 = {(Number(criteria.limits.weeklyDutyHours) / 24).toFixed(2)}</code>
          ), and the daily limit sets the Fatigue Index divisor ({" "}
          <code>{criteria.limits.daily} × 7 = {Number(criteria.limits.daily) * 7}</code>
          ). TOTAL INDEX maximum ={" "}
          <b>{((Number(criteria.limits.weeklyDutyHours) / 24) + 1).toFixed(2)}</b>.
        </p>
        <div className="fatcrit-limits">
          <label>One day must stay under
            <input className="fatcrit-n" value={criteria.limits.daily}
              onChange={(e) => edit((c) => { c.limits.daily = e.target.value; })} /> points
          </label>
          <label>Two consecutive days under
            <input className="fatcrit-n" value={criteria.limits.twoDay}
              onChange={(e) => edit((c) => { c.limits.twoDay = e.target.value; })} /> points
          </label>
          <label>Duty time, 1 week
            <input className="fatcrit-n" value={criteria.limits.weeklyDutyHours}
              onChange={(e) => edit((c) => { c.limits.weeklyDutyHours = e.target.value; })} /> hours
          </label>
        </div>
        <p className="settings-note" style={{ marginTop: 10 }}>
          The action bands (Closely Monitor at 2.50, Recovery Rest at 3.00) are
          <b> not</b> rescaled when these limits change. They are regulatory actions from
          the manual, not points on a curve — moving them would be writing a rule
          OPS-CM-01 does not contain.
        </p>
      </div>

      {/* Audit log -------------------------------------------------------- */}
      <div className="settings-section">
        <h3>Change history</h3>
        {log.length === 0 && <p className="settings-note">No changes recorded — the approved criteria are in use.</p>}
        {log.length > 0 && (
          <table className="fatcrit-table">
            <thead><tr><th>When</th><th>Change</th><th>Matches manual</th></tr></thead>
            <tbody>
              {log.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.at).toLocaleString()}</td>
                  <td>{e.summary}</td>
                  <td>{e.matchesManual ? "Yes" : "No — custom"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Shared editor for the two descending point scales (Flight Duty Time,
// Sectors). Both behave identically, so they share one component rather than
// two copies that could drift.
// `whole` = the quantity only ever takes whole numbers (sectors), so the
// "reads as" column says "9 - 10" rather than the arithmetically-correct but
// nonsensical "9 - 10.99 sectors".
function Scale({ title, note, rows, unit, onChange, onAdd, onRemove, whole = false }) {
  return (
    <div className="settings-section">
      <h3>{title}</h3>
      <p className="settings-note">{note}</p>
      <table className="fatcrit-table">
        <thead><tr><th>At least ({unit})</th><th>Points</th><th>Reads as</th><th /></tr></thead>
        <tbody>
          {(rows || []).map((r, i) => (
            <tr key={i}>
              <td><input className="fatcrit-n" value={r.atLeast}
                onChange={(e) => onChange(i, "atLeast", e.target.value)} /></td>
              <td><input className="fatcrit-n" value={r.points}
                onChange={(e) => onChange(i, "points", e.target.value)} /></td>
              {/* Plain-language echo of the row. The lowest band is stored as
                  0.0001 - the way "any duty at all" is expressed on a >= scale -
                  which on screen looks like a typo. Showing what the row MEANS
                  stops someone "tidying" that value and changing the scoring. */}
              <td className="fatcrit-reads">{describeBand(r, rows[i - 1], unit, whole)}</td>
              <td><button className="fatcrit-del" onClick={() => onRemove(i)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={onAdd}>+ Add band</button>
    </div>
  );
}

// "5 - 5.99 hours -> 4 points", or "more than 0" for the fractional floor.
function describeBand(row, rowAbove, unit, whole = false) {
  const at = Number(row?.atLeast);
  const pts = Number(row?.points);
  if (!Number.isFinite(at) || !Number.isFinite(pts)) return "—";
  const upper = rowAbove ? Number(rowAbove.atLeast) : null;

  let range;
  if (at > 0 && at < 1) range = `more than 0`;
  else if (upper == null || !Number.isFinite(upper)) range = `${trim(at)} or more`;
  else if (upper - at === 1) range = `${trim(at)}`;
  else range = `${trim(at)} – ${trim(whole ? upper - 1 : upper - 0.01)}`;

  return `${range} ${unit} → ${pts} point${pts === 1 ? "" : "s"}`;
}

function trim(n) {
  return Number(Number(n).toFixed(2)).toString();
}

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function minToHhmm(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Collapse a per-minute array into human-readable ranges ("09:01–22:29"),
// so a gap is reported as one span rather than 800 separate minutes.
function runsOf(arr, matches) {
  const out = [];
  let start = null;
  for (let m = 0; m < arr.length; m++) {
    if (matches(arr[m])) {
      if (start == null) start = m;
    } else if (start != null) {
      out.push(`${minToHhmm(start)}–${minToHhmm(m - 1)}`);
      start = null;
    }
  }
  if (start != null) out.push(`${minToHhmm(start)}–${minToHhmm(arr.length - 1)}`);
  return out;
}
