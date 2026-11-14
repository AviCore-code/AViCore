import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every Supabase call so the order (clear old range -> write sheet ->
// retire duplicates) can be checked without a database.
const { calls, state, fromMock } = vi.hoisted(() => {
  const calls = [];
  const state = { liveInRange: [] };
  function query(table) {
    const q = { table, ops: [] };
    const chain = (name) => (...args) => { q.ops.push([name, ...args]); return q; };
    for (const n of ["select", "is", "gte", "lte", "order", "eq", "in", "range"]) q[n] = chain(n);
    q.update = (v) => { q.kind = "update"; q.value = v; return q; };
    q.upsert = (rows, opts) => { q.kind = "upsert"; q.rows = rows; q.opts = opts; calls.push(q); return Promise.resolve({ error: null }); };
    q.then = (resolve) => {
      if (q.kind === "update") { calls.push(q); return resolve({ data: null, error: null }); }
      if (table === "companies") return resolve({ data: { id: "co-1" }, error: null });
      calls.push({ ...q, kind: "select" });
      const page = q.ops.find((o) => o[0] === "range");
      const from = page ? page[1] : 0;
      return resolve({ data: from === 0 ? state.liveInRange : [], error: null });
    };
    q.maybeSingle = () => Promise.resolve({ data: { id: "co-1" }, error: null });
    return q;
  }
  return { calls, state, fromMock: vi.fn((t) => query(t)) };
});

vi.mock("./offlineWrap.js", () => ({ cacheableRead: (_k, fn) => fn, queueableWrite: (_k, fn) => fn }));
vi.mock("./offlineQueue.js", () => ({ registerCurrentReader: vi.fn() }));
vi.mock("./downloadPdf.js", () => ({ downloadElementAsPdf: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { onAuthStateChange: vi.fn(), getSession: vi.fn(async () => ({ data: { session: null }, error: null })) },
    from: fromMock,
    rpc: vi.fn(),
  }),
}));

async function load() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  vi.stubEnv("VITE_COMPANY_SLUG", "uoa");
  return import("./webDatabase.js");
}

beforeEach(() => { calls.length = 0; state.liveInRange = []; });

describe("dedupeRosterRows", () => {
  it("keeps the app's own row over an older duplicate for the same day", async () => {
    const { dedupeRosterRows } = await load();
    const out = dedupeRosterRows([
      { uuid: "KTO_2026-11-09", pilot_code: "KTO", date: "2026-11-09", code: "VL", modified_at: "2026-11-14T01:00:00Z" },
      { uuid: "legacy-abc", pilot_code: "kto ", date: "2026-11-09", code: "O", modified_at: "2026-11-14T09:00:00Z" },
    ]);
    expect(out).toEqual([expect.objectContaining({ pilot_code: "KTO", date: "2026-11-09", code: "VL" })]);
  });

  it("without the app's own row, the most recently modified wins", async () => {
    const { dedupeRosterRows } = await load();
    const out = dedupeRosterRows([
      { uuid: "a", pilot_code: "WJU", date: "2026-11-15", code: "X", modified_at: "2026-11-01" },
      { uuid: "b", pilot_code: "WJU", date: "2026-11-15", code: "VL", modified_at: "2026-11-10" },
    ]);
    expect(out.map((r) => r.code)).toEqual(["VL"]);
  });
});

describe("replaceRosterRange (Roster Import)", () => {
  it("clears every live row in the range first, then writes only the filled cells", async () => {
    state.liveInRange = [{ uuid: "KTO_2026-11-09" }, { uuid: "legacy-1" }, { uuid: "OLDPILOT_2026-11-10" }];
    const { replaceRosterRange } = await load();
    const res = await replaceRosterRange([
      { pilotCode: "KTO", date: "2026-11-09", code: "VL" },
      { pilotCode: "KTO", date: "2026-11-10", code: "", clearExisting: true },
    ], { from: "2026-11-01", to: "2026-11-30" });

    const firstUpdate = calls.findIndex((c) => c.kind === "update");
    const upsert = calls.findIndex((c) => c.kind === "upsert");
    expect(firstUpdate).toBeGreaterThanOrEqual(0);
    expect(upsert).toBeGreaterThan(firstUpdate);                       // delete old, THEN copy new
    expect(calls[firstUpdate].ops).toContainEqual(["in", "uuid", ["KTO_2026-11-09", "legacy-1", "OLDPILOT_2026-11-10"]]);
    expect(calls[upsert].rows.map((r) => [r.uuid, r.code])).toEqual([["KTO_2026-11-09", "VL"]]);
    expect(res).toMatchObject({ ok: true, count: 1, removed: 3, from: "2026-11-01", to: "2026-11-30" });
  });

  it("reads the range on a stable order so no row slips between pages", async () => {
    const { replaceRosterRange } = await load();
    await replaceRosterRange([{ pilotCode: "KTO", date: "2026-11-09", code: "VL" }], { from: "2026-11-01", to: "2026-11-30" });
    const read = calls.find((c) => c.kind === "select");
    expect(read.ops).toContainEqual(["order", "uuid", { ascending: true }]);
    expect(read.ops).toContainEqual(["gte", "date", "2026-11-01"]);
    expect(read.ops).toContainEqual(["lte", "date", "2026-11-30"]);
  });
});
