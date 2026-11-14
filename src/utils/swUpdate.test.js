import { describe, expect, it, vi } from "vitest";
import { applyUpdate, watchForUpdates, isNewerVersion, watchServerVersion, forceUpdate, reloadOnStaleChunk } from "./swUpdate.js";

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

describe("server version.json", () => {
  it("compares versions numerically", () => {
    expect(isNewerVersion("1.0.326", "1.0.325")).toBe(true);
    expect(isNewerVersion("1.0.1000", "1.0.999")).toBe(true);
    expect(isNewerVersion("1.0.325", "1.0.325")).toBe(false);
    expect(isNewerVersion("1.0.324", "1.0.325")).toBe(false);
    expect(isNewerVersion("", "1.0.325")).toBe(false);
    expect(isNewerVersion("abc", "1.0.325")).toBe(false);
  });

  it("reports a newer deployed version, uncached", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ version: "1.0.326" }) }));
    const onNewer = vi.fn();
    const stop = watchServerVersion("1.0.325", onNewer, { fetchImpl, doc: fakeTarget() });
    await flush(); await flush();
    expect(onNewer).toHaveBeenCalledWith("1.0.326");
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^\.\/version\.json\?t=\d+$/);
    expect(fetchImpl.mock.calls[0][1]).toEqual({ cache: "no-store" });
    stop();
  });

  it("stays quiet when up to date or offline", async () => {
    const onNewer = vi.fn();
    const same = vi.fn(async () => ({ ok: true, json: async () => ({ version: "1.0.325" }) }));
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const s1 = watchServerVersion("1.0.325", onNewer, { fetchImpl: same, doc: fakeTarget() });
    const s2 = watchServerVersion("1.0.325", onNewer, { fetchImpl: offline, doc: fakeTarget() });
    await flush(); await flush();
    expect(onNewer).not.toHaveBeenCalled();
    s1(); s2();
  });

  it("forceUpdate switches to a worker found on update, else drops the old one and reloads", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const waiting = { postMessage: vi.fn() };
    const regA = { update: vi.fn(async () => { regA.waiting = waiting; }), waiting: null, unregister: vi.fn() };
    const swA = { ...fakeTarget(), getRegistration: async () => regA };
    await forceUpdate({ sw: swA, reload });
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(regA.unregister).not.toHaveBeenCalled();

    const regB = { update: vi.fn(async () => {}), waiting: null, unregister: vi.fn(async () => true) };
    const swB = { ...fakeTarget(), getRegistration: async () => regB };
    await forceUpdate({ sw: swB, reload });
    expect(regB.unregister).toHaveBeenCalled();
    vi.runAllTimers();
    expect(reload).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("self-activating worker and stale files", () => {
  it("reloads at once when the new worker is already active", () => {
    const { sw } = setup();
    const reload = vi.fn();
    applyUpdate({ state: "activated", postMessage: vi.fn() }, { sw, reload });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads once on a missing lazily-loaded file, never in a loop", () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const win = fakeTarget();
    const reload = vi.fn();
    const stop = reloadOnStaleChunk({ win, storage, reload });
    const evt = { preventDefault: vi.fn() };
    win.listeners["vite:preloadError"][0](evt);
    win.listeners["vite:preloadError"][0](evt);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(evt.preventDefault).toHaveBeenCalled();
    stop();
  });
});
