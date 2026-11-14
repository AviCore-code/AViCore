// "A new version is available - Update" for the Crew and Admin web apps.
//
// The PWA used registerType:'autoUpdate': a new service worker took over in
// the background, but the open page kept running the old code until someone
// happened to reload, and nobody could tell. Now the build uses
// registerType:'prompt' (vite.config.js): the new worker installs and WAITS,
// this module notices, and the page shows an Update button. Pressing it tells
// the waiting worker to activate (workbox listens for SKIP_WAITING) and
// reloads once it controls the page. Nothing is swapped while someone is
// mid-edit unless they choose to.

const CHECK_EVERY_MS = 30 * 60 * 1000;

// onReady(worker) is called when a new version has installed and is waiting.
// Returns a stop function.
export function watchForUpdates(onReady, {
  sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
  intervalMs = CHECK_EVERY_MS,
  scriptUrl = "./sw.js",
} = {}) {
  if (!sw) return () => {};
  let reg = null;
  // Only an UPDATE counts. With no controller this is the very first install,
  // and there is no older version on screen to replace.
  const notify = (worker) => { if (worker && sw.controller) onReady(worker); };

  sw.register(scriptUrl, { scope: "./" }).then((r) => {
    reg = r;
    if (r.waiting) notify(r.waiting);
    r.addEventListener("updatefound", () => {
      const worker = r.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") notify(worker);
      });
    });
  }).catch(() => { /* no service worker (dev server, private mode) - nothing to watch */ });

  // A tab can stay open for days on an office PC; ask the server now and then,
  // and whenever the app comes back to the foreground.
  const check = () => { reg?.update().catch(() => {}); };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => { if (doc?.visibilityState === "visible") check(); };
  doc?.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener("visibilitychange", onVisible);
  };
}

// --- Second signal: the server's version.json ----------------------------
//
// The service worker route above depends on the browser noticing the new
// sw.js, which some do late (an iPhone home-screen app, a tab left open for
// days). Every web build also writes version.json (vite.config.js); reading it
// says straight away whether the server holds a newer version than the one
// running here.

// "1.0.326" > "1.0.325" -> true. Missing or malformed -> false (never nag).
export function isNewerVersion(server, running) {
  const parse = (v) => String(v || "").split(".").map((n) => Number(n));
  const a = parse(server), b = parse(running);
  if (!server || !running || a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a.at(i) || 0, y = b.at(i) || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// onNewer(serverVersion) when the deployed version is newer than `running`.
export function watchServerVersion(running, onNewer, {
  fetchImpl = typeof fetch !== "undefined" ? fetch : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
  intervalMs = CHECK_EVERY_MS,
  url = "./version.json",
} = {}) {
  if (!fetchImpl || !running) return () => {};
  let stopped = false;
  const check = async () => {
    try {
      const res = await fetchImpl(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { version } = await res.json();
      if (!stopped && isNewerVersion(version, running)) onNewer(version);
    } catch { /* offline or no version.json yet - try again later */ }
  };
  check();
  const timer = setInterval(check, intervalMs);
  const onVisible = () => { if (doc?.visibilityState === "visible") check(); };
  doc?.addEventListener("visibilitychange", onVisible);
  return () => {
    stopped = true;
    clearInterval(timer);
    doc?.removeEventListener("visibilitychange", onVisible);
  };
}

// Update when only version.json knew: ask the service worker to fetch the new
// version; if one then waits, switch to it; otherwise drop the old worker so
// the reload is guaranteed to come from the network, not the old cache.
export async function forceUpdate({
  sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
  reload = () => window.location.reload(),
} = {}) {
  try {
    const reg = await sw?.getRegistration?.();
    if (reg) {
      await reg.update().catch(() => {});
      if (reg.waiting) { applyUpdate(reg.waiting, { sw, reload }); return; }
      await reg.unregister();
    }
  } catch { /* fall through to a plain reload */ }
  reload();
}

// Activate the waiting version and reload into it.
export function applyUpdate(worker, {
  sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
  reload = () => window.location.reload(),
  fallbackMs = 4000,
} = {}) {
  let done = false;
  const go = () => { if (!done) { done = true; reload(); } };
  sw?.addEventListener("controllerchange", go);
  worker?.postMessage({ type: "SKIP_WAITING" });
  // If the switch is never reported (old browser), reload anyway: the new
  // worker activates once nothing old is holding it.
  setTimeout(go, fallbackMs);
}
