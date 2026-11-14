// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DutyHistory from "./DutyHistory.jsx";
import { localIso } from "./dutyHistory.js";
import { isoAddDays } from "./weeklyPlanHeadroom.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";

afterEach(cleanup);

const today = localIso(new Date());
const yesterday = isoAddDays(today, -1);

function loader() {
  return async () => ({
    limits: withFtlDefaults(DEFAULT_FTL_LIMITS),
    rows: [
      { pilot: { code: "CSU", name: "Chanchai" }, entries: [
        { dutyType: "flight", date: yesterday, schDep: "08:00", stop: "16:00", totalFlightTime: "3:20" },
      ] },
      { pilot: { code: "KCH", name: "Kitsaphon" }, entries: [
        { dutyType: "non_flight", date: yesterday, nonFlightType: "Day Standby", start: "06:00", end: "18:00" },
      ] },
    ],
  });
}

describe("DutyHistory", () => {
  it("shows each pilot's past days, totals and next-7-day FT left", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => []} />);
    expect(await screen.findByText("CSU")).toBeTruthy();
    expect(screen.getByText("KCH")).toBeTruthy();
    const dayCells = [...document.querySelectorAll(".dutyhist-ft")].map((el) => el.textContent);
    expect(dayCells).toContain("3:20");                      // flight day cell
    expect(dayCells).toContain("DSB");                       // standby day cell
    expect(screen.getAllByText("FT 7D").length).toBe(1);
    expect(document.querySelectorAll("tbody tr")[0].querySelectorAll(".dutyhist-ahead")).toHaveLength(7);
  });

  it("filters by pilot and changes the range", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => []} />);
    await screen.findByText("CSU");
    fireEvent.change(screen.getByPlaceholderText(/Search pilot/), { target: { value: "kch" } });
    expect(screen.queryByText("CSU")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    expect(document.querySelectorAll("tbody tr")[0].querySelectorAll(".dutyhist-day")).toHaveLength(7);
  });
});

describe("DutyHistory remark column", () => {
  it("shows the roster's RR / OFF / leave blocks for the next 7 days", async () => {
    const d = (n) => isoAddDays(today, n);
    const roster = async () => [
      { pilot_code: "CSU", date: d(1), code: "RR" },
      { pilot_code: "CSU", date: d(2), code: "RR" },
      ...[3, 4, 5, 6, 7, 8, 9].map((n) => ({ pilot_code: "CSU", date: d(n), code: "X" })),
      { pilot_code: "KCH", date: d(2), code: "VL" },
      { pilot_code: "KCH", date: d(3), code: "O" },
    ];
    render(<DutyHistory loadRows={loader()} loadRoster={roster} />);
    await screen.findByText("CSU");
    const rows = document.querySelectorAll("tbody tr");
    const chips = (row) => [...row.querySelectorAll(".dutyhist-chip")].map((c) => c.textContent);
    expect(chips(rows[0])[0]).toMatch(/^RR .*\(2d\)$/);
    expect(chips(rows[0])[1]).toMatch(/^OFF .*\(7d\)$/);
    expect(chips(rows[1])).toEqual([expect.stringMatching(/^VL /)]);
  });

  it("keeps the hours on screen when the roster cannot be loaded", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => { throw new Error("offline"); }} />);
    expect(await screen.findByText("CSU")).toBeTruthy();
    expect(screen.getByText(/could not load the roster \(offline\)/)).toBeTruthy();
  });
});
