import { describe, expect, it, vi } from "vitest";
import { bangkokDay, digestMessages, pushBatch, deliveryRetryKey } from "./digest.js";

describe("LINE due date delivery", () => {
  it("uses Bangkok's calendar date across UTC midnight", () => {
    expect(bangkokDay(new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-07");
  });
  it("does not send an empty digest", () => expect(digestMessages([], "2026-09-06")).toEqual([]));
  it("keeps all content within LINE's text and batch limits", () => {
    const content = "ก😀".repeat(20000);
    const batches = digestMessages([{ status: "warn", text: content }], "2026-09-06");
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(5);
      for (const message of batch) {
        expect(message.text.length).toBeLessThanOrEqual(5000);
        expect(message.text.isWellFormed()).toBe(true);
      }
    }
    expect(batches.flat().map(m => m.text.split("รายการ\n")[1]).join("")).toContain(content);
  });
  it("uses stable retry keys isolated by company/day/group/batch", async () => {
    const key = await deliveryRetryKey("company|group|2026-09-06|0");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await deliveryRetryKey("company|group|2026-09-06|0")).toBe(key);
    expect(await deliveryRetryKey("company|group|2026-09-07|0")).not.toBe(key);
  });
  it("recognizes accepted retries but rejects other failures", async () => {
    const args = { token: "test", groupId: "test", retryKey: "test", messages: [] };
    await expect(pushBatch({ ...args, fetcher: vi.fn().mockResolvedValue(new Response("", { status: 409,
      headers: { "x-line-accepted-request-id": "accepted" } })) })).resolves.toBeUndefined();
    for (const status of [401, 409, 429, 500]) {
      await expect(pushBatch({ ...args, fetcher: vi.fn().mockResolvedValue(new Response("", { status })) })).rejects.toThrow(`${status}`);
    }
  });
});
