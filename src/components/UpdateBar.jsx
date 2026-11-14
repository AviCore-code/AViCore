import { useEffect, useState } from "react";
import { watchForUpdates, watchServerVersion, applyUpdate, forceUpdate } from "../utils/swUpdate.js";
import "./UpdateBar.css";

const RUNNING = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

// Inside the Android app (Capacitor) the web code ships in the APK: a reload
// cannot fetch a newer version, so the bar would only nag. It stays off there.
const isNativeApp = () => {
  try { return !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
};

// Top-of-screen bar shown when a new version of the app has been deployed.
// Two signals, whichever comes first: the browser has installed a new service
// worker (it waits for the click), or the server's version.json is newer than
// the version running here. Same wording style as OfflineBar: Thai first,
// English under it. "Later" only hides it for now; it comes back after the
// next reload.
export default function UpdateBar() {
  const [worker, setWorker] = useState(null);
  const [serverVersion, setServerVersion] = useState("");
  const [hidden, setHidden] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || isNativeApp()) return undefined;   // dev server / APK: nothing to update
    const stopSw = watchForUpdates((w) => { setWorker(w); setHidden(false); });
    const stopVersion = watchServerVersion(RUNNING, (v) => { setServerVersion(v); setHidden(false); });
    return () => { stopSw(); stopVersion(); };
  }, []);

  if ((!worker && !serverVersion) || hidden) return null;

  const onUpdate = () => {
    setUpdating(true);
    if (worker) applyUpdate(worker);
    else forceUpdate();
  };

  return (
    <div className="updbar" role="status" aria-live="polite">
      <span className="updbar-icon" aria-hidden="true">⬆</span>
      <span className="updbar-text">
        <span className="updbar-th">
          มีเวอร์ชันใหม่ของแอป{serverVersion ? ` (v${RUNNING} → v${serverVersion})` : ""} กด Update เพื่อใช้งานเวอร์ชันล่าสุด
        </span>
        <span className="updbar-en">A new version is available. Save your work, then press Update.</span>
      </span>
      <button className="updbar-go" disabled={updating} onClick={onUpdate}>
        {updating ? "Updating..." : "Update"}
      </button>
      <button className="updbar-later" disabled={updating} onClick={() => setHidden(true)}>Later</button>
    </div>
  );
}
