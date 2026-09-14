// A failed READ shown as a failed read - not as an empty screen.
//
// This exists because of a real incident: one wrong column name made the
// pilot query fail, the data layer turned that into an empty array, and every
// page in the app - pilot list, All Status, FDT, roster, weekly plan - went
// blank. It looked exactly like every pilot record had been deleted. It took
// several rounds of "the data is gone" / "no, it's still there" to establish
// that nothing had been lost at all.
//
// So any read that fails silently now says so on screen, in words that
// distinguish "could not read" from "there is nothing here".
//
// Deliberately plain DOM rather than React state: this is called from the
// data layer, which every page uses and none of them own, so there is no
// component that could be relied on to render it. One banner per distinct
// message, dismissible, never blocks the app.

const shown = new Set();

export function showDataErrorBanner(message) {
  const text = String(message || "").trim();
  if (!text || typeof document === "undefined" || !document.body) return;
  if (shown.has(text)) return;
  shown.add(text);

  const bar = document.createElement("div");
  bar.setAttribute("role", "alert");
  bar.style.cssText = [
    "position:fixed", "left:0", "right:0", "top:0", "z-index:99999",
    "background:#7f1d1d", "color:#fee2e2", "padding:10px 44px 10px 16px",
    "font:13px/1.5 system-ui,sans-serif", "box-shadow:0 2px 10px rgba(0,0,0,.4)"
  ].join(";");
  bar.textContent = text;

  const close = document.createElement("button");
  close.textContent = "✕";
  close.style.cssText = "position:absolute;right:10px;top:8px;background:transparent;border:0;color:inherit;font-size:15px;cursor:pointer";
  close.onclick = () => bar.remove();
  bar.appendChild(close);

  document.body.appendChild(bar);
}
