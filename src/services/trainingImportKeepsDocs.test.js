import { describe, expect, it, vi } from "vitest";

// A Training Excel import (manual or the VPS Auto Import) must keep the
// attachments and monitoring ticks already saved on each pilot's record.
const { calls, fromMock } = vi.hoisted(() => {
  const calls = [];
  const saved = [{ code_key: "WJU", uuid: "u-wju", docs: { passport: "data:application/pdf;base64,AAA", medical: "data:image/png;base64,BBB" }, monitor: { lpc: true } }];
  function query(table) {
    const q = { table, ops: [] };
    const chain = (n) => (...a) => { q.ops.push([n, ...a]); return q; };
    for (const n of ["select", "is", "eq", "in", "order", "range"]) q[n] = chain(n);
    q.upsert = (rows, opts) => { calls.push({ table, rows, opts }); return Promise.resolve({ error: null }); };
    q.maybeSingle = () => Promise.resolve({ data: { id: "co-1" }, error: null });
    q.then = (resolve) => {
      if (table === "companies") return resolve({ data: { id: "co-1" }, error: null });
      return resolve({ data: saved, error: null });
    };
    return q;
  }
  return { calls, fromMock: vi.fn((t) => query(t)) };
});

vi.mock("./offlineWrap.js", () => ({ cacheableRead: (_k, fn) => fn, queueableWrite: (_k, fn) => fn }));
vi.mock("./offlineQueue.js", () => ({ registerCurrentReader: vi.fn() }));
vi.mock("./downloadPdf.js", () => ({ downloadElementAsPdf: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: vi.fn(), getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
    from: fromMock, rpc: vi.fn(),
  }),
}));

async function load() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubEnv("VITE_COMPANY_SLUG", "uoa");
  return import("./webDatabase.js");
}

describe("training import keeps attachments", () => {
  it("carries docs and monitor over from the saved record", async () => {
    const db = await load();
    await db.importTrainingMany([{ code: "WJU", name: "Weera", record: { passport: { due: "2036-07-01" } } }, { code: "KSU", name: "K", record: {} }]);
    const up = calls.find((c) => c.table === "Admin_pilot_training");
    const wju = up.rows.find((r) => r.code_key === "WJU");
    expect(wju.record_json.passport).toEqual({ due: "2036-07-01" });
    expect(wju.record_json.docs).toEqual({ passport: "data:application/pdf;base64,AAA", medical: "data:image/png;base64,BBB" });
    expect(wju.record_json.monitor).toEqual({ lpc: true });
    expect(up.rows.find((r) => r.code_key === "KSU").record_json.docs).toBeUndefined();
  });

  it("withKeptTrainingFields: a new attachment in the import wins for that item only", async () => {
    const { withKeptTrainingFields } = await load();
    const out = withKeptTrainingFields({ docs: { medical: "new" } }, { docs: { passport: "p", medical: "old" } });
    expect(out.docs).toEqual({ passport: "p", medical: "new" });
  });
});
