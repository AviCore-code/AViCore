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
});
