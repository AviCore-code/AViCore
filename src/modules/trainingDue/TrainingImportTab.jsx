import { useEffect, useMemo, useState } from "react";
import { importTrainingMany, getSetting, saveSetting, saveTraining, saveDocument } from "../../services/desktopDatabase.js";
import { parseTrainingExcelFile } from "../../services/trainingImport.js";
import { TRAINING_ITEMS } from "../../utils/trainingDue.js";
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

// Two ways to bring documents into the Training module:
//  1. Excel (bulk, structured) - the company's Training Track workbook,
//     already fully working. Re-importing preserves any certificates
//     already attached per-pilot below (Excel doesn't carry those).
//  2. Attach Document (one at a time) - a scan/photo of an actual source
//     document (Medical Class 1, Passport, License, a training certificate)
//     linked to one pilot + one training item, opened later from All/Person
//     Status with "View Document". This is what "Import PDF" means today;
//     automatic due-date extraction from a PDF isn't built (unreliable
//     across the many certificate formats/issuers involved) - a straight
//     bulk "read dates out of a PDF" importer is flagged as a possible
//     future addition below rather than guessed at now.
export default function TrainingImportTab({ pilots, thresholds, onImported }) {
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [applyThresholds, setApplyThresholds] = useState(true);
  const [importMsg, setImportMsg] = useState(null);

  const [docCode, setDocCode] = useState("");
  const [docItem, setDocItem] = useState(TRAINING_ITEMS[0].key);
  const [docFile, setDocFile] = useState(null);
  const [docUploading, setDocUploading] = useState(false);
  const [docMsg, setDocMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

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
      await onImported();
    } catch (err) {
      setImportMsg({ ok: false, text: "Import failed: " + err.message });
    } finally {
      setImporting(false);
    }
  }

  async function handleAttachDocument() {
    if (!docCode || !docFile) return;
    setDocUploading(true);
    setDocMsg(null);
    try {
      const pilot = pilots.find((p) => p.code === docCode);
      if (!pilot) throw new Error("Pilot not found.");
      // In the browser build there is no filesystem, so the document is kept
      // inside the pilot's training record as base64 - which is a third
      // larger than the file and is then re-downloaded by every page that
      // reads training records. A scan of a certificate is a few hundred KB;
      // anything much past that is a photo that should be reduced first.
      if (docFile.size > MAX_DOC_BYTES) {
        throw new Error(
          `${(docFile.size / 1048576).toFixed(1)} MB is too large — the limit is ${MAX_DOC_BYTES / 1048576} MB. ` +
          "Scan or export it at a lower resolution and try again."
        );
      }
      const dataUrl = await fileToDataUrl(docFile);
      const filename = `${docCode}_${docItem}_${Date.now()}.${extFromFile(docFile)}`;
      const path = await saveDocument(dataUrl, "TrainingDocs", filename);
      const record = { ...pilot.record, docs: { ...(pilot.record?.docs || {}), [docItem]: path } };
      await saveTraining(pilot.code, pilot.name, record);
      setDocMsg({ ok: true, text: `Attached ${docFile.name} to ${docCode} — ${TRAINING_ITEMS.find((i) => i.key === docItem)?.label}.` });
      setDocFile(null);
      await onImported();
    } catch (err) {
      setDocMsg({ ok: false, text: "Attach failed: " + err.message });
    } finally {
      setDocUploading(false);
    }
  }

  return (
    <div className={`trainingdue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header" style={{ marginBottom: "10px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "16px" }}>Import Excel</h2>
          <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12.5px" }}>Bulk-loads every pilot's due dates from the company's Training Track workbook (sheets "INPUT DATA" + "Pilot Training DUE Monitor").</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <label className={`trainingdue-import-btn${importing ? " busy" : ""}`}>
            {importing ? "Importing..." : "Import Excel"}
            <input
              type="file" accept=".xlsx,.xlsm" hidden disabled={importing}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
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

      <div className="training-doc-attach">
        <h2>Attach Document (PDF / Photo)</h2>
        <p>Attach a scanned certificate — Medical Class 1, Passport, License, or a training certificate — to one pilot's item. Viewable later from All / Person Training Status.</p>

        <div className="training-pilot-picker">
          <select value={docCode} onChange={(e) => setDocCode(e.target.value)}>
            <option value="">-- Pilot --</option>
            {sorted.map((p) => (
              <option key={p.code} value={p.code}>{p.code} — {p.name || "(no name)"}</option>
            ))}
          </select>
          <select value={docItem} onChange={(e) => setDocItem(e.target.value)}>
            {TRAINING_ITEMS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          <label className="trainingdue-import-btn" style={{ background: docFile ? "linear-gradient(135deg,#16a34a,#22c55e)" : undefined }}>
            {docFile ? docFile.name : "Choose File"}
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
          </label>
          <button className="primary" onClick={handleAttachDocument} disabled={!docCode || !docFile || docUploading}>
            {docUploading ? "Uploading..." : "Attach"}
          </button>
        </div>

        {docMsg && <div className={`settings-msg ${docMsg.ok ? "ok" : "error"}`}>{docMsg.text}</div>}
      </div>

      <div className="training-coming-soon">
        Bulk "read dates automatically from a PDF" import — coming soon. For now, attach the source document above and enter/confirm its due date on the Input tab.
      </div>
    </div>
  );
}
