// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { idleState, IDLE_LIMIT_MS, registerBeforeLogout, runBeforeLogout, saveDraft, takeDraft } from "./idleLogout.js";

const web = vi.hoisted(() => ({
  paired: "WJU",
  getPairedPilotCode: vi.fn(async () => web.paired),
  clearPairedPilotCode: vi.fn(async () => { web.paired = ""; }),
  isConfigured: vi.fn(() => true),
  getSetting: vi.fn(async () => null),
  subscribeSyncStatus: vi.fn(() => () => {}),
  pingServer: vi.fn(),
}));
const queue = vi.hoisted(() => ({ startOfflineQueue: vi.fn(() => () => {}), flushQueue: vi.fn(async () => {}), isOnline: vi.fn(() => true), pendingWrites: vi.fn(async () => []), currentOwner: vi.fn(() => "WJU") }));
vi.mock("../services/webDatabase.js", () => web);
vi.mock("../services/offlineQueue.js", () => queue);
vi.mock("../services/desktopDatabase.js", () => ({ isDemoSession: () => false, getPairingHoursLeft: async () => null }));
vi.mock("../components/OfflineBar.jsx", () => ({ default: () => null }));
vi.mock("../utils/clickSound.js", () => ({ startClickSound: () => () => {} }));
vi.mock("./useAppearanceTheme.js", () => ({ default: () => "default" }));
vi.mock("./crewDisplay.js", () => ({ applyCrewDisplay: () => {} }));
vi.mock("./WebPilotLogin.jsx", () => ({ default: ({ notice }) => <div>LOGIN SCREEN<p>{notice}</p></div> }));
const { stub } = vi.hoisted(() => ({ stub: (name) => ({ default: () => name }) }));
vi.mock("../modules/myStatus/MyStatus.jsx", () => stub("MyStatus"));
vi.mock("../modules/dutyEntry/DutyEntry.jsx", () => stub("DutyEntry"));
vi.mock("../modules/myLogbook/MyLogbook.jsx", () => stub("MyLogbook"));
vi.mock("../modules/myExperience/MyExperience.jsx", () => stub("MyExperience"));
vi.mock("./MyTrainingStatus.jsx", () => stub("MyTraining"));
vi.mock("./CrewDashboard.jsx", () => stub("CrewDashboard"));
vi.mock("./MyRoster.jsx", () => stub("MyRoster"));
vi.mock("./MyWeeklySchedule.jsx", () => stub("MyWeekly"));
vi.mock("./CrewSettings.jsx", () => stub("CrewSettings"));

import WebApp from "./WebApp.jsx";

describe("idle timing", () => {
  it("warns in the last minute and expires at 10 minutes", () => {
    const t0 = 1_000_000;
    expect(idleState(t0, t0 + 8 * 60000)).toMatchObject({ warning: false, expired: false });
    expect(idleState(t0, t0 + 9.5 * 60000)).toMatchObject({ warning: true, expired: false });
    expect(idleState(t0, t0 + IDLE_LIMIT_MS)).toMatchObject({ expired: true });
  });
  it("drafts are kept per pilot and handed back once", async () => {
    const off = registerBeforeLogout(() => saveDraft("duty", "wju", { a: 1 }));
    await runBeforeLogout("idle");
    off();
    expect(takeDraft("duty", "KCH")).toBeNull();
    expect(takeDraft("duty", "WJU").data).toEqual({ a: 1 });
    expect(takeDraft("duty", "WJU")).toBeNull();
  });
});

describe("AviCore Crew signs out after 10 idle minutes", () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); web.paired = "WJU"; web.clearPairedPilotCode.mockClear(); queue.flushQueue.mockClear(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  async function signedIn() {
    render(<WebApp />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("CrewDashboard")).toBeTruthy();
  }

  it("activity keeps the session; 10 quiet minutes save, send and sign out", async () => {
    const saver = vi.fn();
    const off = registerBeforeLogout(saver);
    await signedIn();
    await act(async () => { vi.advanceTimersByTime(8 * 60000); });
    fireEvent.mouseMove(window);
    await act(async () => { vi.advanceTimersByTime(8 * 60000); });
    expect(web.clearPairedPilotCode).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1.5 * 60000); });
    expect(screen.getByText(/signing out in/)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(61000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(saver).toHaveBeenCalled();
    expect(queue.flushQueue).toHaveBeenCalled();
    expect(web.clearPairedPilotCode).toHaveBeenCalled();
    expect(screen.getByText("LOGIN SCREEN")).toBeTruthy();
    expect(screen.getByText(/Signed out automatically after 10 minutes/)).toBeTruthy();
    off();
  });

  it("'Stay signed in' resets the countdown", async () => {
    await signedIn();
    await act(async () => { vi.advanceTimersByTime(9.5 * 60000); });
    fireEvent.click(screen.getByText("Stay signed in"));
    await act(async () => { vi.advanceTimersByTime(5 * 60000); });
    expect(web.clearPairedPilotCode).not.toHaveBeenCalled();
    expect(screen.queryByText(/signing out in/)).toBeNull();
  });
});
