import { describe, expect, it } from "vitest";
import { applyPendingDutyWrites, isPendingDutyId, pendingOpIdOf } from "./offlineDutyOverlay.js";
import { queueWrite, pendingWrites, rewriteQueuedWrite, discardWrite } from "./offlineQueue.js";
import { scoreDaysForPilot } from "../utils/fatigueMonitor.js";

const server = [
  { id: "u1", pilotCode: "WJU", date: "2026-10-28", dutyType: "flight", route: "VTSH-BQP-VTSH", totalFlightTime: "2:06" },
  { id: "u2", pilotCode: "WJU", date: "2026-10-27", dutyType: "flight", route: "VTSH-ERLQ2-VTSH", totalFlightTime: "2:15" }
];
const multi = {
  pilotCode: "WJU", date: "2026-10-30", dutyType: "flight", totalFlightTime: "4:35",
  legs: [{ route: "VTSH-CPOC-VTSH" }, { route: "VTSH-CPOC-VTSH" }, { route: "VTSH-CPOC-VTSH" }],
  route: "VTSH-CPOC-VTSH/VTSH-CPOC-VTSH/VTSH-CPOC-VTSH"
};

describe("offline duty entries are shown and counted before they are sent", () => {
  it("adds a queued entry, flagged pending, newest first", () => {
    const out = applyPendingDutyWrites(server, [{ id: "op1", kind: "addDutyEntry", args: [multi] }], "WJU");
    expect(out.map((e) => e.date)).toEqual(["2026-10-30", "2026-10-28", "2026-10-27"]);
    expect(out[0].pending).toBe(true);
    expect(isPendingDutyId(out[0].id)).toBe(true);
    expect(pendingOpIdOf(out[0].id)).toBe("op1");
  });

  it("the queued multi-flight day counts in Fatigue straight away", () => {
    const out = applyPendingDutyWrites(server, [{ id: "op1", kind: "addDutyEntry", args: [multi] }], "WJU");
    const day = scoreDaysForPilot(out).find((d) => d.date === "2026-10-30");
    expect(day.flights).toBe(3);
  });

  it("a queued add replaces the same pilot/date/type, like the server upsert", () => {
    const again = { ...server[0], route: "VTSH-VTSH" };
    delete again.id;
    const out = applyPendingDutyWrites(server, [{ id: "op2", kind: "addDutyEntry", args: [again] }], "WJU");
    expect(out.filter((e) => e.date === "2026-10-28")).toHaveLength(1);
    expect(out.find((e) => e.date === "2026-10-28").route).toBe("VTSH-VTSH");
  });

  it("applies queued edits and deletes, and ignores other pilots' writes", () => {
    const ops = [
      { id: "a", kind: "updateDutyEntry", args: ["WJU", "u1", { ...server[0], totalFlightTime: "3:00" }] },
      { id: "b", kind: "deleteDutyEntry", args: ["WJU", "u2"] },
      { id: "c", kind: "addDutyEntry", args: [{ ...multi, pilotCode: "KCH" }] }
    ];
    const out = applyPendingDutyWrites(server, ops, "WJU");
    expect(out.map((e) => e.id)).toEqual(["u1"]);
    expect(out[0].totalFlightTime).toBe("3:00");
    expect(out[0].pending).toBe(true);
  });

  it("with nothing cached, queued entries alone still show", () => {
    expect(applyPendingDutyWrites([], [{ id: "op1", kind: "addDutyEntry", args: [multi] }], "wju")).toHaveLength(1);
  });

  it("editing a queued entry rewrites it in place; deleting drops it", async () => {
    const op = await queueWrite({ kind: "addDutyEntry", args: [multi], label: "x" });
    expect(await rewriteQueuedWrite(op.id, [{ ...multi, totalFlightTime: "5:00" }])).toBe(true);
    let mine = (await pendingWrites()).filter((o) => o.id === op.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].args[0].totalFlightTime).toBe("5:00");
    await discardWrite(op.id);
    expect((await pendingWrites()).some((o) => o.id === op.id)).toBe(false);
    expect(await rewriteQueuedWrite(op.id, [multi])).toBe(false);
  });
});
