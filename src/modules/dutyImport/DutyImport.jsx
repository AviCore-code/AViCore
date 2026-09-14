import { useEffect, useMemo, useState } from "react";
import { parseFdtExcelFileToEntries } from "../../services/fdtImport.js";
import { addDutyEntriesMany, removeDutyEntriesBySourceFile, listImportedFdtFiles } from "../../services/desktopDatabase.js";
import "./DutyImport.css";

export default function DutyImport() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
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
  const dupCodes = useMemo(() => {
    const seen = new Map();
    for (const f of files || []) {
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
    setUploading(true);
    const newNotices = [];
    for (const file of fileArr) {
      try {
        const { code, entries } = await parseFdtExcelFileToEntries(file);
        // The source Excel has no aircraft-type column (only tail number),
        // so every flight entry in this upload is tagged with whatever type
        // was entered above - correct as long as one _FDT.xlsx file covers
        // one fleet assignment (validated against real CSU data: PICUS/SIC
        // increases matched the updated PES PDF exactly when treated this way).
        const tagged = aircraftType.trim()
          ? entries.map((e) => (e.dutyType === "flight" ? { ...e, aircraftType: aircraftType.trim() } : e))
          : entries;
        const result = await addDutyEntriesMany(code, tagged);
        const flightCount = entries.filter((e) => e.dutyType === "flight").length;
        const nonFlightCount = entries.length - flightCount;
        newNotices.push({
          filename: file.name, code, flightCount, nonFlightCount,
          replaced: result?.replaced > 0, ok: true
        });
      } catch (err) {
        newNotices.push({ filename: file.name, error: err.message, ok: false });
      }
    }
    setNotices((prev) => [...newNotices, ...prev]);
    await refreshFiles();
    setUploading(false);
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
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length && !uploading) handleFiles(e.dataTransfer.files); }}
        onClick={() => !uploading && document.getElementById("dutyimport-file-input").click()}
      >
        <div className="dutyimport-title">{uploading ? "Reading file..." : "Drop _FDT.xlsx files here, or click to select (multiple allowed)"}</div>
        <div className="dutyimport-sub">Filenames must start with the pilot's 3-letter code, e.g. CSU_FDT.xlsx</div>
        <input
          id="dutyimport-file-input" type="file" accept=".xlsx" multiple hidden disabled={uploading}
          onChange={(e) => e.target.files.length && handleFiles(e.target.files)}
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
