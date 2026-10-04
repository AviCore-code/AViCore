// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportLogbookPdf: vi.fn(async () => ({ ok: true, filePath: "/tmp/logbook.pdf" })),
}));

vi.mock("../../services/desktopDatabase.js", () => ({
  listExperience: vi.fn(async () => [{ code: "PDE", name: "Pilot Demo", licence: "LIC-1" }]),
  loadExperience: vi.fn(async () => null),
  listDutyEntriesByPilot: vi.fn(async () => []),
  exportLogbookPdf: mocks.exportLogbookPdf,
  getPreferredPilotCode: vi.fn(async () => "PDE"),
  isSinglePilotDevice: vi.fn(() => false),
  isDemoSession: vi.fn(() => false),
}));

vi.mock("../../components/DateField.jsx", () => ({
  default: ({ value, onChange }) => (
    <input data-testid="date-field" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
  isoToDisplay: (value) => value,
}));

import MyLogbook from "./MyLogbook.jsx";

async function renderLogbook() {
  render(<MyLogbook />);
  await waitFor(() => expect(screen.getByRole("combobox").value).toBe("PDE"));
  return screen.getAllByTestId("date-field");
}

describe("MyLogbook selected-date export", () => {
  beforeEach(() => {
    mocks.exportLogbookPdf.mockClear();
    window.aviCoreAPI = {};
    window.requestAnimationFrame = (callback) => callback();
  });

  afterEach(() => {
    cleanup();
    delete window.aviCoreAPI;
    delete window.requestAnimationFrame;
  });

  it("keeps the existing 12-month export preset active until a date is edited", async () => {
    await renderLogbook();

    expect(screen.getByTitle("The last 12 months. Print and Export will use this span.").className)
      .toContain("active");
    expect(screen.getByRole("button", { name: "Selected dates" }).className)
      .not.toContain("active");
    expect(screen.getByRole("button", { name: "Export PDF (12M)" })).toBeTruthy();
  });

  it("deactivates the month preset and activates Selected dates after a date is edited", async () => {
    const [fromInput] = await renderLogbook();

    const threeMonthButton = screen.getByTitle("The last 3 months. Print and Export will use this span.");
    fireEvent.click(threeMonthButton);
    expect(threeMonthButton.className).toContain("active");

    fireEvent.change(fromInput, { target: { value: "2026-01-17" } });

    expect(threeMonthButton.className).not.toContain("active");
    expect(screen.getByRole("button", { name: "Selected dates" }).className).toContain("active");
  });

  it("exports the exact selected From and To dates", async () => {
    const [fromInput, toInput] = await renderLogbook();

    fireEvent.change(fromInput, { target: { value: "2026-01-17" } });
    fireEvent.change(toInput, { target: { value: "2026-03-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Export PDF (Selected dates)" }));

    await waitFor(() => {
      expect(mocks.exportLogbookPdf).toHaveBeenCalledWith(
        "PDE_2026-01-17_to_2026-03-09_Logbook.pdf",
      );
    });
  });
});
