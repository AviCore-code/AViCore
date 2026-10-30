// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const db = vi.hoisted(() => ({
  listExperience: vi.fn(async () => [{ code: "WJU", name: "Weera Juntaklud" }, { code: "KCH", name: "K" }, { code: "NSO", name: "N" }]),
  addDutyEntry: vi.fn(async () => {}),
  listDutyEntriesByPilot: vi.fn(async () => []),
  deleteDutyEntry: vi.fn(async () => {}),
  updateDutyEntry: vi.fn(async () => {}),
  getSetting: vi.fn(async () => null),
  getPreferredPilotCode: vi.fn(async () => "WJU"),
  isSinglePilotDevice: vi.fn(() => false),
  isDemoSession: vi.fn(() => false),
}));
vi.mock("../../services/desktopDatabase.js", () => db);
vi.mock("../../utils/uiSound.js", () => ({ playOk() {}, playError() {}, playClick() {} }));
vi.mock("../../utils/clickSound.js", () => ({ playOk() {}, playError() {}, playClick() {} }));

import DutyEntry from "./DutyEntry.jsx";

beforeEach(() => { cleanup(); Object.values(db).forEach((f) => f.mockClear?.()); window.alert = vi.fn(); Element.prototype.scrollIntoView = vi.fn(); });

async function openForm() {
  const utils = render(<DutyEntry />);
  await waitFor(() => expect(screen.getByDisplayValue(/WJU — Weera/)).toBeTruthy());
  return utils;
}
const picker = () => screen.getByRole("radiogroup");

describe("Daily Duty — Flights / Day first, one row per flight", () => {
  it("later flights follow flight 1's LS and Route until changed", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("3"));
    const ls = () => [...container.querySelectorAll(".duty-legs-row")].map((r) => r.querySelectorAll(".pilot-picker input")[1].value);
    const routes = () => [1, 2, 3].map((n) => screen.getByLabelText(`Flight ${n} route`).value);
    fireEvent.change(screen.getByLabelText("Flight 1 route"), { target: { value: "VTSH-CPOC-VTSH" } });
    fireEvent.change(container.querySelectorAll(".duty-legs-row .pilot-picker input")[1], { target: { value: "KCH" } });
    expect(routes()).toEqual(["VTSH-CPOC-VTSH", "VTSH-CPOC-VTSH", "VTSH-CPOC-VTSH"]);
    expect(ls()).toEqual(["KCH", "KCH", "KCH"]);
    fireEvent.change(screen.getByLabelText("Flight 3 route"), { target: { value: "VTSH-BQP-VTSH" } });
    fireEvent.change(screen.getByLabelText("Flight 1 route"), { target: { value: "VTSH-ERLQ2-VTSH" } });
    expect(routes()).toEqual(["VTSH-ERLQ2-VTSH", "VTSH-ERLQ2-VTSH", "VTSH-BQP-VTSH"]);
    fireEvent.change(screen.getByLabelText("Flight 2 type"), { target: { value: "Ferry Flight" } });
    fireEvent.change(screen.getByLabelText("Flight 1 type"), { target: { value: "Training" } });
    expect([1, 2, 3].map((n) => screen.getByLabelText(`Flight ${n} type`).value)).toEqual(["Training", "Ferry Flight", "Training"]);
    fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByText("4"));
    expect(screen.getByLabelText("Flight 4 route").value).toBe("VTSH-BQP-VTSH");
    expect(ls()[3]).toBe("KCH");
  });

  it("defaults RS to the logged-in pilot on every flight, editable", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    const rs = () => [...container.querySelectorAll(".duty-legs-row")].map((r) => r.querySelectorAll(".pilot-picker input")[0].value);
    expect(rs()).toEqual(["WJU", "WJU"]);
    fireEvent.change(container.querySelectorAll(".duty-legs-row .pilot-picker input")[0], { target: { value: "KCH" } });
    fireEvent.change(container.querySelectorAll(".duty-legs-row .pilot-picker input")[1], { target: { value: "WJU" } }); // WJU moves to LS on flight 1
    fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByText("3"));
    expect(rs()).toEqual(["KCH", "WJU", "WJU"]);
    const ls2 = container.querySelectorAll(".duty-legs-row")[1].querySelectorAll(".pilot-picker input")[1].value;
    expect(ls2).toBe(""); // WJU is already RS on flight 2 - not copied into LS
    const ls3 = container.querySelectorAll(".duty-legs-row")[2].querySelectorAll(".pilot-picker input")[1].value;
    expect(ls3).toBe("");
  });

  it("asks for Flights / Day before showing the flight form", async () => {
    await openForm();
    expect(screen.queryByText("Sch Dep")).toBeNull();
    expect(screen.getByText(/How many flights today/)).toBeTruthy();
    expect(screen.getByText("Save Entry").disabled).toBe(true);
  });

  it("opens one row per flight, copying the row above, and keeps rows when the count changes", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("3"));
    expect(screen.getByText("Sch Dep")).toBeTruthy();
    expect(container.querySelectorAll(".duty-legs-row").length).toBe(3);
    fireEvent.change(screen.getByLabelText("Flight 1 route"), { target: { value: "VTSH-CPOC-VTSH" } });
    fireEvent.change(screen.getByLabelText("Flight 3 type"), { target: { value: "Training" } });
    fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByText("2"));
    expect(container.querySelectorAll(".duty-legs-row").length).toBe(2);
    expect(screen.getByLabelText("Flight 1 route").value).toBe("VTSH-CPOC-VTSH");
    fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByText("3"));
    expect(screen.getByLabelText("Flight 3 type").value).toBe("Revenue Flight"); // re-copied from row 2
  });

  it("saves each flight's own type and the first flight's type on the entry", async () => {
    await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    fireEvent.change(screen.getByLabelText("Flight 2 type"), { target: { value: "Training" } });
    fireEvent.change(screen.getByLabelText("Flight 1 route"), { target: { value: "VTSH-CPOC-VTSH" } });
    fireEvent.change(screen.getByLabelText("Flight 2 route"), { target: { value: "VTSH-VTSH" } });
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(db.addDutyEntry).toHaveBeenCalled());
    const saved = db.addDutyEntry.mock.calls[0][0];
    expect(saved.flightsPerDay).toBe("2");
    expect(saved.flightType).toBe("Revenue Flight");
    expect(saved.legs.map((l) => l.flightType)).toEqual(["Revenue Flight", "Training"]);
    expect(saved.legs[0].rs).toBe("WJU");
    expect(saved.route).toBe("VTSH-CPOC-VTSH/VTSH-VTSH");
  });

  it("blocks saving when the pilot is not seated on a flight", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("1"));
    const seat = container.querySelectorAll(".duty-legs-row .pilot-picker input")[0];
    fireEvent.change(seat, { target: { value: "KCH" } });
    expect(screen.getByText(/WJU is not in RS or LS on this flight/)).toBeTruthy();
    fireEvent.click(screen.getByText("Save Entry"));
    expect(window.alert).toHaveBeenCalled();
    expect(db.addDutyEntry).not.toHaveBeenCalled();
  });

  it("opens an old single-type multi-leg entry with that type on every flight", async () => {
    db.listDutyEntriesByPilot.mockResolvedValueOnce([{ id: 7, dutyType: "flight", date: "2026-10-20", flightType: "Ferry Flight", totalFlightTime: "1:00",
      legs: [{ aircraftType: "AW139", registration: "HS-UOM", rs: "WJU", ls: "", route: "VTSH-VTUP" }, { aircraftType: "AW139", registration: "HS-UOM", rs: "WJU", ls: "", route: "VTUP-VTSH" }] }]);
    await openForm();
    await waitFor(() => expect(screen.getByText("Edit")).toBeTruthy());
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByLabelText("Flight 1 type").value).toBe("Ferry Flight");
    expect(screen.getByLabelText("Flight 2 type").value).toBe("Ferry Flight");
  });
});
