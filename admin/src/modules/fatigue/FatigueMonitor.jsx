import { useEffect, useMemo, useState } from "react";
import { loadAllPilotStatusRows } from "../../utils/statusCompute.js";
import { buildDutyPeriods, periodDutyCreditHours } from "../../utils/dutyPeriods.js";
import {
  pilotWeeklyFatigue, isoAddDays, TOTAL_INDEX_BANDS,
  TOTAL_INDEX_MAX, FATIGUE_VALUE_DIVISOR
} from "../../utils/fatigueMonitor.js";
import { todayIso } from "../../utils/dateKeys.js";
import { getSetting } from "../../services/desktopDatabase.js";
import { FATIGUE_CRITERIA_KEY, isModified, modifiedSections } from "../../utils/fatigueCriteria.js";
import "./FatigueMonitor.css";

// Fatique Weekly Monitor - OPS-CM-01 §7.17.3.2.
//
// Laid out to match the company's own printout (fatigue.pdf) column for column,
// deliberately: the Crew Scheduler and FOO read that sheet every morning, and
// the whole value of this page is that they don't have to learn a new one.
//
//   No. | NAME | CODE | DT(1xW)60 | <7 day columns> | Total 7 Days (29/34)
//       | Fatique Value (154) | DT(1xW) INDEX (0.0-2.50)
//       | Fatique Index (0.0-1.00) | TOTAL INDEX (3.5)
//
// Split into Captain and Co-Pilot blocks, each numbered from 1, same as the
// original. Every figure is computed in src/utils/fatigueMonitor.js, whose
// constants were verified by reproducing all 14 rows of the 28 Jul 2026
// printout exactly - see docs/FATIGUE-MONITOR.md.

const WINDOW_DAYS = 7;

// The weekly duty-hours column heading on the original reads "(29/34)" - the
// oil & gas / CAAT thresholds for the 7-day total. Kept as the caption rather
// than turned into a rule here, because they are FDT limits, already enforced
// by FDT Monitor, not fatigue-index inputs.
const WEEK_DUTY_CAPTION = "29/34";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "28-Jul", the format the printout uses for its day columns.
//
// Joined with a NON-BREAKING hyphen (U+2011), not a plain "-". A plain hyphen is
// a legal line-break opportunity, so in a narrow column the heading rendered as
// "28-" above "Jul" - unreadable at a glance, which is the whole job of a date
// column. CSS alone did not reliably stop it across renderers; removing the
// break opportunity does.
function dayLabel(iso) {
  const [, m, d] = String(iso).split("-").map(Number);
  return `${d}‑${MONTHS[(m || 1) - 1]}`;
}

function longDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}

// Duty hours as "H:MM", matching the printout - which shows 0:00, not a blank,
// for a day with no duty.
function hhmm(hours) {
  const total = Math.round((Number(hours) || 0) * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// "Today" comes from utils/dateKeys.js, which returns a LOCAL calendar date.
//
// NOT toISOString(): east of Greenwich that returns the previous UTC day for
// most of the morning. In Asia/Bangkok at 05:44 it gives the 28th when it is
// already the 29th - the page would open on yesterday and shift the whole
// 7-day window by a day, which is the same class of bug that made DT 7D
// disagree with All Status.

// "Captain" / "Capt/PICUS" -> captain; everything else co-pilot. Unknown rank
// goes to co-pilot rather than being dropped, so a pilot never silently
// vanishes from a fatigue report because their profile is incomplete.
function isCaptainRank(position) {
  return /capt/i.test(String(position || ""));
}

export default function FatigueMonitor() {
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [fullScreen, setFullScreen] = useState(false);
  // null = use the approved OPS-CM-01 figures (what the engine defaults to).
  const [criteria, setCriteria] = useState(null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) { if (e.key === "Escape") setFullScreen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // listExperience() (inside loadAllPilotStatusRows) already carries each
      // pilot's rank, so there is no second call to make for it.
      const [{ rows: loaded, limits: lim }, savedCriteria] = await Promise.all([
        loadAllPilotStatusRows(),
        getSetting(FATIGUE_CRITERIA_KEY).catch(() => null)
      ]);
      setRows(loaded);
      setLimits(lim);
      setCriteria(savedCriteria || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Newest day first, as on the printout.
  const dates = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => isoAddDays(asOf, -i)),
    [asOf]
  );

  const { captains, coPilots } = useMemo(() => {
    const built = rows.map((r) => {
      // The whole row comes from the shared helper, which the Crew dashboard
      // also uses - so a pilot's own figure and the one the Chief Pilot sees
      // are the same number by construction, not by two implementations
      // happening to agree.
      //
      // dt7d is the pilot's already-computed 7-day duty total: withinDays(7)
      // counts back from a midnight-local cutoff, which is NOT the same as
      // summing the seven date columns. All Status showed 6 days where this
      // page showed 7, and KPO read 35:18 against 32:18 for the same week.
      const week = pilotWeeklyFatigue({
        entries: r.entries,
        limits,
        asOfIso: asOf,
        dt7d: r.stats?.dt7d,
        buildDutyPeriods,
        periodDutyCreditHours,
        criteria
      });
      return {
        code: r.pilot.code,
        name: r.pilot.name,
        position: r.pilot.position || r.pilot.profile?.position || "",
        ...week
      };
    });
    // Worst first within each block - the printout is sorted this way too (it
    // has "Sort Captain" / "Sort CoPilot" macro buttons for exactly this).
    const byIndex = (a, b) => b.total - a.total || (a.name || "").localeCompare(b.name || "");
    return {
      captains: built.filter((p) => isCaptainRank(p.position)).sort(byIndex),
      coPilots: built.filter((p) => !isCaptainRank(p.position)).sort(byIndex)
    };
  }, [rows, limits, dates, asOf, criteria]);

  // True only when the saved criteria differ from OPS-CM-01. Drives the banner
  // below: a figure computed from unapproved criteria must never be mistaken
  // for the approved one, least of all on the screen the CAAT return is read
  // from.
  const criteriaChanged = useMemo(() => isModified(criteria), [criteria]);
  const criteriaChangedSections = useMemo(() => modifiedSections(criteria), [criteria]);

  const flagged = [...captains, ...coPilots].filter((p) => p.band);

  function renderBlock(title, list, startAt = 1) {
    return (
      <>
        <tr className="fatigue-group">
          <td colSpan={dates.length + 8}>{title}</td>
        </tr>
        {list.length === 0 && (
          <tr><td colSpan={dates.length + 8} className="fatigue-empty">No pilots</td></tr>
        )}
        {list.map((p, i) => (
          <tr key={p.code}>
            <td className="fatigue-no">{startAt + i}</td>
            <td className="fatigue-name-col">{p.name || "-"}</td>
            <td className="fatigue-code">{p.code}</td>
            <td className="fatigue-dt">{hhmm(p.weeklyDutyHours)}</td>
            {/* Day cells show FLIGHT time - they sum to Total 7 Days. The
                duty figure for the day is in the tooltip, where it explains
                the score, rather than competing with it in the cell. */}
            {p.perDay.map((d) => (
              <td
                key={d.date}
                className={`fatigue-day${d.flightHours > 0 ? " on" : ""}`}
                title={d.score
                  ? `${p.code} ${d.date}\n` +
                    `Flight time ${hhmm(d.flightHours)} · Duty ${hhmm(d.dutyHours)}\n` +
                    `Flight Duty Time ${d.score.dutyHours.toFixed(1)}h → ${d.score.flightDutyTimePoints}\n` +
                    `Crew ${d.score.crew ?? "?"} (dep ${d.score.departure || "?"}) → ${d.score.crewsPoints}\n` +
                    `Sectors ${d.score.sectors} → ${d.score.sectorsPoints}\n` +
                    `Flights ${d.score.flights} → ${d.score.flightsPoints}\n` +
                    `Daily score ${d.score.total}`
                  : `${p.code} ${d.date} — no flight duty logged`}
              >
                {hhmm(d.flightHours)}
              </td>
            ))}
            <td className="fatigue-total7">{hhmm(p.weeklyFlightHours)}</td>
            <td className="fatigue-value">{p.fatigueValue}</td>
            <td className="fatigue-idx">{p.dutyIndex.toFixed(2)}</td>
            <td className="fatigue-idx">{p.fatigueIndex.toFixed(2)}</td>
            <td
              className={`fatigue-index-total${p.band ? " " + p.band.key : ""}`}
              title={p.band ? `${p.band.label}\n${p.band.detail}` : undefined}
            >
              {p.total.toFixed(1)}
            </td>
          </tr>
        ))}
      </>
    );
  }

  return (
    <div className={`fatigue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Fatigue Weekly Monitor</h1>
          <p>
            OPS-CM-01 §7.17.3.2 — Crew Scheduler / FOO. TOTAL INDEX =
            DT&nbsp;(1&times;W)&nbsp;INDEX + Fatique&nbsp;Index, out of {TOTAL_INDEX_MAX}.
          </p>
        </div>
        <div className="fatigue-actions">
          <label>
            As of{" "}
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value || todayIso())} />
          </label>
          {/* Per-page Refresh removed - the sidebar's single Refresh (full
              page reload) now covers this. load() itself stays, still
              called elsewhere (initial load, when "As of" date changes). */}
          <button onClick={() => window.print()}>Print / Save PDF</button>
          <button onClick={() => setFullScreen((v) => !v)}>
            {fullScreen ? "Exit Full Screen" : "Full Screen"}
          </button>
        </div>
      </div>

      {/* NOT no-print: if a page computed from unapproved criteria is printed
          and handed to the CAAT, the printout has to say so too. */}
      {criteriaChanged && (
        <div className="fatigue-criteria-warn">
          ⚠ <b>Computed with modified criteria</b> — {criteriaChangedSections.join(", ")} differ
          from OPS-CM-01 §7.17.3. These figures are <b>not</b> the approved calculation.
          Settings → Fatigue Criteria → “Reset to OPS-CM-01” restores it.
        </div>
      )}

      {loading && <div className="fatigue-empty">Loading…</div>}
      {!loading && error && (
        <>
          <div className="fatigue-empty">Could not load: {error}</div>
          <button onClick={load}>Try Again</button>
        </>
      )}

      {!loading && !error && (
        <div className="fatigue-sheet">
          <div className="fatigue-sheet-head">
            <span className="fatigue-asof">{longDate(asOf)}</span>
            <span className="fatigue-sheet-title">Fatique Weekly Monitor (Crew Scheduler / FOO)</span>
          </div>

          <div className="fatigue-scroll">
            <table className="fatigue-table">
              <thead>
                {/* One header row. The year used to sit in a second row under
                    each day column; it was removed on instruction - the sheet
                    is already dated at the top, so repeating "2026" seven times
                    only cost a line of height. */}
                <tr>
                  <th className="fatigue-no">No.</th>
                  <th className="fatigue-name-col">NAME</th>
                  <th className="fatigue-code">CODE</th>
                  <th className="fatigue-dt">DT<small>(1xW) 60</small></th>
                  {dates.map((d) => (
                    <th key={d} className="fatigue-day">{dayLabel(d)}</th>
                  ))}
                  <th className="fatigue-total7">Total 7 Days<small>({WEEK_DUTY_CAPTION})</small></th>
                  <th className="fatigue-value">Fatique Value<small>({FATIGUE_VALUE_DIVISOR})</small></th>
                  <th className="fatigue-idx">DT (1xW) INDEX<small>(0.0-2.50)</small></th>
                  <th className="fatigue-idx">Fatique Index<small>(0.0-1.00)</small></th>
                  <th className="fatigue-index-total">TOTAL INDEX<small>({TOTAL_INDEX_MAX})</small></th>
                </tr>
              </thead>
              <tbody>
                {renderBlock("Captain", captains)}
                {renderBlock("Co-Pilot", coPilots)}
              </tbody>
            </table>
          </div>

          {/* The action legend from the foot of the company's sheet, reproduced
              verbatim - at 3.0 a recovery rest is required, not suggested. */}
          <table className="fatigue-legend">
            <tbody>
              <tr>
                <td rowSpan={TOTAL_INDEX_BANDS.length} className="fatigue-legend-title">
                  TOTAL INDEX ({TOTAL_INDEX_MAX})
                </td>
                <td className="fatigue-legend-band monitor">2.5-2.99</td>
                <td className="fatigue-legend-text">Closely Monitor</td>
              </tr>
              <tr>
                <td className="fatigue-legend-band rest">3.0-3.5</td>
                <td className="fatigue-legend-text">
                  The flight crew member shall be provided with a minimum recovery rest
                  period of 36 hours, including 2 local nights.
                </td>
              </tr>
            </tbody>
          </table>

          {flagged.length > 0 && (
            <div className="fatigue-flagged no-print">
              <b>Needs action:</b>{" "}
              {flagged.map((p) => `${p.code} ${p.total.toFixed(1)} (${p.band.label})`).join(" · ")}
            </div>
          )}

          <p className="fatigue-note no-print">
            Hover a day to see how its daily score was made up, or the TOTAL INDEX for
            the required action. Duty hours come from Daily Duty entries — a day not yet
            entered reads 0:00 and cannot be scored.
          </p>
        </div>
      )}
    </div>
  );
}
