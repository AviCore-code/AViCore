import { useEffect, useMemo, useState } from "react";
import DocumentViewer from "./DocumentViewer.jsx";
import { openFile, getSetting, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { computeTrainingRow, monitoredTrainingItems } from "../../utils/trainingDue.js";
import { STATUS_LABEL } from "../../utils/statusCompute.js";
import { TrainingItemCell } from "./TrainingAllStatus.jsx";
import "../myStatus/MyStatus.css";
import "./TrainingDue.css";
import "./Training.css";

const LABEL = { ...STATUS_LABEL, unknown: "NO DATA" };

// Single-pilot detail view - same 31-item breakdown as the expanded row in
// All Training Status, but as its own dedicated page (useful for printing
// or reviewing just one pilot's currency without scrolling the fleet
// table), plus a "View Document" link per item when a certificate/photo
// has been attached via the Import PDF/Excel tab's document-attach section.
export default function TrainingPersonStatus({ pilots, thresholds, disabledItems, loading }) {
  const [code, setCode] = useState("");
  const [branding, setBranding] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  // The attachment currently open in the in-page viewer, or null.
  const [viewing, setViewing] = useState(null);

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

  const sorted = useMemo(
    () => pilots.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [pilots]
  );

  const pilot = sorted.find((p) => p.code === code) || null;
  const computed = pilot ? computeTrainingRow(pilot.record, thresholds, disabledItems) : null;
  const docs = pilot?.record?.docs || {};

  // Show it in the page (viewable AND printable). Opening it in a new tab is
  // still available from inside the viewer, and is what the PC build does,
  // where a document is a real file on disk rather than data in the record.
  async function handleView(path, label) {
    if (window.aviCoreAPI) {
      const result = await openFile(path);
      if (!result.ok) alert("Could not open the file: " + (result.error || "unknown error"));
      return;
    }
    setViewing({ path, title: label });
  }

  async function handleOpenExternally(path) {
    const result = await openFile(path);
    if (!result.ok) alert("Could not open the file: " + (result.error || "unknown error"));
  }

  async function handleExport() {
    setExporting(true);
    setExportMsg("");
    try {
      const result = await exportLogbookPdf(`TrainingStatus_${pilot?.code || "pilot"}.pdf`);
      if (result?.ok && result.filePath) setExportMsg(`Saved: ${result.filePath}`);
    } catch (err) {
      setExportMsg("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`trainingdue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="training-subtab-toolbar no-print">
        <p className="training-subtitle">Pick a pilot to see their full training/certificate status in one place.</p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => window.print()} disabled={!pilot}>Print</button>
          <button onClick={handleExport} disabled={exporting || !pilot}>{exporting ? "Exporting..." : "Export PDF"}</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>
      {exportMsg && <div className="trainingall-export-msg no-print">{exportMsg}</div>}

      <div className="training-pilot-picker no-print">
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">-- Select pilot --</option>
          {sorted.map((p) => (
            <option key={p.code} value={p.code}>{p.code} — {p.name || "(no name)"}</option>
          ))}
        </select>
      </div>

      {loading && <div className="mystatus-empty">Loading...</div>}
      {!loading && !pilot && sorted.length === 0 && (
        <div className="mystatus-empty">No training data yet — use "Import PDF / Excel" or "Input" to add pilots.</div>
      )}

      {pilot && computed && (
        <div className="trainingperson-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="trainingall-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="training-person-detail">
            <div className="training-person-detail-head">
              <h2>{pilot.code} — {pilot.name || "-"}</h2>
              <span className={`mystatus-badge ${computed.status}`}>{LABEL[computed.status]}</span>
            </div>
            <div className="trainingdue-grid">
              {monitoredTrainingItems(disabledItems).map((item) => (
                <div key={item.key} style={{ display: "flex", flexDirection: "column" }}>
                  <TrainingItemCell item={item} result={computed.perItem[item.key]} />
                  {docs[item.key] && (
                    <button type="button" className="training-doc-link no-print" onClick={() => handleView(docs[item.key], `${pilot.code} — ${item.label}`)}>
                      View Document
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
