import { useEffect, useMemo, useState } from "react";
import { listTraining, importTrainingMany, getSetting, saveSetting } from "../../services/desktopDatabase.js";
import { parseTrainingExcelFile } from "../../services/trainingImport.js";
import { TRAINING_ITEMS, withTrainingThresholdDefaults, computeTrainingRow, formatDueDate } from "../../utils/trainingDue.js";
import { STATUS_LABEL } from "../../utils/statusCompute.js";
import "../myStatus/MyStatus.css";
import "./TrainingDue.css";

const LABEL = { ...STATUS_LABEL, unknown: "NO DATA" };

// Flight crew training/certificate DUE tracking (Passport, Medical, LPC,
// OPC2, HUET, CRM, ...) - imported from the company's Training Track Excel
// workbook (see src/services/trainingImport.js) rather than entered by hand,
// since that workbook is already the source of truth in daily use. Reuses
// the same ok/warn/exc badge language and expand-per-pilot-row layout as
// All Status (FTL) for a consistent look, but "unknown" (blank in the
// source file) is a real fourth state here since a due-date item genuinely
// missing data isn't the same thing as one that's simply not due soon.
export default function TrainingDue() {
  const [thresholds, setThresholds] = useState(withTrainingThresholdDefaults());
  const [pilots, setPilots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState("");
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applyThresholds, setApplyThresholds] = useState(true);
  const [importMsg, setImportMsg] = useState(null);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    const [list, savedThresholds] = await Promise.all([listTraining(), getSetting("training_thresholds")]);
    setPilots(list);
    setThresholds(withTrainingThresholdDefaults(savedThresholds));
    setLoading(false);
  }

  async function handleFile(file) {
    setImportMsg(null);
    try {
      const result = await parseTrainingExcelFile(file);
      setPreview(result);
      setApplyThresholds(true);
    } catch (err) {
      setImportMsg({ ok: false, text: "Could not read this file: " + err.message });
    }
  }

  async function handleConfirmImport() {
    if (!preview) return;
    setImporting(true);
    try {
      await importTrainingMany(preview.pilots.map((p) => ({ code: p.code, name: p.name, record: p.record })));
      let nextThresholds = thresholds;
      if (applyThresholds && preview.thresholds) {
        nextThresholds = { ...thresholds, ...preview.thresholds };
        await saveSetting("training_thresholds", nextThresholds);
      }
      setThresholds(nextThresholds);
      setImportMsg({ ok: true, text: `Imported ${preview.pilots.length} pilot(s).` });
      setPreview(null);
      await refresh();
    } catch (err) {
      setImportMsg({ ok: false, text: "Import failed: " + err.message });
    } finally {
      setImporting(false);
    }
  }

  const rows = useMemo(
    () => pilots.map((p) => ({ ...p, computed: computeTrainingRow(p.record, thresholds) })),
    [pilots, thresholds]
  );

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.code || "").toLowerCase().includes(q))
      : rows;
    return filtered.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [rows, filter]);

  return (
    <div className="trainingdue-page">
      <div className="module-header">
        <div>
          <h1>Training DUE Monitor</h1>
          <p>Flight crew training and certificate due dates ({TRAINING_ITEMS.length} items per pilot), imported from the company's Training Track Excel workbook.</p>
        </div>
        <div className="trainingdue-controls">
          <input className="trainingdue-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or code..." />
          <button onClick={refresh}>Refresh</button>
          <label className={`trainingdue-import-btn${importing ? " busy" : ""}`}>
            {importing ? "Importing..." : "Import Excel"}
            <input
              type="file" accept=".xlsx,.xlsm" hidden disabled={importing}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
        </div>
      </div>

      {importMsg && <div className={`settings-msg ${importMsg.ok ? "ok" : "error"}`}>{importMsg.text}</div>}

      {preview && (
        <div className="trainingdue-preview">
          <h2>Import preview — {preview.pilots.length} pilot(s) found</h2>
          <div className="trainingdue-preview-list">
            {preview.pilots.map((p) => (
              <span className="trainingdue-chip" key={p.code}>{p.code} — {p.name || "(no name)"}</span>
            ))}
          </div>
          {preview.thresholds && (
            <label className="trainingdue-apply-thresholds">
              <input type="checkbox" checked={applyThresholds} onChange={(e) => setApplyThresholds(e.target.checked)} />
              <span>Also apply the "Caution" warning windows found in this file as the company-wide defaults (synced to every device)</span>
            </label>
          )}
          <div className="trainingdue-preview-actions">
            <button className="primary" onClick={handleConfirmImport} disabled={importing}>
              {importing ? "Importing..." : `Import ${preview.pilots.length} pilot(s)`}
            </button>
            <button onClick={() => setPreview(null)} disabled={importing}>Cancel</button>
          </div>
        </div>
      )}

      {loading && <div className="mystatus-empty">Loading...</div>}
      {!loading && visibleRows.length === 0 && (
        <div className="mystatus-empty">No training data yet — use "Import Excel" above to load the Training Track workbook.</div>
      )}

      {!loading && visibleRows.length > 0 && (
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
              expanded={expanded === r.code}
              onToggle={() => setExpanded((cur) => (cur === r.code ? "" : r.code))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrainingRow({ row, expanded, onToggle }) {
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
            {TRAINING_ITEMS.map((item) => (
              <TrainingItemCell key={item.key} item={item} result={computed.perItem[item.key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingItemCell({ item, result }) {
  const { status, daysRemaining, dueDate, count, lifetime } = result;

  let valueText;
  if (status === "unknown") valueText = "No data";
  else if (lifetime) valueText = "For life";
  else if (item.type === "count") valueText = `${count} in last 180 days`;
  else if (status === "exc") valueText = `Expired ${formatDueDate(dueDate)} (${Math.abs(daysRemaining)}d ago)`;
  else valueText = `Due ${formatDueDate(dueDate)} (${daysRemaining}d left)`;

  return (
    <div className={`trainingdue-item ${status}`}>
      <span className="trainingdue-item-label">{item.label}</span>
      <span className="trainingdue-item-value">{valueText}</span>
    </div>
  );
}
