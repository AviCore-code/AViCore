import { beforeAll, describe, expect, it, vi } from "vitest";

// The real offline layer (offlineWrap / offlineQueue / offlineStore); only the
// network is replaced, and it is never reached because the device is offline.
vi.mock("./downloadPdf.js", () => ({ downloadElementAsPdf: vi.fn(), resolvePdfExportTarget: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => new Proxy({}, { get: () => { throw new Error("Failed to fetch"); } }) }));

let db;
beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  db = await import("./webDatabase.js");
});

const day = (over = {}) => ({
  pilotCode: "WJU", dutyType: "flight", date: "2026-11-01", schDep: "07:30", stop: "15:10", totalFlightTime: "4:35",
  legs: [{ flightType: "Revenue Flight", route: "VTSH-CPOC-VTSH" }, { flightType: "Training", route: "VTSH-VTSH" }],
  ...over
});

describe("Daily Duty offline, end to end through the data layer", () => {
  it("saving offline queues it and the pilot's list shows it at once, marked pending", async () => {
    const res = await db.addDutyEntry(day());
    expect(res.queued).toBe(true);
    const list = await db.listDutyEntriesByPilot("WJU");
    expect(list).toHaveLength(1);
    expect(list[0].pending).toBe(true);
    expect(list[0].legs).toHaveLength(2);
  });

  it("editing the pending entry offline changes it in place (no second entry, no stray update)", async () => {
    const [entry] = await db.listDutyEntriesByPilot("WJU");
    await db.updateDutyEntry("WJU", entry.id, { ...entry, totalFlightTime: "5:00" });
    const list = await db.listDutyEntriesByPilot("WJU");
    expect(list).toHaveLength(1);
    expect(list[0].totalFlightTime).toBe("5:00");
    const { pendingWrites } = await import("./offlineQueue.js");
    const ops = (await pendingWrites()).filter((o) => o.args?.[0]?.pilotCode === "WJU" || o.args?.[2]?.pilotCode === "WJU");
    expect(ops.map((o) => o.kind)).toEqual(["addDutyEntry"]);
    expect(ops[0].args[0].pending).toBeUndefined();
  });

  it("deleting the pending entry offline drops it", async () => {
    const [entry] = await db.listDutyEntriesByPilot("WJU");
    await db.deleteDutyEntry("WJU", entry.id);
    await expect(db.listDutyEntriesByPilot("WJU")).rejects.toThrow(/offline/i);
  });
});
