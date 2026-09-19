import { useEffect, useMemo, useState } from "react";
import { loadAllPilotStatusRows, classify, STATUS_LABEL } from "../../utils/statusCompute.js";
import {
  recentMonthKeys, periodSummary, pilotsApproachingLimits, fatigueDistribution,
  pilotComparison, monthLabel, hhmm, LIMIT_KEYS
} from "../../utils/fdtStatistics.js";
import { getSetting } from "../../services/desktopDatabase.js";
import { FATIGUE_CRITERIA_KEY, isModified, modifiedSections } from "../../utils/fatigueCriteria.js";
import { TOTAL_INDEX_MAX } from "../../utils/fatigueMonitor.js";
import { todayIso } from "../../utils/dateKeys.js";
import "./FdtStatistics.css";

// FDT & Fatigue statistics, monthly.
//
// Capt. Weera asked for this to present at internal meetings and to CAAT and
// customer auditors ("ประชุม ภายใน บริษัท และ auditor มาตรวจ CAAT and
// Customer - รายเดือน"), covering fleet FT/DT trend, pilots approaching
// limits, the Fatigue Index distribution, and fleet hour totals.
//
// TWO THINGS THIS PAGE DOES DELIBERATELY, because an audit is not a dashboard:
//
//   It states its own basis. Every figure carries the window it came from and
//   the date it was produced. An auditor's first question about any number is
//   "as at when, over what period" - a page that cannot answer that is worth
//   nothing in the room, however good the chart looks.
//
//   It distinguishes MONTHLY totals from ROLLING limits, and says so on screen.
//   Hours are summed by calendar month (what "June" means to an auditor);
//   limits are rolling windows ending today (what "legal" means to the CAAT).
//   The two give different figures for what sounds like the same thing, and
//   the caption exists so that difference reads as intent rather than error.

const RANGES = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" }
];

const THRESHOLD = 0.9;   // "approaching" = 90% of a limit

export default function FdtStatistics() {
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState(null);
  const [criteria, setCriteria] = useState(null);
  const [monthCount, setMonthCount] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

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

  const months = useMemo(() => recentMonthKeys(monthCount), [monthCount]);

  const summary = useMemo(
    () => (limits ? periodSummary({ rows, limits, months }) : null),
    [rows, limits, months]
  );

  const comparison = useMemo(
    () => (limits ? pilotComparison({ rows, limits, months }) : null),
    [rows, limits, months]
  );

  // All Status, from the rows already loaded - no second fetch.
  //
  // Cells are classified with the SAME classify() the All Status page uses, so
  // a pilot cannot read amber on one screen and green on the other. Sorted
  // worst-first here rather than by name: on a page being presented, the
  // pilots who need discussion belong at the top, whereas All Status is a
  // lookup tool where alphabetical is easier to scan for a known name.
  const allStatus = useMemo(() => {
    if (!limits) return [];
    const rank = { exc: 0, warn: 1, ok: 2 };
    return rows.map((r) => {
      const stats = r.stats || {};
      const cells = {};
      for (const { key } of LIMIT_KEYS) {
        const limit = limits[key] || { max: 0 };
        cells[key] = {
          used: Number(stats[key]) || 0,
          max: Number(limit.max) || 0,
          state: classify(Number(stats[key]) || 0, limit)
        };
      }
      const cycleStatus = r.recoveryRest?.status || "ok";
      return {
        code: r.pilot?.code || "",
        name: r.pilot?.name || "",
        status: r.status || "ok",
        cycleStatus,
        cycleLabel: cycleStatus === "exc" ? "DUE" : cycleStatus === "warn" ? "SOON" : "OK",
        cells
      };
    }).sort((a, b) =>
      (rank[a.status] ?? 3) - (rank[b.status] ?? 3) ||
      (a.code || "").localeCompare(b.code || "")
    );
  }, [rows, limits]);

  const approaching = useMemo(
    () => (limits ? pilotsApproachingLimits({ rows, limits, threshold: THRESHOLD }) : []),
    [rows, limits]
  );

  const fatigue = useMemo(
    () => (limits ? fatigueDistribution({ rows, limits, asOfIso: todayIso(), criteria }) : null),
    [rows, limits, criteria]
  );

  // Chart scale. Rounded UP to a clean step so the axis labels are readable
  // numbers rather than "137.4" - an auditor reads the axis, not the tooltip.
  const chartMax = useMemo(() => {
    const peak = Math.max(0, ...(summary?.monthly || []).map((m) => Math.max(m.ftHours, m.dtHours)));
    if (peak <= 0) return 10;
    const step = peak > 500 ? 100 : peak > 100 ? 50 : peak > 40 ? 10 : 5;
    return Math.ceil(peak / step) * step;
  }, [summary]);

  const generated = new Date();

  if (loading) return <div className="stats-page"><div className="stats-empty">Loading statistics…</div></div>;
  if (error) return <div className="stats-page"><div className="stats-empty stats-error">{error}</div></div>;

  return (
    <div className={`stats-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>FDT &amp; Fatigue Statistics</h1>
          <p>
            Monthly flight and duty time across the fleet, with limit exposure and
            fatigue distribution — for internal review and CAAT / customer audit.
          </p>
        </div>
        <div className="stats-actions">
          <label>
            Period{" "}
            <select value={monthCount} onChange={(e) => setMonthCount(Number(e.target.value))}>
              {RANGES.map((r) => <option key={r.months} value={r.months}>{r.label}</option>)}
            </select>
          </label>
          <button onClick={load}>Refresh</button>
          <button className="primary" onClick={() => window.print()}>Print</button>
          <button onClick={() => setFullScreen((v) => !v)}>
            {fullScreen ? "Exit Full Screen" : "Full Screen"}
          </button>
        </div>
      </div>

      <div className="stats-print-area">
        {/* Every printed page an auditor keeps has to say what it is, over what
            period, and when it was produced - otherwise it is an undated sheet
            of numbers. */}
        <div className="stats-doc-head">
          <div>
            <div className="stats-doc-title">FDT &amp; Fatigue Statistics</div>
            <div className="stats-doc-sub">
              {monthLabel(months[0])} – {monthLabel(months[months.length - 1])}
              {" · "}{months.length} months
              {" · "}Fleet: {summary?.pilotCount || 0} pilots with recorded duty
            </div>
          </div>
          <div className="stats-doc-meta">
            <div>Generated {generated.toLocaleDateString()} {generated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <div>OPS-CM-01 §7.9 / §7.17.3</div>
          </div>
        </div>

        {isModified(criteria) && (
          <div className="stats-warn">
            ⚠ Fatigue figures computed with <b>modified criteria</b> ({modifiedSections(criteria).join(", ")})
            — not the approved OPS-CM-01 §7.17.3 calculation.
          </div>
        )}

        {/* ---- 1. Fleet totals ---- */}
        <h2 className="stats-section">Fleet Totals</h2>
        <div className="stats-kpis">
          <Kpi label="Total Flight Time" value={hhmm(summary?.ftHours)} sub={`${summary?.flights || 0} flights`} />
          <Kpi label="Total Duty Time" value={hhmm(summary?.dtHours)} sub={`${summary?.dutyDays || 0} duty periods`} />
          <Kpi label="Average FT / pilot" value={hhmm(summary?.avgFtPerPilot)} sub={`over ${months.length} months`} />
          <Kpi label="Average FT / month" value={hhmm(summary?.avgFtPerMonth)} sub="fleet" />
          <Kpi
            label="Busiest month"
            value={summary?.busiestMonth?.label || "—"}
            sub={summary?.busiestMonth ? `${hhmm(summary.busiestMonth.ftHours)} FT` : ""}
          />
        </div>

        {/* ---- 2. Monthly trend ---- */}
        <h2 className="stats-section">Monthly Flight &amp; Duty Time</h2>
        <p className="stats-caption">
          Calendar-month totals for the whole fleet. Duty Time includes the report
          and post-flight allowances and standby credit (OPS-CM-01 §7.9.2).
          <b> These are calendar months</b>, not the rolling windows used for limit
          checks below — the two answer different questions and will differ.
        </p>

        <TrendChart months={summary?.monthly || []} max={chartMax} />

        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Month</th>
              <th>Flight Time</th>
              <th>Duty Time</th>
              <th>Flights</th>
              <th>Duty periods</th>
              <th>Pilots flown</th>
              <th>Avg FT / pilot</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.monthly || []).map((m) => (
              <tr key={m.month}>
                <td className="stats-left">{m.label}</td>
                <td>{hhmm(m.ftHours)}</td>
                <td>{hhmm(m.dtHours)}</td>
                <td>{m.flights}</td>
                <td>{m.dutyDays}</td>
                <td>{m.pilotCount}</td>
                <td>{hhmm(m.avgFtPerPilot)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="stats-left">Total</td>
              <td>{hhmm(summary?.ftHours)}</td>
              <td>{hhmm(summary?.dtHours)}</td>
              <td>{summary?.flights || 0}</td>
              <td>{summary?.dutyDays || 0}</td>
              <td>{summary?.pilotCount || 0}</td>
              <td>{hhmm(summary?.avgFtPerPilot)}</td>
            </tr>
            </tfoot>
          </table>
        </div>

        {/* ---- 3. Limit exposure ---- */}
        <h2 className="stats-section">Pilots Approaching Limits</h2>
        <p className="stats-caption">
          Rolling windows ending today — the basis on which a limit actually applies.
          Listed at <b>{Math.round(THRESHOLD * 100)}% or more</b> of any FTL limit,
          worst limit per pilot.
        </p>

        {approaching.length === 0 ? (
          <div className="stats-clear">
            ✓ No pilot is within {Math.round((1 - THRESHOLD) * 100)}% of any FTL limit.
          </div>
        ) : (
          <div className="stats-table-wrap">
            <table className="stats-table">
              <thead>
                <tr>
                  <th>Pilot</th><th>Limit</th><th>Used</th><th>Maximum</th>
                <th>Remaining</th><th>Used %</th><th />
              </tr>
            </thead>
            <tbody>
              {approaching.map((p) => (
                <tr key={p.code} className={p.over ? "stats-row-exc" : "stats-row-warn"}>
                  <td className="stats-left"><b>{p.code}</b>{p.name ? ` — ${p.name}` : ""}</td>
                  <td>{p.label}</td>
                  <td>{hhmm(p.used)}</td>
                  <td>{hhmm(p.max)}</td>
                  <td>{hhmm(p.remaining)}</td>
                  <td><b>{(p.pct * 100).toFixed(0)}%</b></td>
                  <td>
                    <span className="stats-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, p.pct * 100)}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---- 4. Per-pilot comparison ---- */}
        <h2 className="stats-section">Comparison by Pilot</h2>
        <p className="stats-caption">
          Calendar-month totals per pilot over the period, with each pilot's gap from
          the fleet average. <b>A higher figure is not a finding</b> — it usually means
          more roster days. Flagged only where a pilot is clearly apart from the fleet
          (50% above or below the mean), since in any group about half sit above average.
          <i> FT / month</i> counts only the months a pilot actually flew, so leave does
          not read as under-utilisation.
        </p>

        <div className="stats-cmp-head">
          <span>Fleet average: <b>{hhmm(comparison?.avgFt)}</b> FT · <b>{hhmm(comparison?.avgDt)}</b> DT</span>
          <span>{comparison?.flownCount || 0} of {comparison?.pilots?.length || 0} pilots flew in this period</span>
        </div>

        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Pilot</th>
                <th>Flight Time</th>
              <th>Duty Time</th>
              <th>Flights</th>
              <th>Months flown</th>
              <th>FT / month</th>
              <th>vs fleet avg</th>
              <th>Share of fleet FT</th>
            </tr>
          </thead>
          <tbody>
            {(comparison?.pilots || []).map((p) => (
              <tr
                key={p.code}
                className={p.outlierHigh ? "stats-row-warn" : p.activeMonths === 0 ? "stats-row-idle" : ""}
              >
                <td className="stats-left">
                  <b>{p.code}</b>{p.name ? ` — ${p.name}` : ""}
                  {p.outlierHigh && <span className="stats-tag stats-tag-high">high</span>}
                  {p.outlierLow && <span className="stats-tag stats-tag-low">low</span>}
                  {p.activeMonths === 0 && <span className="stats-tag">no duty</span>}
                </td>
                <td>{hhmm(p.ftHours)}</td>
                <td>{hhmm(p.dtHours)}</td>
                <td>{p.flights}</td>
                <td>{p.activeMonths}</td>
                <td>{hhmm(p.ftPerActiveMonth)}</td>
                <td className={p.ftVsAvg >= 0 ? "stats-pos" : "stats-neg"}>
                  {p.ftVsAvg >= 0 ? "+" : "−"}{hhmm(Math.abs(p.ftVsAvg))}
                </td>
                <td>
                  <span className="stats-share">
                    <span style={{ width: `${Math.min(100, p.ftShare * 100)}%` }} />
                  </span>
                  <span className="stats-share-pct">{(p.ftShare * 100).toFixed(0)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="stats-left">Fleet total</td>
              <td>{hhmm(comparison?.fleetFt)}</td>
              <td>{hhmm(comparison?.fleetDt)}</td>
              <td>{(comparison?.pilots || []).reduce((s, p) => s + p.flights, 0)}</td>
              <td />
              <td>{hhmm(comparison?.avgFt)}</td>
              <td />
              <td>100%</td>
            </tr>
            </tfoot>
          </table>
        </div>

        {/* ---- 5. Fatigue distribution ---- */}
        <h2 className="stats-section">Fatigue Index Distribution</h2>
        <p className="stats-caption">
          TOTAL INDEX per pilot for the last 7 days, out of {TOTAL_INDEX_MAX.toFixed(2)}
          {" "}(OPS-CM-01 §7.17.3.2). Bands are the manual's own action thresholds.
        </p>

        <div className="stats-bands">
          {(fatigue?.bands || []).map((b) => (
            <div key={b.key} className={`stats-band stats-band-${b.key}`}>
              <div className="stats-band-count">{b.count}</div>
              <div className="stats-band-label">{b.label}</div>
              <div className="stats-band-range">
                {b.key === "normal" ? "below 2.50" : `${b.from.toFixed(2)}+`}
              </div>
            </div>
          ))}
          {fatigue?.noData?.length > 0 && (
            <div className="stats-band stats-band-none">
              <div className="stats-band-count">{fatigue.noData.length}</div>
              <div className="stats-band-label">No duty records</div>
              <div className="stats-band-range">not scored</div>
            </div>
          )}
        </div>

        {/* Named, not just counted: a count tells the meeting that someone needs
            a recovery rest but not who, which is the one thing needed to act. */}
        {(fatigue?.bands || []).filter((b) => b.key !== "normal" && b.count > 0).map((b) => (
          <div key={b.key} className="stats-band-list">
            <h3>{b.label} — {b.count} pilot{b.count === 1 ? "" : "s"}</h3>
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                <tr><th>Pilot</th><th>TOTAL INDEX</th><th>DT Index</th><th>Fatigue Index</th></tr>
              </thead>
              <tbody>
                {b.pilots.map((p) => (
                  <tr key={p.code} className={b.key === "rest" ? "stats-row-exc" : "stats-row-warn"}>
                    <td className="stats-left"><b>{p.code}</b>{p.name ? ` — ${p.name}` : ""}</td>
                    <td><b>{p.total.toFixed(2)}</b></td>
                    <td>{p.dutyIndex.toFixed(2)}</td>
                    <td>{p.fatigueIndex.toFixed(2)}</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* ---- 6. All Status ---- */}
        <h2 className="stats-section">All Status — Every Pilot</h2>
        <p className="stats-caption">
          Current FTL position for the whole fleet, as at {generated.toLocaleDateString()}.
          Rolling windows, same figures as the All Status page. Each cell shows
          used / limit; amber is approaching, red is at or over.
        </p>

        <div className="stats-table-wrap stats-allstatus-wrap">
          <table className="stats-table stats-allstatus">
            <thead>
              <tr>
                <th>Pilot</th>
                <th>Status</th>
                <th>168h Cycle</th>
                {LIMIT_KEYS.map((l) => <th key={l.key}>{l.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {allStatus.map((r) => (
                <tr key={r.code} className={r.status === "exc" ? "stats-row-exc" : r.status === "warn" ? "stats-row-warn" : ""}>
                  <td className="stats-left"><b>{r.code}</b>{r.name ? ` — ${r.name}` : ""}</td>
                  <td><span className={`stats-pill stats-pill-${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                  <td><span className={`stats-pill stats-pill-${r.cycleStatus}`}>{r.cycleLabel}</span></td>
                  {LIMIT_KEYS.map((l) => {
                    const c = r.cells[l.key];
                    return (
                      <td key={l.key} className={`stats-cell-${c.state}`}>
                        {hhmm(c.used)}<small> / {hhmm(c.max)}</small>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="stats-foot">
          Produced by AviCore from Daily Duty records. Flight and duty figures are
          calendar-month totals; limit percentages are rolling windows ending{" "}
          {generated.toLocaleDateString()}.
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="stats-kpi">
      <div className="stats-kpi-label">{label}</div>
      <div className="stats-kpi-value">{value}</div>
      {sub ? <div className="stats-kpi-sub">{sub}</div> : null}
    </div>
  );
}

// Grouped bar chart, drawn as plain elements rather than a charting library.
//
// No dependency, and - the point for this page - it prints. Canvas-based charts
// are routinely dropped or rendered blank by print engines, which is exactly
// the wrong failure for a page whose purpose is to be printed and handed over.
function TrendChart({ months, max }) {
  if (!months.length) return null;
  const ticks = 4;

  return (
    <div className="stats-chart">
      <div className="stats-chart-plot">
        {/* Gridlines with values, so a bar can be read without a tooltip -
            there is no hovering on paper. */}
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (max / ticks) * (ticks - i);
          return (
            <div className="stats-gridline" key={i} style={{ top: `${(i / ticks) * 100}%` }}>
              <span>{Math.round(v)}</span>
            </div>
          );
        })}

        <div className="stats-bars">
          {months.map((m) => (
            <div className="stats-barpair" key={m.month}>
              <div className="stats-barpair-bars">
                <span
                  className="stats-bar-ft"
                  style={{ height: `${max ? (m.ftHours / max) * 100 : 0}%` }}
                  title={`${m.label} — Flight Time ${hhmm(m.ftHours)}`}
                />
                <span
                  className="stats-bar-dt"
                  style={{ height: `${max ? (m.dtHours / max) * 100 : 0}%` }}
                  title={`${m.label} — Duty Time ${hhmm(m.dtHours)}`}
                />
              </div>
              <div className="stats-barpair-label">{m.label.replace(" ", " ")}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="stats-legend">
        <span><i className="stats-swatch-ft" /> Flight Time (hours)</span>
        <span><i className="stats-swatch-dt" /> Duty Time (hours)</span>
      </div>
    </div>
  );
}
