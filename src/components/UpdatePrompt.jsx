import { useEffect, useState } from "react";
import "./UpdatePrompt.css";

// "A new version is ready - Update now."
//
// ---------------------------------------------------------------------------
// WHY A BUTTON, WHEN THE SERVICE WORKER ALREADY AUTO-UPDATES
// ---------------------------------------------------------------------------
//
// vite-plugin-pwa is configured with registerType: 'autoUpdate'. That downloads
// a new build in the background, but it only takes effect once EVERY tab of the
// app has been closed - on a phone that is running as an installed PWA, that can
// be weeks. So a pilot could be looking at last month's build while believing
// they had the current one, which for duty limits and expiry dates is the wrong
// kind of quiet.
//
// This makes the moment explicit: the app says a new version is ready and the
// person chooses when to take it. Nothing reloads underneath them mid-task -
// pressing the button is what activates the waiting worker and reloads.
//
// ---------------------------------------------------------------------------
// WHAT IT DOES NOT DO
// ---------------------------------------------------------------------------
//
// It never auto-reloads. A pilot half-way through typing a duty entry must not
// lose it to a background update, so the prompt waits, however long that is.
export default function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);

  useEffect(() => {
    let cancelled = false;

    // Imported dynamically, and the .catch below matters: `virtual:pwa-register`
    // only exists in builds where the PWA plugin runs. Today that is safe because
    // only WebApp.jsx and AdminWebApp.jsx import this component and both are PWA
    // builds - but if this is ever mounted in the PC/Electron or Android shell,
    // the import fails there and the prompt simply never appears rather than
    // breaking the app. Those builds update through their own installers.
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        if (cancelled) return;
        const fn = registerSW({
          immediate: true,
          onNeedRefresh() { setNeedRefresh(true); },
          // Deliberately silent. "Ready to work offline" is true from the first
          // visit and telling someone about it interrupts without giving them
          // anything to do.
          onOfflineReady() {}
        });
        setUpdateSW(() => fn);
      })
      .catch(() => { /* no service worker in this build */ });

    return () => { cancelled = true; };
  }, []);

  if (!needRefresh) return null;

  async function handleUpdate() {
    setUpdating(true);
    try {
      // `true` tells the waiting worker to activate and reload the page.
      if (updateSW) await updateSW(true);
      else window.location.reload();
    } catch {
      // If activation fails for any reason, a plain reload still picks up the
      // new files - better than leaving the button spinning.
      window.location.reload();
    }
  }

  return (
    <div className="updateprompt" role="status">
      <span className="updateprompt-dot" aria-hidden="true" />
      <span className="updateprompt-text">
        <b>มีเวอร์ชันใหม่พร้อมใช้งาน</b>
        <span>A new version is ready.</span>
      </span>
      <button className="updateprompt-btn" onClick={handleUpdate} disabled={updating}>
        {updating ? "Updating…" : "Update now"}
      </button>
      {/* Dismissable, because the prompt must never block work. It comes back on
          the next load while the new build is still waiting. */}
      <button
        className="updateprompt-later" onClick={() => setNeedRefresh(false)}
        title="Later" aria-label="Later"
      >
        ✕
      </button>
    </div>
  );
}
