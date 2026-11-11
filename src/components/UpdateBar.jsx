import { useEffect, useState } from "react";
import { watchForUpdates, applyUpdate } from "../utils/swUpdate.js";
import "./UpdateBar.css";

// Top-of-screen bar shown when a new version of the app has been deployed.
// Same wording style as OfflineBar: Thai first, English under it.
// "Later" only hides it for now; it comes back after the next reload.
export default function UpdateBar() {
  const [worker, setWorker] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;   // dev server has no service worker
    return watchForUpdates((w) => { setWorker(w); setHidden(false); });
  }, []);

  if (!worker || hidden) return null;

  return (
    <div className="updbar" role="status" aria-live="polite">
      <span className="updbar-icon" aria-hidden="true">⬆</span>
      <span className="updbar-text">
        <span className="updbar-th">มีเวอร์ชันใหม่ของแอป กด Update เพื่อใช้งานเวอร์ชันล่าสุด</span>
        <span className="updbar-en">A new version is available. Save your work, then press Update.</span>
      </span>
      <button className="updbar-go" disabled={updating}
        onClick={() => { setUpdating(true); applyUpdate(worker); }}>
        {updating ? "Updating..." : "Update"}
      </button>
      <button className="updbar-later" disabled={updating} onClick={() => setHidden(true)}>Later</button>
    </div>
  );
}
