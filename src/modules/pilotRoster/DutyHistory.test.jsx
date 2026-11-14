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
    render(<DutyHistory loadRows={loader()} />);
    expect(await screen.findByText("CSU")).toBeTruthy();
    expect(screen.getByText("KCH")).toBeTruthy();
    const dayCells = [...document.querySelectorAll(".dutyhist-ft")].map((el) => el.textContent);
    expect(dayCells).toContain("3:20");                      // flight day cell
    expect(dayCells).toContain("DSB");                       // standby day cell
    expect(screen.getAllByText("FT 7D").length).toBe(1);
    expect(document.querySelectorAll("tbody tr")[0].querySelectorAll(".dutyhist-ahead")).toHaveLength(7);
  });

  it("filters by pilot and changes the range", async () => {
    render(<DutyHistory loadRows={loader()} />);
    await screen.findByText("CSU");
    fireEvent.change(screen.getByPlaceholderText(/Search pilot/), { target: { value: "kch" } });
    expect(screen.queryByText("CSU")).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "7" } });
    expect(document.querySelectorAll("tbody tr")[0].querySelectorAll(".dutyhist-day")).toHaveLength(7);
  });
});
