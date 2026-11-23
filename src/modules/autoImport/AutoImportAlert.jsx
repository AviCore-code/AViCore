import { useEffect, useState } from "react";
import { getSetting } from "../../services/desktopDatabase.js";
import { CONFIG_KEY, STATUS_KEY, withConfigDefaults } from "../../services/autoImportCore.js";
import { autoImportHealth, thaiDuration } from "./autoImportHealth.js";
import "./AutoImport.css";

// A bar across the top of every Admin page when Auto Import is not bringing
// the Excel files in (see autoImportHealth.js). Thai first, like OfflineBar:
// whoever sees it needs to understand it at once. Checked every 5 minutes and
// whenever the tab comes back into view. "Close" hides it for this tab until
// the situation changes.

const CHECK_MS = 5 * 60_000;
const DISMISS_KEY = "avicore_autoimport_alert_dismissed";

const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })} ${d.toTimeString().slice(0, 5)}`;
};

export default function AutoImportAlert({ onOpen, loadSetting = getSetting, now = () => Date.now() }) {
  const [health, setHealth] = useState(null);
  const [dismissed, setDismissed] = useState(() => { try { return sessionStorage.getItem(DISMISS_KEY) || ""; } catch { return ""; } });

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const [status, config] = await Promise.all([loadSetting(STATUS_KEY), loadSetting(CONFIG_KEY)]);
        if (alive) setHealth(autoImportHealth(status, withConfigDefaults(config), now()));
      } catch { /* offline - keep what we had */ }
    }
    check();
    const t = setInterval(check, CHECK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!health) return null;
  const key = `${health.kind}|${health.since || "never"}`;
  if (dismissed === key) return null;
  const dismiss = () => { setDismissed(key); try { sessionStorage.setItem(DISMISS_KEY, key); } catch { /* fine */ } };

  const ago = health.minutes == null ? "" : thaiDuration(health.minutes);
  const last = health.since ? ` (ล่าสุด ${fmt(health.since)})` : "";
  const th = health.kind === "vps"
    ? `⛔ Auto Import บน server (VPS) หยุดทำงาน${ago ? ` มา ${ago}` : ""}${last} — ไม่มีการ import ไฟล์ Excel เข้าระบบ`
    : `⚠ เครื่อง PC office${health.host ? ` (${health.host})` : ""} ไม่ได้ส่งไฟล์ Excel มา${ago ? ` ${ago}` : "เลย"}${last} — ค่าที่แก้ใน FDT / Roster / Training ยังไม่เข้าระบบ ให้เปิดเครื่องและเช็ค AviCore Sync`;
  const en = health.kind === "vps"
    ? "The Auto Import service on the VPS has stopped reporting - nothing is being imported."
    : "The office PC has not sent the Excel files - imports are re-reading old copies.";

  return (
    <div className={`autoimp-alert ${health.level}`} role="alert">
      <div className="autoimp-alert-text">
        <b>{th}</b>
        <span>{en}</span>
      </div>
      <div className="autoimp-alert-actions">
        {onOpen && <button type="button" onClick={onOpen}>เปิดหน้า Auto Import</button>}
        <button type="button" className="autoimp-alert-x" onClick={dismiss} aria-label="ปิดข้อความนี้">✕</button>
      </div>
    </div>
  );
}
