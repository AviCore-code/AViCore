// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DutyHistory from "./DutyHistory.jsx";
import { localIso } from "./dutyHistory.js";
import { isoAddDays } from "./weeklyPlanHeadroom.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";

afterEach(cleanup);

// The row of one pilot (rows are sorted for planning and grouped, so never by index).
const rowFor = (code) => [...document.querySelectorAll("tbody tr:not(.dutyhist-grouprow)")]
  .find((tr) => tr.querySelector(".dutyhist-code")?.textContent === code);

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
    expect(rowFor("CSU").querySelectorAll(".dutyhist-ahead")).toHaveLength(7);
  });

  it("filters by pilot and changes the range", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => []} />);
    await screen.findByText("CSU");
    fireEvent.change(screen.getByPlaceholderText(/Search pilot/), { target: { value: "kch" } });
    expect(screen.queryByText("CSU")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    expect(rowFor("KCH").querySelectorAll(".dutyhist-day")).toHaveLength(7);
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
    const chips = (row) => [...row.querySelectorAll(".dutyhist-chip")].map((c) => c.textContent);
    expect(chips(rowFor("CSU"))[0]).toMatch(/^RR .*\(2d\)$/);
    expect(chips(rowFor("CSU"))[1]).toMatch(/^OFF .*\(7d\)$/);
    expect(chips(rowFor("KCH"))).toEqual([expect.stringMatching(/^VL /)]);
  });

  it("reds the OFF days and only the RR pair right before a 7-day OFF", async () => {
    const d = (n) => isoAddDays(today, n);
    const roster = async () => [
      { pilot_code: "CSU", date: d(1), code: "RR" },     // mid-cycle RR: not red
      { pilot_code: "CSU", date: d(2), code: "O" },
      { pilot_code: "CSU", date: d(3), code: "RR" },     // RR pair before OFF x7: red
      { pilot_code: "CSU", date: d(4), code: "RR" },
      ...[5, 6, 7, 8, 9, 10, 11].map((n) => ({ pilot_code: "CSU", date: d(n), code: "X" })),
    ];
    render(<DutyHistory loadRows={loader()} loadRoster={roster} />);
    await screen.findByText("CSU");
    const cells = [...rowFor("CSU").querySelectorAll(".dutyhist-ahead")];
    expect(cells.map((c) => c.classList.contains("rostered-off"))).toEqual([false, false, true, true, true, true, true]);
    expect(cells[2].title).toMatch(/^Roster: RR/);
    expect(cells[4].title).toMatch(/^Roster: OFF/);
  });

  it("keeps the hours on screen when the roster cannot be loaded", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => { throw new Error("offline"); }} />);
    expect(await screen.findByText("CSU")).toBeTruthy();
    expect(screen.getByText(/could not load the roster \(offline\)/)).toBeTruthy();
  });
});

import { sortForPlanning } from "./DutyHistory.jsx";

describe("row order for planning", () => {
  const item = (code, position, ft, dt) => ({ pilot: { code, position }, h: { ahead: [{ left: ft, dtLeft: dt }] } });

  it("Captains first, then Co-pilots, then no position; most FT then DT left on top", () => {
    const out = sortForPlanning([
      item("FO1", "FO", 30, 50), item("CPT1", "Captain", 10, 40), item("NOPOS", undefined, 34, 60),
      item("SFO1", "SFO", 30, 55), item("CPT2", "Captain", 25, 20),
    ]).map((x) => x.pilot.code);
    expect(out).toEqual(["CPT2", "CPT1", "SFO1", "FO1", "NOPOS"]);
  });

  it("shows a header row per group in the table", async () => {
    render(<DutyHistory loadRows={loader()} loadRoster={async () => []} />);
    await screen.findByText("CSU");
    const headers = [...document.querySelectorAll(".dutyhist-grouprow")].map((r) => r.textContent);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatch(/^Position not set \(2\)/);
  });
});
