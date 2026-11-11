import { describe, expect, it, vi } from "vitest";
import { applyUpdate, watchForUpdates } from "./swUpdate.js";

function fakeTarget() {
  const listeners = {};
  return {
    listeners,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    fire: (type) => (listeners[type] || []).forEach((fn) => fn()),
  };
}

function setup({ controller = {}, waiting = null } = {}) {
  const reg = { ...fakeTarget(), waiting, installing: null, update: vi.fn(async () => {}) };
  const sw = { ...fakeTarget(), controller, register: vi.fn(async () => reg) };
  const doc = { ...fakeTarget(), visibilityState: "visible" };
  return { reg, sw, doc };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("watchForUpdates", () => {
  it("reports a version that is already waiting", async () => {
    const waiting = { state: "installed" };
    const { sw, doc } = setup({ waiting });
    const onReady = vi.fn();
    const stop = watchForUpdates(onReady, { sw, doc });
    await flush();
    expect(onReady).toHaveBeenCalledWith(waiting);
    stop();
  });

  it("reports a version that finishes installing later", async () => {
    const { reg, sw, doc } = setup();
    const onReady = vi.fn();
    const stop = watchForUpdates(onReady, { sw, doc });
    await flush();
    const worker = { ...fakeTarget(), state: "installing" };
    reg.installing = worker;
    reg.fire("updatefound");
    worker.state = "installed";
    worker.fire("statechange");
    expect(onReady).toHaveBeenCalledWith(worker);
    stop();
  });

  it("stays quiet on a first install (nothing older on screen)", async () => {
    const { sw, doc } = setup({ controller: null, waiting: { state: "installed" } });
    const onReady = vi.fn();
    const stop = watchForUpdates(onReady, { sw, doc });
    await flush();
    expect(onReady).not.toHaveBeenCalled();
    stop();
  });

  it("checks the server again when the app comes back to the foreground", async () => {
    const { reg, sw, doc } = setup();
    const stop = watchForUpdates(() => {}, { sw, doc });
    await flush();
    doc.fire("visibilitychange");
    expect(reg.update).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("applyUpdate", () => {
  it("asks the waiting worker to activate and reloads once it takes over", () => {
    vi.useFakeTimers();
    const { sw } = setup();
    const worker = { postMessage: vi.fn() };
    const reload = vi.fn();
    applyUpdate(worker, { sw, reload });
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    sw.fire("controllerchange");
    vi.runAllTimers();
    expect(reload).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
