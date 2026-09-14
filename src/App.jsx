import { useEffect, useState } from "react";
import { playClick } from "./utils/uiSound.js";
import { hasAdminPin } from "./services/desktopDatabase.js";
import { ADMIN_LOCK_ENABLED } from "./config/adminLock.js";
import DutyEntry from "./modules/dutyEntry/DutyEntry.jsx";
import MyStatus from "./modules/myStatus/MyStatus.jsx";
import MyExperience from "./modules/myExperience/MyExperience.jsx";
import MyLogbook from "./modules/myLogbook/MyLogbook.jsx";
import Dashboard from "./modules/dashboard/Dashboard.jsx";
import SyncStatus from "./components/SyncStatus.jsx";
import TopBar from "./components/TopBar.jsx";
import AppBackground from "./components/AppBackground.jsx";
import AdminGate from "./components/AdminGate.jsx";
import Training from "./modules/trainingDue/Training.jsx";
import FlightCrews from "./modules/flightCrews/FlightCrews.jsx";
import Settings from "./modules/settings/Settings.jsx";

const ADMIN_GROUP_LABEL = "Admin";
const menuGroups = [
  { label: ADMIN_GROUP_LABEL, items: ["Dashboard", "Training", "Flight Crews", "Settings"] },
  { label: "My Flight Data", items: ["Daily Duty", "My Status", "My Experience", "My Logbook"] }
];
// Emoji icons (same lightweight style already used elsewhere in the app -
// 🔒/🔓 for the Admin lock, 📅 for date pickers) rather than pulling in an
// icon-font/SVG library just for the sidebar.
const MENU_ICONS = {
  "Dashboard": "📊",
  "Training": "🎓",
  "Flight Crews": "✈️",
  "Settings": "⚙️",
  "Daily Duty": "📝",
  "My Status": "🧭",
  "My Experience": "🪪",
  "My Logbook": "📔"
};
const ADMIN_PAGES = new Set(menuGroups.find((g) => g.label === ADMIN_GROUP_LABEL).items);

export default function App() {
  const [page, setPage] = useState("Dashboard");

  // Admin PIN gate: protects the whole "Admin" menu group (which includes
  // Settings > FTL Limits) from anyone who just has the app open. pinExists
  // is null while still loading (so we don't flash the gate open/closed);
  // until a PIN has ever been set, Admin pages stay open by default so the
  // very first launch isn't locked out of Settings before a PIN can be
  // created there (see the Admin Access card in Settings.jsx).
  const [pinExists, setPinExists] = useState(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pendingPage, setPendingPage] = useState(null);

  async function refreshPinExists() {
    setPinExists(await hasAdminPin());
  }

  useEffect(() => {
    refreshPinExists();
    window.addEventListener("admin-pin-updated", refreshPinExists);
    return () => window.removeEventListener("admin-pin-updated", refreshPinExists);
  }, []);

  // Covers the case where the app boots straight into an Admin page (the
  // default landing page is Dashboard) while a PIN is already set - without
  // this, the gate would only ever trigger from a sidebar click and the
  // very first launch of a locked, already-PIN-protected install would show
  // Dashboard wide open.
  useEffect(() => {
    if (ADMIN_LOCK_ENABLED && pinExists && !adminUnlocked && ADMIN_PAGES.has(page) && !pendingPage) {
      setPendingPage(page);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinExists]);

  // Treat "still checking whether a PIN exists" (pinExists === null) as
  // locked too for an Admin page, not just "PIN exists and not unlocked" -
  // otherwise Dashboard/All Status data could flash visible for the instant
  // between mount and the hasAdminPin() IPC call resolving, on every launch.
  // ADMIN_LOCK_ENABLED short-circuits all of this to "never locked" while the
  // lock is temporarily turned off (see src/config/adminLock.js).
  const locked = ADMIN_LOCK_ENABLED && ADMIN_PAGES.has(page) && (pinExists === null || (pinExists && !adminUnlocked));

  function goTo(pageName) {
    const needsGate = ADMIN_LOCK_ENABLED && ADMIN_PAGES.has(pageName) && pinExists && !adminUnlocked;
    if (needsGate) {
      setPendingPage(pageName);
    } else {
      setPage(pageName);
    }
  }

  function handleUnlock() {
    setAdminUnlocked(true);
    if (pendingPage) setPage(pendingPage);
    setPendingPage(null);
  }

  function handleLock() {
    setAdminUnlocked(false);
    if (ADMIN_PAGES.has(page)) setPage("Daily Duty");
  }

  // App-wide button click sound (toggleable from Settings, per-machine).
  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest("button")) playClick();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <>
      <AppBackground />
      {ADMIN_LOCK_ENABLED && pendingPage && (
        <AdminGate onUnlock={handleUnlock} onCancel={() => setPendingPage(null)} />
      )}
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          ✦ AviCore
          <span>Flight Operations Suite</span>
          <small>Enterprise 1.0.0 Build 0016 Production</small>
        </div>

        <SyncStatus />

        {menuGroups.map((group) => (
          <div className="menu-group" key={group.label}>
            <div className="menu-group-label">
              {group.label}
              {ADMIN_LOCK_ENABLED && group.label === ADMIN_GROUP_LABEL && pinExists && adminUnlocked && (
                <button type="button" className="menu-group-lock" title="Lock Admin" onClick={handleLock}>🔓 Lock</button>
              )}
              {ADMIN_LOCK_ENABLED && group.label === ADMIN_GROUP_LABEL && pinExists && !adminUnlocked && (
                <span className="menu-group-lock-indicator" title="Admin PIN required">🔒</span>
              )}
            </div>
            {group.items.map((m) => (
              <button
                key={m}
                className={page === m ? "active" : ""}
                disabled={ADMIN_LOCK_ENABLED && group.label === ADMIN_GROUP_LABEL && pinExists === null}
                onClick={() => goTo(m)}
              >
                <span className="menu-icon" aria-hidden="true">{MENU_ICONS[m]}</span> {m}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-copyright">© {new Date().getFullYear()} Capt. Weera Juntaklud. All rights reserved.</div>
      </aside>

      <main className="main">
        <TopBar />
        <div className="main-content">
        {locked ? (
          <div className="placeholder">
            <h1>{pinExists === null ? "Checking access..." : "🔒 Admin Access Required"}</h1>
            {pinExists !== null && <p>Enter the Admin PIN to view this page.</p>}
          </div>
        ) : page === "Dashboard" ? (
          <Dashboard />
        ) : page === "Training" ? (
          <Training />
        ) : page === "Flight Crews" ? (
          <FlightCrews />
        ) : page === "Settings" ? (
          <Settings />
        ) : page === "Daily Duty" ? (
          <DutyEntry />
        ) : page === "My Status" ? (
          <MyStatus />
        ) : page === "My Experience" ? (
          <MyExperience />
        ) : page === "My Logbook" ? (
          <MyLogbook />
        ) : (
          <div className="placeholder">
            <h1>{page}</h1>
            <p>Module coming soon.</p>
          </div>
        )}
        </div>
      </main>
      </div>
    </>
  );
}
