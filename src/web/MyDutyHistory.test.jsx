// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  code: "KPO",
  dutyFor: vi.fn(async () => []),
  roster: vi.fn(async () => [
    { pilot_code: "KPO", date: "2099-01-01", code: "X" },
    { pilot_code: "CSU", date: "2099-01-01", code: "VL" },
  ]),
}));

vi.mock("../services/desktopDatabase.js", () => ({
  getPreferredPilotCode: vi.fn(async () => mocks.code),
  listExperience: vi.fn(async () => [
    { code: "KPO", name: "Pilot K", position: "Captain" },
    { code: "CSU", name: "Pilot C", position: "FO" },
  ]),
  listDutyEntriesByPilot: mocks.dutyFor,
  getSetting: vi.fn(async () => null),
  listRoster: mocks.roster,
}));

import MyDutyHistory from "./MyDutyHistory.jsx";

afterEach(() => { cleanup(); mocks.dutyFor.mockClear(); mocks.code = "KPO"; });

describe("Crew: my Duty & Flight History", () => {
  it("shows only the signed-in pilot, reads only their duty, no search box", async () => {
    render(<MyDutyHistory />);
    expect(await screen.findByText("KPO")).toBeTruthy();
    expect(screen.queryByText("CSU")).toBeNull();
    expect(mocks.dutyFor.mock.calls.map((c) => c[0])).toEqual(["KPO"]);
    expect(screen.queryByPlaceholderText(/Search pilot/)).toBeNull();
    expect(document.querySelectorAll(".dutyhist-grouprow")).toHaveLength(0);
  });

  it("asks to sign in when no pilot is paired", async () => {
    mocks.code = "";
    render(<MyDutyHistory />);
    expect(await screen.findByText(/Sign in as a pilot/)).toBeTruthy();
    expect(mocks.dutyFor).not.toHaveBeenCalled();
  });
});
