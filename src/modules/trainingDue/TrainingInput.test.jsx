// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const db = vi.hoisted(() => ({
  saveTraining: vi.fn(async () => {}),
  importTrainingMany: vi.fn(async () => {}),
  getSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => {}),
  saveDocument: vi.fn(async (_d, _f, name) => `stored/${name}`),
  openFile: vi.fn(async () => ({ ok: true })),
  listTraining: vi.fn(async () => []),
}));
vi.mock("../../services/desktopDatabase.js", () => db);
vi.mock("../../services/trainingImport.js", () => ({ parseTrainingExcelFile: vi.fn() }));

import TrainingInput from "./TrainingInput.jsx";
import Training from "./Training.jsx";
import { TRAINING_ITEMS } from "../../utils/trainingDue.js";

const dateItem = TRAINING_ITEMS.find((i) => i.type !== "count");
const pilots = [{ code: "ABC", name: "Pilot A", record: { [dateItem.key]: "2027-01-05", docs: { [dateItem.key]: "stored/old.pdf" } } }];

beforeEach(() => { cleanup(); Object.values(db).forEach((f) => f.mockClear()); });

describe("Training Input / Import (merged tab)", () => {
  it("has one Input / Import tab instead of separate Input and Import PDF / Excel tabs", () => {
    render(<Training />);
    expect(screen.getByText(/Input \/ Import/)).toBeTruthy();
    expect(screen.queryByText(/Import PDF \/ Excel/)).toBeNull();
  });

  it("shows Excel import and per-item attach in the same tab", () => {
    render(<TrainingInput pilots={pilots} thresholds={{}} onSaved={async () => {}} />);
    expect(screen.getByText(/Import Excel/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ABC" } });
    expect(screen.getAllByText("📄 View").length).toBe(1);
    expect(screen.getAllByText("Replace").length).toBe(1);
    expect(screen.getAllByText("📎 Attach").length).toBe(TRAINING_ITEMS.length - 1);
  });

  it("attaching a document keeps the existing record and other docs", async () => {
    const onSaved = vi.fn(async () => {});
    const { container } = render(<TrainingInput pilots={pilots} thresholds={{}} onSaved={onSaved} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ABC" } });
    const other = TRAINING_ITEMS.find((i) => i.key !== dateItem.key);
    const inputs = container.querySelectorAll('label.doc-upload input[type="file"]');
    const idx = TRAINING_ITEMS.findIndex((i) => i.key === other.key);
    const file = new File(["%PDF"], "cert.pdf", { type: "application/pdf" });
    fireEvent.change(inputs[idx], { target: { files: [file] } });
    await waitFor(() => expect(db.saveTraining).toHaveBeenCalled());
    const [code, , record] = db.saveTraining.mock.calls[0];
    expect(code).toBe("ABC");
    expect(record[dateItem.key]).toBe("2027-01-05");
    expect(record.docs[dateItem.key]).toBe("stored/old.pdf");
    expect(record.docs[other.key]).toMatch(/^stored\/ABC_/);
    expect(onSaved).toHaveBeenCalled();
  });

  it("new pilot cannot attach until saved", () => {
    render(<TrainingInput pilots={pilots} thresholds={{}} onSaved={async () => {}} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__new__" } });
    expect(screen.queryByText("📎 Attach")).toBeNull();
    expect(screen.getAllByText("Save pilot first to attach").length).toBe(TRAINING_ITEMS.length);
  });
});
