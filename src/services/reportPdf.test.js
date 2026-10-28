// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadElementAsPdf, resolvePdfExportTarget } from "./downloadPdf.js";

const pdfSpy = vi.hoisted(() => ({
  constructorOptions: null,
  addImageCalls: 0,
  addPageCalls: 0,
  savedName: "",
  outputCalls: [],
  capturedText: "",
  cloneCss: ""
}));

vi.mock("jspdf", () => ({
  default: class FakePdf {
    constructor(options) { pdfSpy.constructorOptions = options; }
    addImage() { pdfSpy.addImageCalls += 1; }
    addPage() { pdfSpy.addPageCalls += 1; }
    save(name) { pdfSpy.savedName = name; }
    output(type) { pdfSpy.outputCalls.push(type); return new Blob(["PDF"], { type: "application/pdf" }); }
  }
}));

vi.mock("html2canvas", () => ({
  default: async (element, options) => {
    pdfSpy.capturedText = element.textContent;
    const clone = document.implementation.createHTMLDocument("PDF clone");
    clone.body.innerHTML = element.outerHTML;
    options.onclone(clone);
    pdfSpy.cloneCss = clone.head.querySelector("style")?.textContent || "";
    return {
      width: 1000,
      height: 5000,
      toDataURL: () => "data:image/jpeg;base64,AA=="
    };
  }
}));

describe("one-page report PDF target selection", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    Object.assign(pdfSpy, {
      constructorOptions: null,
      addImageCalls: 0,
      addPageCalls: 0,
      savedName: "",
      outputCalls: [],
      capturedText: "",
      cloneCss: ""
    });
  });

  it("selects Personal Training instead of the page shell and fits it to one page", () => {
    document.body.innerHTML = `
      <div class="app-shell">shell</div>
      <section class="trainingperson-print-area">FIRST TRAINING ITEM … FINAL TRAINING ITEM</section>
    `;

    const target = resolvePdfExportTarget();

    expect(target.element).toBe(document.querySelector(".trainingperson-print-area"));
    expect(target.fitToPage).toBe(true);
    expect(target.element.textContent).toContain("FIRST TRAINING ITEM");
    expect(target.element.textContent).toContain("FINAL TRAINING ITEM");
  });

  it("selects the Pilot Experience sheet and fits its first and final content to one page", () => {
    document.body.innerHTML = `
      <header>editor controls</header>
      <section class="pe-print-area"><h2>Pilot experience summary</h2><footer>Chief Pilot / Authorised Signatory</footer></section>
    `;

    const target = resolvePdfExportTarget();

    expect(target.element).toBe(document.querySelector(".pe-print-area"));
    expect(target.fitToPage).toBe(true);
    expect(target.element.textContent).toContain("Pilot experience summary");
    expect(target.element.textContent).toContain("Chief Pilot / Authorised Signatory");
  });

  it("selects the read-only Pilot Experience Summary and fits the entire record to one page", () => {
    document.body.innerHTML = `
      <nav>Admin shell</nav>
      <section class="myexp-print-area"><h2>Pilot Experience Summary</h2><footer>Chief Pilot / Authorised Signatory</footer></section>
    `;

    const target = resolvePdfExportTarget();

    expect(target.element).toBe(document.querySelector(".myexp-print-area"));
    expect(target.fitToPage).toBe(true);
    expect(target.element.textContent).toContain("Pilot Experience Summary");
    expect(target.element.textContent).toContain("Chief Pilot / Authorised Signatory");
  });

  it.each([
    ["trainingperson-print-area", "FIRST TRAINING ITEM", "FINAL TRAINING ITEM", "Training.pdf"],
    ["pe-print-area", "Pilot experience summary", "Chief Pilot / Authorised Signatory", "Experience.pdf"],
    ["myexp-print-area", "Pilot Experience Summary", "Chief Pilot / Authorised Signatory", "ExperienceSummary.pdf"]
  ])("renders %s as exactly one landscape A4 PDF image", async (className, first, last, filename) => {
    document.body.innerHTML = `<section class="${className}"><h2>${first}</h2><div class="no-print">Delete row</div><footer>${last}</footer></section>`;
    const target = resolvePdfExportTarget();

    const result = await downloadElementAsPdf(target.element, filename, {
      landscape: true,
      fitToPage: target.fitToPage
    });

    expect(result).toEqual({ ok: true, filePath: filename });
    expect(pdfSpy.constructorOptions).toMatchObject({ orientation: "landscape", format: "a4" });
    expect(pdfSpy.addImageCalls).toBe(1);
    expect(pdfSpy.addPageCalls).toBe(0);
    expect(pdfSpy.savedName).toBe(filename);
    expect(pdfSpy.capturedText).toContain(first);
    expect(pdfSpy.capturedText).toContain(last);
    expect(pdfSpy.cloneCss).toContain(".top-grid,.exp-grid{ display:grid !important");
  });

  it("opens a one-page report in the browser PDF viewer when a preview window is provided", async () => {
    document.body.innerHTML = `<section class="myexp-print-area"><h2>Pilot Experience Summary</h2></section>`;
    const target = resolvePdfExportTarget();
    const previewWindow = { location: { href: "" } };
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:experience-preview");

    const result = await downloadElementAsPdf(target.element, "ExperienceSummary.pdf", {
      landscape: true,
      fitToPage: true,
      previewWindow
    });

    expect(result).toEqual({ ok: true, filePath: "ExperienceSummary.pdf", preview: true });
    expect(pdfSpy.outputCalls).toEqual(["blob"]);
    expect(pdfSpy.addImageCalls).toBe(1);
    expect(pdfSpy.addPageCalls).toBe(0);
    expect(pdfSpy.savedName).toBe("");
    expect(previewWindow.location.href).toBe("blob:experience-preview");
    createObjectURL.mockRestore();
  });
});
