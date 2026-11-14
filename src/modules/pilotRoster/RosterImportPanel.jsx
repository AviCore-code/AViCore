import { useMemo, useState } from "react";
import { readRosterWorkbookFile, parseRosterWorkbook, listRosterSheetNames, guessRosterSheet } from "../../services/rosterImport.js";
import { replaceRosterRange } from "../../services/desktopDatabase.js";
import "./PilotRoster.css";

// The part of the sheet to import: "all" = the sheet's whole date range, or a
// from/to picked by the scheduler. Whatever range is chosen is REPLACED on
// the roster (old rows removed, the sheet copied exactly); days outside it are
// left alone.
export function entriesInRange(entries, from, to) {
  return (entries || []).filter((e) => e.date >= from && e.date <= to);
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
  const [rangeMode, setRangeMode] = useState("all");   // "all" | "custom"
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function runParse(wb, name) {
    try {
      const result = parseRosterWorkbook(wb, name);
      setPreview(result);
      setFrom(result.dateRange.from);
      setTo(result.dateRange.to);
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
      const guess = guessRosterSheet(names);
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

  // The range actually used: the whole sheet, or the picked dates clipped to it.
  const range = useMemo(() => {
    if (!preview) return null;
    const sheet = preview.dateRange;
    if (rangeMode === "all") return { from: sheet.from, to: sheet.to };
    const f = from && from > sheet.from ? from : sheet.from;
    const t = to && to < sheet.to ? to : sheet.to;
    return { from: f, to: t };
  }, [preview, rangeMode, from, to]);

  const rangeError = range && range.from > range.to ? "The start date is after the end date." : "";
  const selected = useMemo(
    () => (preview && range && !rangeError ? entriesInRange(preview.entries, range.from, range.to) : []),
    [preview, range, rangeError]
  );

  async function handleConfirm() {
    if (!preview || !range || rangeError || !selected.length) return;
    setImporting(true);
    try {
      const result = await replaceRosterRange(selected, range);
      const filled = selected.filter((e) => !e.clearExisting).length;
      setMsg({ ok: true, text: result?.queued
        ? `Saved on this device; waiting to sync. ${range.from} → ${range.to} will be replaced with this sheet.`
        : `Replaced ${range.from} → ${range.to}: removed ${result?.removed ?? 0} old cell(s), wrote ${filled} from "${preview.sheetName}" (${preview.pilots.length} pilots).` });
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
            Loads one sheet from the company's roster workbook — the latest "RR &lt;year&gt;_Add Training" sheet is picked by default; choose another below if needed. Import the whole sheet or only a date range. <b>The chosen range is replaced</b>: everything already on the roster for those dates (every pilot) is removed first, then the sheet is copied exactly. Days outside the range are unchanged.
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

      {preview && range && (
        <div className="roster-preview">
          <h2>Import preview — {preview.pilots.length} pilot(s)</h2>

          <div className="roster-import-row roster-import-range" style={{ flexWrap: "wrap", gap: "10px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="radio" name="roster-range" checked={rangeMode === "all"} onChange={() => setRangeMode("all")} />
              All dates in the sheet ({preview.dateRange.from} → {preview.dateRange.to})
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input type="radio" name="roster-range" checked={rangeMode === "custom"} onChange={() => setRangeMode("custom")} />
              Only from
            </label>
            <input
              type="date" aria-label="From date" value={from}
              min={preview.dateRange.from} max={preview.dateRange.to}
              onChange={(e) => { setFrom(e.target.value); setRangeMode("custom"); }}
            />
            <span>to</span>
            <input
              type="date" aria-label="To date" value={to}
              min={preview.dateRange.from} max={preview.dateRange.to}
              onChange={(e) => { setTo(e.target.value); setRangeMode("custom"); }}
            />
          </div>

          <p style={{ margin: "0 0 12px", color: "#94a3b8", fontSize: "12.5px" }}>
            {rangeError
              ? <span style={{ color: "#fca5a5" }}>{rangeError}</span>
              : <>Will replace <b>{range.from} → {range.to}</b> with {selected.length} daily cells from "{preview.sheetName}". Everything currently on the roster for these dates is removed first.</>}
          </p>
          <div className="roster-preview-list">
            {preview.pilots.map((p) => (
              <span className="roster-chip" key={p.pilotCode}>{p.pilotCode} — {p.pilotName || "(no name)"}</span>
            ))}
          </div>
          <div className="roster-preview-actions">
            <button className="primary" onClick={handleConfirm} disabled={importing || !!rangeError || !selected.length}>
              {importing ? "Importing..." : `Import ${range.from} → ${range.to}`}
            </button>
            <button onClick={() => setPreview(null)} disabled={importing}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
