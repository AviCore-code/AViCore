// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(async () => ({ ok: true, count: 2, removed: 5, from: "2026-11-01", to: "2026-11-30", limited: true })),
}));

vi.mock("../../services/fdtImport.js", () => ({
  parseAllFdtFiles: vi.fn(async () => [{ filename: "KPO_FDT.xlsx", code: "KPO", entries: [{ date: "2026-11-10", dutyType: "flight" }] }]),
}));
vi.mock("../../services/desktopDatabase.js", () => ({
  replaceDutyEntriesFromFile: mocks.replace,
  removeDutyEntriesBySourceFile: vi.fn(),
  listImportedFdtFiles: vi.fn(async () => []),
}));

import DutyImport from "./DutyImport.jsx";

afterEach(() => { cleanup(); mocks.replace.mockClear(); });

const drop = () => {
  const input = document.getElementById("dutyimport-file-input");
  fireEvent.change(input, { target: { files: [new File(["x"], "KPO_FDT.xlsx")] } });
};

describe("FDT Import date range", () => {
  it("All passes no range (replace everything)", async () => {
    render(<DutyImport />);
    drop();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.replace.mock.calls[0][2]).toBeNull();
  });

  it("Only from..to passes the chosen range", async () => {
    render(<DutyImport />);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-30" } });
    drop();
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalled());
    expect(mocks.replace.mock.calls[0][2]).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(await screen.findByText(/2026-11-01 → 2026-11-30 only: removed 5 old, wrote 2/)).toBeTruthy();
  });

  it("refuses a start date after the end date", async () => {
    render(<DutyImport />);
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-30" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-01" } });
    drop();
    expect(await screen.findAllByText(/The start date is after the end date/)).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
