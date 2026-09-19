import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

function setup(role = "admin", valid = true, {
  groupSummaryStatus = 200,
  groupRows = [],
  privateRows = [],
  failedRecipientIds = [],
} = {}) {
  let handler;
  const send = vi.fn().mockImplementation(async ({ groupId }) => {
    if (failedRecipientIds.includes(groupId)) throw new Error("LINE send failed");
  });
  const makeQuery = table => {
    let privateQuery = false;
    const q = {
      select: () => q,
      eq: () => q,
      not: () => q,
      is: () => { privateQuery = true; return q; },
      in: () => q,
      order: () => q,
      limit: () => q,
      single: async () => ({ data: { id: "company" } }),
      maybeSingle: async () => ({ data: role ? { role } : null }),
      then: resolve => {
        if (table === "admin_line_user_events") {
          resolve({ data: privateQuery ? privateRows : groupRows, error: null });
        } else resolve({ data: [], error: null });
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
    fetch: vi.fn().mockResolvedValue(new Response("{}", { status: groupSummaryStatus })),
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
it("returns failure with zero delivery counts when every destination fails", async () => {
  const { handler, send } = setup("admin", true, { groupSummaryStatus: 404 });

  const res = await handler(new Request("https://example.com", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  }));

  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({
    ok: false,
    groupRecipients: 0,
    privateRecipients: 0,
    error: expect.any(String),
  });
  expect(send).not.toHaveBeenCalled();
});

it("returns failure when every checked group and private push fails", async () => {
  const configuredGroup = "C" + "1".repeat(32);
  const privateId = "U-private";
  const { handler, send } = setup("admin", true, {
    privateRows: [{ line_user_id: privateId }],
    failedRecipientIds: [configuredGroup, privateId],
  });

  const res = await handler(new Request("https://example.com", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  }));

  expect(res.status).toBe(502);
  expect(await res.json()).toMatchObject({
    ok: false,
    groupRecipients: 0,
    privateRecipients: 0,
    error: expect.any(String),
  });
  expect(send).toHaveBeenCalledTimes(2);
});

it("reports a private-only success without claiming a group delivery in the message", async () => {
  const { handler, send } = setup("admin", true, {
    groupSummaryStatus: 404,
    privateRows: [{ line_user_id: "U-private" }],
  });

  const res = await handler(new Request("https://example.com", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  }));

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    groupRecipients: 0,
    privateRecipients: 1,
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0].messages[0].text).not.toContain("LINE Group และ LINE ส่วนตัว");
});

it("counts only successful group and private deliveries", async () => {
  const discoveredGroup = "C" + "2".repeat(32);
  const failedPrivate = "U-failed";
  const successfulPrivate = "U-successful";
  const { handler } = setup("admin", true, {
    groupRows: [{ line_group_id: discoveredGroup }],
    privateRows: [{ line_user_id: failedPrivate }, { line_user_id: successfulPrivate }],
    failedRecipientIds: [discoveredGroup, failedPrivate],
  });

  const res = await handler(new Request("https://example.com", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  }));

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    ok: true,
    groupRecipients: 1,
    privateRecipients: 1,
  });
});

it("sends a generic test only to the server-configured group for an admin", async () => {
  const { handler, send } = setup();
  const res = await handler(new Request("https://example.com", { method: "POST", headers: { Authorization: "Bearer test" }, body: JSON.stringify({ groupId: "attacker" }) }));
  expect(res.status).toBe(200);
  expect(send.mock.calls[0][0].groupId).toBe("C" + "1".repeat(32));
  expect(send.mock.calls[0][0].messages[0].text).toContain("ทดสอบ");
});
