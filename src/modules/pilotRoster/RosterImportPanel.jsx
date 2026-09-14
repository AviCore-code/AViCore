import { useState } from "react";
import { readRosterWorkbookFile, parseRosterWorkbook, listRosterSheetNames } from "../../services/rosterImport.js";
import { importRosterMany } from "../../services/desktopDatabase.js";
import "./PilotRoster.css";

// The company's roster workbook carries ~90+ sheets (years of drafts and
// revisions), so this doesn't guess which one is "current" - it just
// pre-selects the sheet named "RR <year>" with the highest year (falling
// back to the first sheet) and lets the person confirm/change it before
// anything is imported.
function guessDefaultSheet(names) {
  const rrSheets = names
    .map((n) => ({ n, m: n.match(/^RR\s?(\d{4})$/i) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(b.m[1]) - Number(a.m[1]));
  return rrSheets.length ? rrSheets[0].n : names[0];
}

export default function RosterImportPanel({ onImported, onCancel }) {
  const [workbook, setWorkbook] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const [sheetName, setSheetName] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);

  function runParse(wb, name) {
    try {
      const result = parseRosterWorkbook(wb, name);
      setPreview(result);
      setMsg(null);
    } catch (err) {
      setPreview(null);
      setMsg({ ok: false, text: err.message });
    }
  }

  async function handleFile(file) {
    setMsg(null);
    setPreview(null);
    setFileName(file.name);
    setReading(true);
    try {
      const wb = await readRosterWorkbookFile(file);
      const names = listRosterSheetNames(wb);
      setWorkbook(wb);
      setSheetNames(names);
      const guess = guessDefaultSheet(names);
      setSheetName(guess);
      runParse(wb, guess);
    } catch (err) {
      setMsg({ ok: false, text: "Could not read this file: " + err.message });
    } finally {
      setReading(false);
    }
  }

  function handleSheetChange(e) {
    const name = e.target.value;
    setSheetName(name);
    if (workbook) runParse(workbook, name);
  }

  async function handleConfirm() {
    if (!preview) return;
    setImporting(true);
    try {
      await importRosterMany(preview.entries);
      setMsg({ ok: true, text: `Replaced roster for ${preview.pilots.length} pilot(s), ${preview.dateRange.from} to ${preview.dateRange.to}. Blank Excel cells cleared previous entries.` });
      setPreview(null);
      await onImported?.();
    } catch (err) {
      setMsg({ ok: false, text: "Import failed: " + err.message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="roster-import-panel">
      <div className="module-header" style={{ marginBottom: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "16px" }}>Import Duty Schedule from Excel</h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12.5px" }}>
            Imports the selected sheet and replaces the schedule for its pilots and date columns. Blank Excel cells delete previous entries. Pilots and dates outside the sheet are unchanged.
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <label className={`roster-import-btn${reading ? " busy" : ""}`}>
            {reading ? "Reading..." : fileName || "Choose File"}
            <input
              type="file" accept=".xlsx,.xls,.xlsm" hidden disabled={reading}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
          <button onClick={onCancel}>Close</button>
        </div>
      </div>

      {sheetNames.length > 0 && (
        <div className="roster-import-row">
          <label>Sheet</label>
          <select value={sheetName} onChange={handleSheetChange}>
            {sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      )}

      {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {preview && (
        <div className="roster-preview">
          <h2>Import preview — {preview.pilots.length} pilot(s), {preview.entries.length} daily entries</h2>
          <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: "12.5px" }}>
            Date range: {preview.dateRange.from} → {preview.dateRange.to}
            {" · "}{preview.entries.filter((entry) => entry.clearExisting).length} blank cells will clear previous entries.
          </p>
          <div className="roster-preview-list">
            {preview.pilots.map((p) => (
              <span className="roster-chip" key={p.pilotCode}>{p.pilotCode} — {p.pilotName || "(no name)"}</span>
            ))}
          </div>
          <div className="roster-preview-actions">
            <button className="primary" onClick={handleConfirm} disabled={importing}>
              {importing ? "Importing..." : `Import ${preview.entries.length} entries`}
            </button>
            <button onClick={() => setPreview(null)} disabled={importing}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
