import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTrainingWorkbook } from "./trainingImport.js";
import { TRAINING_COLUMNS, TRAINING_ITEMS } from "../utils/trainingDue.js";

// Builds a workbook in the company's layout: one pilot, every column of
// "Pilot Training DUE Monitor" filled with a distinct date (I.APP with a count).
function workbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["No", "Name", "License No", "CODE"], [], [1, "Weera Juntaklud", "ATPL-1", "WJU"]
  ]), "INPUT DATA");
  const header = ["CODE", ...TRAINING_COLUMNS.map((c) => c.label)];
  const row = ["WJU", ...TRAINING_COLUMNS.map((c, i) => (c.type === "count" ? 7 : new Date(Date.UTC(2027, 0, 1 + i))))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row], { cellDates: true }), "Pilot Training DUE Monitor");
  return wb;
}

describe("Training Excel import after I.APP (180D) was removed from Training", () => {
  it("I.APP is no longer a training item but its column is still skipped in place", () => {
    expect(TRAINING_ITEMS.some((i) => i.key === "iApp180")).toBe(false);
    expect(TRAINING_COLUMNS.some((i) => i.key === "iApp180")).toBe(true);
  });

  it("columns after I.APP still land on the right items", () => {
    const { pilots } = parseTrainingWorkbook(workbook());
    const rec = pilots.find((p) => p.code === "WJU").record;
    expect(rec.iApp180).toBeUndefined();
    TRAINING_COLUMNS.forEach((c, i) => {
      if (c.key === "iApp180") return;
      const d = new Date(rec[c.key]);
      expect([c.key, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([c.key, 2027, 0, 1 + i]);
    });
  });
});
