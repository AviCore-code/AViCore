import { useEffect, useMemo, useState } from "react";

// Shows an attached certificate (PDF or photo) inside the page, with a Print
// button - rather than only handing it to the browser to open elsewhere.
//
// Two things make this less trivial than it looks:
//
// 1. On the web an attachment is stored as a data: URL. Browsers BLOCK
//    top-level navigation to data: URLs, so it has to become a blob: URL
//    before anything can display it. That is done here, once, and revoked
//    when the viewer closes.
// 2. Printing an <iframe> whose contents came from a blob works, but only if
//    the print is aimed at the FRAME, not at the page - printing the page
//    gives you the surrounding app with an empty box where the document was.
//
// On the PC build a document is a real file path instead; there is nothing to
// render inline, so the viewer defers to the OS viewer via onOpenExternally.

function isDataUrl(value) {
  return String(value || "").startsWith("data:");
}

function mimeOf(dataUrl) {
  const header = String(dataUrl).slice(5, String(dataUrl).indexOf(","));
  return header.replace(/;base64$/i, "") || "application/octet-stream";
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(5, comma);
  const isBase64 = /;base64$/i.test(header);
  const mime = header.replace(/;base64$/i, "") || "application/octet-stream";
  const body = dataUrl.slice(comma + 1);
  if (!isBase64) return new Blob([decodeURIComponent(body)], { type: mime });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function DocumentViewer({ path, title, onClose, onOpenExternally }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const kind = useMemo(() => {
    if (!isDataUrl(path)) return "file";
    return mimeOf(path).startsWith("image/") ? "image" : "pdf";
  }, [path]);

  useEffect(() => {
    if (!isDataUrl(path)) return undefined;
    let objectUrl = "";
    try {
      objectUrl = URL.createObjectURL(dataUrlToBlob(path));
      setUrl(objectUrl);
    } catch (err) {
      setError(`Couldn't read the stored document (${err.message}).`);
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handlePrint() {
    if (kind === "image") {
      // An image is in the page itself, so the page's own print CSS handles
      // it - .docview-print-area is the only thing left visible.
      window.print();
      return;
    }
    // A PDF lives inside an iframe; print the frame, not the page.
    const frame = document.getElementById("docview-frame");
    try {
      frame?.contentWindow?.focus();
      frame?.contentWindow?.print();
    } catch {
      // Cross-origin or a viewer that refuses - fall back to opening it, from
      // where the browser's own PDF viewer can print.
      onOpenExternally?.(path);
    }
  }

  return (
    <div className="docview-backdrop" onClick={onClose}>
      <div className="docview" onClick={(e) => e.stopPropagation()}>
        <div className="docview-head no-print">
          <b>{title || "Document"}</b>
          <div className="docview-actions">
            {kind !== "file" && <button onClick={handlePrint}>Print</button>}
            <button onClick={() => onOpenExternally?.(path)}>Open in new tab</button>
            <button onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="docview-body docview-print-area">
          {error && <p className="docview-msg">{error}</p>}

          {!error && kind === "file" && (
            <p className="docview-msg">
              This document was attached from the PC app and is stored on that computer,
              so it can't be shown here. Attach it again from the web to view it on any device.
            </p>
          )}

          {!error && kind === "image" && url && (
            <img src={url} alt={title || "Document"} />
          )}

          {!error && kind === "pdf" && url && (
            <iframe id="docview-frame" title={title || "Document"} src={url} />
          )}
        </div>
      </div>
    </div>
  );
}
