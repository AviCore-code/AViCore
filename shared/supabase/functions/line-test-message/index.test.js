import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

function setup(role = "admin", valid = true) {
  let handler;
  const send = vi.fn().mockResolvedValue(undefined);
  const makeQuery = table => {
    const q = {
      select: () => q,
      eq: () => q,
      not: () => q,
      is: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      single: async () => ({ data: { id: "company" } }),
      maybeSingle: async () => ({ data: role ? { role } : null }),
      then: resolve => {
        if (table === "admin_line_user_events") resolve({ data: [], error: null });
        else resolve({ data: [], error: null });
      },
    };
    return q;
  };
  const db = {
    auth: { getUser: async () => valid ? { data: { user: { id: "user" } } } : { data: {}, error: {} } },
    from: makeQuery,
  };
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  runInNewContext(transformSync(source, { loader: "ts" }).code, {
    createClient: () => db,
    pushBatch: send,
    deliveryRetryKey: async () => "retry",
    fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    AbortSignal,
    Deno: { serve: h => { handler = h; }, env: { get: key => key === "LINE_PILOT_GROUP_ID" ? "C" + "1".repeat(32) : "test" } },
    Request, Response, Date, console,
  });
  return { handler, send };
}
it("blocks missing/invalid sessions and non-admin members before sending", async () => {
  for (const [role, valid, token, expected] of [["admin", true, false, 401], ["admin", false, true, 401], ["viewer", true, true, 403], [null, true, true, 403]]) {
    const { handler, send } = setup(role, valid);
    const res = await handler(new Request("https://example.com", { method: "POST", headers: token ? { Authorization: "Bearer test" } : {} }));
    expect(res.status).toBe(expected); expect(send).not.toHaveBeenCalled();
  }
});
it("sends a generic test only to the server-configured group for an admin", async () => {
  const { handler, send } = setup();
  const res = await handler(new Request("https://example.com", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ groupId: "attacker" }) }));
  expect(res.status).toBe(200);
  expect(send.mock.calls[0][0].groupId).toBe("C" + "1".repeat(32));
  expect(send.mock.calls[0][0].messages[0].text).toContain("ทดสอบ");
});
