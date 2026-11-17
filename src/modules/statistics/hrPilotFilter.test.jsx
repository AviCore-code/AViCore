// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

vi.mock("../../services/desktopDatabase.js", () => ({ getSetting: vi.fn(async () => null), saveSetting: vi.fn(async () => {}), listRoster: vi.fn(async () => []) }));

import FtMonthlyHr from "./FtMonthlyHr.jsx";
import { withoutExcluded } from "./hrPilotFilter.jsx";
import { ftMonthlyHrSheetRows } from "../../utils/ftMonthlyHr.js";

beforeEach(() => cleanup());

const rows = [
  { pilot: { code: "CSU", name: "Chanchai" }, entries: [] },
  { pilot: { code: "KTH", name: "Krittee" }, entries: [] },
  { pilot: { code: "SBO", name: "Sutep" }, entries: [] }
];

describe("HR sheets - choose pilots", () => {
  it("leaves excluded pilots off and renumbers", () => {
    const r = withoutExcluded({ days: [], pilots: ["CSU", "KTH", "SBO"].map((code, i) => ({ no: i + 1, code, name: code, perDay: [], total: 0 })) }, new Set(["KTH"]));
    expect(r.pilots.map((p) => [p.no, p.code])).toEqual([[1, "CSU"], [2, "SBO"]]);
    expect(ftMonthlyHrSheetRows(r, { dayLabel: (d) => d }).slice(2, 4).map((x) => x[2])).toEqual(["CSU", "SBO"]);
  });

  it("FT Monthly: untick a pilot - gone from the table, saved, others renumbered; saved list applied on open", async () => {
    const save = vi.fn(async () => {});
    render(<FtMonthlyHr loadRows={async () => ({ rows })} pilotFilter={{ load: async () => ["SBO"], save }} />);
    await waitFor(() => expect(screen.getByText(/Pilots 2 \/ 3/)).toBeTruthy());
    expect(screen.queryByText("Sutep")).toBeNull();
    fireEvent.click(screen.getByText(/Pilots 2 \/ 3/));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Choose pilots" })).getByLabelText("Include KTH"));
    expect(save).toHaveBeenLastCalledWith("hr_excluded_pilots", ["KTH", "SBO"]);
    const body = document.querySelector(".hrft-table tbody");
    expect(within(body).queryByText("Krittee")).toBeNull();
    expect(within(body).getByText("Chanchai").closest("tr").firstChild.textContent).toBe("1");
    expect(screen.getByText(/1 pilots/)).toBeTruthy();
    fireEvent.click(screen.getByText("All"));
    expect(save).toHaveBeenLastCalledWith("hr_excluded_pilots", []);
    expect(within(document.querySelector(".hrft-table tbody")).getByText("Sutep")).toBeTruthy();
  });
});
