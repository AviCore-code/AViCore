import { useEffect, useState } from "react";

// Shrinks a printed document down to fit exactly one physical page, however
// much content it holds. The print-time sibling of useFitToScreen.js's
// on-screen zoom fit - same "measure natural size, scale to the available
// box" idea, aimed at a fixed page instead of a resizable viewport.
//
// Unlike the roster grid's --print-font-scale (PilotRoster.css, a formula
// derived from known day/pilot counts), these reports vary in height with
// whatever training items or experience rows the record has, so the scale
// is measured off the real DOM rather than predicted.
//
// Returns CSS custom properties to spread onto the printed element's style.
// They only do anything inside that stylesheet's own @media print block
// (transform: scale(var(--print-fit-scale)) etc.) - unconsumed on screen,
// so this has zero effect on the normal editable/scrollable view.
//
// @param deps  extra values that should trigger a re-measure (e.g. the
//              selected pilot, or their record). These reports render inside
//              an overflow:auto/max-height box on screen (the sticky-thead
//              scroll area), so the ref'd element's OWN border box never
//              actually resizes when its content grows or shrinks - only
//              what's visible inside it changes - meaning ResizeObserver
//              alone never fires on a pilot swap. deps is what catches that,
//              same reason useFitToScreen.js takes one.
export default function usePrintFit(ref, { widthMm, heightMm, marginMm = 10, allowUpscale = false } = {}, deps = []) {
  const [vars, setVars] = useState({
    "--print-fit-scale": 1,
    "--print-fit-w": "auto",
    "--print-fit-h": "auto"
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const mmToPx = 96 / 25.4;
    const pageW = (widthMm - marginMm * 2) * mmToPx;
    const pageH = (heightMm - marginMm * 2) * mmToPx;

    function recompute() {
      const node = ref.current;
      if (!node) return;
      // scrollWidth/scrollHeight are the element's natural, pre-transform
      // size - reading them here is safe even once our own transform:scale
      // is applied (see useFitToScreen.js for the same fact verified against
      // CSS zoom). That is what lets this re-measure itself on every change
      // without ever compounding its own previous shrink.
      const naturalW = node.scrollWidth;
      const naturalH = node.scrollHeight;
      if (!naturalW || !naturalH) return;
      // Reports normally only shrink. A compact one-sheet form can opt into
      // upscaling so "Fit to page" uses the available paper instead of
      // leaving a small table surrounded by a large blank area.
      const scale = Math.min(allowUpscale ? Infinity : 1, pageW / naturalW, pageH / naturalH);
      setVars({
        "--print-fit-scale": scale,
        "--print-fit-w": `${naturalW}px`,
        "--print-fit-h": `${naturalH}px`
      });
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    // Belt-and-suspenders: re-measure right before the browser paginates, in
    // case content changed between the last resize tick and Print being
    // pressed (e.g. a value that only settles once print's own CSS media
    // query flips). Harmless if it fires after the ResizeObserver already
    // measured the same thing.
    window.addEventListener("beforeprint", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("beforeprint", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, widthMm, heightMm, marginMm, allowUpscale, ...deps]);

  return vars;
}
