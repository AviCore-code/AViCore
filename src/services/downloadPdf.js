// Generate a real PDF file and download it under a chosen name.
//
// WHY THIS EXISTS ALONGSIDE PRINTING
//
// The browser's print dialog cannot be told what to call the file. Three
// attempts at naming it through document.title all failed in Chrome, which
// keeps the filename it derived when the page loaded:
//
//   1. set title, then print()                     - dialog shows the old name
//   2. set title, wait two animation frames, print - same
//   3. print a new window whose <title> is in the markup - same
//
// Building the PDF ourselves sidesteps the dialog entirely: this is a
// DOWNLOAD, and a download's filename is ours to set.
//
// THE TRADE-OFF, and why Print is deliberately kept as well:
//
// html2canvas rasterises the page, so the PDF is an IMAGE of the table. Text in
// it cannot be selected or searched, and the pagination is a straight slice
// through a tall bitmap rather than the browser's own page-breaking. For a
// logbook handed to a regulator the printed version is the better document, so
// Print stays exactly as it was and this is offered next to it.
//
// Both libraries are imported dynamically: together they are about a megabyte,
// and nobody should pay that on page load for a button they may never press.

const A4 = { width: 210, height: 297 };   // mm, portrait

// Rendering scale, traded against how tall the page is.
//
// html2canvas rasterises the WHOLE element at `scale`x before anything is
// paginated, so cost grows with the square of the scale AND linearly with the
// row count. A 12-month logbook at scale 2 is a ~35-megapixel canvas holding
// ~134 MB, and a 36-month one is ~102 megapixels / ~390 MB - which is why the
// export felt like it had hung.
//
// So the scale is chosen from the actual height: short extracts still get the
// crisp 2x, long ones step down rather than making the user wait minutes (or
// hitting the browser's canvas ceiling and failing outright). 1.5x is still
// above screen resolution, so the text stays readable.
function scaleForHeight(px) {
  if (px <= 4000) return 2;      // ~6 months and under
  if (px <= 9000) return 1.6;    // ~12-18 months
  return 1.25;                   // 24-36 months
}

export async function downloadElementAsPdf(element, filename, options = {}) {
  if (!element) return { ok: false, error: "Nothing to export." };

  // Progress callback. A long export with no feedback reads as a hang, so the
  // caller is told which stage it is in rather than left showing a spinner.
  const report = typeof options.onProgress === "function" ? options.onProgress : () => {};

  report("Loading PDF tools…");
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas")
  ]);

  const landscape = options.landscape !== false;   // the logbook is wide
  const page = landscape
    ? { width: A4.height, height: A4.width }
    : { width: A4.width, height: A4.height };
  const margin = Number.isFinite(options.margin) ? options.margin : 8;

  const scale = options.scale || scaleForHeight(element.scrollHeight || 0);

  // Wait for fonts before measuring anything.
  //
  // html2canvas measures glyph widths at capture time. If a face is still
  // loading it measures the fallback and draws the real one - the two disagree,
  // and characters pile up with the spaces and colons between them squeezed
  // out. Cheap insurance: document.fonts.ready resolves immediately when
  // nothing is pending.
  report("Preparing fonts…");
  try {
    if (document.fonts?.ready) await document.fonts.ready;
  } catch { /* not supported - the forced font-family below still applies */ }

  report("Rendering the page…");
  // Rendered on white: the app's dark theme would otherwise flood every sheet
  // with ink, and JPEG compresses a light page far better than a dark one.
  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: element.scrollWidth,
    onclone: (doc) => {
      // Apply the print stylesheet's intent to the clone: drop the on-screen
      // controls, and force dark-on-light so the PDF is readable on paper.
      doc.querySelectorAll(".no-print").forEach((n) => n.remove());

      // .print-only blocks (the signature/certification panels) are hidden on
      // screen and revealed by @media print. An EXPORT never prints - the clone
      // is rendered normally - so those rules do not fire and the signature
      // block was missing from every exported PDF while appearing correctly on
      // a printed page. Revealed explicitly here.
      doc.querySelectorAll(".print-only").forEach((n) => { n.style.display = "block"; });
      const fix = doc.createElement("style");
      fix.textContent = `
        /* FONT — the cause of overlapping text in exported PDFs.
           html2canvas does not use the browser's text engine; it lays out each
           run itself from measured glyph widths. With no font-family declared
           anywhere in this app, the page renders in the browser's default UI
           font, which html2canvas measures badly: the runs come out narrower
           than drawn, so characters pile up and the spaces and colons between
           them disappear ("WeeraJuntaklud", "446 52" for 446:52).
           Naming a plain, universally-present family - and turning off the
           ligature/kerning features that shift glyphs after measurement - makes
           the measured and drawn widths agree. */
        *{
          font-family: Arial, "Helvetica Neue", Helvetica, sans-serif !important;
          font-kerning: none !important;
          font-variant-ligatures: none !important;
          font-feature-settings: "liga" 0, "clig" 0, "kern" 0 !important;
          letter-spacing: normal !important;
          word-spacing: normal !important;
          text-rendering: geometricPrecision !important;
        }
        *{ background-image:none !important; box-shadow:none !important; }
        /* EVERY element, not a tag list.
           The old list named b, span, div... but missed elements like <label>
           and <i>, and - more importantly - a tag-name selector loses to a
           class rule such as ".myexp-head b{color:#94a3b8}". So the field
           labels, and the ":" inside them, kept their pale on-screen grey:
           2.56:1 against white, which is why the colons were invisible in the
           exported PDF while printing fine. */
        *{ color:#000 !important; }
        body,div,table,thead,tbody,tr,td,th,span,p,h1,h2,h3,h4,b,small,label{
          background-color:#fff !important;
        }
        b,strong{ color:#000 !important; font-weight:700 !important; }
        th,td{ border-color:#999 !important; }

        /* RELEASE EVERY SCROLL CAP.

           This is what cut exported PDFs off at the bottom while PRINTING the
           same page came out complete. The print stylesheet lifts these caps,
           but an export is not a print - none of those @media print rules
           apply here, so the card kept its on-screen "max-height:70vh;
           overflow:auto" and html2canvas captured only the visible slice of
           the scroll box. Everything below the fold was simply not in the
           image, with nothing to indicate it was missing.

           Applied to every element rather than the known offenders, because
           the same pattern (a card with an internal scroll for a sticky
           header) is used on several pages and each would fail the same way. */
        *{
          max-height:none !important;
          overflow:visible !important;
          overflow-x:visible !important;
          overflow-y:visible !important;
        }
        /* Sticky headers overlap the rows they label once the scroll box is
           gone, because there is no longer a scroll container to stick to. */
        thead, thead th, .myexp-print-area thead{ position:static !important; }
        /* Grids do not paginate; as blocks the sections stack and stay whole.
           (Harmless on pages that use neither.)
           EXCEPT the aircraft grid when fitting to one page: forcing it to a
           single column makes the content roughly twice as TALL, and a
           fit-to-page then shrinks everything to half the size to compensate.
           Kept as two columns there, which is both shorter and closer to the
           printed layout. */
        .top-grid, .exp-grid{ display:block !important; }
        /* Code / Name / Licence / Update stay on ONE row. Flattened to blocks
           they became four stacked lines - taller, and it breaks up what reads
           as a single identity line on the printed sheet. */
        .myexp-head{
          display:grid !important;
          grid-template-columns:repeat(4,1fr) !important;
        }
        ${options.fitToPage ? "" : ".myexp-aircraft-grid{ display:block !important; }"}
        /* The totals rows stay THREE ACROSS. Flattened to blocks they became
           six stacked rows - taller, and it separates PIC/PICUS/SIC, which
           belong on one line. A 3-cell row always fits a page, so there is no
           pagination risk in leaving it a grid. */
        .myexp-totals, .myexp-current{
          display:grid !important;
          grid-template-columns:repeat(3,1fr) !important;
        }
        /* Signature blocks. Hidden on screen and normally revealed by
           @media print, which does not apply to an export - so they are forced
           visible here, with !important because the screen rule that hides them
           would otherwise win. The row of signature lines keeps the same
           three-across shape as the totals above it. */
        .print-only, .myexp-certify, .logbook-certify, .pe-certify{
          display:block !important;
        }
        .myexp-certify-sigs, .logbook-certify-sigs, .pe-certify-sigs{
          display:grid !important;
          grid-template-columns:repeat(3,1fr) !important;
          gap:10px !important;
        }
        .myexp-sigline, .logbook-sigline, .pe-sigline{
          border-bottom:1px solid #555 !important;
        }
        ${options.fitToPage ? `
        /* Tighten spacing so the sheet fits at FULL SIZE rather than being
           shrunk to fit. Shrinking the finished image scales the text down with
           it; removing dead space costs nothing legible. Applied only when
           fitting to one page, so the multi-page logbook keeps its spacing. */
        /* Sized per BLOCK, not one size for the sheet.
           The identity line and the totals hold a handful of short values and
           can carry a larger face; the aircraft tables hold many rows and are
           what decides the height. Sizing them separately keeps the figures
           that matter legible instead of shrinking everything to the size the
           densest table needs. */
        .myexp-print-area{ font-size:12px !important; }
        .myexp-head{ margin-bottom:6px !important; font-size:13px !important; }
        .myexp-head b{ font-size:13px !important; }
        .myexp-table{ margin-bottom:5px !important; font-size:11.5px !important; }
        .myexp-table th, .myexp-table td{ padding:2px 6px !important; line-height:1.25 !important; font-size:11.5px !important; }
        /* The aircraft grid is the densest block - one step smaller so the
           sheet fits without shrinking the whole image. */
        .myexp-aircraft-grid .myexp-table th,
        .myexp-aircraft-grid .myexp-table td{ font-size:10.5px !important; padding:2px 5px !important; }
        /* Totals are the headline figures - kept a step larger. */
        .myexp-totals > div, .myexp-current > div{ font-size:12.5px !important; }
        .myexp-totals b, .myexp-current b{ font-size:14px !important; }
        /* Grand Total keeps the printed sheet's green tint and dark-green
           figure. The blanket "*{color:#000}" above would flatten it to plain
           black, losing the one visual cue that says which number is the
           headline total. Dark green on a pale tint is 7:1, well past legible. */
        .myexp-grand{ background:#dcfce7 !important; border-color:#86efac !important; }
        .myexp-grand b{ font-size:15px !important; color:#166534 !important; }
        .myexp-grand span{ color:#14532d !important; }
        .myexp-aircraft-grid{ gap:6px !important; }
        .myexp-totals, .myexp-current{ gap:6px !important; margin-top:5px !important; }
        .myexp-totals > div, .myexp-current > div{ padding:4px 8px !important; }
        .myexp-certify{ margin-top:8px !important; }
        /* The certification sentence is one long unbroken run - the worst case
           for glyph pile-up, and where the overlap showed most. Given its own
           line height and room to wrap rather than being squeezed. */
        .myexp-certify-text{
          font-size:11px !important;
          line-height:1.6 !important;
          white-space:normal !important;
          overflow-wrap:break-word !important;
        }
        .myexp-certify-sigs{ margin-top:14px !important; }
        .myexp-certify-sigs span{ font-size:10.5px !important; line-height:1.5 !important; }
        .myexp-sigline{ height:26px !important; }
        /* Nothing may spill out of its box. A value wider than its cell would
           otherwise be clipped by the capture with no sign it was cut - the
           same silent-loss failure as the scroll cap. Long names wrap; figures
           never do, because "12345:" / "30" on two lines is unreadable. */
        .myexp-head > div, .myexp-totals > div, .myexp-current > div{
          overflow-wrap:anywhere !important; word-break:normal !important;
        }
        .myexp-table td, .myexp-table th{ white-space:nowrap !important; }
        .myexp-totals b, .myexp-current b{ white-space:nowrap !important; }
        ` : ""}
      `;
      doc.head.appendChild(fix);
    }
  });

  const pdf = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "mm", format: "a4" });

  const usableW = page.width - margin * 2;
  const usableH = page.height - margin * 2;
  const imgH = (canvas.height * usableW) / canvas.width;   // mm, if drawn full width

  // JPEG, not PNG. PNG encoding is lossless and by far the slowest step here -
  // on a 35-megapixel logbook canvas it dominated the export time and produced
  // a file several times larger. At 0.92 the text is visually indistinguishable
  // on a white page, and both the wait and the file shrink several-fold.
  const IMG = { type: "image/jpeg", fmt: "JPEG", quality: 0.92 };

  // FIT TO ONE PAGE, when the caller asks for it.
  //
  // An experience summary is a single-sheet document: split across two pages it
  // reads as two half-records, and the signature block ends up on a page of its
  // own with nothing above it to sign for. Capt. Weera: "เอาหน้าเดียว แนวนอน".
  //
  // Scaled down to fit rather than sliced. Only shrinks - a short record is
  // still drawn at its natural size rather than being blown up to fill the
  // sheet, which would look wrong and gain nothing. Centred horizontally so a
  // narrowed page does not sit against the left margin.
  if (options.fitToPage && imgH > usableH) {
    const fitH = usableH;
    const fitW = (canvas.width * fitH) / canvas.height;
    const x = margin + Math.max(0, (usableW - fitW) / 2);
    report("Fitting to one page…");
    pdf.addImage(canvas.toDataURL(IMG.type, IMG.quality), IMG.fmt, x, margin, fitW, fitH);
  } else if (imgH <= usableH) {
    pdf.addImage(canvas.toDataURL(IMG.type, IMG.quality), IMG.fmt, margin, margin, usableW, imgH);
  } else {
    // Taller than one page: slice the bitmap into page-height bands. Sliced
    // from the source canvas rather than re-drawing the same image at negative
    // offsets, because the latter makes every page carry the WHOLE image and
    // a 12-month logbook then runs to tens of megabytes.
    const pxPerMm = canvas.width / usableW;
    const sliceHpx = Math.floor(usableH * pxPerMm);

    // ONE reusable slice canvas, not one per page: allocating and discarding a
    // multi-megabyte canvas per page is what makes a long export stutter, and
    // leaves the garbage collector to catch up mid-run.
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHpx;
    const ctx = slice.getContext("2d");

    const totalPages = Math.ceil(canvas.height / sliceHpx);
    let y = 0;
    let first = true;
    let pageNo = 0;

    while (y < canvas.height) {
      report(`Building page ${++pageNo} of ${totalPages}…`);
      const h = Math.min(sliceHpx, canvas.height - y);
      if (slice.height !== h) slice.height = h;        // last page is short
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, slice.width, h);              // clear the previous page
      ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);

      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL(IMG.type, IMG.quality), IMG.fmt, margin, margin, usableW, h / pxPerMm);
      first = false;
      y += h;

      // Yield between pages so the browser can paint. Without this the tab is
      // frozen for the whole export and looks crashed - which is what "นานจัง"
      // actually feels like, as much as the raw duration.
      if (y < canvas.height) await new Promise((r) => setTimeout(r, 0));
    }
  }

  // jsPDF's save() triggers a normal download, so the name is honoured - the
  // whole point of this path.
  report("Saving…");
  const name = String(filename || "document.pdf").replace(/\.pdf$/i, "") + ".pdf";
  pdf.save(name);
  return { ok: true, filePath: name };
}
