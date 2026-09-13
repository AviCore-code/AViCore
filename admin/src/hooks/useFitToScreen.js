import { useEffect, useState } from "react";

// "Full Screen should show the WHOLE roster, not just more of it to scroll
// through." Full Screen used to only remove the app chrome and give the
// table more room - a wide month still needed horizontal scrolling to see
// every day. This scales the table (via CSS `zoom`, which - unlike
// `transform: scale()` - actually shrinks/grows the element's contribution
// to its container's layout, so no separate sizing wrapper is needed) so
// the whole thing fits the available space, the same idea Print/Export PDF
// already uses (computePrintFontScale in DutySchedule.jsx), just aimed at
// the screen instead of a page.
//
// Usage:
//   const scrollRef = useRef(null);
//   const zoom = useFitToScreen(scrollRef, fullScreen, [numDays, filtered.length]);
//   <div ref={scrollRef} style={{ zoom }}>...table...</div>
//
// @param ref     a React ref on the element to measure and scale. Its
//                PARENT determines the available space to fit into.
// @param active  only measures/applies while true (e.g. fullScreen is on) -
//                returns 1 while false, so normal rendering is untouched.
// @param deps    extra values that should trigger a re-measure when they
//                change (e.g. month, pilot count) - the element's own size
//                changing doesn't resize its parent, so a ResizeObserver on
//                the parent alone would miss it.
// @returns {number} a CSS `zoom` value for the ref'd element
export default function useFitToScreen(ref, active, deps = []) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!active) { setZoom(1); return; }
    const el = ref.current;
    const container = el?.parentElement;
    if (!el || !container) return;

    function recompute() {
      // scrollWidth/scrollHeight are measured in the element's OWN local
      // coordinate space, so they read the same natural content size
      // whatever `zoom` is currently applied to the element itself - no
      // need to divide it back out. (container.clientWidth/Height are
      // reliable too: .roster-scroll's parent fills available space via
      // flex, it doesn't shrink-to-fit its zoomed child.)
      const naturalW = el.scrollWidth;
      const naturalH = el.scrollHeight;
      if (!naturalW || !naturalH) return;
      const fit = Math.min(container.clientWidth / naturalW, container.clientHeight / naturalH);
      // Never shrink into illegibility, never blow up past a sane ceiling on
      // a small roster in a huge window.
      setZoom(Math.max(0.3, Math.min(fit, 1.5)));
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);

  return active ? zoom : 1;
}
