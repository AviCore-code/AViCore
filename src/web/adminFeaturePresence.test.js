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
