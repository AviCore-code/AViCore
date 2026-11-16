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
import { runBeforeLogout } from "../../web/idleLogout.js";

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

  it("RS starts as the logged-in pilot; later flights keep flight 1's pilot pair, editable", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    const seats = () => [...container.querySelectorAll(".duty-legs-row")].map((r) => [...r.querySelectorAll(".pilot-picker input")].map((x) => x.value).join("/"));
    expect(seats()).toEqual(["WJU/", "WJU/"]);
    const seat = (row, k) => container.querySelectorAll(".duty-legs-row")[row].querySelectorAll(".pilot-picker input")[k];
    fireEvent.change(seat(0, 0), { target: { value: "KCH" } });
    fireEvent.change(seat(0, 1), { target: { value: "WJU" } }); // WJU moves to LS on flight 1
    expect(seats()).toEqual(["KCH/WJU", "KCH/WJU"]);           // flight 2 follows the pair
    fireEvent.click(within(screen.getAllByRole("radiogroup")[0]).getByText("3"));
    expect(seats()[2]).toBe("KCH/WJU");                        // a new row copies the row above
    fireEvent.change(seat(2, 0), { target: { value: "NSO" } }); // flight 3 edited on its own
    fireEvent.change(seat(0, 0), { target: { value: "KSU" } });
    expect(seats()).toEqual(["KSU/WJU", "KSU/WJU", "NSO/WJU"]);
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

  it("takes hours per flight and saves the day's totals (Σ) on the entry", async () => {
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    const set = (n, label, v) => fireEvent.change(screen.getByLabelText(`Flight ${n} ${label}`), { target: { value: v } });
    set(1, "Day", "1:50"); set(1, "IMC", "0:10"); set(1, "Onshore", "0:20"); set(1, "Offshore", "1:30"); set(1, "T/O Day", "2"); set(1, "Ldg Day", "2"); set(1, "I.App", "1");
    set(2, "Day", "1:42"); set(2, "Onshore", "0:12"); set(2, "Offshore", "1:30"); set(2, "T/O Day", "2"); set(2, "Ldg Day", "2");
    fireEvent.change(screen.getByLabelText("Flight 2 role"), { target: { value: "SIC" } });
    expect(screen.getByLabelText("Flight 1 flight time").value).toBe("1:50");
    expect(screen.getByLabelText("Flight 1 IFR").value).toBe("1:50");          // IFR follows the flight time
    const total = container.querySelector(".duty-leg-total").textContent;
    expect(total).toContain("3:32");                                          // Total Flight Time
    expect(total).toContain("0:32");                                          // Onshore
    expect(screen.getByLabelText("Role PIC totals").textContent).toMatch(/Day\s*1:50.*Night\s*0:00.*Total\s*1:50/);
    expect(screen.getByLabelText("Role SIC totals").textContent).toMatch(/Day\s*1:42.*Total\s*1:42/);
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(db.addDutyEntry).toHaveBeenCalled());
    const saved = db.addDutyEntry.mock.calls[0][0];
    expect(saved.totalFlightTime).toBe("3:32");
    expect(saved.roles).toEqual([{ role: "PIC", dayHours: "1:50", nightHours: "0:00" }, { role: "SIC", dayHours: "1:42", nightHours: "0:00" }]);
    expect([saved.ifrRulesHours, saved.ifrHours, saved.onshoreHours, saved.offshoreHours]).toEqual(["3:32", "0:10", "0:32", "3:00"]);
    expect([saved.toDay, saved.landDay, saved.iApp]).toEqual(["4", "4", "1"]);
    expect(saved.legs[1].dayHours).toBe("1:42");
    expect(saved.crew).toEqual([{ rs: "WJU", ls: "" }, { rs: "WJU", ls: "" }]);
  });

  it("reads Actual FDT 0:00 on an empty form even with another entry saved that day", async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    db.listDutyEntriesByPilot.mockResolvedValueOnce([{ id: "e1", pilotCode: "WJU", dutyType: "flight", date: today, schDep: "05:30", stop: "09:32", totalFlightTime: "3:32" }]);
    const { container } = await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    expect(container.querySelector(".duty-lt.fdt b").textContent).toBe("0:00");
  });

  it("blocks saving when Onshore + Offshore is more than a flight's time", async () => {
    await openForm();
    fireEvent.click(within(picker()).getByText("1"));
    fireEvent.change(screen.getByLabelText("Flight 1 Day"), { target: { value: "1:00" } });
    fireEvent.change(screen.getByLabelText("Flight 1 Onshore"), { target: { value: "0:30" } });
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(db.addDutyEntry).not.toHaveBeenCalled();
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

  it("automatic sign-out keeps a half-typed entry as a draft and restores it - without saving it", async () => {
    const first = await openForm();
    fireEvent.click(within(picker()).getByText("2"));
    fireEvent.change(screen.getByLabelText("Flight 1 route"), { target: { value: "VTSH-CPOC-VTSH" } });
    await runBeforeLogout("idle");
    first.unmount();
    expect(db.addDutyEntry).not.toHaveBeenCalled();
    await openForm();
    await waitFor(() => expect(screen.getByText(/Restored the entry you were typing/)).toBeTruthy());
    expect(screen.getByLabelText("Flight 1 route").value).toBe("VTSH-CPOC-VTSH");
    expect(screen.getByLabelText("Flight 2 route").value).toBe("VTSH-CPOC-VTSH");
    expect(db.addDutyEntry).not.toHaveBeenCalled();
  });

  it("an untouched form leaves no draft", async () => {
    const first = await openForm();
    await runBeforeLogout("idle");
    first.unmount();
    await openForm();
    expect(screen.queryByText(/Restored the entry/)).toBeNull();
  });
});
