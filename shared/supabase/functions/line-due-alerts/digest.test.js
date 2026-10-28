import { describe, expect, it, vi } from "vitest";
import {
  bangkokDay,
  birthdayPilots,
  digestMessages,
  pushBatch,
  deliveryRetryKey,
  ensureSecondaryDelivery,
  ensureDeliverySnapshot
} from "./digest.js";

describe("LINE due date delivery", () => {
  it("uses Bangkok's calendar date across UTC midnight", () => {
    expect(bangkokDay(new Date("2026-09-06T18:00:00Z"))).toBe("2026-09-07");
  });
  it("does not send an empty digest", () => expect(digestMessages([], "2026-09-06")).toEqual([]));
  it("selects pilots whose HBD day and month match the Bangkok day", () => {
    const rows = [
      { code: "WJU", name: "Weera Juntaklud", record_json: { profile: { hbd: "18-Oct-73" } } },
      { code: "KCH", name: "Kitsaphon Chom-In", record_json: { profile: { hbd: "18-Oct-1980" } } },
      { code: "PCH", name: "Prapan Chan-Udom", record_json: { profile: { hbd: "19-Oct-70" } } },
      { code: "BAD", name: "Invalid Date", record_json: { profile: { hbd: "31-Feb-80" } } },
    ];

    expect(birthdayPilots(rows, "2026-10-18")).toEqual([
      { code: "KCH", name: "Kitsaphon Chom-In" },
      { code: "WJU", name: "Weera Juntaklud" },
    ]);
  });
  it("accepts Feb 29 birthdays independently of the stored birth year", () => {
    const rows = [
      { code: "LEAP", name: "Leap Pilot", record_json: { profile: { hbd: "29-Feb-00" } } },
    ];

    expect(birthdayPilots(rows, "2028-02-29")).toEqual([
      { code: "LEAP", name: "Leap Pilot" },
    ]);
  });
  it("sends a birthday greeting even when there are no due-date warnings", () => {
    const batches = digestMessages([], "2026-10-18", {
      birthdays: [{ code: "WJU", name: "Weera Juntaklud" }]
    });
    const text = batches.flat().map((message) => message.text).join("\n");

    expect(text).toContain("สุขสันต์วันเกิด");
    expect(text).toContain("WJU — Weera Juntaklud");
    expect(text).toContain("ปลอดภัยในทุกเที่ยวบิน");
  });
  it("splits a birthday-only greeting into Unicode-safe LINE batches", () => {
    const birthdays = Array.from({ length: 100 }, (_, index) => ({
      code: `CP${String(index).padStart(3, "0")}`,
      name: `นักบิน😀${index}`.repeat(40),
    }));
    const batches = digestMessages([], "2026-10-18", { birthdays });

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(5);
      for (const message of batch) {
        expect(message.text.length).toBeLessThanOrEqual(4500);
        expect(message.text.isWellFormed()).toBe(true);
      }
    }
    const text = batches.flat().map((message) => message.text).join("");
    expect(text).toContain("CP000 — นักบิน😀0");
    expect(text).toContain("CP099 — นักบิน😀99");
    expect(text).toContain("ปลอดภัยในทุกเที่ยวบิน");
  });
  it("splits combined birthday and warning output within LINE limits", () => {
    const birthdays = Array.from({ length: 40 }, (_, index) => ({
      code: `CP${String(index).padStart(3, "0")}`,
      name: `Birthday😀${index}`.repeat(35),
    }));
    const warning = "ก😀".repeat(8000);
    const batches = digestMessages([
      { category: "training", status: "warn", text: warning },
    ], "2026-10-18", { birthdays });

    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(5);
      for (const message of batch) {
        expect(message.text.length).toBeLessThanOrEqual(4500);
        expect(message.text.isWellFormed()).toBe(true);
      }
    }
    const messages = batches.flat();
    const text = messages.map((message) => message.text).join("\n");
    const warningText = messages
      .filter((message) => message.text.startsWith("AviCore"))
      .map((message) => message.text.split("รายการ\n")[1])
      .join("");
    expect(text).toContain("สุขสันต์วันเกิด");
    expect(text).toContain("CP039 — Birthday😀39");
    expect(warningText).toContain(warning);
  });
  it("labels training and FTL warnings in the same LINE digest", () => {
    const messages = digestMessages([
      { category: "training", status: "warn", text: "CP1 — CRM due in 30 days" },
      { category: "ftl", status: "exc", text: "CP2 — Flight Time 7D at 35:00 / 34:00" }
    ], "2026-09-06").flat();
    const text = messages.map((message) => message.text).join("\n");
    expect(text).toContain("Training Due Date & FTL Limits");
    expect(text).toContain("[TRAINING][แจ้งเตือน] CP1 — CRM due in 30 days");
    expect(text).toContain("[FTL][เกินเกณฑ์] CP2 — Flight Time 7D at 35:00 / 34:00");
  });
  it("uses a Training-only title for secondary recipients", () => {
    const batches = digestMessages([
      { category: "training", status: "warn", text: "CP1 — CRM due in 30 days" }
    ], "2026-09-06", { title: "AviCore — Training Due Date" });
    expect(batches[0][0].text).toContain("AviCore — Training Due Date\n");
    expect(batches[0][0].text).not.toContain("FTL Limits");
  });
  it("freezes secondary payloads and recipients across a same-day retry", () => {
    const first = ensureSecondaryDelivery(null, {
      recommendations: [{ category: "training", status: "warn", text: "first snapshot" }],
      day: "2026-09-06",
      groups: ["C111"],
      users: ["U111"]
    });
    const retried = ensureSecondaryDelivery(first, {
      recommendations: [{ category: "training", status: "warn", text: "changed live data" }],
      day: "2026-09-06",
      groups: ["C222"],
      users: ["U222"]
    });
    expect(retried).toBe(first);
    expect(JSON.stringify(retried)).toContain("first snapshot");
    expect(JSON.stringify(retried)).not.toContain("changed live data");
    expect(retried.destinations.map((item) => item.id)).toEqual(["C111", "U111"]);
  });
  it("freezes the complete primary and secondary snapshot before any delivery", async () => {
    const first = await ensureDeliverySnapshot(null, {
      companyId: "company",
      groupId: "Cprimary",
      day: "2026-09-06",
      birthdays: [{ code: "CP1", name: "Birthday First" }],
      primaryRecommendations: [{ category: "ftl", status: "warn", text: "primary first" }],
      secondaryRecommendations: [{ category: "training", status: "warn", text: "secondary first" }],
      groups: ["C111"],
      users: ["U111"]
    });
    const retried = await ensureDeliverySnapshot(first, {
      companyId: "company",
      groupId: "Cprimary",
      day: "2026-09-06",
      birthdays: [{ code: "CP2", name: "Birthday Changed" }],
      primaryRecommendations: [{ category: "ftl", status: "warn", text: "primary changed" }],
      secondaryRecommendations: [{ category: "training", status: "warn", text: "secondary changed" }],
      groups: ["C222"],
      users: ["U222"]
    });
    expect(retried).toBe(first);
    const frozen = JSON.stringify(retried);
    expect(frozen).toContain("primary first");
    expect(frozen).toContain("secondary first");
    expect(frozen).toContain("Birthday First");
    expect(frozen).not.toContain("Birthday Changed");
    expect(frozen).not.toContain("changed");
    expect(retried.secondary.destinations.map((item) => item.id)).toEqual(["C111", "U111"]);
    for (const batch of retried.batches) {
      expect(batch.retryKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(batch.sent).toBe(false);
    }
    for (const destination of retried.secondary.destinations) {
      expect(destination.batches).toHaveLength(retried.secondary.batches.length);
      for (const batch of destination.batches) {
        expect(batch.retryKey).toMatch(/^[0-9a-f-]{36}$/);
        expect(batch.sent).toBe(false);
      }
    }
  });
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
