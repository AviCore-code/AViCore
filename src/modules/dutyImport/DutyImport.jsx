import { useEffect, useMemo, useState } from "react";
import { parseAllFdtFiles } from "../../services/fdtImport.js";
import { addDutyEntriesMany, removeDutyEntriesBySourceFile, listImportedFdtFiles } from "../../services/desktopDatabase.js";
import "./DutyImport.css";

export function visibleImportedFiles(files = []) {
  return files.filter((file) => !file.manual);
}

export default function DutyImport() {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notices, setNotices] = useState([]);
  const [files, setFiles] = useState([]);
  const [aircraftType, setAircraftType] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [currentFile, setCurrentFile] = useState("");
  const [doneCount, setDoneCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => { refreshFiles(); }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const sortedFiles = useMemo(
    () => visibleImportedFiles(files).sort(
      (a, b) => String(a.code || "").localeCompare(String(b.code || "")) ||
                String(a.filename || "").localeCompare(String(b.filename || ""))
    ),
    [files]
  );

  async function refreshFiles() {
    setFiles(await listImportedFdtFiles());
  }

  async function handleFiles(fileList) {
    const fileArr = Array.from(fileList);
    setUploading(true);
    setDoneCount(0);
    setTotalCount(fileArr.length);
    setCurrentFile("");
    const newNotices = [];

    // Phase 1: parse ALL files in parallel (xlsx decompression + row scan)
    // — this is the expensive CPU work; running concurrently cuts total time
    //   from O(N) sequential to roughly O(max_one_file).
    setCurrentFile("กำลังอ่านไฟล์ทั้งหมด…");
    const parsed = await parseAllFdtFiles(fileArr);

    // Phase 2: write to DB one at a time (safe, sequential)
    for (const result of parsed) {
      setCurrentFile(result.filename);
      if (result.error) {
        newNotices.push({ filename: result.filename, error: result.error, ok: false });
        setDoneCount((d) => d + 1);
        continue;
      }
      try {
        const { code, entries } = result;
        // The source Excel has no aircraft-type column (only tail number),
        // so every flight entry in this upload is tagged with whatever type
        // was entered above - correct as long as one _FDT.xlsx file covers
        // one fleet assignment (validated against real CSU data: PICUS/SIC
        // increases matched the updated PES PDF exactly when treated this way).
        const tagged = aircraftType.trim()
          ? entries.map((e) => (e.dutyType === "flight" ? { ...e, aircraftType: aircraftType.trim() } : e))
          : entries;
        const dbResult = await addDutyEntriesMany(code, tagged);
        const flightCount = entries.filter((e) => e.dutyType === "flight").length;
        const nonFlightCount = entries.length - flightCount;
        newNotices.push({
          filename: result.filename, code, flightCount, nonFlightCount,
          replaced: dbResult?.replaced > 0, ok: true
        });
      } catch (err) {
        newNotices.push({ filename: result.filename, error: err.message, ok: false });
      }
      setDoneCount((d) => d + 1);
    }
    setNotices((prev) => [...newNotices, ...prev]);
    await refreshFiles();
    setUploading(false);
    setCurrentFile("");
    setDoneCount(0);
    setTotalCount(0);
  }

  async function handleRemove(file) {
    const msg = `Delete all data imported from "${file.filename}" (pilot ${file.code})?`;
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
        <div className="dutyimport-title">
          {uploading ? (
            <div className="dutyimport-reading">
              <div className="dutyimport-heli-track">
                <span className="dutyimport-heli">🚁</span>
              </div>
              <div className="dutyimport-reading-label">
                กำลังอ่าน: <span className="dutyimport-filename">{currentFile}</span>
              </div>
              <div className="dutyimport-progress">
                โหลดเสร็จแล้ว {doneCount} / {totalCount} ไฟล์
              </div>
            </div>
          ) : (
            "Drop _FDT.xlsx files here, or click to select (multiple allowed)"
          )}
        </div>
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
          {sortedFiles.length > 0 && <span className="dutyimport-count">{sortedFiles.length} file(s)</span>}
        </h2>
        {sortedFiles.length === 0 && <div className="dutyimport-empty">No files imported yet.</div>}
        {sortedFiles.length > 0 && (
          <div className="dutyimport-log dutyimport-filelist">
            {sortedFiles.map((f, i) => (
              <div key={i} className="dutyimport-row">
                <span className="dutyimport-code">{f.code}</span>
                <span className="dutyimport-detail">
                  {f.filename} — Flight {f.flightCount} · Non-Flight {f.nonFlightCount}
                  {f.aircraftType ? ` · Type: ${f.aircraftType}` : " · Type: (not specified)"}
                </span>
                <button onClick={() => handleRemove(f)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
