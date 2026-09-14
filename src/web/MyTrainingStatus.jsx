import { useEffect, useMemo, useState } from "react";
import { getPreferredPilotCode, getMyTraining, getSetting, isDemoSession, listExperience, openFile } from "../services/desktopDatabase.js";
import { computeTrainingRow, monitoredTrainingItems, withTrainingThresholdDefaults, withTrainingDisabledDefaults } from "../utils/trainingDue.js";
import { STATUS_LABEL } from "../utils/statusCompute.js";
import { TrainingItemCell } from "../modules/trainingDue/TrainingAllStatus.jsx";
import DocumentViewer from "../modules/trainingDue/DocumentViewer.jsx";
import "../modules/myStatus/MyStatus.css";
import "../modules/trainingDue/TrainingDue.css";
import "../modules/trainingDue/Training.css";

const LABEL = { ...STATUS_LABEL, unknown: "NO DATA" };

// Web equivalent of the PC app's "Person Training Status" tab
// (TrainingPersonStatus.jsx), simplified for one pilot: no dropdown to pick
// someone else (this web build is already paired to one pilot - see
// WebApp.jsx).
//
// Attached documents ARE shown here (Capt. Weera: "training monitor สามารถ view
// attach file ได้ด้วย เช่น passport และ license เป็นต้น") - a pilot can open
// their own passport/licence/certificate scan from their phone.
//
// This used to say documents couldn't work on the web. That was only ever true
// of attachments made from the PC app, which stores a FILE PATH on that
// computer and means nothing in a browser elsewhere. An attachment made from
// the web is stored as a data: URL inside the training record itself, arrives
// with getMyTraining(), and DocumentViewer already renders it - so those work
// on any device. DocumentViewer says so plainly for the PC-path case rather
// than failing silently.
//
// Read-only either way: training entry and attaching stay PC/Admin-only (see
// sql/web-training-readonly-rls.sql).
export default function MyTrainingStatus() {
  const [pilotCode, setPilotCode] = useState("");
  const [pilots, setPilots] = useState([]);
  const [training, setTraining] = useState(null);
  const [thresholds, setThresholds] = useState(withTrainingThresholdDefaults());
  const [disabledItems, setDisabledItems] = useState(withTrainingDisabledDefaults());
  const [branding, setBranding] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);
  // The attachment currently open in the in-page viewer, or null.
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  // A demo session isn't locked to one pilot, so it gets a dropdown to view
  // anyone's training (same idea as the FDT Monitor). A normal pilot stays
  // locked to their own paired code (no roster fetch, no dropdown).
  const demo = isDemoSession();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [preferred, roster, savedThresholds, savedDisabled, savedBranding] = await Promise.all([
        getPreferredPilotCode(),
        demo ? listExperience() : Promise.resolve([]),
        getSetting("training_thresholds"),
        getSetting("training_disabled_items"),
        getSetting("customer_branding")
      ]);
      setPilots(roster);
      setPilotCode(preferred || roster[0]?.code || "");
      setThresholds(withTrainingThresholdDefaults(savedThresholds));
      setDisabledItems(withTrainingDisabledDefaults(savedDisabled));
      setBranding(savedBranding || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Whenever the selected pilot changes (demo dropdown, or the initial code),
  // (re)load that pilot's training record.
  useEffect(() => {
    if (!pilotCode) { setTraining(null); return; }
    let cancelled = false;
    getMyTraining(pilotCode).then((rec) => { if (!cancelled) setTraining(rec); }).catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [pilotCode]);

  const computed = useMemo(
    () => (training ? computeTrainingRow(training.record, thresholds, disabledItems) : null),
    [training, thresholds, disabledItems]
  );

  // Attachments live on the training record itself, keyed by item ("passport",
  // "thaiLicense", ...). Absent for pilots who have none, hence the fallback.
  const docs = training?.record?.docs || {};

  // Show it inside the page, so it can be read AND printed without leaving the
  // app - the same thing the PC build's Person Training Status does. "Open in
  // new tab" is still offered from inside the viewer.
  function handleView(path, label) {
    setViewing({ path, title: label });
  }

  async function handleOpenExternally(path) {
    const result = await openFile(path);
    if (!result?.ok) {
      alert("Could not open the document: " + (result?.error || "unknown error"));
    }
  }

  return (
    <div className={`trainingdue-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="training-subtab-toolbar no-print">
        <p className="training-subtitle">Your training and certificate status, item by item.</p>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {demo && (
            <select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)} style={{ padding: "9px 12px", borderRadius: "10px", border: "1px solid #334155", background: "#0f172a", color: "white" }}>
              <option value="">— Select pilot —</option>
              {pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          )}
          <button onClick={() => { if (isDemoSession()) { alert("Demo account — printing is disabled."); return; } window.print(); }} disabled={!computed}>Print</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {loading && <div className="mystatus-empty">Loading...</div>}

      {!loading && error && (
        <>
          <div className="mystatus-empty">Could not load training status: {error}</div>
          <button onClick={load}>Try Again</button>
        </>
      )}

      {!loading && !error && !training && (
        <div className="mystatus-empty">No training data yet — ask your Admin to add or import your training record.</div>
      )}

      {!loading && !error && training && computed && (
        <div className="trainingperson-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="trainingall-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="training-person-detail">
            <div className="training-person-detail-head">
              <h2>{training.code} — {training.name || "-"}</h2>
              <span className={`mystatus-badge ${computed.status}`}>{LABEL[computed.status]}</span>
            </div>
            <div className="trainingdue-grid">
              {monitoredTrainingItems(disabledItems).map((item) => (
                <div key={item.key} style={{ display: "flex", flexDirection: "column" }}>
                  <TrainingItemCell item={item} result={computed.perItem[item.key]} />
                  {docs[item.key] && (
                    <button
                      type="button"
                      className="training-doc-link no-print"
                      onClick={() => handleView(docs[item.key], `${training.code} — ${item.label}`)}
                    >
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
