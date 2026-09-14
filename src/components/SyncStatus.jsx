import { useEffect, useState } from "react";
import { syncNow, getSyncStatus } from "../services/desktopDatabase.js";
import "./SyncStatus.css";

function timeAgo(iso) {
  if (!iso) return "Never synced";
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  return `${Math.floor(diffSec / 3600)} hr ago`;
}

export default function SyncStatus() {
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);

  async function refresh() {
    setStatus(await getSyncStatus());
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    await syncNow();
    await refresh();
    setSyncing(false);
  }

  if (!status) return null;

  const tone = !status.configured ? "off" : status.lastError ? "error" : status.pending > 0 ? "pending" : "ok";
  const label = !status.configured
    ? "Sync not configured"
    : status.lastError
    ? "Sync failed"
    : status.pending > 0
    ? `${status.pending} pending sync`
    : `Synced ${timeAgo(status.lastSyncAt)}`;

  return (
    <div className={`sync-status sync-status-${tone}`} title={status.lastError || ""}>
      <span className="sync-status-dot" />
      <span className="sync-status-label">{label}</span>
      {status.configured && (
        <button className="sync-status-btn" onClick={handleSyncNow} disabled={syncing || status.syncing}>
          {syncing || status.syncing ? "Syncing..." : "Sync now"}
        </button>
      )}
    </div>
  );
}
