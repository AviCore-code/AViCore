/**
 * removeDutyEntriesBySourceFile must not report success while rows are still
 * live. When RLS refuses the UPDATE, PostgREST returns no error and no rows -
 * the leftovers kept counting towards FT/DT after "Remove".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, fromMock } = vi.hoisted(() => {
  const state = { updateResults: [], leftCount: 0, calls: [] };
  // Chainable query stub: every filter returns itself; awaiting it resolves to
  // the next queued UPDATE result, or to the COUNT result for a head select.
  function query(kind) {
    const q = {
      kind,
      eq: () => q, is: () => q, update: () => { q.kind = "update"; return q; },
      select: (_cols, opts) => {
        if (opts?.head) { q.kind = "count"; return q; }
        return q;
      },
      then: (resolve) => {
        state.calls.push(q.kind);
        if (q.kind === "count") return resolve({ count: state.leftCount, error: null });
        return resolve(state.updateResults.shift() || { data: [], error: null });
      }
    };
    return q;
  }
  const fromMock = vi.fn(() => query("select"));
  return { state, fromMock };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    },
    from: fromMock,
    rpc: vi.fn()
  })
}));

async function loadWebDatabase() {
  vi.resetModules();
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public-anon-key");
  return import("./webDatabase.js");
}

describe("removeDutyEntriesBySourceFile", () => {
  beforeEach(() => {
    state.updateResults = [];
    state.leftCount = 0;
    state.calls = [];
  });

  it("returns the removed count when nothing is left", async () => {
    state.updateResults = [{ data: [{ uuid: "a" }, { uuid: "b" }], error: null }, { data: [], error: null }];
    const { removeDutyEntriesBySourceFile } = await loadWebDatabase();
    await expect(removeDutyEntriesBySourceFile("wju", "WJU_FDT.xlsx")).resolves.toEqual({ ok: true, removed: 2 });
    expect(state.calls).toEqual(["update", "update", "count"]);
  });

  it("throws when rows are still live after the delete (RLS skipped them)", async () => {
    state.updateResults = [{ data: [], error: null }];
    state.leftCount = 37;
    const { removeDutyEntriesBySourceFile } = await loadWebDatabase();
    await expect(removeDutyEntriesBySourceFile("WJU", "WJU_FDT.xlsx"))
      .rejects.toThrow(/37 entries for WJU could not be deleted \(0 removed\)/);
  });
});
