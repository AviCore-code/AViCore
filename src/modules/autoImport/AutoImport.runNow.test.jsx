// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

vi.mock("../../services/desktopDatabase.js", () => ({ getSetting: vi.fn(async () => null), saveSetting: vi.fn(async () => {}) }));
vi.mock("../../services/webDatabase.js", () => ({ getAdminSession: vi.fn(async () => ({ user: { email: "weera@example.test" } })) }));

import AutoImport, { findRunResult } from "./AutoImport.jsx";
import { CONFIG_KEY, STATUS_KEY, REQUEST_KEY } from "../../services/autoImportCore.js";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const row = (at, reason, o) => ({ at, reason, source: "FDT", file: "WJU_FDT.xlsx", ok: true, text: "WJU: 900 entries written", ...o });

describe("Auto Import - Run now result", () => {
  it("finds the Run now batch logged after the request", () => {
    const log = [
      row("2026-11-19T05:22:05Z", "Run now by kanchana", {}),
      row("2026-11-19T05:22:05Z", "Run now by kanchana", { source: "Roster", file: "schedule.xlsx", ok: false, text: "Sheet not found" }),
      row("2026-11-19T05:13:23Z", "file changed", {}),
      row("2026-11-19T01:51:14Z", "Run now by kanchana", {})
    ];
    expect(findRunResult(log, "2026-11-19T05:30:00Z")).toBeNull();
    const r = findRunResult(log, "2026-11-19T05:21:00Z");
    expect(r).toMatchObject({ at: "2026-11-19T05:22:05Z", ok: 1, failed: 1 });
    expect(r.rows).toHaveLength(2);
  });

  it("shows Importing… then Update completed with each file", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let status = { heartbeat: new Date().toISOString(), log: [] };
    const store = vi.fn(async () => {});
    const load = vi.fn(async (k) => (k === STATUS_KEY ? status : k === CONFIG_KEY ? null : null));
    render(<AutoImport loadSetting={load} storeSetting={store} />);
    const btn = await screen.findByText("Run now (all files)");
    await act(async () => { fireEvent.click(btn); });
    expect(store).toHaveBeenCalledWith(REQUEST_KEY, expect.objectContaining({ by: "weera@example.test", force: true }));
    expect(screen.getByText(/Importing all files/)).toBeTruthy();
    expect(screen.getByText("Importing…")).toBeTruthy();
    const at = new Date(Date.now() + 30_000).toISOString();
    status = { ...status, log: [row(at, "Run now by weera@example.test", {}), row(at, "Run now by weera@example.test", { source: "Roster", file: "schedule.xlsx", text: "120 days" })] };
    await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
    expect(screen.getByText("✓ Update completed")).toBeTruthy();
    expect(screen.getByText(/2 files · 2 OK/)).toBeTruthy();
    expect(screen.getAllByText(/120 days/).length).toBeGreaterThan(0);
    expect(screen.getByText("Run now (all files)")).toBeTruthy();
  });
});
