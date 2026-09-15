import { describe, expect, it } from "vitest";
import { documentFilename, validateStaffDocument } from "./documents.js";

describe("staff training document attachments", () => {
  it("accepts persisted record formats and creates a safe attachment filename", () => {
    const file = { name: "My Certificate (Final).PDF", size: 1024, type: "application/pdf" };
    expect(validateStaffDocument(file)).toBe(file);
    expect(documentFilename(file, "record_123")).toBe("record_123.pdf");
  });

  it("rejects unsupported or oversized attachments", () => {
    expect(() => validateStaffDocument({ name: "notes.txt", size: 10 })).toThrow("PDF, JPG or PNG");
    expect(() => validateStaffDocument({ name: "scan.png", size: 5 * 1024 * 1024 + 1 })).toThrow("5 MB or smaller");
  });
});
