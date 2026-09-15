import { useEffect, useState } from "react";
import OfflineBar from "../components/OfflineBar.jsx";
import { startClickSound } from "../utils/clickSound.js";
import { startOfflineQueue } from "../services/offlineQueue.js";
import ConflictDialog from "../components/ConflictDialog.jsx";
import { isConfigured, getSetting, signInAdmin, signOutAdmin, getAdminSession, onAdminAuthChange, subscribeSyncStatus, pingServer } from "../services/webDatabase.js";
import Dashboard from "../modules/dashboard/Dashboard.jsx";
import FlightCrews from "../modules/flightCrews/FlightCrews.jsx";
import Training from "../modules/trainingDue/Training.jsx";
import Settings from "../modules/settings/Settings.jsx";
import PilotRoster from "../modules/pilotRoster/PilotRoster.jsx";
import MyLogbook from "../modules/myLogbook/MyLogbook.jsx";
import FatigueMonitor from "../modules/fatigue/FatigueMonitor.jsx";
import FdtStatistics from "../modules/statistics/FdtStatistics.jsx";
import CrewLoginMonitor from "./CrewLoginMonitor.jsx";
import CrewAccess from "./CrewAccess.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoginShell from "./LoginShell.jsx";
import { ADMIN_ALLOWED_EMAILS } from "../config/adminAllowlist.js";
import AppSidebar from "./AppSidebar.jsx";
import adminLoginBg from "./admin-login-bg.png";
import "./WebApp.css";
import "./AdminWebApp.css";
import "./AppSidebar.css";

// Is this signed-in account allowed into admin? Empty allowlist = allow any
// signed-in account (no restriction); otherwise only the listed emails.
function emailAllowed(session) {
  if (!ADMIN_ALLOWED_EMAILS.length) return true;
  const email = (session?.user?.email || "").trim().toLowerCase();
  return ADMIN_ALLOWED_EMAILS.map((e) => e.trim().toLowerCase()).includes(email);
}

// Enterprise Web admin shell (build target "admin" -> dist-admin). Unlike
// the read-only Phase 1, this one signs an admin in with a REAL Supabase
// account (email/password); every edit then carries that user's JWT and RLS
// grants writes only to authenticated users (sql/web-admin-write-rls.sql).
// It renders the same editable admin page components as the PC build, on the
// web data layer. Excel/PDF *import* (which needs the Electron file dialog)
// and email alerts stay PC-only; manual editing works here.
const TABS = [
  { key: "dashboard", label: "Dashboard", icon: "📊", Component: Dashboard },
  // Pilot Roster sits second (right of Dashboard); Daily Duty swapped down
  // into the FDT tab's own tab bar, where Pilot Roster used to be.
  { key: "pilotRoster", label: "Pilot Roster", icon: "🗓️", Component: PilotRoster },
  { key: "crews", label: "FDT", icon: "✈️", Component: FlightCrews },
  // Sits next to FDT: both answer "is this pilot fit to be assigned", FDT from
  // the hard limits and this from the company fatigue score (OPS-CM-01 7.17.3).
  { key: "fatigue", label: "Fatigue", icon: "😴", Component: FatigueMonitor },
  // Monthly FT/DT and fatigue statistics for internal review and for CAAT /
  // customer auditors. Sits next to Fatigue because it reports on the same
  // figures - one screen answers "is anyone at risk today", the other "what
  // did the last six months look like".
  { key: "statistics", label: "Statistics", icon: "📈", Component: FdtStatistics },
  { key: "training", label: "Training", icon: "🎓", Component: Training },
  // Same Logbook page the Crew app has (Capt. Weera: "tab logbook ใน admin
  // เหมือน ของ crew เลย แต่ยังเลือกชือนักบิน ได้ครับ"). No admin-specific
  // variant: the component already shows a pilot dropdown wherever
  // isSinglePilotDevice() is false, which is every build except Crew web - so
  // admin gets the selector for free and the two can never drift apart.
  { key: "logbook", label: "Logbook", icon: "📖", Component: MyLogbook },
  { key: "settings", label: "Settings", icon: "⚙️", Component: Settings },
  { key: "access", label: "Crew Access", icon: "🔑", Component: CrewAccess },
  { key: "utility", label: "Utility", icon: "🛠️", Component: CrewLoginMonitor }
];

// The tab names this build knows about, used to validate a remembered one.
const TAB_KEYS = TABS.map((t) => t.key);

// Injected by Vite from package.json's version (see vite.config.js).
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

const SYNC_LABEL = { connecting: "Connecting…", syncing: "Syncing…", online: "Online", offline: "Offline", unconfigured: "Not configured" };
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

export default function AdminWebApp() {
  const [session, setSession] = useState(undefined); // undefined=loading, null=logged out
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [tab, setTab] = useState(() => rememberedTab("avicore_admin_tab", "dashboard", TAB_KEYS));
  const [branding, setBranding] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ status: "connecting", lastSyncAt: null, lastError: null });
  // Remember which page is open, so a refresh comes back to it.
  useEffect(() => { rememberTab("avicore_admin_tab", tab); }, [tab]);
  // Button clicks make a short sound (utils/clickSound.js).
  useEffect(() => startClickSound(), []);
  // Queue runs app-wide, including before sign-in (see WebApp.jsx).
  useEffect(() => startOfflineQueue(), []);

  // Accept a session only if its email is on the allowlist - otherwise sign
  // it straight back out (a valid Supabase account that just isn't cleared
  // for admin, e.g. a Crew-side or other-project account) and show why.
  async function applySession(s) {
    if (s && !emailAllowed(s)) {
      setAuthError("This account isn't authorized for the admin site.");
      await signOutAdmin();
      setSession(null);
      return;
    }
    setSession(s);
  }

  // Closing the page signs the admin out: the session lives in sessionStorage
  // (see webDatabase.js), which the browser discards with the tab. Nothing to
  // do here beyond clearing an auth token left in localStorage by an older
  // build - without that, the previous long-lived session would sign the
  // person straight back in and the tab-close logout wouldn't take effect.
  //
  // The browser cache is deliberately NOT touched: Firebase Hosting already
  // serves the root and index.html with no-cache, so a fresh build is picked
  // up on reload anyway, and wiping Cache Storage on every load only made the
  // app slower to start.
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sb-") || key.includes("supabase.auth")) localStorage.removeItem(key);
      }
    } catch { /* storage blocked (private mode) - nothing to clean up */ }
  }, []);

  useEffect(() => {
    getAdminSession().then((s) => applySession(s));
    const off = onAdminAuthChange((event, s) => {
      // Only an explicit sign-out drops you back to the login screen. A
      // TOKEN_REFRESHED / USER_UPDATED / INITIAL_SESSION event that carries a
      // session just updates it; an event WITHOUT a session (but that isn't a
      // real sign-out) is ignored, so a background token refresh can't wipe
      // the screen while you're mid-edit (e.g. typing a pilot's password).
      if (event === "SIGNED_OUT") { setSession(null); return; }
      if (s) applySession(s);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeSyncStatus(setSyncStatus);
    pingServer();
    const interval = setInterval(pingServer, SYNC_POLL_MS);
    return () => { unsubscribe(); clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!session) return;
    getSetting("customer_branding").then((b) => setBranding(b || null)).catch(() => {});
  }, [session]);

  async function handleSignIn(e) {
    e.preventDefault();
    setSigningIn(true);
    setAuthError("");
    const res = await signInAdmin(email, password);
    setSigningIn(false);
    if (!res.ok) setAuthError(res.error || "Sign in failed.");
    // On success, onAdminAuthChange updates session automatically.
  }

  async function handleSignOut() {
    await signOutAdmin();
    setSession(null);
    setPassword("");
  }

  if (!isConfigured()) {
    return (
      // Plain .web-login, not LoginShell: Supabase is not configured here, so
      // the chosen background could not be fetched. CSS falls back to the
      // bundled photo.
      <div className="web-login">
        <div className="web-login-card">
          <h1>AviCore Enterprise</h1>
          <div className="web-login-status error">
            This admin web build isn't configured yet — it's missing its Supabase connection details.
          </div>
        </div>
      </div>
    );
  }

  if (session === undefined) {
    return <div className="web-loading">Loading...</div>;
  }

  if (!session) {
    return (
      <LoginShell className="admin-login" defaultBackground={adminLoginBg}>
        <span className="web-version-badge">v{APP_VERSION}</span>
        <div className="web-login-card admin-login-card">
          <div className="admin-login-accent" aria-hidden="true" />
          <div className="admin-login-kicker">
            <span>SECURE OPERATIONS CONSOLE</span>
            <b>ADMIN</b>
          </div>
          {/* Same layout as the Crew sign-in screen (see WebPilotLogin.jsx),
              which follows the AviCore Flight Planner reference. Admin really
              does sign in with an email and password - Supabase auth - so unlike
              Crew this one keeps the EMAIL field from the reference.
              No offline button here: admin sign-in is never cached on the device
              (see the note at the top of offlineLogin.js). */}
          <div className="login-brand">
            <span aria-hidden="true">✣</span>
            <div>
              <strong>AVI<span className="login-brand-core">CORE</span></strong>
              <small>ENTERPRISE · V{APP_VERSION}</small>
            </div>
          </div>
          <p className="login-series">ADMIN · MONITORING &amp; REPORTS</p>
          <h1>Welcome back<span className="admin-login-dot">.</span></h1>
          <p className="login-copy">Sign in to monitor operations, crew readiness and enterprise records.</p>

          <form onSubmit={handleSignIn}>
            <label>
              <span>EMAIL ADDRESS</span>
              <div className="admin-login-field">
                <i aria-hidden="true">@</i>
                <input
                  type="email" lang="en" autoComplete="username"
                  value={email} placeholder="admin@example.com"
                  onChange={(e) => { setEmail(e.target.value); setAuthError(""); }}
                />
              </div>
            </label>
            <label>
              <span>PASSWORD</span>
              <div className="login-password-field admin-login-field">
                <i aria-hidden="true">●</i>
                <input
                  type={showPassword ? "text" : "password"} lang="en" autoComplete="current-password"
                  value={password} placeholder="Password"
                  onChange={(e) => { setPassword(e.target.value); setAuthError(""); }}
                />
                <button
                  type="button" className="login-password-toggle" tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "HIDE" : "SHOW"}
                </button>
              </div>
            </label>
            {authError && <p className="login-message">{authError}</p>}
            <button className="login-primary" type="submit" disabled={signingIn || !email.trim() || !password}>
              <span>{signingIn ? "AUTHENTICATING…" : "ENTER ADMIN CONSOLE"}</span>
              <i aria-hidden="true">→</i>
            </button>
          </form>

          <div className="login-links">
            <span>Authorized users only</span>
          </div>

          {/* Full About details live in Settings → Admin Setting (after sign-in). */}
          <footer className="login-owner">
            <span>Copy Right © 2026</span>
            <strong>Capt. Weera Juntaklud</strong>
            <a href="mailto:freeman201@yahoo.com">freeman201@yahoo.com</a>
            <small>tel. 081-8406275</small>
          </footer>
        </div>
      </LoginShell>
    );
  }

  const Active = TABS.find((t) => t.key === tab)?.Component;

  const sidebarGroups = [
    { label: "Operations", items: [
      { key: "dashboard", label: "Dashboard", icon: "📊", active: tab === "dashboard", onClick: () => setTab("dashboard") },
      { key: "pilotRoster", label: "Pilot Roster", icon: "🗓️", active: tab === "pilotRoster", onClick: () => setTab("pilotRoster") },
    ]},
    { label: "Compliance", items: [
      { key: "crews", label: "FDT", icon: "✈️", active: tab === "crews", onClick: () => setTab("crews") },
      { key: "fatigue", label: "Fatigue", icon: "😴", active: tab === "fatigue", onClick: () => setTab("fatigue") },
      { key: "training", label: "Training", icon: "🎓", active: tab === "training", onClick: () => setTab("training") },
    ]},
    { label: "Reports", items: [
      { key: "statistics", label: "Statistics", icon: "📈", active: tab === "statistics", onClick: () => setTab("statistics") },
      { key: "logbook", label: "Logbook", icon: "📖", active: tab === "logbook", onClick: () => setTab("logbook") },
    ]},
    { label: "System", items: [
      { key: "settings", label: "Settings", icon: "⚙️", active: tab === "settings", onClick: () => setTab("settings") },
      { key: "access", label: "Crew Access", icon: "🔑", active: tab === "access", onClick: () => setTab("access") },
      { key: "utility", label: "Login Monitor", icon: "🛠️", active: tab === "utility", onClick: () => setTab("utility") },
      { key: "signout", label: "Sign Out", icon: "⏻", danger: true, onClick: handleSignOut },
    ]},
  ];

  return (
    <div className="web-app admin-shell">
      <OfflineBar />
      <ConflictDialog />
      <div className="web-body">
        <AppSidebar
          brand={{ icon: "✦", title: "AviCore Enterprise", subtitle: `ADMIN · v${APP_VERSION}` }}
          sync={{ status: syncStatus.status, label: SYNC_LABEL[syncStatus.status] || syncStatus.status }}
          groups={sidebarGroups}
          footItems={[{ key: "refresh", label: "Refresh", icon: "⟳", onClick: () => window.location.reload() }]}
        />
        <div className="web-main">
          <header className="web-header">
            <div className="web-header-brand">
              {branding?.logo ? (
                <img className="web-header-logo" src={branding.logo} alt="" />
              ) : (
                <span className="web-header-planeicon" aria-hidden="true">✦</span>
              )}
              <div className="web-header-titlegroup">
                <span className="web-header-title">AviCore Enterprise <span className="admin-web-badge admin-web-badge-edit">ADMIN</span></span>
                <span className="web-header-copyright">© Copyright 2026 @ Capt.Weera</span>
              </div>
            </div>
            <span className={`web-sync-status ${syncStatus.status}`}>
              <span className="web-sync-dot" />
              <span className="web-sync-label">{SYNC_LABEL[syncStatus.status] || syncStatus.status}</span>
            </span>
          </header>

          <main className="web-content">
            <ErrorBoundary key={tab}>
              {Active && <Active />}
            </ErrorBoundary>
          </main>

          {branding?.name && <div className="web-footer">{branding.name}</div>}
        </div>
      </div>
    </div>
  );
}
