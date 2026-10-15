import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("Admin feature navigation regression", () => {
  it("keeps All Staff Training reachable from the Training workspace", () => {
    const source = read("../modules/trainingDue/Training.jsx");
    expect(source).toContain('import StaffTraining from "../staffTraining/StaffTraining.jsx"');
    expect(source).toContain('key: "staff"');
    expect(source).toContain('label: "All Staff Training"');
    expect(source).toContain('tab === "staff" && <StaffTraining />');
  });

  it("keeps LINE Settings visible in Admin Setting", () => {
    const source = read("../modules/settings/AdminSettingsTab.jsx");
    expect(source).toContain('import LineSettingsPanel from "./LineSettingsPanel.jsx"');
    expect(source).toContain("<LineSettingsPanel />");
  });

  it("keeps server-managed Training Due and FTL email alerts visible in Web Admin", () => {
    const source = read("../modules/settings/AdminSettingsTab.jsx");
    const database = read("../services/desktopDatabase.js");
    expect(source).toContain("Daily Training Due &amp; FTL Email Alerts");
    expect(source).toContain("Notification Recipients");
    expect(database).toContain('saveSetting("alert_email_config"');
  });

  it("keeps Pilot Experience Summary beside Logbook with the same pilot selector", () => {
    const navigation = read("./adminNavigation.js");
    const admin = read("./AdminWebApp.jsx");
    const workspace = read("../modules/flightCrews/FlightCrews.jsx");
    const experience = read("../modules/myExperience/MyExperience.jsx");
    expect(navigation).toContain('{ key: "logbook", label: "Logbook", icon: "📖" },\n      { key: "experience", label: "Pilot Experience Summary", icon: "🪪" }');
    expect(admin).toContain('import PilotExperienceSummary from "../modules/myExperience/PilotExperienceSummary.jsx"');
    expect(admin).toContain('{ key: "experience", label: "Pilot Experience Summary", icon: "🪪", Component: PilotExperienceSummary }');
    expect(workspace).toContain('import PilotExperienceSummary from "../myExperience/PilotExperienceSummary.jsx"');
    expect(workspace).toContain('{ key: "logbook", label: "Logbook", icon: "📔", Component: MyLogbook },\n  { key: "experience", label: "Pilot Experience Summary", icon: "🪪", Component: PilotExperienceSummary }');
    expect(experience).toContain('<select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)}>');
    expect(experience).toContain('{pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}');
  });

  it("renders five main destinations with a second-level screen tab bar", () => {
    const source = read("./AdminWebApp.jsx");
    const css = read("./AdminWebApp.css");
    expect(source).toContain('from "./adminNavigation.js"');
    expect(source).toContain("ADMIN_SECTIONS.map");
    expect(source).toContain('className="admin-subtabs"');
    expect(source).toContain('aria-label={`${activeSection.label} screens`}');
    expect(source).toContain('aria-current={screen.key === tab ? "page" : undefined}');
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('role="tab"');
    expect(css).toContain(".admin-subtabs");
    expect(css).toContain('.admin-subtabs button[aria-current="page"]');
    expect(css).not.toContain('.admin-subtabs button[aria-selected="true"]');
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.admin-subtabs/s);
  });

  it("preserves danger styling when Sign Out moves to sidebar footer actions", () => {
    const source = read("./AppSidebar.jsx");
    expect(source.match(/item\.danger \? " app-sidebar-signout"/g)).toHaveLength(2);
  });
});
