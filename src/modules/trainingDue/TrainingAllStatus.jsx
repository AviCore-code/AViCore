import { useEffect, useMemo, useState } from "react";
import { computeTrainingRow, formatDueDate, monitoredTrainingItems } from "../../utils/trainingDue.js";
import { STATUS_LABEL } from "../../utils/statusCompute.js";
import { getSetting, exportLogbookPdf } from "../../services/desktopDatabase.js";
import "../myStatus/MyStatus.css";
import "./TrainingDue.css";

const LABEL = { ...STATUS_LABEL, unknown: "NO DATA" };

// Fleet-wide expand-per-pilot-row table - same look as All Status (FTL),
// but "unknown" (blank in the source file/never entered) is a real fourth
// state here since a due-date item genuinely missing data isn't the same
// thing as one that's simply not due soon.
export default function TrainingAllStatus({ pilots, thresholds, disabledItems, loading, onRefresh }) {
  const [expanded, setExpanded] = useState("");
  const [filter, setFilter] = useState("");
  const [branding, setBranding] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function handleExport() {
    setExporting(true);
    setExportMsg("");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await exportLogbookPdf(`TrainingAllStatus_${stamp}.pdf`);
      if (result?.ok && result.filePath) setExportMsg(`Saved: ${result.filePath}`);
    } catch (err) {
      setExportMsg("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  const rows = useMemo(
    () => pilots.map((p) => ({ ...p, computed: computeTrainingRow(p.record, thresholds, disabledItems) })),
    [pilots, thresholds, disabledItems]
  );

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.code || "").toLowerCase().includes(q))
      : rows;
    return filtered.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [rows, filter]);

  return (
    <div className={`trainingdue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="trainingdue-controls no-print" style={{ marginBottom: "14px" }}>
        <input className="trainingdue-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or code..." />
        <button onClick={onRefresh}>Refresh</button>
        <button onClick={() => window.print()} disabled={!visibleRows.length}>Print</button>
        <button className="trainingall-export-btn" onClick={handleExport} disabled={exporting || !visibleRows.length}>{exporting ? "Exporting..." : "Export PDF"}</button>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>
      {exportMsg && <div className="trainingall-export-msg no-print">{exportMsg}</div>}

      {loading && <div className="mystatus-empty">Loading...</div>}
      {!loading && visibleRows.length === 0 && (
        <div className="mystatus-empty">No training data yet — use the "Import PDF / Excel" tab to load pilots, or "Input" to add one by hand.</div>
      )}

      {!loading && visibleRows.length > 0 && (
        <div className="trainingall-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="trainingall-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="trainingall-print-title">All Training Status — Fleet Summary</div>
          <div className="trainingdue-table">
            <div className="trainingdue-row trainingdue-head">
              <span>Pilot</span>
              <span>Status</span>
              <span>Expired</span>
              <span>Due Soon</span>
              <span>No Data</span>
            </div>
            {visibleRows.map((r) => (
              <TrainingRow
                key={r.code}
                row={r}
                disabledItems={disabledItems}
                expanded={expanded === r.code}
                onToggle={() => setExpanded((cur) => (cur === r.code ? "" : r.code))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingRow({ row, disabledItems, expanded, onToggle }) {
  const { code, name, computed } = row;
  const items = Object.values(computed.perItem);
  const excCount = items.filter((v) => v.status === "exc").length;
  const warnCount = items.filter((v) => v.status === "warn").length;
  const unknownCount = items.filter((v) => v.status === "unknown").length;

  return (
    <div className={`trainingdue-rowgroup${expanded ? " open" : ""}`}>
      <button className="trainingdue-row trainingdue-row-btn" onClick={onToggle}>
        <span className="trainingdue-name">{code} — {name || "-"}</span>
        <span><span className={`mystatus-badge ${computed.status}`}>{LABEL[computed.status]}</span></span>
        <span className={`trainingdue-count${excCount ? " exc" : ""}`}>{excCount}</span>
        <span className={`trainingdue-count${warnCount ? " warn" : ""}`}>{warnCount}</span>
        <span className="trainingdue-count">{unknownCount}</span>
      </button>

      {expanded && (
        <div className="trainingdue-detail">
          <div className="trainingdue-grid">
            {monitoredTrainingItems(disabledItems).map((item) => (
              <TrainingItemCell key={item.key} item={item} result={computed.perItem[item.key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TrainingItemCell({ item, result }) {
  const { status, daysRemaining, dueDate, count, lifetime } = result;

  // Wording keys off the REAL overdue-ness (daysRemaining < 0), not the
  // (possibly maxSeverity-capped) status - Night Currency stays "warn" even
  // once overdue, but the text should still say "Expired", not "Due".
  const isOverdue = item.type !== "count" && daysRemaining != null && daysRemaining < 0;

  let valueText;
  if (status === "unknown") valueText = "No data";
  else if (lifetime) valueText = "For life";
  else if (item.type === "count") valueText = `${count} in last 180 days`;
  else if (isOverdue) valueText = `Expired ${formatDueDate(dueDate)} (${Math.abs(daysRemaining)}d ago)`;
  else valueText = `Due ${formatDueDate(dueDate)} (${daysRemaining}d left)`;

  return (
    <div className={`trainingdue-item ${status}`}>
      <span className="trainingdue-item-label">{item.label}</span>
      <span className="trainingdue-item-value">{valueText}</span>
    </div>
  );
}
