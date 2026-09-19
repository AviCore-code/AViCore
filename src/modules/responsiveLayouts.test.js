import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const modulesDir = path.dirname(new URL(import.meta.url).pathname);
const read = (relativePath) => fs.readFileSync(path.join(modulesDir, relativePath), "utf8");
const compact = (value) => value.replace(/\s+/g, "");

describe("responsive Admin module layouts", () => {
  it("gives every Statistics table a local horizontal scroll wrapper", () => {
    const jsx = read("statistics/FdtStatistics.jsx");
    const css = compact(read("statistics/FdtStatistics.css"));
    const tableCount = (jsx.match(/<table className="stats-table/g) || []).length;
    const wrapperCount = (jsx.match(/className="[^"]*stats-table-wrap[^"]*"/g) || []).length;

    expect(tableCount).toBeGreaterThan(0);
    expect(wrapperCount).toBe(tableCount);
    expect(css).toContain(".stats-table-wrap{max-width:100%;overflow-x:auto");
  });

  it("lets All Status controls wrap without forcing page overflow", () => {
    const css = compact(read("allStatus/AllStatus.css"));

    expect(css).toContain(".allstatus-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}");
    expect(css).toContain(".allstatus-filter{flex:11220px;min-width:min(220px,100%);max-width:100%");
    expect(css).toContain(".allstatus-controlsbutton{min-height:44px");
  });

  it("keeps Reports tabs reachable with wrapping and mobile scrolling", () => {
    const css = compact(read("reports/Reports.css"));

    expect(css).toContain(".reports-tabs{display:flex;gap:8px;flex-wrap:wrap;");
    expect(css).toContain(".reports-tabsbutton{min-height:44px;");
    expect(css).toContain("@media(max-width:600px){.reports-tabs{flex-wrap:nowrap;overflow-x:auto;");
  });

  it("keeps Settings cards, grids, and tables inside narrow viewports", () => {
    const css = compact(read("settings/Settings.css"));

    expect(css).toContain(".settings-hub-tab-body{min-height:200px;min-width:0;max-width:100%;overflow-x:auto}");
    expect(css).toContain(".settings-card{box-sizing:border-box;width:100%;");
    expect(css).toContain("max-width:min(560px,100%)");
    expect(css).toContain("@media(max-width:700px)");
    expect(css).toContain(".settings-ftl-grid{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".settings-devices-table{min-width:620px}");
  });

  it("keeps the Logbook career summary readable in a local scroll region", () => {
    const jsx = read("myLogbook/MyLogbook.jsx");
    const css = compact(read("myLogbook/MyLogbook.css"));

    expect(jsx).toContain('<div className="logbook-summary-scroll">');
    expect(css).toContain(".logbook-summary-scroll{max-width:100%;overflow-x:auto;");
    expect(css).toContain(".logbook-summary-table{width:100%;min-width:820px;");
    expect(css).toContain("@mediaprint");
    expect(css).toContain(".logbook-summary-scroll{overflow:visible}");
  });

  it("reflows Daily Duty grids and wide fields on mobile", () => {
    const css = compact(read("dutyEntry/DutyEntry.css"));

    expect(css).toContain("@media(max-width:700px)");
    expect(css).toContain(".duty-form-grid{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".duty-field.wide{grid-column:1/-1}");
    expect(css).toContain(".duty-legs-row{grid-template-columns:minmax(0,1fr)minmax(0,1fr);");
    expect(css).toContain(".duty-roles-row{grid-template-columns:minmax(0,1fr)minmax(0,1fr)36px;");
  });
});
