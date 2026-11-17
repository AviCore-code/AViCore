// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

const store = vi.hoisted(() => ({ byPilot: {} }));
const db = vi.hoisted(() => ({
  listExperience: vi.fn(async () => [
    { code: "WJU", name: "Weera Juntaklud", position: "FO" },
    { code: "TYO", name: "T Yo", position: "Captain" },
    { code: "KSU", name: "K Su", position: "FO" }
  ]),
  addDutyEntry: vi.fn(async () => ({ ok: true })),
  listDutyEntriesByPilot: vi.fn(async (code) => store.byPilot[code] || []),
  deleteDutyEntry: vi.fn(async () => {}),
  updateDutyEntry: vi.fn(async () => ({ ok: true })),
  getSetting: vi.fn(async () => null),
  getPreferredPilotCode: vi.fn(async () => "WJU"),
  isSinglePilotDevice: vi.fn(() => false),
  isDemoSession: vi.fn(() => false),
}));
vi.mock("../../services/desktopDatabase.js", () => db);
vi.mock("../../utils/clickSound.js", () => ({ playOk() {}, playError() {}, playClick() {} }));

import DutyEntry from "./DutyEntry.jsx";

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

beforeEach(() => { cleanup(); store.byPilot = {}; Object.values(db).forEach((f) => f.mockClear?.()); window.alert = vi.fn(); window.confirm = vi.fn(() => true); Element.prototype.scrollIntoView = vi.fn(); });

async function openTwoFlights() {
  const utils = render(<DutyEntry />);
  await waitFor(() => expect(screen.getByDisplayValue(/WJU — Weera/)).toBeTruthy());
  fireEvent.click(within(screen.getByRole("radiogroup")).getByText("2"));
  const ls = (row) => utils.container.querySelectorAll(".duty-legs-row")[row].querySelectorAll(".pilot-picker input")[1];
  return { ...utils, ls };
}
const set = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

describe("Daily Duty — Pairing & Copy", () => {
  it("copies my flights to the pilot I flew with on Save: their role by rank, no T/O LDG I.App", async () => {
    const { ls } = await openTwoFlights();
    fireEvent.change(ls(0), { target: { value: "TYO" } });          // flight 2 follows
    expect(screen.getByLabelText("Flight 1 role").value).toBe("SIC");  // WJU is FO, TYO Captain
    set("Flight 1 Day", "1:50"); set("Flight 1 T/O Day", "2"); set("Flight 1 Ldg Day", "2"); set("Flight 1 I.App", "1");
    set("Flight 2 Day", "1:42");
    await waitFor(() => expect(screen.getByLabelText("Copy to TYO").checked).toBe(false)); // off until ticked
    fireEvent.click(screen.getByLabelText("Copy to TYO"));
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(db.addDutyEntry).toHaveBeenCalledTimes(2));
    const [mine, theirs] = db.addDutyEntry.mock.calls.map((c) => c[0]);
    expect(mine.pilotCode).toBe("WJU");
    expect(theirs.pilotCode).toBe("TYO");
    expect(theirs.legs.map((l) => l.role)).toEqual(["PIC", "PIC"]);
    expect(theirs.legs[0]).toMatchObject({ dayHours: "1:50", toDay: "", landDay: "", iApp: "" });
    expect(theirs.totalFlightTime).toBe("3:32");
    expect(theirs.pairCopy.from).toBe("WJU");
    await waitFor(() => expect(screen.getByText(/copied to TYO/)).toBeTruthy());
  });

  it("does not copy unless the box is ticked", async () => {
    const { ls } = await openTwoFlights();
    fireEvent.change(ls(0), { target: { value: "KSU" } });
    await waitFor(() => screen.getByLabelText("Copy to KSU"));
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(db.addDutyEntry).toHaveBeenCalledTimes(1));
  });

  it("partner already logged: no copy, Pairing Check shows differences and saves their edited entry", async () => {
    store.byPilot.TYO = [{ id: "t1", pilotCode: "TYO", dutyType: "flight", date: todayKey(), schDep: "05:30", stop: "09:32",
      legs: [{ flightType: "Revenue Flight", aircraftType: "AW139", registration: "HS-UOL", rs: "WJU", ls: "TYO", route: "VTSH-CPOC-VTSH", role: "PIC", dayHours: "1:40", toDay: "3" }] }];
    const { ls } = await openTwoFlights();
    fireEvent.change(ls(0), { target: { value: "TYO" } });
    set("Flight 1 route", "VTSH-CPOC-VTSH");
    set("Flight 1 Day", "1:50"); set("Flight 2 Day", "1:42");
    await waitFor(() => expect(screen.getByText(/Already logged/)).toBeTruthy());
    fireEvent.click(screen.getByText("Pairing Check"));
    const dlg = screen.getByRole("dialog", { name: /Pairing Check WJU and TYO/ });
    expect(dlg.querySelectorAll("td.diff").length).toBeGreaterThan(0);          // 1:40 vs 1:50 and the missing flight 2
    fireEvent.change(within(dlg).getByLabelText("TYO flight 1 Day"), { target: { value: "1:50" } });
    fireEvent.click(within(dlg).getByText("Add"));                              // flight 2 copied into TYO's entry
    fireEvent.click(within(dlg).getByText("Save TYO's entry"));
    await waitFor(() => expect(db.updateDutyEntry).toHaveBeenCalled());
    const [code, id, saved] = db.updateDutyEntry.mock.calls[0];
    expect([code, id]).toEqual(["TYO", "t1"]);
    expect(saved.legs).toHaveLength(2);
    expect(saved.legs[0]).toMatchObject({ dayHours: "1:50", toDay: "3" });       // their own T/O kept
    expect(saved.legs[1]).toMatchObject({ dayHours: "1:42", role: "PIC", toDay: "" });
    expect(saved.totalFlightTime).toBe("3:32");
    expect(saved.pairEdit.by).toBe("WJU");
    // Saving my own entry now doesn't overwrite TYO's.
    fireEvent.click(screen.getByText("Save Entry"));
    await waitFor(() => expect(db.addDutyEntry).toHaveBeenCalledTimes(1));
  });
});

describe("Daily Duty — Duty Time Calculator tab", () => {
  it("opens the calculator, works out a flight, and the forms come back", async () => {
    render(<DutyEntry />);
    await waitFor(() => expect(screen.getByDisplayValue(/WJU — Weera/)).toBeTruthy());
    fireEvent.click(screen.getByText("Duty Time Calculator"));
    expect(screen.queryByText("Save Entry")).toBeNull();
    const sec = screen.getByRole("region", { name: "FDP + Flight Time" });
    fireEvent.change(within(sec).getByPlaceholderText("HH:MM (24h)"), { target: { value: "05:00" } });
    expect(within(sec).getByText("10:00 hrs")).toBeTruthy();
    expect(within(sec).getByText("15:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flight Duty" }));
    expect(screen.getByText("Save Entry")).toBeTruthy();
  });
});
