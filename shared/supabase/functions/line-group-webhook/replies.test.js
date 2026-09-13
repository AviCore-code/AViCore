import { expect, it, vi } from "vitest";
import { handleWebhook, testReply } from "./replies.js";
const event = text => ({ type: "message", source: { type: "group", groupId: "C" + "1".repeat(32) }, replyToken: "test", message: { type: "text", text } });
it("responds only to addressed commands with Bangkok time", () => {
  expect(testReply(event("ตอนนี้กี่โมง"))).toBeNull();
  expect(testReply(event("ทดสอบ avicore ตอนนี้กี่โมงแล้ว"), new Date("2026-09-06T09:17:00Z"))).toContain("16:17");
  expect(testReply(event("ทดสอบ AviCore"))).toContain("โหมดทดสอบ");
  expect(testReply(event("@AViCore Bot ดีครับ"))).toContain("สวัสดี");
  expect(testReply(event("AviCore ขอข้อมูล Medical นักบิน"))).toBeNull();
});
async function request(events) {
  const body = JSON.stringify({ events });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))).toString("base64");
  return new Request("https://example.com", { method: "POST", headers: { "x-line-signature": signature }, body });
}
it("rejects invalid signatures without sending", async () => {
  const fetcher = vi.fn();
  expect((await handleWebhook(await request([event("ทดสอบ AviCore")]), { secret: "wrong", token: "test", fetcher })).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
it("accepts LINE verification without replying", async () => {
  expect((await handleWebhook(await request([]), { secret: "test-secret" })).status).toBe(200);
});
it("replies to signed events and reports API failures", async () => {
  for (const status of [200, 401]) {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status }));
    const result = await handleWebhook(await request([event("ทดสอบ AviCore")]), { secret: "test-secret", token: "test", fetcher, logger: { log() {}, error() {} } });
    expect(result.status).toBe(status === 200 ? 200 : 502);
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(sent.replyToken).toBe("test"); expect(sent.to).toBeUndefined();
    expect(sent.messages[0].text).toContain("โหมดทดสอบ");
  }
});
