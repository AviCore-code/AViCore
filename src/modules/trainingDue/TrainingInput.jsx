import { useEffect, useMemo, useRef, useState } from "react";
import { saveTraining, importTrainingMany, getSetting, saveSetting, saveDocument, openFile } from "../../services/desktopDatabase.js";
import { parseTrainingExcelFile } from "../../services/trainingImport.js";
import { TRAINING_ITEMS, formatDueDate } from "../../utils/trainingDue.js";
import DocumentViewer from "./DocumentViewer.jsx";
import "./TrainingDue.css";
import "./Training.css";

// Attached documents live inside the training record on the web build, so
// they travel with every read of it. Five megabytes is generous for a
// scanned certificate and small enough not to make the Training pages crawl.
const MAX_DOC_BYTES = 5 * 1024 * 1024;

function extFromFile(file) {
  const m = /\.(\w+)$/.exec(file.name || "");
  return m ? m[1].toLowerCase() : (file.type === "application/pdf" ? "pdf" : "jpg");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const NEW_PILOT = "__new__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isLifetime(v) {
  return typeof v === "string" && /life/i.test(v);
}

function fullYear(y) {
  y = Number(y);
  return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
}
function toIso(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Free-typed "6 Jul 2026" / "6 July 26" / "6/7/2026" / ISO "2026-07-06" ->
// ISO "YYYY-MM-DD". Returns null if unparseable (blocks Save on that field).
function parseTypedDate(text) {
  const s = (text || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toIso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
  if (m) {
    const mi = MONTHS.findIndex((mo) => mo.toLowerCase() === m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return toIso(fullYear(m[3]), mi + 1, m[1]);
    return null;
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return toIso(fullYear(m[3]), m[2], m[1]);
  return null;
}

// Stored due dates come back either as a Date (fresh from Excel import) or
// an ISO string (Date objects get JSON.stringify'd on save) - both parse
// fine here. Uses UTC getters since due dates are snapped to UTC midnight
// (see trainingImport.js's cleanExcelDate) - a local-time read could roll
// the displayed day back by one depending on the system timezone.
function toDisplayText(v) {
  if (v == null || v === "" || isLifetime(v)) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return formatDueDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}

// ISO "YYYY-MM-DD" (native <input type="date"> value) -> the same "D Mon
// YYYY" display text, for filling the typed field when picked from the
// calendar assist button.
function pickerValueToDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatDueDate(new Date(Date.UTC(y, m - 1, d)));
}

// Typed display text -> "YYYY-MM-DD" for seeding the native date picker's
// current value (so opening the picker starts on the already-typed date
// rather than always today). Returns "" if the text doesn't parse (picker
// then just opens on today, which is fine).
function toPickerValue(text) {
  return parseTypedDate(text) || "";
}

function blankValues() {
  const v = {};
  for (const item of TRAINING_ITEMS) v[item.key] = item.type === "count" ? "" : "";
  return v;
}

function valuesFromRecord(record) {
  const v = {};
  for (const item of TRAINING_ITEMS) {
    const raw = record?.[item.key];
    if (item.type === "count") v[item.key] = raw == null ? "" : String(raw);
    else v[item.key] = isLifetime(raw) ? "For life" : toDisplayText(raw);
  }
  return v;
}

// Single date/lifetime field: one text input (typed "D Mon YYYY" or "For
// life") plus a calendar-icon-only button that opens a hidden native
// input[type=date] via showPicker() for choosing without typing. Left
// blank on Save, an item that was already "For life" stays "For life" -
// there's no separate toggle for it anymore (removed per an earlier
// request), typing "for life" directly still sets it, and typing a real
// date always overrides.
function TrainingDateField({ value, onChange, invalid }) {
  const nativeRef = useRef(null);
  return (
    <div className="row training-datefield">
      <input
        type="text"
        className={invalid ? "invalid" : ""}
        placeholder="d mmm yyyy or 'For life'"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="date-pick-icon"
        title="Pick a date"
        onClick={() => nativeRef.current?.showPicker?.()}
      >
        📅
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="training-datefield-native"
        value={toPickerValue(value)}
        onChange={(e) => onChange(pickerValueToDisplay(e.target.value))}
        tabIndex={-1}
      />
    </div>
  );
}

// Combined "Input / Import" tab (was two tabs: "Input" and "Import PDF /
// Excel"). One place to:
//  - bulk-load every pilot from the Training Track Excel workbook (top bar),
//  - add or correct one pilot by hand (form below), and
//  - attach / view / replace the source document (PDF or photo) for each
//    item right under that item's date field, so the date and its
//    certificate are entered together.
// Excel re-imports and manual saves both preserve already-attached docs.
export default function TrainingInput({ pilots, thresholds, onSaved }) {
  const [selected, setSelected] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [values, setValues] = useState(blankValues());
  const [invalidKeys, setInvalidKeys] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Excel import
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applyThresholds, setApplyThresholds] = useState(true);
  const [importMsg, setImportMsg] = useState(null);

  // Per-item documents
  const [docBusyKey, setDocBusyKey] = useState(null);
  const [docMsg, setDocMsg] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const sorted = useMemo(
    () => pilots.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [pilots]
  );
  const editingPilot = sorted.find((p) => p.code === selected) || null;

  useEffect(() => {
    setMsg(null);
    setDocMsg(null);
    setInvalidKeys(new Set());
    if (selected === NEW_PILOT) {
      setNewCode("");
      setNewName("");
      setValues(blankValues());
    } else if (editingPilot) {
      setValues(valuesFromRecord(editingPilot.record));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, reloadKey]);

  function updateField(key, val) {
    setValues((v) => ({ ...v, [key]: val }));
    setInvalidKeys((cur) => { if (!cur.has(key)) return cur; const next = new Set(cur); next.delete(key); return next; });
  }

  async function handleSave() {
    const code = selected === NEW_PILOT ? newCode.trim() : editingPilot?.code;
    const name = selected === NEW_PILOT ? newName.trim() : editingPilot?.name;
    if (!code) {
      setMsg({ ok: false, text: "Pilot code is required." });
      return;
    }

    const record = {};
    const badKeys = new Set();
    for (const item of TRAINING_ITEMS) {
      if (item.type === "count") {
        record[item.key] = values[item.key] === "" ? null : Number(values[item.key]);
        continue;
      }
      const text = (values[item.key] || "").trim();
      const wasLifetime = isLifetime(editingPilot?.record?.[item.key]);
      if (text === "") {
        record[item.key] = wasLifetime ? "For life" : null; // blank preserves an existing "For life", clears an existing date
      } else if (/life/i.test(text)) {
        record[item.key] = "For life";
      } else {
        const iso = parseTypedDate(text);
        if (!iso) { badKeys.add(item.key); continue; }
        record[item.key] = iso;
      }
    }

    if (badKeys.size > 0) {
      setInvalidKeys(badKeys);
      setMsg({ ok: false, text: `Couldn't read ${badKeys.size} date${badKeys.size > 1 ? "s" : ""} - use "D Mon YYYY" (e.g. 6 Jul 2026), or "For life".` });
      return;
    }

    // Keep any documents already attached to this pilot - this form doesn't
    // touch record.docs, so overwrite would silently detach every attached
    // certificate on the next save without this.
    if (editingPilot?.record?.docs) record.docs = editingPilot.record.docs;

    setSaving(true);
    setMsg(null);
    try {
      await saveTraining(code, name, record);
      await onSaved();
      if (selected === NEW_PILOT) setSelected(code); // now attach documents to it right away
      setMsg({ ok: true, text: `Saved ${code}.` });
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleExcelFile(file) {
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
      const byCode = new Map(pilots.map((p) => [p.code, p]));
      const payload = preview.pilots.map((p) => {
        const existingDocs = byCode.get(p.code)?.record?.docs;
        const record = existingDocs ? { ...p.record, docs: existingDocs } : p.record;
        return { code: p.code, name: p.name, record };
      });
      await importTrainingMany(payload);
      if (applyThresholds && preview.thresholds) {
        const current = await getSetting("training_thresholds");
        await saveSetting("training_thresholds", { ...(current || thresholds), ...preview.thresholds });
      }
      setImportMsg({ ok: true, text: `Imported ${preview.pilots.length} pilot(s).` });
      setPreview(null);
      await onSaved();
      setReloadKey((k) => k + 1); // show the imported dates in the form for the selected pilot
    } catch (err) {
      setImportMsg({ ok: false, text: "Import failed: " + err.message });
    } finally {
      setImporting(false);
    }
  }

  async function handleAttach(itemKey, file) {
    if (!editingPilot || !file) return;
    const label = TRAINING_ITEMS.find((i) => i.key === itemKey)?.label || itemKey;
    setDocBusyKey(itemKey);
    setDocMsg(null);
    try {
      // In the browser build the document is kept inside the pilot's training
      // record as base64, re-downloaded by every page that reads training.
      if (file.size > MAX_DOC_BYTES) {
        throw new Error(
          `${(file.size / 1048576).toFixed(1)} MB is too large — the limit is ${MAX_DOC_BYTES / 1048576} MB. ` +
          "Scan or export it at a lower resolution and try again."
        );
      }
      const dataUrl = await fileToDataUrl(file);
      const filename = `${editingPilot.code}_${itemKey}_${Date.now()}.${extFromFile(file)}`;
      const path = await saveDocument(dataUrl, "TrainingDocs", filename);
      // Saves the stored record + the new doc only; dates typed in the form
      // but not saved yet stay in the form until "Save Pilot".
      const record = { ...editingPilot.record, docs: { ...(editingPilot.record?.docs || {}), [itemKey]: path } };
      await saveTraining(editingPilot.code, editingPilot.name, record);
      await onSaved();
      setDocMsg({ ok: true, text: `Attached ${file.name} to ${editingPilot.code} — ${label}.` });
    } catch (err) {
      setDocMsg({ ok: false, text: "Attach failed: " + err.message });
    } finally {
      setDocBusyKey(null);
    }
  }

  async function handleView(path, title) {
    if (window.aviCoreAPI) {
      const result = await openFile(path);
      if (!result.ok) alert("Could not open the file: " + (result.error || "unknown error"));
      return;
    }
    setViewing({ path, title });
  }

  async function handleOpenExternally(path) {
    const result = await openFile(path);
    if (!result.ok) alert("Could not open the file: " + (result.error || "unknown error"));
  }

  const docs = editingPilot?.record?.docs || {};

  return (
    <div className={`trainingdue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="training-subtab-toolbar">
        <p className="training-subtitle">Import every pilot from the Training Track Excel, or pick one pilot to type dates by hand and attach each certificate (PDF / photo) under its item.</p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label className={`trainingdue-import-btn${importing ? " busy" : ""}`} title='Training Track workbook (sheets "INPUT DATA" + "Pilot Training DUE Monitor")'>
            {importing ? "Importing..." : "📥 Import Excel"}
            <input
              type="file" accept=".xlsx,.xlsm" hidden disabled={importing}
              onChange={(e) => { if (e.target.files?.[0]) handleExcelFile(e.target.files[0]); e.target.value = ""; }}
            />
          </label>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
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

      <div className="training-pilot-picker">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">-- Select pilot to edit --</option>
          <option value={NEW_PILOT}>+ New pilot</option>
          {sorted.map((p) => (
            <option key={p.code} value={p.code}>{p.code} — {p.name || "(no name)"}</option>
          ))}
        </select>

        {selected === NEW_PILOT && (
          <>
            <input type="text" placeholder="Code (3 letters)" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} maxLength={6} />
            <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </>
        )}
      </div>

      {(selected === NEW_PILOT || editingPilot) && (
        <>
          <div className="training-form-grid">
            {TRAINING_ITEMS.map((item) => (
              <div className="training-form-field" key={item.key}>
                <label className="title">{item.label}</label>
                {item.type === "count" ? (
                  <div className="row">
                    <input type="number" min="0" placeholder="count (180d)" value={values[item.key] ?? ""} onChange={(e) => updateField(item.key, e.target.value)} />
                  </div>
                ) : (
                  <TrainingDateField
                    value={values[item.key] || ""}
                    onChange={(v) => updateField(item.key, v)}
                    invalid={invalidKeys.has(item.key)}
                  />
                )}
                <div className="doc-row">
                  {docs[item.key] && (
                    <button type="button" onClick={() => handleView(docs[item.key], `${editingPilot.code} — ${item.label}`)}>📄 View</button>
                  )}
                  {editingPilot ? (
                    <label className="doc-upload" title="Attach a PDF or photo of this certificate">
                      {docBusyKey === item.key ? "Uploading..." : docs[item.key] ? "Replace" : "📎 Attach"}
                      <input
                        type="file" accept=".pdf,.jpg,.jpeg,.png" hidden disabled={docBusyKey !== null}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleAttach(item.key, f); }}
                      />
                    </label>
                  ) : (
                    <span className="doc-path" style={{ color: "#64748b" }}>Save pilot first to attach</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="settings-actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Pilot"}</button>
          </div>
          {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
        </>
      )}

      {docMsg && <div className={`settings-msg ${docMsg.ok ? "ok" : "error"}`}>{docMsg.text}</div>}

      {viewing && (
        <DocumentViewer
          path={viewing.path}
          title={viewing.title}
          onClose={() => setViewing(null)}
          onOpenExternally={handleOpenExternally}
        />
      )}
    </div>
  );
}
