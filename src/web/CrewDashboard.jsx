import { useEffect, useMemo, useState } from "react";
import {
  listExperience, listDutyEntriesByPilot, listTraining, listWeeklyPlan,
  getSetting, getPairedPilotCode
} from "../services/webDatabase.js";
import { withFtlDefaults } from "../utils/ftlLimits.js";
import { computeStats, overallStatus, STATUS_LABEL } from "../utils/statusCompute.js";
import { checkRecoveryRest168, buildDutyPeriods, periodDutyCreditHours } from "../utils/dutyPeriods.js";
import { pilotWeeklyFatigue, TOTAL_INDEX_MAX } from "../utils/fatigueMonitor.js";
import { FATIGUE_CRITERIA_KEY } from "../utils/fatigueCriteria.js";
import {
  TRAINING_ITEMS, classifyTrainingValue,
  withTrainingThresholdDefaults, withTrainingDisabledDefaults, monitoredTrainingItems
} from "../utils/trainingDue.js";
import { WEEKLY_SECTIONS, displayTime } from "../modules/pilotRoster/weeklyPlanSections.js";
import { summariseYear, yearsWithRecords, decimalToHm } from "../utils/yearSummary.js";
import { isDemoPilotCode } from "../config/demoUsers.js";
import { demoDutyEntries, demoTrainingRecord, demoWeeklyPlan, DEMO_PROFILE } from "./demoDashboardData.js";
import "./CrewDashboard.css";

// The Crew app's home page: the first thing a pilot sees on opening it.
//
// Ordered by what someone actually needs in the first two seconds, not by
// what is most impressive:
//
//   1. Am I legal?          FDT status, training about to expire
//   2. What am I doing?     this week's lines
//   3. How is my year?      monthly hours - interesting, never urgent
//
// Everything on this page is computed from the SAME functions the detail
// pages use (computeStats for FDT, classifyTrainingValue for training,
// summariseYear for hours), so the summary can never disagree with the page
// it summarises. A dashboard that quietly drifts from its source is worse
// than no dashboard.

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_START_DOW = 2;

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
function weekStartFor(iso) {
  const d = parseIso(iso);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_START_DOW + 7) % 7));
  return toIso(d);
}

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function CrewDashboard() {
  const [me, setMe] = useState("");
  const [pilot, setPilot] = useState(null);
  const [entries, setEntries] = useState([]);
  const [limits, setLimits] = useState(withFtlDefaults(null));
  // null = the approved OPS-CM-01 criteria (the engine's own default).
  const [fatigueCriteria, setFatigueCriteria] = useState(null);
  const [training, setTraining] = useState(null);
  const [weekCells, setWeekCells] = useState([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  // Compare against the previous year as a line overlay - "am I flying more
  // or less than last year" is the question a yearly chart invites, and it
  // cannot be answered by looking at one year at a time.
  const [compare, setCompare] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isDemo, setIsDemo] = useState(false);

  const todayIso = toIso(new Date());
  const currentYear = new Date().getFullYear();
  const weekStart = useMemo(() => weekStartFor(todayIso), [todayIso]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const code = String((await getPairedPilotCode()) || "").toUpperCase();
        if (!alive) return;
        setMe(code);

        // DEMO has no records of its own, so the page would open completely
        // empty - a poor first impression of an app whose point is what it
        // shows. Sample data is used INSTEAD of a query, and only for this
        // one account: a real pilot with an empty dashboard is looking at a
        // fact about their own records, and must keep seeing it.
        if (isDemoPilotCode(code)) {
          const now = new Date();
          setIsDemo(true);
          setPilot(DEMO_PROFILE);
          setLimits(withFtlDefaults(await getSetting("ftl_limits").catch(() => null)));
          setEntries(demoDutyEntries(now));
          setWeekCells(demoWeeklyPlan(weekStart));
          setTraining({
            record: demoTrainingRecord(now),
            thresholds: withTrainingThresholdDefaults(null),
            disabled: withTrainingDisabledDefaults(null)
          });
          setLoading(false);
          return;
        }

        const [pilots, savedLimits, duty, trainingRows, plan, thresholds, disabled, savedCriteria] = await Promise.all([
          listExperience().catch(() => []),
          getSetting("ftl_limits").catch(() => null),
          code ? listDutyEntriesByPilot(code).catch(() => []) : [],
          listTraining().catch(() => []),
          listWeeklyPlan({ from: weekStart, to: addDays(weekStart, 6) }).catch(() => []),
          getSetting("training_thresholds").catch(() => null),
          getSetting("training_disabled_items").catch(() => null),
          // Same scoring criteria the Admin Fatigue Monitor uses. Loaded here
          // too because the pilot's own index and the Chief Pilot's view of it
          // must be the same number - if the criteria were customised and only
          // one screen knew, the two would silently disagree.
          getSetting(FATIGUE_CRITERIA_KEY).catch(() => null)
        ]);
        if (!alive) return;
        setFatigueCriteria(savedCriteria || null);

        setPilot((pilots || []).find((p) => String(p.code).toUpperCase() === code) || null);
        setLimits(withFtlDefaults(savedLimits));
        setEntries(duty || []);
        setWeekCells(plan || []);
        setTraining({
          record: (trainingRows || []).find((t) => String(t.code).toUpperCase() === code)?.record || {},
          thresholds: withTrainingThresholdDefaults(thresholds),
          disabled: withTrainingDisabledDefaults(disabled)
        });
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [weekStart]);

  // --- FDT: the same computation the FDT Monitor page runs ------------------
  const fdt = useMemo(() => {
    if (!entries.length) return { status: "ok", note: "no duty recorded yet" };
    try {
      // overallStatus is the SAME verdict the FDT Monitor and All Status
      // pages show - reimplementing the "worst of" logic here is exactly how
      // a dashboard starts disagreeing with the page it summarises.
      const stats = computeStats(entries, limits);
      const rest = checkRecoveryRest168(entries, limits);
      const status = overallStatus(stats, limits, rest.status);
      const note = status === "ok"
        ? "within every limit"
        : (rest.status !== "ok" && rest.reason) || "check FDT Monitor";
      return { status, note };
    } catch {
      // Never let the home page fail over a computation - it is the first
      // thing seen, and a blank page reads as a broken app.
      return { status: "ok", note: "" };
    }
  }, [entries, limits]);

  // --- Fatigue index (OPS-CM-01 7.17.3.2) ----------------------------------
  // The pilot's own TOTAL INDEX for the last 7 days - the same figure the Chief
  // Pilot sees for them on the Admin Fatigue Monitor. Computed through the
  // shared pilotWeeklyFatigue helper precisely so the two cannot disagree: a
  // crew member who reads "1.7" here and is then told "2.6" would rightly stop
  // trusting both screens.
  const fatigue = useMemo(() => {
    if (!entries.length) return null;
    try {
      const dt7d = computeStats(entries, limits)?.dt7d;
      return pilotWeeklyFatigue({
        entries, limits, dt7d,
        buildDutyPeriods, periodDutyCreditHours,
        criteria: fatigueCriteria
      });
    } catch {
      return null;
    }
  }, [entries, limits, fatigueCriteria]);

  // --- Training due soon ---------------------------------------------------
  const trainingDue = useMemo(() => {
    if (!training) return [];
    const monitored = new Set(monitoredTrainingItems(training.disabled).map((i) => i.key));
    const now = new Date();
    return TRAINING_ITEMS
      .filter((item) => monitored.has(item.key) && item.type !== "count")
      .map((item) => ({ item, result: classifyTrainingValue(item, training.record[item.key], training.thresholds[item.key], now) }))
      .filter(({ result }) => result.daysRemaining != null && result.daysRemaining <= 90)
      .sort((a, b) => a.result.daysRemaining - b.result.daysRemaining)
      .slice(0, 4);
  }, [training]);

  // --- This week's lines ---------------------------------------------------
  const myWeek = useMemo(() => {
    if (!me) return [];
    const byKey = new Map();
    for (const c of weekCells) {
      if (c.pilot_code) byKey.set(`${c.date}|${c.section}|${c.slot}`, String(c.pilot_code).toUpperCase());
    }
    const out = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(weekStart, i);
      for (const section of WEEKLY_SECTIONS) {
        for (let slot = 0; slot < section.slots; slot++) {
          if (byKey.get(`${iso}|${section.key}|${slot}`) !== me) continue;
          const mates = [];
          for (let s = 0; s < section.slots; s++) {
            const other = byKey.get(`${iso}|${section.key}|${s}`);
            if (other && other !== me) mates.push(other);
          }
          out.push({
            iso, today: iso === todayIso,
            day: `${WEEKDAY[parseIso(iso).getDay()]} ${parseIso(iso).getDate()}`,
            section: section.label, time: displayTime(section.key), mates
          });
        }
      }
    }
    return out;
  }, [weekCells, me, weekStart, todayIso]);

  // --- The year ------------------------------------------------------------
  const summary = useMemo(
    () => summariseYear({ entries, year, limits, todayIso }),
    [entries, year, limits, todayIso]
  );
  // The same twelve months a year earlier, drawn as a line over the bars.
  const previous = useMemo(
    () => summariseYear({ entries, year: year - 1, limits, todayIso }),
    [entries, year, limits, todayIso]
  );
  const hasPrevious = previous.totalFlight > 0 || previous.totalDuty > 0;
  const years = useMemo(() => yearsWithRecords(entries, todayIso), [entries, todayIso]);

  // How far back the arrows may go. Not "the earliest year with records" -
  // that was the bug: a pilot whose only records are this year got
  // Math.min(...) === this year, so BACK was disabled, and FORWARD is
  // disabled at the current year, leaving both arrows dead and the year
  // apparently unselectable.
  //
  // A pilot may legitimately want to look at a year before they joined and
  // see it empty; what they must not do is wander off into 1990. Five years
  // back from the earliest record (or from today) is plenty, and the year
  // dropdown below makes the useful years reachable in one click anyway.
  const earliestYear = Math.min(currentYear, ...years) - 5;
  const canGoBack = year > earliestYear;
  const canGoForward = year < currentYear;

  // Bars are scaled to the tallest bar of the year, rounded up to a sensible
  // gridline, so a quiet year isn't drawn as a flat line.
  const axisMax = useMemo(() => {
    // Scaled to whichever year is taller, so the two are actually comparable.
    // Scaling to this year alone would draw last year's line off the top of
    // the chart and make a heavier year look identical to a lighter one.
    const peak = Math.max(
      summary.peakHours || 0,
      compare && hasPrevious ? previous.peakHours || 0 : 0
    );
    if (peak <= 0) return 40;
    const step = peak > 120 ? 40 : peak > 60 ? 20 : 10;
    return Math.ceil(peak / step) * step;
  }, [summary.peakHours, previous.peakHours, compare, hasPrevious]);

  const gridLines = useMemo(() => {
    const lines = [];
    for (let i = 4; i >= 0; i--) lines.push(Math.round((axisMax / 4) * i));
    return lines;
  }, [axisMax]);

  if (loading) return <div className="cdash"><p className="cdash-note">Loading…</p></div>;

  return (
    <div className="cdash">
      <div className="cdash-head">
        <div>
          <h1>{greeting()}{me ? `, ${me}` : ""}</h1>
          <p>
            {pilot?.name || "—"}
            {pilot?.position ? ` · ${pilot.position}` : ""}
          </p>
        </div>
        <div className="cdash-year">
          <button onClick={() => setYear((y) => y - 1)} disabled={!canGoBack} aria-label="Previous year">‹</button>
          {/* A dropdown as well as arrows: stepping back six years one press
              at a time is the kind of thing that gets a feature called
              broken. Lists the years that actually have records. */}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
            {[...new Set([...years, year])].sort((a, b) => b - a).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button onClick={() => setYear((y) => y + 1)} disabled={!canGoForward} aria-label="Next year">›</button>
        </div>
      </div>

      {isDemo && (
        <div className="cdash-demo">
          <b>Sample data</b> — the DEMO account has no records of its own, so this page is
          filled with realistic example figures. Everything here is calculated by the same
          code the real pages use; only the underlying duty records are invented.
        </div>
      )}

      {error && <div className="cdash-error">Couldn't load everything: {error}</div>}

      <div className="cdash-cards">
        <div className={`cdash-card status-${fdt.status}`}>
          <span className="cdash-card-label">FDT status</span>
          <span className="cdash-card-value">{STATUS_LABEL?.[fdt.status] || fdt.status.toUpperCase()}</span>
          <span className="cdash-card-note">{fdt.note}</span>
        </div>
        {/* Fatigue index. Shown next to FDT status because the two answer the
            same question from different directions - FDT is "am I inside the
            hard limits", this is "how tired does the company's own scoring say
            I am". Only rendered once there is duty to score: a confident "0.0"
            for a pilot with no records would be a claim, not a measurement. */}
        {fatigue && (
          <div className={`cdash-card${fatigue.band ? (fatigue.band.key === "rest" ? " status-exc" : " status-warn") : ""}`}>
            <span className="cdash-card-label">Fatigue index</span>
            <span className="cdash-card-value">
              {fatigue.total.toFixed(1)}
              <small style={{ fontSize: "0.5em", opacity: 0.7 }}> / {TOTAL_INDEX_MAX}</small>
            </span>
            {/* At 3.0 the manual REQUIRES a 36-hour recovery rest. Saying only
                "Recovery rest required" would leave the pilot to guess what
                that means, so the actual requirement is spelled out. */}
            <span className="cdash-card-note" title={fatigue.band?.detail}>
              {fatigue.band
                ? (fatigue.band.key === "rest"
                    ? "36 h recovery rest required, incl. 2 local nights"
                    : fatigue.band.label)
                : `DT ${fatigue.dutyIndex.toFixed(2)} + fatigue ${fatigue.fatigueIndex.toFixed(2)} · last 7 days`}
            </span>
          </div>
        )}
        <div className="cdash-card">
          <span className="cdash-card-label">Flight hours {year}</span>
          <span className="cdash-card-value">{decimalToHm(summary.totalFlight)}</span>
          <span className="cdash-card-note">
            {decimalToHm(summary.averageFlightPerMonth)} avg / month
            {/* Compared over the SAME part of the year, not against last
                year's full total - in July, "down 45%" would be true of
                every pilot alive and would mean nothing. */}
            {hasPrevious && (() => {
              const upTo = summary.months.filter((m) => !m.future).length;
              const mineSoFar = summary.totalFlight;
              const theirsSoFar = previous.months.slice(0, upTo).reduce((s2, m) => s2 + m.flightHours, 0);
              if (theirsSoFar <= 0) return null;
              const pct = Math.round(((mineSoFar - theirsSoFar) / theirsSoFar) * 100);
              if (pct === 0) return <em className="cdash-delta"> · same as {year - 1}</em>;
              return (
                <em className={`cdash-delta ${pct > 0 ? "up" : "down"}`}>
                  {" "}· {pct > 0 ? "+" : ""}{pct}% vs {year - 1}
                </em>
              );
            })()}
          </span>
        </div>
        <div className="cdash-card">
          <span className="cdash-card-label">Duty hours {year}</span>
          <span className="cdash-card-value">{decimalToHm(summary.totalDuty)}</span>
          <span className="cdash-card-note">{summary.totalDutyDays} duty days</span>
        </div>
        <div className={`cdash-card${trainingDue.some((t) => t.result.daysRemaining < 0) ? " status-exc" : trainingDue.length ? " status-warn" : ""}`}>
          <span className="cdash-card-label">Training</span>
          <span className="cdash-card-value">{trainingDue.length}</span>
          <span className="cdash-card-note">due within 90 days</span>
        </div>
      </div>

      <div className="cdash-panel">
        <div className="cdash-panel-head">
          <b>Monthly hours · {year}</b>
          <div className="cdash-legend">
            <span><i className="swatch flight" />Flight</span>
            <span><i className="swatch duty" />Duty</span>
            {hasPrevious && (
              <>
                <span><i className="swatch prev" />{year - 1} flight</span>
                <label className="cdash-toggle">
                  <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                  Compare
                </label>
              </>
            )}
          </div>
        </div>

        <div className="cdash-chart">
          <div className="cdash-axis">
            {gridLines.map((v) => <span key={v}>{v}</span>)}
          </div>
          <div className="cdash-bars">
            {compare && hasPrevious && (
              // Drawn in a viewBox of 12 x 100 and stretched to fit, so each
              // point sits over the centre of its month whatever the width.
              // preserveAspectRatio="none" is what keeps them aligned.
              <svg className="cdash-line" viewBox="0 0 12 100" preserveAspectRatio="none" aria-hidden="true">
                <polyline
                  points={previous.months
                    .map((m, i) => `${i + 0.5},${100 - Math.min(100, (m.flightHours / axisMax) * 100)}`)
                    .join(" ")}
                  fill="none" stroke="#fbbf24" strokeWidth="1.2"
                  vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
                />
              </svg>
            )}
            {summary.months.map((m) => (
              <div
                key={m.label}
                className={`cdash-month${m.partial ? " partial" : ""}${m.future ? " future" : ""}`}
                title={m.future
                  ? `${m.label} — not yet`
                  : `${m.label}: flight ${decimalToHm(m.flightHours)} · duty ${decimalToHm(m.dutyHours)} · ${m.dutyDays} duty days`
                    + (compare && hasPrevious ? `\n${year - 1}: flight ${decimalToHm(previous.months[m.month - 1].flightHours)}` : "")}
              >
                {!m.future && (
                  <>
                    <i className="bar flight" style={{ height: `${Math.min(100, (m.flightHours / axisMax) * 100)}%` }} />
                    <i className="bar duty" style={{ height: `${Math.min(100, (m.dutyHours / axisMax) * 100)}%` }} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="cdash-months">
          <span className="cdash-axis-spacer" />
          {summary.months.map((m) => (
            <span key={m.label} className={m.partial ? "now" : ""}>{m.label}</span>
          ))}
        </div>
      </div>

      <div className="cdash-split">
        <div className="cdash-panel">
          <div className="cdash-panel-head"><b>This week</b></div>
          {myWeek.length === 0
            ? <p className="cdash-note">Not rostered to a line this week.</p>
            : (
              <ul className="cdash-list">
                {myWeek.map((d, i) => (
                  <li key={i} className={d.today ? "today" : ""}>
                    <span>{d.day} · {d.section}</span>
                    <span className="cdash-dim">
                      {d.time ? `${d.time}` : ""}
                      {d.mates.length ? ` · with ${d.mates.join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div className="cdash-panel">
          <div className="cdash-panel-head"><b>Training due</b></div>
          {trainingDue.length === 0
            ? <p className="cdash-note">Nothing due in the next 90 days.</p>
            : (
              <ul className="cdash-list">
                {trainingDue.map(({ item, result }) => (
                  <li key={item.key} className={result.daysRemaining < 0 ? "exc" : result.daysRemaining <= 30 ? "warn" : ""}>
                    <span>{item.label}</span>
                    <span className="cdash-dim">
                      {result.daysRemaining < 0
                        ? `expired ${Math.abs(result.daysRemaining)} days ago`
                        : `${result.daysRemaining} days`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
