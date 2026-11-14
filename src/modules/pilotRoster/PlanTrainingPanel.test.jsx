// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  importRosterMany: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../../services/desktopDatabase.js", () => ({
  listRoster: vi.fn(async () => []),
  listRosterPilots: vi.fn(async () => []),
  listTraining: vi.fn(async () => []),
  listExperience: vi.fn(async () => []),
  loadExperience: vi.fn(async () => null),
  listDutyEntriesByPilot: vi.fn(async () => []),
  getSetting: vi.fn(async () => null),
  importRosterMany: mocks.importRosterMany,
}));

vi.mock("../../services/rosterTrainingPlanner.js", () => ({
  planTrainingOntoRoster: () => ({
    entries: [
      { pilotCode: "CSU", date: "2026-12-01", code: "O,S" },
      { pilotCode: "CSU", date: "2026-12-02", code: "O,S" },
    ],
    planned: [{ pilotCode: "CSU", item: "lpc", start: "2026-12-01", end: "2026-12-02" }],
    skipped: [],
  }),
  describePlannedTraining: (p) => `${p.pilotCode} ${p.item}`,
  describeSkippedTraining: () => "",
  isoAddDays: (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
}));

import PlanTrainingPanel from "./PlanTrainingPanel.jsx";

afterEach(() => { cleanup(); mocks.importRosterMany.mockClear(); });

describe("PlanTrainingPanel (locked: preview first)", () => {
  it("Preview plan writes nothing to the roster", async () => {
    render(<PlanTrainingPanel onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Preview plan"));
    expect(await screen.findByText(/Preview only - nothing has been written/)).toBeTruthy();
    expect(screen.getByText(/not written yet/)).toBeTruthy();
    expect(mocks.importRosterMany).not.toHaveBeenCalled();
  });

  it("writes only when Write ... to roster is pressed", async () => {
    const onGenerated = vi.fn();
    render(<PlanTrainingPanel onCancel={() => {}} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText("Preview plan"));
    fireEvent.click(await screen.findByText("Write 2 day(s) to roster"));
    expect(await screen.findByText(/Written 2 training day\(s\)/)).toBeTruthy();
    expect(mocks.importRosterMany).toHaveBeenCalledTimes(1);
    expect(onGenerated).toHaveBeenCalled();
  });

  it("Discard drops the plan without writing", async () => {
    render(<PlanTrainingPanel onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Preview plan"));
    fireEvent.click(await screen.findByText("Discard"));
    expect(screen.queryByText(/Write 2 day/)).toBeNull();
    expect(mocks.importRosterMany).not.toHaveBeenCalled();
  });
});
