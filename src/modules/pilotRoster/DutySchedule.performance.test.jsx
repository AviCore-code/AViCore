// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRoster: vi.fn(async () => []),
  listRosterPilots: vi.fn(async () => {
    throw new Error("Duty Schedule must not scan the complete roster history");
  }),
  listExperience: vi.fn(async () => [
    { code: "WJU", name: "Weera Juntaklud", position: "Captain" },
    { code: "KCH", name: "Pilot K", position: "FO" },
  ]),
}));

vi.mock("../../services/desktopDatabase.js", () => ({
  listRoster: mocks.listRoster,
  listRosterPilots: mocks.listRosterPilots,
  listExperience: mocks.listExperience,
  importRosterMany: vi.fn(async () => ({ ok: true })),
  deleteRosterEntry: vi.fn(async () => ({ ok: true })),
  getSetting: vi.fn(async () => null),
  exportLogbookPdf: vi.fn(async () => ({ ok: true })),
}));

import DutySchedule from "./DutySchedule.jsx";

afterEach(() => {
  cleanup();
  mocks.listRoster.mockClear();
  mocks.listRosterPilots.mockClear();
  mocks.listExperience.mockClear();
});

describe("Duty Schedule data loading", () => {
  it("builds the pilot list from experience plus the selected month only", async () => {
    render(<DutySchedule />);

    expect(await screen.findByText("WJU")).toBeTruthy();
    expect(screen.getByText("KCH")).toBeTruthy();
    await waitFor(() => expect(mocks.listRoster).toHaveBeenCalledTimes(1));

    expect(mocks.listRoster.mock.calls[0][0]).toMatchObject({
      from: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      to: expect.stringMatching(/^\d{4}-\d{2}-(28|29|30|31)$/),
    });
    expect(mocks.listExperience).toHaveBeenCalledTimes(1);
    expect(mocks.listRosterPilots).not.toHaveBeenCalled();
  });
});
