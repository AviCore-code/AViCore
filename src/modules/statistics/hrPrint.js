import { useEffect } from "react";

// Shared by the two HR reports (FT Monthly for HR, DT Work for HR): date
// labels, Excel column auto-fit, and printing on ONE A4 landscape sheet.

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dayLabel = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]} ${String(y).slice(2)}`;
};
export const isWeekend = (iso) => { const g = new Date(`${iso}T00:00:00`).getDay(); return g === 0 || g === 6; };

// A4 landscape less the 6 mm print margins (FtMonthlyHr.css @page), in CSS px.
const PAGE_W = Math.floor(((297 - 12) / 25.4) * 96);
const PAGE_H = Math.floor(((210 - 12) / 25.4) * 96) - 8;

// Capt. Weera: "print A4 แนวนอน แผ่นเดียว". A 31-day table is wider than the
// sheet, so just before printing the report is zoomed to fit one page (never
// enlarged), and set back afterwards.
export function fitToPage(area, { fitHeight = true } = {}) {
  if (!area) return;
  area.style.zoom = "";
  const table = area.querySelector("table");
  const width = Math.max(area.scrollWidth, table?.scrollWidth || 0);
  const height = [...area.children].reduce((h, el) => h + (el.classList.contains("hrft-wrap") ? (table?.offsetHeight || 0) : el.offsetHeight), 0);
  const zoom = Math.min(1, PAGE_W / Math.max(1, width), fitHeight ? PAGE_H / Math.max(1, height + 40) : 1);
  area.style.zoom = String(Math.floor(zoom * 1000) / 1000);
}

// fitHeight:false = fit the width only and let a long list run onto more pages.
export function useFitToPagePrint(ref, { fitHeight = true } = {}) {
  useEffect(() => {
    const before = () => fitToPage(ref.current, { fitHeight });
    const after = () => { if (ref.current) ref.current.style.zoom = ""; };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); };
  }, [ref, fitHeight]);
}

// Excel: each column as wide as its longest value ("fit to cell"), counted
// over rows [fromRow, toRow).
export function autoFitCols(aoa, toRow, fromRow = 0) {
  const widths = [];
  aoa.slice(fromRow, toRow).forEach((row) => row.forEach((v, c) => {
    widths[c] = Math.max(widths[c] || 2, String(v ?? "").length + 1);
  }));
  return widths.map((wch) => ({ wch }));
}
