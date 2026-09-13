import { useEffect, useState } from "react";
import { getPairedPilotCode, clearPairedPilotCode, syncNow, getSyncStatus, getSetting } from "../services/mobileDatabase.js";
import PilotLogin from "./PilotLogin.jsx";
import MyStatus from "../modules/myStatus/MyStatus.jsx";
import DutyEntry from "../modules/dutyEntry/DutyEntry.jsx";
import MyLogbook from "../modules/myLogbook/MyLogbook.jsx";
import MyExperience from "../modules/myExperience/MyExperience.jsx";
import "./MobileApp.css";

// Android Crew app shell - only the four Pilot/Flight Crew pages from the PC
// app, reused completely untouched (they already talk to
// desktopDatabase.js, which auto-routes to the mobile SQLite+sync layer -
// see src/services/desktopDatabase.js). No Admin/Training/Settings pages
// ship here at all - this is a personal-phone app, not an admin device.
const TABS = [
  { key: "status", label: "Status", Component: MyStatus },
  { key: "duty", label: "Duty", Component: DutyEntry },
  { key: "logbook", label: "Logbook", Component: MyLogbook },
  { key: "experience", label: "Experience", Component: MyExperience }
];

const AUTO_SYNC_MS = 2 * 60 * 1000;

export default function MobileApp() {
  // null = still checking on-device pairing state, "" = not paired yet.
  const [pairedCode, setPairedCode] = useState(null);
  const [tab, setTab] = useState("status");
  const [syncStatus, setSyncStatus] = useState(null);
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    checkPairing();
    refreshBranding();
  }, []);

  // Same customer_branding (logo + company name) an admin sets once in the
  // PC app's Settings > Admin Setting - pulled down by mobileSync.js's
  // pullBranding() on every sync (see doSync below), so this just re-reads
  // whatever's in local SQLite after each sync instead of hitting Supabase
  // directly itself.
  async function refreshBranding() {
    setBranding((await getSetting("customer_branding")) || null);
  }

  async function checkPairing() {
    const code = await getPairedPilotCode();
    setPairedCode(code);
    if (code) doSync();
  }

  async function doSync() {
    await syncNow();
    setSyncStatus(await getSyncStatus());
    refreshBranding();
  }

  useEffect(() => {
    if (!pairedCode) return;
    const timer = setInterval(doSync, AUTO_SYNC_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairedCode]);

  function handlePaired(code) {
    setPairedCode(code);
    doSync();
  }

  async function handleSwitchPilot() {
    if (!confirm("Switch this phone to a different pilot? Data already entered stays saved and will still sync.")) return;
    await clearPairedPilotCode();
    setPairedCode("");
  }

  if (pairedCode === null) {
    return <div className="mobile-loading">Loading...</div>;
  }
  if (!pairedCode) {
    return <PilotLogin onPaired={handlePaired} />;
  }

  const Active = TABS.find((t) => t.key === tab)?.Component;
  const syncLabel = !syncStatus
    ? "Sync"
    : syncStatus.syncing
    ? "Syncing..."
    : syncStatus.lastError
    ? "Sync failed"
    : syncStatus.pending > 0
    ? `${syncStatus.pending} pending`
    : "Synced";

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        {branding?.logo && <img className="mobile-header-logo" src={branding.logo} alt="" />}
        <span className="mobile-header-title">AviCore Crew</span>
        <span className="mobile-header-pilot" onClick={handleSwitchPilot} title="Tap to switch pilot">{pairedCode}</span>
        <button
          className={`mobile-sync-btn${syncStatus?.lastError ? " error" : ""}`}
          onClick={doSync}
          disabled={syncStatus?.syncing}
        >
          {syncLabel}
        </button>
      </header>

      {syncStatus?.lastError && (
        // The header button only ever says "Sync failed" - with no detail
        // shown anywhere, a pilot (or the captain testing on their own
        // phone) has no way to tell WHY without plugging into a computer
        // for remote debugging. Surfacing the actual message here means the
        // real cause (bad key, RLS rejection, no network, etc.) is readable
        // directly off the phone screen.
        <div className="mobile-sync-error">{syncStatus.lastError}</div>
      )}

      <main className="mobile-content">
        {Active && <Active />}
      </main>

      <nav className="mobile-tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mobile-footer">
        {branding?.name ? `${branding.name} · ` : ""}© Capt.Weera Juntaklud
      </div>
    </div>
  );
}
