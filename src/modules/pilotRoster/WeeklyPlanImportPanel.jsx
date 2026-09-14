import { useState } from "react";
import {
  readWeeklyPlanWorkbookFile,
  parseWeeklyPlanWorkbook,
  listWeeklyPlanSheetNames,
  guessWeeklyPlanSheet
} from "../../services/weeklyPlanImport.js";
import { saveWeeklyPlanMany, clearWeeklyPlanRange } from "../../services/desktopDatabase.js";
import "./PilotRoster.css";

// Import panel for the weekly PLANNING workbook (see
// services/weeklyPlanImport.js for the sheet layout). Deliberately imports
// only the week currently on screen by default: the real sheet spans years
// across its columns, and pulling all of it in would mostly be historical
// noise - but the person can widen the range here before importing.
export default function WeeklyPlanImportPanel({ weekFrom, weekTo, onImported, onCancel }) {
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetName, setSheetName] = useState("");
  const [fileName, setFileName] = useState("");
  const [from, setFrom] = useState(weekFrom || "");
  const [to, setTo] = useState(weekTo || "");
  const [replace, setReplace] = useState(true);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  function runParse(wb, name, rangeFrom, rangeTo) {
    try {
      setPreview(parseWeeklyPlanWorkbook(wb, name, { from: rangeFrom, to: rangeTo }));
      setMsg(null);
    } catch (err) {
      setPreview(null);
      setMsg({ ok: false, text: err.message });
    }
  }

  async function handleFile(file) {
    if (!file) return;
    setMsg(null);
    setPreview(null);
    setFileName(file.name);
    setReading(true);
    try {
      const wb = await readWeeklyPlanWorkbookFile(file);
      const names = listWeeklyPlanSheetNames(wb);
      const guess = guessWeeklyPlanSheet(names);
      setWorkbook(wb);
      setSheetNames(names);
      setSheetName(guess);
      runParse(wb, guess, from, to);
    } catch (err) {
      setMsg({ ok: false, text: "Could not read this file: " + err.message });
    } finally {
      setReading(false);
    }
  }

  function changeSheet(name) {
    setSheetName(name);
    if (workbook) runParse(workbook, name, from, to);
  }

  function changeRange(nextFrom, nextTo) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (workbook) runParse(workbook, sheetName, nextFrom, nextTo);
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    setMsg(null);
    try {
      // "Replace" clears the period first, so cells the planner DELETED in
      // the spreadsheet also disappear here - an upsert alone would leave
      // them behind, which is exactly the kind of stale assignment that
      // causes someone to show up for a duty that was cancelled.
      if (replace) await clearWeeklyPlanRange({ from: preview.dateRange.from, to: preview.dateRange.to });
      const result = await saveWeeklyPlanMany(preview.cells);
      setMsg({ ok: true, text: `Imported ${result.count ?? preview.cells.length} assignments (${preview.dateRange.from} to ${preview.dateRange.to}).` });
      onImported?.();
    } catch (err) {
      setMsg({ ok: false, text: "Import failed: " + err.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="roster-import-panel no-print">
      <div className="roster-import-head">
        <h2>Import Weekly Plan from Excel</h2>
        <button onClick={onCancel}>Close</button>
      </div>

      <p className="roster-note">
        Reads the planning workbook (e.g. <b>SKL WeeklySchedulePlan 2026 (V3).xlsm</b>), sheet
        <b> SKL Weekly Plan</b>. Cells are read as <code>CODE(level)</code>, e.g. <code>WJU(3)</code>.
      </p>

      <label className="file-btn primary">
        {reading ? "Reading..." : fileName ? `File: ${fileName}` : "Choose Excel file (.xlsx / .xlsm)"}
        <input type="file" accept=".xlsx,.xlsm,.xls" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      </label>

      {sheetNames.length > 0 && (
        <div className="roster-import-fields">
          <label className="settings-field">
            <span>Sheet</span>
            <select value={sheetName} onChange={(e) => changeSheet(e.target.value)}>
              {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>From date</span>
            <input type="date" lang="en" value={from} onChange={(e) => changeRange(e.target.value, to)} />
          </label>
          <label className="settings-field">
            <span>To date</span>
            <input type="date" lang="en" value={to} onChange={(e) => changeRange(from, e.target.value)} />
          </label>
        </div>
      )}

      {sheetNames.length > 0 && (
        <label className="settings-toggle">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          <span>Replace everything already planned in this date range (recommended — removes assignments deleted in the spreadsheet)</span>
        </label>
      )}

      {preview && (
        <div className="roster-import-preview">
          <div><b>{preview.cells.length}</b> assignments · <b>{preview.pilotCodes.length}</b> pilots · {preview.dateRange.from} → {preview.dateRange.to}</div>
          <div className="roster-note">Sections found: {preview.sections.join(" · ")}</div>
          {preview.missingSections.length > 0 && (
            <div className="settings-msg error">Not found in this sheet (will be left empty): {preview.missingSections.join(", ")}</div>
          )}
          {preview.unrecognized.length > 0 && (
            <div className="settings-msg error">Cells that aren't a pilot code and were skipped: {preview.unrecognized.slice(0, 12).join(", ")}{preview.unrecognized.length > 12 ? " …" : ""}</div>
          )}
          <div className="settings-actions">
            <button className="primary" onClick={handleImport} disabled={importing}>
              {importing ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      )}

      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}
