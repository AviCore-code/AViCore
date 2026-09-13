import { useEffect, useMemo, useState } from "react";
import { parseFdtExcelFileToEntries } from "../../services/fdtImport.js";
import { addDutyEntriesMany, removeDutyEntriesBySourceFile, listImportedFdtFiles } from "../../services/desktopDatabase.js";
import "./DutyImport.css";

export default function DutyImport() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [notices, setNotices] = useState([]);
  const [files, setFiles] = useState([]);
  const [aircraftType, setAircraftType] = useState("");
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => { refreshFiles(); }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  // Grouped by pilot code so a pilot's files sit together - the only way to
  // SEE a duplicate is to have both rows adjacent.
  const sortedFiles = useMemo(
    () => [...(files || [])].sort(
      (a, b) => String(a.code || "").localeCompare(String(b.code || "")) ||
                String(a.filename || "").localeCompare(String(b.filename || ""))
    ),
    [files]
  );

  // Pilots with more than one imported file.
  //
  // This matters because replace-on-import is keyed by FILENAME
  // (removeDutyEntriesBySourceFile), not by pilot: re-uploading
  // "PDE_FDT.xlsx" replaces only the rows from that exact name. Upload the
  // same pilot's data as "PDE_FDT(1).xlsx" and BOTH sets stay live, so every
  // duty period is counted twice and DT/FT read higher than the pilot's own
  // FDT file - with nothing on screen to say why.
  // Only IMPORTED FILES are counted. The "(not from a file)" row is a pilot's
  // own hand-typed duty entries, which this list shows so they are visible
  // somewhere - it is not a second copy of anything.
  //
  // Counting it caused a false alarm: the moment a pilot saved a single Daily
  // Duty entry, their code appeared twice here and the banner told the admin to
  // "remove the older file". Following that advice would have deleted real work.
  // Nothing is double-counted in this case - typed entries and imported rows are
  // separate duty periods.
  const dupCodes = useMemo(() => {
    const seen = new Map();
    for (const f of files || []) {
      if (f.manual) continue;
      const c = String(f.code || "").toUpperCase();
      seen.set(c, (seen.get(c) || 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([c]) => c));
  }, [files]);

  const isDup = (f) => dupCodes.has(String(f?.code || "").toUpperCase());

  async function refreshFiles() {
    setFiles(await listImportedFdtFiles());
  }

  async function handleFiles(fileList) {
    const fileArr = Array.from(fileList);
    if (!fileArr.length || uploading) return;
    setUploading(true);
    const newNotices = [];
    try {
      for (let index = 0; index < fileArr.length; index += 1) {
        const file = fileArr[index];
        try {
          setUploadProgress({ current: index + 1, total: fileArr.length, fileName: file.name, phase: "Reading workbook" });
          // Give React two frames to paint the loader before XLSX parsing starts.
          // Without this, a large synchronous workbook can block the first paint,
          // making the page look frozen even though the import is running.
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const { code, entries, validation } = await parseFdtExcelFileToEntries(file);
        // The source Excel has no aircraft-type column (only tail number),
        // so every flight entry in this upload is tagged with whatever type
        // was entered above - correct as long as one _FDT.xlsx file covers
        // one fleet assignment (validated against real CSU data: PICUS/SIC
        // increases matched the updated PES PDF exactly when treated this way).
        const tagged = aircraftType.trim()
          ? entries.map((e) => (e.dutyType === "flight" ? { ...e, aircraftType: aircraftType.trim() } : e))
          : entries;
          setUploadProgress({ current: index + 1, total: fileArr.length, fileName: file.name, phase: "Saving duty records" });
          const result = await addDutyEntriesMany(code, tagged);
        const flightCount = entries.filter((e) => e.dutyType === "flight").length;
        const nonFlightCount = entries.length - flightCount;
        newNotices.push({
          filename: file.name, code, flightCount, nonFlightCount,
          replaced: result?.replaced > 0, validation, ok: true
        });
        } catch (err) {
          newNotices.push({ filename: file.name, error: err.message, ok: false });
        }
      }
      setNotices((prev) => [...newNotices, ...prev]);
      setUploadProgress({ current: fileArr.length, total: fileArr.length, fileName: "", phase: "Refreshing file list" });
      await refreshFiles();
    } finally {
      setUploadProgress(null);
      setUploading(false);
    }
  }

  async function handleRemove(file) {
    // Hand-typed entries get a stronger warning: an imported file can always be
    // uploaded again, but a duty somebody typed in has no copy anywhere.
    const msg = file.manual
      ? `Delete every duty entry for ${file.code} that did NOT come from a file?\n\n` +
        `These were typed in by hand (${file.flightCount} flight, ${file.nonFlightCount} non-flight). ` +
        `There is no file to re-import them from — this cannot be undone.`
      : `Delete all data imported from "${file.filename}" (pilot ${file.code})?`;
    if (!confirm(msg)) return;
    await removeDutyEntriesBySourceFile(file.code, file.filename);
    await refreshFiles();
  }

  return (
    <div className={`dutyimport-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header">
        <div>
          <h1>Import FDT</h1>
          <p>Upload each pilot's _FDT.xlsx file (DT sheet + Logbook sheet) — the data is added automatically to that pilot's Daily Duty. Re-uploading a file with the same name automatically replaces its previous data.</p>
        </div>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <label className="dutyimport-type">
        <span>Aircraft Type (the type flown in the file you're about to upload)</span>
        <input value={aircraftType} onChange={(e) => setAircraftType(e.target.value)} placeholder="e.g. AW139" />
      </label>

      <div
        className={`dutyimport-dropzone${dragOver ? " over" : ""}${uploading ? " busy" : ""}`}
        aria-busy={uploading}
        aria-live="polite"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length && !uploading) handleFiles(e.dataTransfer.files); }}
        onClick={() => !uploading && document.getElementById("dutyimport-file-input").click()}
      >
        {uploading ? (
          <div className="dutyimport-loader" role="status">
            <div className="dutyimport-flight" aria-hidden="true">
              <span className="dutyimport-helicopter">🚁</span>
              <span className="dutyimport-flightline" />
            </div>
            <div>
              <div className="dutyimport-title">{uploadProgress?.phase || "Preparing import"}...</div>
              {uploadProgress?.fileName && <div className="dutyimport-current-file">{uploadProgress.fileName}</div>}
              <div className="dutyimport-sub">File {uploadProgress?.current || 1} of {uploadProgress?.total || 1} · Please keep this page open</div>
            </div>
          </div>
        ) : (
          <>
            <div className="dutyimport-title">Drop _FDT.xlsx files here, or click to select (multiple allowed)</div>
            <div className="dutyimport-sub">Filenames must start with the pilot's 3-letter code, e.g. CSU_FDT.xlsx</div>
          </>
        )}
        <input
          id="dutyimport-file-input" type="file" accept=".xlsx" multiple hidden disabled={uploading}
          onChange={async (e) => {
            if (e.target.files.length) await handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notices.length > 0 && (
        <div className="dutyimport-log">
          {notices.map((n, i) => (
            <div key={i} className={`dutyimport-row${n.ok ? "" : " error"}`}>
              {n.ok ? (
                <>
                  <span className="dutyimport-code">{n.code}</span>
                  <span className="dutyimport-detail">
                    {n.filename} — Flight {n.flightCount} · Non-Flight {n.nonFlightCount}
                    {n.replaced ? " · replaced this file's previous data" : ""}
                    {n.validation?.summary?.firstDate ? ` · ${n.validation.summary.firstDate} to ${n.validation.summary.lastDate}` : ""}
                    {n.validation?.warnings?.length ? ` · Warning: ${n.validation.warnings.join(" ")}` : " · Structure checked"}
                  </span>
                </>
              ) : (
                <span className="dutyimport-detail">✕ {n.filename} — {n.error}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="dutyimport-files">
        <h2>
          Files in the system
          {files.length > 0 && <span className="dutyimport-count">{files.length} file(s)</span>}
        </h2>
        {dupCodes.size > 0 && (
          <div className="dutyimport-empty" style={{ borderColor: "rgba(251,191,36,.45)", color: "#fbbf24", marginBottom: 10 }}>
            <b>{[...dupCodes].join(", ")}</b> {dupCodes.size === 1 ? "has" : "have"} more than one file
            imported. Duty hours from every file are counted together, so a pilot listed twice reads
            higher than their FDT file. Remove the older file, then re-import.
          </div>
        )}
        {files.length === 0 && <div className="dutyimport-empty">No files imported yet.</div>}
        {files.length > 0 && (
          <div className="dutyimport-log dutyimport-filelist">
            {sortedFiles.map((f, i) => (
              <div key={i} className={`dutyimport-row${isDup(f) ? " dup" : ""}`}>
                <span className="dutyimport-code">{f.code}</span>
                <span className="dutyimport-detail">
                  {f.filename} — Flight {f.flightCount} · Non-Flight {f.nonFlightCount}
                  {f.aircraftType ? ` · Type: ${f.aircraftType}` : " · Type: (not specified)"}
                </span>
                {f.manual && <span className="dutyimport-dupflag">TYPED IN</span>}
                {isDup(f) && <span className="dutyimport-dupflag">DUPLICATE</span>}
                <button onClick={() => handleRemove(f)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
