import { useEffect, useState } from "react";
import OfflineBar from "../components/OfflineBar.jsx";
import { startClickSound } from "../utils/clickSound.js";
import { startOfflineQueue } from "../services/offlineQueue.js";
import { getPairedPilotCode, clearPairedPilotCode, isConfigured, getSetting, subscribeSyncStatus, pingServer } from "../services/webDatabase.js";
import { isDemoSession, getPairingHoursLeft } from "../services/desktopDatabase.js";
import WebPilotLogin from "./WebPilotLogin.jsx";
import MyStatus from "../modules/myStatus/MyStatus.jsx";
import DutyEntry from "../modules/dutyEntry/DutyEntry.jsx";
import MyLogbook from "../modules/myLogbook/MyLogbook.jsx";
import MyExperience from "../modules/myExperience/MyExperience.jsx";
import MyTrainingStatus from "./MyTrainingStatus.jsx";
import CrewDashboard from "./CrewDashboard.jsx";
import MyRoster from "./MyRoster.jsx";
import MyWeeklySchedule from "./MyWeeklySchedule.jsx";
import CrewSettings from "./CrewSettings.jsx";
import { applyCrewDisplay } from "./crewDisplay.js";
import "./WebApp.css";

// Browser-based shell for the four pilot self-service pages - same pages,
// same components, as the PC app and the Android app (see
// desktopDatabase.js's isWeb() branch for how they transparently reach
// webDatabase.js here instead of Electron IPC or the mobile SQLite+sync
// layer). Deliberately simpler than MobileApp.jsx: there's no local cache
// and no offline queue in a plain browser tab, so every read/write already
// happens live against Supabase - no "Sync" button, no pending count, no
// sync-error banner needed. If a request fails, the page it happened on
// will surface that failure itself (same as it would talk to Electron IPC
// failing on the PC app).
const TABS = [
  // Home first: this is where the app opens, and the default tab below must
  // match it or a fresh browser lands somewhere else.
  { key: "home", label: "Home", icon: "🏠", Component: CrewDashboard },
  { key: "duty", label: "Daily Duty Entry", icon: "📝", Component: DutyEntry },
  { key: "status", label: "FDT Monitor", icon: "⏱️", Component: MyStatus },
  { key: "training", label: "Training Monitor", icon: "🎓", Component: MyTrainingStatus },
  { key: "roster", label: "Roster", icon: "🗓️", Component: MyRoster },
  { key: "weekly", label: "Weekly Schedule", icon: "🚁", Component: MyWeeklySchedule },
  { key: "logbook", label: "Logbook", icon: "📖", Component: MyLogbook },
  { key: "experience", label: "Experience", icon: "📊", Component: MyExperience },
  { key: "settings", label: "Settings", icon: "⚙️", Component: CrewSettings }
];

// The tab names this build knows about, used to validate a remembered one.
const TAB_KEYS = TABS.map((t) => t.key);

const SYNC_LABEL = {
  connecting: "Connecting…",
  syncing: "Syncing…",
  online: "Synced",
  offline: "Offline",
  unconfigured: "Not configured"
};
// Re-check often enough that the badge is trustworthy without hammering
// Supabase - a pilot glancing at the corner should never see a "Synced"
// that's more than half a minute stale.
const SYNC_POLL_MS = 30000;


// Which page is open survives a refresh.
//
// Pressing F5 used to drop you back on the first tab - and on a page like the
// weekly plan or a pilot's FDT, that means finding your way back to what you
// were looking at. The browser reloads for all sorts of reasons (an update, a
// crashed tab, a phone reclaiming memory in the background), so this is not
// only about someone deliberately pressing refresh.
//
// localStorage, not sessionStorage: the point is to come back to the same
// place after the tab is closed and reopened too. It holds a tab NAME, nothing
// about the data itself, so there is nothing sensitive in it.
function rememberedTab(key, fallback, allowed) {
  try {
    const saved = localStorage.getItem(key);
    // Checked against the tabs this build actually has - a name saved by an
    // older version must not leave the app rendering nothing.
    if (saved && (!allowed || allowed.includes(saved))) return saved;
  } catch { /* private mode: fall through */ }
  return fallback;
}

function rememberTab(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not fatal */ }
}

export default function WebApp() {
  const [pairedCode, setPairedCode] = useState(null);
  // A FRESH VISIT always starts on Home; a refresh mid-session returns to the
  // page you were on.
  //
  // These two pull in opposite directions, so the remembered tab is kept in
  // sessionStorage-scoped terms: rememberTab still writes it, but it is only
  // honoured when the session is already running (the app was reloaded, not
  // opened). Opening the app fresh - new tab, next morning - lands on Home,
  // which is what "Home" means.
  const [tab, setTab] = useState(() => {
    try {
      if (sessionStorage.getItem("avicore_crew_session") === "open") {
        return rememberedTab("avicore_crew_tab", "home", TAB_KEYS);
      }
    } catch { /* private mode - fall through to Home */ }
    return "home";
  });
  const [branding, setBranding] = useState(null);
  // Hours left on the 24-hour device pairing, for the Log Out tooltip.
  const [pairingHoursLeft, setPairingHoursLeft] = useState(null);
  const [configError, setConfigError] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ status: "connecting", lastSyncAt: null, lastError: null });
  // Remember which page is open, so a refresh comes back to it.
  useEffect(() => { rememberTab("avicore_crew_tab", tab); }, [tab]);
  // Marks the session as running, so a RELOAD restores the tab while a fresh
  // open does not. sessionStorage is cleared by the browser when the tab is
  // closed, which is exactly the line between the two cases.
  useEffect(() => { try { sessionStorage.setItem("avicore_crew_session", "open"); } catch { /* private mode */ } }, []);
  // Re-read the pairing clock every 10 minutes. Polled rather than computed
  // once: a tablet left open through a shift would otherwise keep showing the
  // figure from whenever the page loaded.
  useEffect(() => {
    let alive = true;
    const read = () => getPairingHoursLeft()
      .then((h) => { if (alive) setPairingHoursLeft(h); })
      .catch(() => {});
    read();
    const t = setInterval(read, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // Button clicks make a short sound (utils/clickSound.js).
  useEffect(() => startClickSound(), []);

  // The offline queue runs for the WHOLE app, including the login screen.
  //
  // It used to be started inside OfflineBar, which only renders after a pilot
  // has signed in - so a browser sitting on the login screen with queued duty
  // entries never sent them, no matter how good the connection was. That is
  // exactly the state a pilot leaves the device in after working offline and
  // logging out.
  useEffect(() => startOfflineQueue(), []);

  useEffect(() => {
    // Apply the saved display prefs (text size / screen) for the whole
    // session, before anything renders (see crewDisplay.js + the Settings tab).
    applyCrewDisplay();
    if (!isConfigured()) {
      setConfigError(true);
      setPairedCode("");
      return;
    }
    checkPairing();
    refreshBranding();
  }, []);

  // Independent of pairing/config-error state above - even the "not paired
  // yet" Login screen benefits from knowing whether Supabase is reachable
  // (that's the same connection fetchPilotRoster() needs). Re-checks on a
  // timer, and immediately whenever the browser's own online/offline
  // events fire or the tab regains focus, so switching back to an
  // already-open tab after a dead spot updates the badge right away rather
  // than waiting out the rest of the poll interval.
  useEffect(() => {
    const unsubscribe = subscribeSyncStatus(setSyncStatus);
    pingServer();
    const interval = setInterval(pingServer, SYNC_POLL_MS);
    const onOnline = () => pingServer();
    const onVisible = () => { if (document.visibilityState === "visible") pingServer(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function refreshBranding() {
    try {
      setBranding((await getSetting("customer_branding")) || null);
    } catch {
      // Branding is cosmetic only - a failed fetch here should never block
      // the rest of the app from loading.
    }
  }

  async function checkPairing() {
    const code = await getPairedPilotCode();
    setPairedCode(code);
  }

  function handlePaired(code) {
    setPairedCode(code);
  }

  // No confirm() dialog here on purpose - a native browser confirm/alert
  // popup forces Chromium out of true full screen automatically (it can't
  // render a modal dialog over an exclusive full screen surface), which is
  // exactly why logging out was kicking pilots out of full screen. Logging
  // out is low stakes anyway - worst case a pilot logs back in - so it
  // just happens immediately on tap.
  //
  // This intentionally does NOT try window.close() - every browser blocks
  // a page from closing its own window unless that window was opened by
  // script in the first place, and a kiosk shortcut's window is opened by
  // Windows launching msedge.exe directly, not by script, so close() would
  // always be silently ignored here. Going back to the Login screen to
  // pick the next pilot is the real, working behavior for this kiosk
  // shortcut - not a fallback.
  async function handleLogout() {
    // Logging out with unsent work is the one way a pilot can lose a duty
    // entry for good: the queue is keyed to the pilot who made it, so after
    // logging out nothing sends until THAT pilot signs in again on THIS
    // browser. Clear the site data in between and it is gone, and nobody ever
    // knew it was there.
    //
    // So: try to send it first, and if that is not possible, say plainly what
    // is about to happen and let the pilot decide.
    try {
      const { pendingWrites, flushQueue, isOnline, currentOwner } = await import("../services/offlineQueue.js");
      const mine = (await pendingWrites()).filter((op) => !op.owner || op.owner === currentOwner());

      if (mine.length) {
        if (isOnline()) {
          const result = await flushQueue();
          const left = (await pendingWrites()).filter((op) => !op.owner || op.owner === currentOwner());
          if (left.length) {
            const ok = window.confirm(
              `${left.length} change(s) still could not be sent.\n\n` +
              "They stay saved on this device and will be sent the next time you sign in here.\n\n" +
              "Log out anyway?"
            );
            if (!ok) return;
          }
        } else {
          const ok = window.confirm(
            `You are OFFLINE and ${mine.length} change(s) have not reached the server.\n\n` +
            "They are saved on this device and will be sent the next time YOU sign in on THIS device with a connection. " +
            "If you clear the browser data first, they are lost.\n\n" +
            "Log out anyway?"
          );
          if (!ok) return;
        }
      }
    } catch {
      // Never let the offline check trap someone in the app.
    }

    await clearPairedPilotCode();
    setPairedCode("");
  }

  // Manual "get the latest code + latest data right now" button - useful for
  // a phone/tablet left open on one tab for a whole shift, where the tabs
  // above already refetch on every switch but a page left sitting open
  // wouldn't otherwise notice a later Admin edit or a newer deploy. A plain
  // reload is enough to guarantee both: firebase.json now serves index.html
  // with Cache-Control: no-cache (see the comment there), so this always
  // re-fetches the current index.html + whichever JS/CSS bundle it points
  // at - never a browser-cached stale copy - and a fresh page load means
  // every page component's own useEffect fetches fresh data on mount too.
  function handleRefresh() {
    window.location.reload();
  }

  if (configError) {
    return (
      // Plain .web-login, not LoginShell: this screen means Supabase is not
      // configured, so the admin's chosen background could not be fetched
      // anyway. The CSS fallback shows the bundled photo.
      <div className="web-login">
        <div className="web-login-card">
          <h1>AviCore Crew</h1>
          <div className="web-login-status error">
            This web build isn't configured yet — it's missing its Supabase connection details. Contact your Admin.
          </div>
        </div>
      </div>
    );
  }

  if (pairedCode === null) {
    return <div className="web-loading">Loading...</div>;
  }
  if (!pairedCode) {
    return (
      <>
        {/* Still shown when signed out: queued work is at its most invisible
            here, and this is where someone decides whether to clear the
            browser. */}
        <OfflineBar />
        <WebPilotLogin onPaired={handlePaired} />
      </>
    );
  }

  const Active = TABS.find((t) => t.key === tab)?.Component;

  return (
    <div className="web-app">
      <OfflineBar />
      <header className="web-header">
        <div className="web-header-brand">
          {branding?.logo ? (
            <img className="web-header-logo" src={branding.logo} alt="" />
          ) : (
            <span className="web-header-planeicon" aria-hidden="true">✈</span>
          )}
          <div className="web-header-titlegroup">
            <span className="web-header-title">AviCore Crew{isDemoSession() && <span className="web-demo-badge">DEMO · view only</span>}</span>
            <span className="web-header-copyright">© Capt.Weera Juntaklud</span>
          </div>
        </div>
        <nav className="web-tabbar">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
              <span className="web-tabbar-icon" aria-hidden="true">{t.icon}</span>
              <span className="web-tabbar-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <span
          className={`web-sync-status ${syncStatus.status}`}
          title={syncStatus.status === "offline" && syncStatus.lastError ? syncStatus.lastError : (syncStatus.lastSyncAt ? `Last synced ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}` : "")}
        >
          <span className="web-sync-dot" />
          <span className="web-sync-label">{SYNC_LABEL[syncStatus.status] || syncStatus.status}</span>
        </span>
        <button className="web-header-refresh" onClick={handleRefresh} title="Refresh page and reload latest data" aria-label="Refresh">⟳</button>
        {/* The pairing now lasts 24 hours rather than until the browser closes,
            so the pilot can reopen the app on a rig with no signal. Showing
            what is left matters: without it, expiry looks like being logged out
            at random, and the pilot finds out at the moment they have no
            connection to sign back in with. */}
        <button
          className="web-header-logout"
          onClick={handleLogout}
          title={
            pairingHoursLeft == null
              ? "Log out"
              : `Log out\n\nThis device stays signed in for about ${Math.max(1, Math.round(pairingHoursLeft))} more hour(s) without a connection. After that you will need signal to sign in again.`
          }
        >
          Log Out
        </button>
      </header>

      <main className="web-content">
        {Active && <Active />}
      </main>

      {branding?.name && <div className="web-footer">{branding.name}</div>}
    </div>
  );
}
