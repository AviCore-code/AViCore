import { describe, expect, it } from "vitest";
import { visibleImportedFiles } from "./DutyImport.jsx";

describe("Import FDT file list", () => {
  it("shows uploaded Excel sources but not Crew-entered synthetic sources", () => {
    const files = [
      { code: "WJU", filename: "(not from a file)", manual: true },
      { code: "WJU", filename: "WJU_FDT.xlsx", manual: false },
      { code: "WJU", filename: "WJU_FDT_OLD.xlsx", manual: false },
    ];

    expect(visibleImportedFiles(files).map((file) => file.filename)).toEqual([
      "WJU_FDT.xlsx",
      "WJU_FDT_OLD.xlsx",
    ]);
  });
});
