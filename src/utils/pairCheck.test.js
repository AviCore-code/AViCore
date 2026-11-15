import { describe, it, expect } from "vitest";
import { buildPairCheck } from "./pairCheck.js";

const fl = (date, ft, crew) => ({ dutyType: "flight", date, totalFlightTime: ft, crew });
const row = (code, entries) => ({ pilot: { code, name: code }, entries });
const D = "2026-11-12";

describe("Pair Check", () => {
  it("same pair all day with the same FT is OK; different FT is flagged", () => {
    const ok = buildPairCheck([
      row("KPO", [fl(D, "5:15", [{ rs: "KCH", ls: "KPO" }, { rs: "KCH", ls: "KPO" }])]),
      row("KCH", [fl(D, "5:15", [{ rs: "KCH", ls: "KPO" }, { rs: "KCH", ls: "KPO" }])])
    ], D, D);
    expect(ok.items).toHaveLength(1);
    expect(ok.items[0]).toMatchObject({ kind: "pair", status: "ok" });

    const bad = buildPairCheck([
      row("KPO", [fl(D, "5:15", [{ rs: "KCH", ls: "KPO" }])]),
      row("KCH", [fl(D, "5:05", [{ rs: "KCH", ls: "KPO" }])])
    ], D, D);
    expect(bad.items[0]).toMatchObject({ status: "exc", diff: 10 });
  });

  it("a swap shows hours with each partner: exact from a one-partner pilot, the rest derived", () => {
    const r = buildPairCheck([
      row("KPO", [fl(D, "5:00", [{ rs: "KCH", ls: "KPO" }, { rs: "KCH", ls: "KPO" }, { rs: "WTH", ls: "KPO" }])]),
      row("KCH", [fl(D, "3:10", [{ rs: "KCH", ls: "KPO" }, { rs: "KCH", ls: "KPO" }])]),
      row("WTH", [fl(D, "1:50", [{ rs: "WTH", ls: "KPO" }, { rs: "WTH", ls: "PIN" }])]),
      row("PIN", [fl(D, "0:40", [{ rs: "WTH", ls: "PIN" }])])
    ], D, D);
    const kpo = r.items.find((i) => i.kind === "swap" && i.pilots[0] === "KPO");
    expect(kpo.split).toEqual([
      { partner: "KCH", minutes: 190, source: "exact", flights: 2 },
      { partner: "WTH", minutes: 110, source: "derived", flights: 1 }
    ]);
    const wth = r.items.find((i) => i.kind === "swap" && i.pilots[0] === "WTH");
    expect(wth.split.find((s) => s.partner === "PIN")).toMatchObject({ minutes: 40, source: "exact" });
  });

  it("flags a partner with no flight that day, and counts days without crew names", () => {
    const r = buildPairCheck([
      row("KPO", [fl(D, "2:00", [{ rs: "KCH", ls: "KPO" }]), fl("2026-11-13", "2:00", [])]),
      row("KCH", [])
    ], D, "2026-11-13");
    expect(r.items[0]).toMatchObject({ status: "exc" });
    expect(r.items[0].text).toMatch(/no flight recorded/);
    expect(r.noCrewDays).toBe(1);
  });
});
