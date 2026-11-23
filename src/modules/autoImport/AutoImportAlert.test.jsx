// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../services/desktopDatabase.js", async (importOriginal) => ({ ...(await importOriginal()), getSetting: vi.fn(async () => null) }));

import AutoImportAlert from "./AutoImportAlert.jsx";
import { autoImportHealth, thaiDuration } from "./autoImportHealth.js";
import { CONFIG_KEY, STATUS_KEY } from "../../services/autoImportCore.js";

afterEach(() => { cleanup(); try { sessionStorage.clear(); } catch { /* jsdom */ } });

const NOW = Date.parse("2026-11-23T07:38:00Z");                // 14:38 Bangkok
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const on = { enabled: true };

describe("Auto Import health (Capt. Weera, 23 Nov 2026)", () => {
  it("all well: VPS and PC reporting", () => {
    expect(autoImportHealth({ heartbeat: minsAgo(3), pcLastSync: minsAgo(4) }, on, NOW)).toBeNull();
  });

  it("office PC silent for more than an hour -> warn, with its name", () => {
    const h = autoImportHealth({ heartbeat: minsAgo(2), pcLastSync: "2026-11-22T09:32:36Z", pcHost: "NB-UO-RADIO" }, on, NOW);
    expect(h).toMatchObject({ kind: "pc", level: "warn", host: "NB-UO-RADIO" });
    expect(thaiDuration(h.minutes)).toBe("22 ชม. 5 นาที");
    expect(autoImportHealth({ heartbeat: minsAgo(2), pcLastSync: minsAgo(59) }, on, NOW)).toBeNull();
  });

  it("VPS silent for more than 15 minutes -> exc, before the PC check", () => {
    expect(autoImportHealth({ heartbeat: minsAgo(16), pcLastSync: minsAgo(400) }, on, NOW)).toMatchObject({ kind: "vps", level: "exc" });
  });

  it("no alert when Auto Import is switched off or there is no status yet", () => {
    expect(autoImportHealth({ heartbeat: minsAgo(999) }, { enabled: false }, NOW)).toBeNull();
    expect(autoImportHealth(null, on, NOW)).toBeNull();
  });

  it("durations in Thai", () => {
    expect(thaiDuration(45)).toBe("45 นาที");
    expect(thaiDuration(1500)).toBe("1 วัน 1 ชม.");
  });
});

describe("AutoImportAlert bar", () => {
  const load = (status) => vi.fn(async (k) => (k === STATUS_KEY ? status : k === CONFIG_KEY ? on : null));

  it("shows the PC warning in Thai, opens Auto Import, and closes until things change", async () => {
    const open = vi.fn();
    render(<AutoImportAlert onOpen={open} now={() => NOW}
      loadSetting={load({ heartbeat: minsAgo(2), pcLastSync: "2026-11-22T09:32:36Z", pcHost: "NB-UO-RADIO" })} />);
    const bar = await screen.findByRole("alert");
    expect(bar.textContent).toMatch(/เครื่อง PC office \(NB-UO-RADIO\) ไม่ได้ส่งไฟล์ Excel มา 22 ชม\. 5 นาที/);
    fireEvent.click(screen.getByText("เปิดหน้า Auto Import"));
    expect(open).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("ปิดข้อความนี้"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows nothing when all is well", async () => {
    const l = load({ heartbeat: minsAgo(1), pcLastSync: minsAgo(2) });
    render(<AutoImportAlert onOpen={() => {}} now={() => NOW} loadSetting={l} />);
    await waitFor(() => expect(l).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
