import { useEffect, useRef, useState } from "react";
import { checkForUpdates, downloadUpdate, installUpdate, onUpdateEvent } from "../services/desktopDatabase.js";
import "./PcUpdateBar.css";

// PC/Electron equivalent of the web builds' UpdatePrompt.jsx ("A new version
// is ready — Update now"). Settings > Software Update (AdminSettingsTab.jsx)
// already had the full check/download/install flow, but only if someone
// remembered to go there and click "Check for Updates" themselves - unlike
// Crew/Admin Web, nothing on PC ever announced an update on its own. Capt.
// Weera asked for that gap closed: "แจ้งเตือน ถ้า PWA มีการ update version
// ให้กด update ด้วย" - and since the same electron-updater plumbing already
// exists (electron/updater.cjs, wired up in main.cjs), this only needed a
// renderer-side banner, not a new update mechanism.
//
// Reuses updater.cjs's existing events (checking/available/not-available/
// progress/downloaded/error) via the same onUpdateEvent() the Settings card
// subscribes to - both can be mounted at once without conflict, since
// electron-updater just broadcasts to every subscribed listener.
//
// Like the web UpdatePrompt, this never auto-downloads or auto-installs:
// Settings > Software Update's own comment explains why (offshore users on
// slow/metered links shouldn't have a multi-hundred-MB installer start
// without asking) - this banner is only the "something's waiting, come look"
// notice; the actual Download / Restart & Install steps still ask first,
// exactly as they do today from Settings.
export default function PcUpdateBar() {
  const [state, setState] = useState({ phase: "idle", version: "", percent: 0, error: "" });
  const [dismissed, setDismissed] = useState(false);
  const checkedOnce = useRef(false);

  useEffect(() => {
    // No window.aviCoreAPI outside Electron (web/mobile builds never mount
    // this component at all, but this guard keeps it harmless if that ever
    // changes) - checkForUpdates()/onUpdateEvent() from desktopDatabase.js
    // already no-op safely without it; this just skips the effect entirely.
    if (typeof window === "undefined" || !window.aviCoreAPI) return;

    const unsubscribe = onUpdateEvent((evt) => {
      if (evt.type === "checking") setState((s) => ({ ...s, phase: "checking" }));
      else if (evt.type === "available") { setState({ phase: "available", version: evt.version, percent: 0, error: "" }); setDismissed(false); }
      else if (evt.type === "not-available") setState((s) => (s.phase === "checking" ? { phase: "idle", version: "", percent: 0, error: "" } : s));
      else if (evt.type === "progress") setState((s) => ({ ...s, phase: "downloading", percent: evt.percent }));
      else if (evt.type === "downloaded") { setState((s) => ({ phase: "downloaded", version: evt.version || s.version, percent: 100, error: "" })); setDismissed(false); }
      // A failed background check should stay invisible - the Settings card
      // still surfaces the same error if the admin goes looking, but a
      // banner popping up over a routine "offline right now" isn't useful
      // the way an available update is.
      else if (evt.type === "error") setState((s) => (s.phase === "checking" || s.phase === "downloading" ? { phase: "idle", version: "", percent: 0, error: "" } : s));
    });

    // One check shortly after launch - not immediately on mount, so it
    // doesn't compete with everything else the app is loading at startup
    // (pilot roster, settings, licence check). checkForUpdates() itself is a
    // no-op with a clear error if Central Sync isn't configured yet
    // (updater.cjs), which this banner simply never surfaces - silent when
    // there's nothing useful to say, same as the "not-available" case above.
    if (!checkedOnce.current) {
      checkedOnce.current = true;
      const t = setTimeout(() => { checkForUpdates().catch(() => {}); }, 4000);
      return () => { clearTimeout(t); unsubscribe(); };
    }
    return unsubscribe;
  }, []);

  async function handleDownload() {
    setState((s) => ({ ...s, phase: "downloading", percent: 0 }));
    const result = await downloadUpdate();
    if (!result.ok) setState({ phase: "available", version: state.version, percent: 0, error: result.error || "" });
  }

  async function handleInstall() {
    await installUpdate();
  }

  if (dismissed) return null;
  if (state.phase !== "available" && state.phase !== "downloading" && state.phase !== "downloaded") return null;

  return (
    <div className="pcupdatebar" role="status">
      <span className="pcupdatebar-dot" aria-hidden="true" />
      <span className="pcupdatebar-text">
        {state.phase === "available" && (
          <>
            <b>มีเวอร์ชันใหม่พร้อมใช้งาน{state.version ? ` (${state.version})` : ""}</b>
            <span>A new version is available.</span>
          </>
        )}
        {state.phase === "downloading" && (
          <>
            <b>กำลังดาวน์โหลดอัปเดต… {state.percent}%</b>
            <span>Downloading update…</span>
          </>
        )}
        {state.phase === "downloaded" && (
          <>
            <b>อัปเดตพร้อมติดตั้งแล้ว</b>
            <span>Update downloaded — ready to install.</span>
          </>
        )}
      </span>

      {state.phase === "available" && (
        <button className="pcupdatebar-btn" onClick={handleDownload}>Update</button>
      )}
      {state.phase === "downloading" && (
        <div className="pcupdatebar-progress" aria-hidden="true">
          <div className="pcupdatebar-progress-fill" style={{ width: `${state.percent}%` }} />
        </div>
      )}
      {state.phase === "downloaded" && (
        <button className="pcupdatebar-btn" onClick={handleInstall}>Restart &amp; Install</button>
      )}

      {/* Dismissable like the web prompt - never blocks work. Reappears next
          launch while the update is still waiting (dismissed is in-memory
          state only, not persisted). Hidden while actively downloading so a
          dismiss can't hide progress mid-transfer with no way back to it
          short of reopening Settings. */}
      {state.phase !== "downloading" && (
        <button
          className="pcupdatebar-later" onClick={() => setDismissed(true)}
          title="Later" aria-label="Later"
        >
          ✕
        </button>
      )}
    </div>
  );
}
