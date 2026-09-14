import { useEffect, useMemo, useState } from "react";
import { getSetting} from "../../services/desktopDatabase.js";
import { DEFAULT_FTL_LIMITS } from "../../utils/ftlLimits.js";
import { decimalToHHMM, classify, STATUS_LABEL, loadAllPilotStatusRows } from "../../utils/statusCompute.js";
import { Bar, CurrencySection, RecoveryRestCard } from "../../components/StatusDisplay.jsx";
import "../myStatus/MyStatus.css";
import "./AllStatus.css";

// Same metrics as My Status, but for every pilot at once - a compact
// summary table (sorted by name) that expands per-row into the full detail
// view. Dashboard reuses this same per-pilot computation.
export default function AllStatus() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  const [expanded, setExpanded] = useState("");
  const [filter, setFilter] = useState("");
  const [branding, setBranding] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    refresh();
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  // Esc exits Full Screen (in addition to the toggle button) - only wired
  // up while fullScreen is on, so it never steals Escape from anything else.
  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refresh() {
    setLoading(true);
    const { rows: loaded, limits: lim } = await loadAllPilotStatusRows();
    setLimits(lim);
    setRows(loaded);
    setLoading(false);
  }

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.pilot.name || "").toLowerCase().includes(q) || (r.pilot.code || "").toLowerCase().includes(q));
  }, [rows, filter]);

  return (
    <div className={`allstatus-page${fullScreen ? " allstatus-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>All Status</h1>
          <p>FTL status for every pilot, sorted by name — click a row to see the full breakdown.</p>
        </div>
        <div className="allstatus-controls">
          <input className="allstatus-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or code..." />
          {/* Per-page Refresh removed - the sidebar's single Refresh (full
              page reload) now covers this. refresh() itself stays. */}
          <button onClick={() => window.print()} disabled={!visibleRows.length}>Print / Save PDF</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {loading && <div className="mystatus-empty">Loading...</div>}
      {!loading && visibleRows.length === 0 && <div className="mystatus-empty">No pilots found.</div>}

      {!loading && visibleRows.length > 0 && (
        <div className="allstatus-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="allstatus-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="allstatus-print-title">All Status — Fleet FTL Summary</div>

          <div className="allstatus-scroll">
            <div className="allstatus-table">
              <div className="allstatus-row allstatus-head">
                <span>Pilot</span>
                <span>Status</span>
                <span>168h Cycle</span>
                <span>DT 7D</span>
                <span>DT 14D</span>
                <span>DT 28D</span>
                <span>FT 7D</span>
                <span>FT 28D</span>
                <span>FT 365D</span>
                <span>T/O (90D)</span>
                <span>L/D (90D)</span>
                <span>I.APP (180D)</span>
              </div>
              {visibleRows.map((r) => (
                <AllStatusRow
                  key={r.pilot.code || r.pilot.licence}
                  row={r}
                  limits={limits}
                  expanded={expanded === (r.pilot.code || r.pilot.licence)}
                  onToggle={() => setExpanded((cur) => (cur === (r.pilot.code || r.pilot.licence) ? "" : (r.pilot.code || r.pilot.licence)))}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ value, limit }) {
  const s = classify(value, limit);
  return <span className={`allstatus-cell ${s}`}>{decimalToHHMM(value)}<small> / {decimalToHHMM(limit.max)}</small></span>;
}

// For minimum-threshold counts (T/O, Landing, I.App) - "ok" when at/above
// the minimum, unlike StatCell's max-based Duty/Flight Time bars.
function MinCountCell({ value, min }) {
  const s = value >= min ? "ok" : "warn";
  return <span className={`allstatus-cell ${s}`}>{value}<small> / ≥{min}</small></span>;
}

function AllStatusRow({ row, limits, expanded, onToggle }) {
  const { pilot, entries, stats, recoveryRest, status } = row;
  const toCount = stats.toDay90 + stats.toNight90;
  const landCount = stats.landDay90 + stats.landNight90;
  return (
    <div className={`allstatus-rowgroup${expanded ? " open" : ""}`}>
      <button className="allstatus-row allstatus-row-btn" onClick={onToggle}>
        <span className="allstatus-name">{pilot.code || "-"} — {pilot.name || "-"}</span>
        <span><span className={`mystatus-badge ${status}`}>{STATUS_LABEL[status]}</span></span>
        <span><span className={`mystatus-badge ${recoveryRest.status}`}>{STATUS_LABEL[recoveryRest.status]}</span></span>
        <StatCell value={stats.dt7d} limit={limits.dt7d} />
        <StatCell value={stats.dt14d} limit={limits.dt14d} />
        <StatCell value={stats.dt28d} limit={limits.dt28d} />
        <StatCell value={stats.ft7d} limit={limits.ft7d} />
        <StatCell value={stats.ft28d} limit={limits.ft28d} />
        <StatCell value={stats.ft365d} limit={limits.ft365d} />
        <MinCountCell value={toCount} min={limits.takeoffLandingMin90d} />
        <MinCountCell value={landCount} min={limits.takeoffLandingMin90d} />
        <MinCountCell value={stats.iApp180} min={limits.iappMin180d} />
      </button>

      {expanded && (
        <div className="allstatus-detail">
          {entries.length === 0 ? (
            <div className="mystatus-empty">No Daily Duty records yet for this pilot.</div>
          ) : (
            <>
              <h3 className="mystatus-section">168 Hr Duty Cycle / Recovery Rest</h3>
              <RecoveryRestCard result={recoveryRest} limits={limits} />

              <h3 className="mystatus-section">Duty Time (Rolling)</h3>
              <div className="mystatus-grid">
                <Bar label="DT 7D" value={stats.dt7d} limit={limits.dt7d} />
                <Bar label="DT 14D" value={stats.dt14d} limit={limits.dt14d} />
                <Bar label="DT 28D" value={stats.dt28d} limit={limits.dt28d} />
              </div>

              <h3 className="mystatus-section">Flight Time (Rolling)</h3>
              <div className="mystatus-grid">
                <Bar label="FT 7D" value={stats.ft7d} limit={limits.ft7d} />
                <Bar label="FT 28D" value={stats.ft28d} limit={limits.ft28d} />
                <Bar label="FT 365D" value={stats.ft365d} limit={limits.ft365d} />
              </div>

              <h3 className="mystatus-section">Currency (90 / 180 Days)</h3>
              <CurrencySection stats={stats} limits={limits} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
