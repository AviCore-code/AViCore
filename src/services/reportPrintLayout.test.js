import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const compact = (value) => value.replace(/\s+/g, "");

describe("single-page report layouts", () => {
  it("keeps Personal Training in normal flow while removing shell layout from print", () => {
    const css = compact(read("../modules/trainingDue/TrainingDue.css"));

    expect(css).toContain("@page{size:A4landscape");
    expect(css).toContain("body:has(.trainingperson-print-area).trainingdue-page>*:not(.trainingperson-print-area){display:none!important}");
    expect(css).toContain("body:has(.trainingperson-print-area).sidebar");
    expect(css).toContain("body:has(.trainingperson-print-area).web-header");
    expect(css).toContain(".trainingperson-print-area{position:static");
    expect(css).toContain(".trainingperson-print-area.trainingdue-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(css).not.toContain(".trainingperson-print-area{position:absolute");
  });

  it("keeps Pilot Experience as a compact two-column one-sheet report without editor controls", () => {
    const css = compact(read("../modules/pilotExperience/PilotExperienceBuilder.css"));
    const jsx = compact(read("../modules/pilotExperience/PilotExperienceBuilder.jsx"));

    expect(jsx).toContain('className="paperpe-print-area"');
    expect(jsx).toContain("exportLogbookPdf(`PilotExperience_${data.code||data.licence||\"pilot\"}.pdf`)");
    expect(jsx).not.toContain("onClick={()=>window.print()}");
    expect(jsx).toContain('className="no-print"><tdcolSpan="3"');
    expect(jsx).toContain('className="no-print"><tdcolSpan="6"');

    expect(css).toContain("@page{size:A4landscape");
    expect(css).toContain("body:has(.pe-print-area).pe-page>*:not(.pe-print-area){display:none!important}");
    expect(css).toContain(".pe-print-area{position:static");
    expect(css).toContain(".pe-print-area.top-grid,.pe-print-area.exp-grid{display:grid!important;grid-template-columns:1fr1fr!important");
    expect(css).toContain(".pe-print-areabutton,.pe-print-area.image-box-actions,.pe-print-area.no-print{display:none!important}");
    expect(css).not.toContain(".top-grid,.exp-grid{display:block!important}");
  });

  it("preserves Pilot Experience two-column grids in the generated fit-to-page PDF clone", () => {
    const source = compact(read("./downloadPdf.js"));

    expect(source).toContain('${options.fitToPage?".top-grid,.exp-grid{display:grid!important;grid-template-columns:1fr1fr!important;}"');
    expect(source).toContain(".pe-print-area.paper-head{");
    expect(source).toContain(".pe-print-areatable{");
  });

  it("uses the generated fit-to-page path before the Electron print bridge", () => {
    const source = compact(read("./desktopDatabase.js"));
    const resolveAt = source.indexOf("resolvePdfExportTarget()");
    const bridgeAt = source.indexOf("if(window.aviCoreAPI)returnwindow.aviCoreAPI.exportLogbookPdf");

    expect(resolveAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(bridgeAt);
    expect(source).toContain("if(fitToPage)returndownloadElementAsPdf(element,suggestedName,{landscape:true,fitToPage:true})");
  });
});
