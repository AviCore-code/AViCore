import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every Supabase call so the FDT replace order can be checked.
const { calls, state, fromMock } = vi.hoisted(() => {
  const calls = [];
  const state = { updateBatches: [], leftCount: 0 };
  function query(table) {
    const q = { table, ops: [], kind: "select" };
    const chain = (name) => (...args) => { q.ops.push([name, ...args]); return q; };
    for (const n of ["eq", "is", "gte", "lte", "order", "in", "range", "not"]) q[n] = chain(n);
    q.select = (cols, opts) => { q.ops.push(["select", cols]); if (opts?.head) q.kind = "count"; return q; };
    q.update = (v) => { q.kind = "update"; q.value = v; return q; };
    q.insert = (rows) => { calls.push({ table, kind: "insert", rows }); return Promise.resolve({ error: null }); };
    q.maybeSingle = () => Promise.resolve({ data: { id: "co-1" }, error: null });
    q.then = (resolve) => {
      calls.push(q);
      if (q.kind === "update") return resolve({ data: state.updateBatches.shift() || [], error: null });
      if (q.kind === "count") return resolve({ count: state.leftCount, error: null });
      if (table === "companies") return resolve({ data: { id: "co-1" }, error: null });
      return resolve({ data: [], error: null });
    };
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

const entries = [
  { date: "2024-01-03", dutyType: "flight", sourceFile: "KPO_FDT.xlsx" },
  { date: "2026-11-13", dutyType: "non_flight", sourceFile: "KPO_FDT.xlsx" },
  { date: "2026-11-10", dutyType: "flight", sourceFile: "KPO_FDT.xlsx" },
];

beforeEach(() => { calls.length = 0; state.updateBatches = []; state.leftCount = 0; });

describe("replacePilotDutyFromFile (FDT Import)", () => {
  it("removes every entry of that pilot in the file's date range, then writes the file", async () => {
    state.updateBatches = [[{ uuid: "a" }, { uuid: "b" }, { uuid: "typed-by-hand" }], []];
    const { replacePilotDutyFromFile } = await load();
    const res = await replacePilotDutyFromFile("kpo", entries);

    const clear = calls.find((c) => c.kind === "update" && c.ops.some((o) => o[0] === "gte"));
    expect(clear.ops).toContainEqual(["eq", "pilot_code", "KPO"]);
    expect(clear.ops).toContainEqual(["gte", "date", "2024-01-03"]);
    expect(clear.ops).toContainEqual(["lte", "date", "2026-11-13"]);
    expect(clear.ops.some((o) => o[0] === "eq" && o[1] === "entry_json->>sourceFile")).toBe(false); // any source
    const insert = calls.find((c) => c.kind === "insert");
    expect(insert.rows).toHaveLength(3);
    expect(calls.indexOf(insert)).toBeGreaterThan(calls.indexOf(clear));
    expect(res).toMatchObject({ ok: true, count: 3, removed: 3, from: "2024-01-03", to: "2026-11-13" });
  });

  it("writes nothing if the database refused to remove the old entries", async () => {
    state.leftCount = 12;
    const { replacePilotDutyFromFile } = await load();
    await expect(replacePilotDutyFromFile("KPO", entries)).rejects.toThrow(/12 old Daily Duty entries for KPO .* could not be removed/);
    expect(calls.some((c) => c.kind === "insert")).toBe(false);
  });
});
