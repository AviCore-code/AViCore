import { describe, expect, it } from "vitest";
import { TRAINING_ITEMS, isItemMonitoredFor, isMonitoredInSet, pilotDisabledItems, monitoredTrainingItems, computeTrainingRow, trainingIssueCounts, buildTrainingRecommendations, withTrainingThresholdDefaults } from "./trainingDue.js";
import { trainingToBook } from "../modules/pilotRoster/weeklyPlanTrainingQueue.js";

const A = TRAINING_ITEMS.find((i) => i.type !== "count").key;
const B = TRAINING_ITEMS.filter((i) => i.type !== "count")[1].key;

describe("per-pilot training monitoring", () => {
  it("no override follows the fleet setting", () => {
    expect(isItemMonitoredFor({}, A, [])).toBe(true);
    expect(isItemMonitoredFor({}, A, [A])).toBe(false);
    expect(isMonitoredInSet({}, A, new Set([B]))).toBe(false);
    expect(isMonitoredInSet({}, A, null)).toBe(true);
  });

  it("a pilot's tick wins over the fleet setting, both ways", () => {
    expect(isItemMonitoredFor({ monitor: { [A]: true } }, A, [A])).toBe(true);
    expect(isItemMonitoredFor({ monitor: { [A]: false } }, A, [])).toBe(false);
    expect(isMonitoredInSet({ monitor: { [A]: true } }, A, new Set())).toBe(true);
    expect(pilotDisabledItems([A], { monitor: { [A]: true, [B]: false } })).toEqual([B]);
    expect(monitoredTrainingItems([], { monitor: { [B]: false } }).some((i) => i.key === B)).toBe(false);
  });

  it("an expired item switched off for one pilot no longer turns that pilot red", () => {
    const thresholds = withTrainingThresholdDefaults();
    const record = { [A]: "2020-01-01" };
    expect(computeTrainingRow(record, thresholds, []).status).toBe("exc");
    const off = { ...record, monitor: { [A]: false } };
    expect(computeTrainingRow(off, thresholds, []).status).not.toBe("exc");
    expect(trainingIssueCounts(computeTrainingRow(off, thresholds, []), [], off).exc).toBe(0);
    expect(buildTrainingRecommendations({ code: "X", name: "X", record: off }, thresholds, []).length).toBe(0);
    // ...and switched on for one pilot while off fleet-wide, it does
    const on = { ...record, monitor: { [A]: true } };
    expect(computeTrainingRow(on, thresholds, [A]).status).toBe("exc");
  });

  it("roster training queue respects a pilot switched off", () => {
    const due = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
    const args = (monitor) => ({ records: [{ code: "WJU", record: { [A]: due, [B]: due, monitor } }], thresholds: withTrainingThresholdDefaults(), monitored: new Set(TRAINING_ITEMS.map((i) => i.key)), items: TRAINING_ITEMS, rosterByPilotDate: {}, todayIso: new Date().toISOString().slice(0, 10) });
    const all = trainingToBook(args(undefined)).map((q) => q.itemKey ?? q.item?.key ?? q.key);
    const off = trainingToBook(args({ [A]: false, [B]: false }));
    expect(off.length).toBeLessThanOrEqual(all.length);
    expect(off.length).toBe(0);
  });
});
