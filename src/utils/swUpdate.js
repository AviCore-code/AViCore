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
