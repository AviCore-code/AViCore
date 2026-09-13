import { useEffect, useRef, useState } from "react";

// "A4 Layout" mode for Daily Duty (Flight/Non-Flight forms): renders its
// children on a fixed-size canvas shaped like an A4 sheet in landscape
// (297 x 210mm) at TRUE size (1:1, never shrunk to fit the viewport), then
// lets the person drag/swipe the canvas around inside a clipped viewport to
// reach parts that don't fit on screen at once - built for a phone screen,
// where a real A4-landscape sheet is much wider (and usually taller) than
// the display. Capt. Weera: "lock area อยู่บน A4 แนวนอน แบบว่า slide up down
// left right ได้ เพื่อใส่ข้อมูลในแต่ละช่อง กรณีรันบนจอโทรศัพท์" - then, after
// an initial version fit the whole sheet on screen at a shrunk scale:
// "A4 ให้ใหญ่เท่าของจริง ไม่ใช่เห็นหมดอยู่ในกรอบหน้าต่าง" - so the sheet now
// always renders at scale(1) (see the `scale` constant below) and is meant
// to be reached entirely by panning, the way a real full-size sheet of paper
// would be too big to see all at once on a phone screen held close.
//
// The alternative, existing behaviour ("Fit to Screen") is just: don't wrap
// at all - render children directly, letting the normal responsive CSS grid
// reflow to the viewport like every other page in the app. See STORAGE_KEY
// below for how the two modes are toggled and remembered.
//
// A4 at 96 CSS px/inch (the standard used everywhere else in the browser,
// e.g. print CSS) = 1123 x 794 - close enough to real A4 (297 x 210mm) for
// an on-screen data-entry canvas; this isn't meant to be printed (see
// A4PanArea's module doc), so the extra ~0.3% of exact-mm precision doesn't
// matter here.
export const A4_WIDTH = 1123;
export const A4_HEIGHT = 794;

const STORAGE_KEY = "avicore_dutyentry_layout"; // "a4" | "fit"

export function getLayoutMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "a4" ? "a4" : "fit";
  } catch { return "fit"; }
}
export function saveLayoutMode(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* private mode: not fatal */ }
}

// Small header control - a pair of toggle buttons, not a checkbox, so both
// states (and which one is active) are visible at a glance without reading
// a label. Lives in DutyEntry's module-header next to Full Screen.
export function LayoutModeToggle({ mode, onChange }) {
  return (
    <div className="a4-mode-toggle" role="group" aria-label="Daily Duty layout">
      <button
        type="button"
        className={mode === "fit" ? "active" : ""}
        onClick={() => onChange("fit")}
        title="Form reflows to fit your screen (normal scrolling)"
      >
        Fit to Screen
      </button>
      <button
        type="button"
        className={mode === "a4" ? "active" : ""}
        onClick={() => onChange("a4")}
        title="Form stays laid out like an A4 landscape sheet — drag/swipe to reach each field on a small screen"
      >
        A4 Layout
      </button>
    </div>
  );
}

// The pannable canvas itself. `mode` controls whether this wrapper does
// anything at all: in "fit" mode it renders `children` completely unwrapped
// (no extra DOM, no transform) so existing responsive CSS is untouched.
export default function A4PanArea({ mode, children }) {
  const viewportRef = useRef(null);
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  // pan = current translate offset (px, at the SCALED size) of the A4
  // canvas's top-left corner within the viewport. Starts centered once the
  // viewport size is known (see the effect below).
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null); // { startX, startY, panX, panY, pointerId } while dragging

  // Measure the viewport (the clipped box the A4 sheet pans around inside)
  // so the fit-to-screen scale and centered starting position can be
  // computed - re-measured on resize/orientation change (rotating a phone
  // from portrait to landscape should re-center and re-fit, not leave the
  // sheet parked off in a corner sized for the old orientation).
  useEffect(() => {
    if (mode !== "a4") return;
    const el = viewportRef.current;
    if (!el) return;
    function measure() {
      const r = el.getBoundingClientRect();
      setViewportSize({ w: r.width, h: r.height });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Always true size (1:1, 96 CSS px/inch - see A4_WIDTH/A4_HEIGHT), never
  // scaled down to fit the viewport. Capt. Weera: "A4 ให้ใหญ่เท่าของจริง
  // ไม่ใช่เห็นหมดอยู่ในกรอบหน้าต่าง" - a real A4 landscape sheet doesn't
  // shrink to fit on a phone either, so this canvas doesn't shrink to fit
  // the phone's viewport: it stays full size and the person pans/drags to
  // reach whatever's off-screen (see onPointerMove below), same as panning
  // around a full-resolution photo or a real paper form larger than the
  // desk in front of you.
  const scale = 1;
  const scaledW = A4_WIDTH * scale;
  const scaledH = A4_HEIGHT * scale;

  // Re-center whenever the fitted size changes (first measurement, or a
  // resize/rotation) - otherwise a pan position computed for the old size
  // could leave the sheet mostly or fully outside the new viewport.
  useEffect(() => {
    if (mode !== "a4" || !viewportSize.w) return;
    setPan({
      x: Math.max(0, (viewportSize.w - scaledW) / 2),
      y: Math.max(0, (viewportSize.h - scaledH) / 2)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, viewportSize.w, viewportSize.h, scaledW, scaledH]);

  // Clamp so the sheet can never be dragged entirely out of view - always
  // leave at least one edge reachable, same behavior as a map/photo viewer.
  function clamp(next) {
    const minX = Math.min(0, viewportSize.w - scaledW);
    const minY = Math.min(0, viewportSize.h - scaledH);
    const maxX = Math.max(0, viewportSize.w - scaledW);
    const maxY = Math.max(0, viewportSize.h - scaledH);
    return {
      x: Math.min(Math.max(next.x, minX), maxX),
      y: Math.min(Math.max(next.y, minY), maxY)
    };
  }

  // Pointer Events (not separate touch/mouse handlers) covers finger drag on
  // a phone and mouse drag on a desktop/trackpad with one code path.
  // Dragging starts from the viewport background OR the A4 sheet itself,
  // but NOT from an interactive control (input/select/button/textarea/a) -
  // otherwise tapping into a text field or opening a <select> would instead
  // start a pan gesture and steal the tap. touch-action: none on the
  // viewport (see CSS) stops the browser's own scroll/refresh gestures from
  // fighting this drag.
  function onPointerDown(e) {
    if (e.target.closest("input, select, textarea, button, a, [contenteditable]")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setPan(clamp({ x: d.panX + dx, y: d.panY + dy }));
  }
  function endDrag(e) {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) dragRef.current = null;
  }

  if (mode !== "a4") return children;

  return (
    <div className="a4pan-viewport" ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="a4pan-sheet"
        style={{
          width: A4_WIDTH, height: A4_HEIGHT,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`
        }}
      >
        {children}
      </div>
      {/* Visual hint that this canvas drags - fades out on first interaction
          via CSS (see .a4pan-hint), rather than needing state/a dismiss
          click of its own. */}
      <div className="a4pan-hint" aria-hidden="true">⇕ ⇔ drag to pan the A4 sheet</div>
    </div>
  );
}
