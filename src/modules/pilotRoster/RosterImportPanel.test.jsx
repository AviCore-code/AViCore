// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replaceRosterRange: vi.fn(async () => ({ ok: true, removed: 5 })),
}));

vi.mock("../../services/desktopDatabase.js", () => ({ replaceRosterRange: mocks.replaceRosterRange }));
vi.mock("../../services/rosterImport.js", () => ({
  readRosterWorkbookFile: vi.fn(async () => ({ SheetNames: ["RR 2026_Add Training"] })),
  listRosterSheetNames: (wb) => wb.SheetNames,
  guessRosterSheet: (names) => names[0],
  parseRosterWorkbook: () => ({
    sheetName: "RR 2026_Add Training",
    pilots: [{ pilotCode: "KTO", pilotName: "Kittisak" }],
    dateRange: { from: "2026-11-01", to: "2026-11-30" },
    entries: [
      { pilotCode: "KTO", date: "2026-11-05", code: "O" },
      { pilotCode: "KTO", date: "2026-11-09", code: "VL" },
      { pilotCode: "KTO", date: "2026-11-20", code: "X" },
    ],
  }),
}));

import RosterImportPanel, { entriesInRange } from "./RosterImportPanel.jsx";

afterEach(() => { cleanup(); mocks.replaceRosterRange.mockClear(); });

async function openFile() {
  render(<RosterImportPanel onCancel={() => {}} />);
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["x"], "roster.xlsx")] } });
  await screen.findByText(/Import preview/);
}

describe("RosterImportPanel date range", () => {
  it("entriesInRange keeps only the chosen dates", () => {
    const e = [{ date: "2026-11-01" }, { date: "2026-11-10" }, { date: "2026-11-30" }];
    expect(entriesInRange(e, "2026-11-05", "2026-11-29").map((x) => x.date)).toEqual(["2026-11-10"]);
  });

  it("imports the whole sheet by default", async () => {
    await openFile();
    fireEvent.click(screen.getByText("Import 2026-11-01 → 2026-11-30"));
    await vi.waitFor(() => expect(mocks.replaceRosterRange).toHaveBeenCalled());
    const [entries, range] = mocks.replaceRosterRange.mock.calls[0];
    expect(range).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(entries).toHaveLength(3);
  });

  it("imports only the picked range, and replaces only that range", async () => {
    await openFile();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-15" } });
    fireEvent.click(screen.getByText("Import 2026-11-08 → 2026-11-15"));
    await vi.waitFor(() => expect(mocks.replaceRosterRange).toHaveBeenCalled());
    const [entries, range] = mocks.replaceRosterRange.mock.calls[0];
    expect(range).toEqual({ from: "2026-11-08", to: "2026-11-15" });
    expect(entries.map((e) => e.date)).toEqual(["2026-11-09"]);
  });

  it("blocks a start date after the end date", async () => {
    await openFile();
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-20" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-10" } });
    expect(screen.getByText("The start date is after the end date.")).toBeTruthy();
    expect(screen.getByText(/^Import 2026-11-20/).closest("button").disabled).toBe(true);
  });
});
