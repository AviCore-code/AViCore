import { useEffect, useMemo, useState } from "react";
import { fetchPilotRoster, setPairedPilotCode, recordCrewLogin, pilotHasPassword, verifyPilotPassword } from "../services/webDatabase.js";
import {
  listOfflinePilots, verifyOffline, rememberCredential, forgetCredential,
  hasOfflineCredential, OFFLINE_LOGIN_REASONS, CREDENTIAL_TTL_DAYS
} from "../services/offlineLogin.js";
import { DEMO_PILOT_CODES } from "../config/demoUsers.js";
import LoginShell from "./LoginShell.jsx";
import "./WebApp.css";

const DEMO_SET = new Set((DEMO_PILOT_CODES || []).map((c) => String(c).toUpperCase()));

// Thai first, English under it - the same convention as OfflineBar.jsx, and for
// the same reason: the people who hit the offline path are pilots on a rig, not
// the admin at a desk.
const TEXT = {
  enterPassword: "กรุณาใส่รหัสผ่าน / Enter your password.",
  offlineButton: "OFFLINE LOGIN · THIS DEVICE",
  offlineHint: "Login ได้เฉพาะบัญชีที่เคยยืนยันออนไลน์บนเครื่องนี้",
  offlineHintEn: "Only for pilots who have signed in on this device with a connection."
};

// First-visit screen for the web build - same idea as the Android app's
// PilotLogin.jsx (pick yourself from the fleet roster rather than typing a
// code from memory), but talking straight to Supabase since there's no
// local cache to fall back to here. Normally needs a connection; if the roster
// cannot be fetched it falls back to offline sign-in against credentials this
// device remembers (see offlineLogin.js), unlike the Android app which is designed
// for offshore rigs with patchy signal.
export default function WebPilotLogin({ onPaired }) {
  // Work queued offline that has not reached the server. Shown HERE because
  // this is the screen someone sees when nobody is signed in - which is
  // exactly when an unsent duty entry is invisible and at risk of being
  // cleared with the browser data. It names the owner, so the right pilot
  // knows to sign in and let it drain.
  const [pendingByOwner, setPendingByOwner] = useState([]);

  useEffect(() => {
    let alive = true;
    import("../services/offlineQueue.js").then(async ({ pendingWrites }) => {
      const ops = await pendingWrites();
      if (!alive) return;
      const counts = new Map();
      for (const op of ops) counts.set(op.owner || "unknown", (counts.get(op.owner || "unknown") || 0) + 1);
      setPendingByOwner([...counts.entries()]);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  // True when the roster could not be fetched and this device is falling back to
  // the pilots it remembers from a previous online sign-in.
  const [offline, setOffline] = useState(false);
  const [pwError, setPwError] = useState("");
  // The browser's own view of the connection, which is available immediately -
  // unlike `offline`, which is only known once the roster fetch has failed. Used
  // for the "● OFFLINE" line so the screen says something true on arrival rather
  // than after a timeout. navigator.onLine lies in both directions (a captive
  // portal reports online), so it drives the NOTICE only, never the sign-in path.
  const [browserOffline, setBrowserOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false
  );

  useEffect(() => {
    const on = () => setBrowserOffline(false);
    const off = () => setBrowserOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    load();
  }, []);

  // A different pilot was picked - clear any half-typed password/error.
  useEffect(() => { setPassword(""); setPwError(""); }, [selected]);

  // Pin DEMO account(s) to the top of the name list so they're easy to find;
  // the rest keep their name order from the server.
  const orderedRoster = useMemo(() => {
    const isDemo = (p) => DEMO_SET.has((p.code || "").toUpperCase());
    return [...roster].sort((a, b) => (isDemo(b) ? 1 : 0) - (isDemo(a) ? 1 : 0));
  }, [roster]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPilotRoster();
      setRoster(list);
      setOffline(false);
    } catch (err) {
      // The roster could not be fetched. If this device has signed in before,
      // fall back to the pilots it remembers rather than showing a dead screen -
      // that is the whole point of offline sign-in (a pilot who signed out on a
      // rig with no signal could otherwise not get back in at all).
      const remembered = listOfflinePilots();
      if (remembered.length > 0) {
        setRoster(remembered);
        setOffline(true);
        setError(null);
      } else {
        setRoster([]);
        setOffline(false);
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  // OFFLINE SIGN-IN, on this device only.
  //
  // Checked against a PBKDF2 hash held on this device, saved the last time this
  // pilot signed in WITH a connection. Weaker than the server check by
  // definition; see offlineLogin.js for the four things that limit how much
  // weaker (no stored password, 210k iterations, 30-day expiry, 5-attempt
  // lockout).
  //
  // Reached two ways, which is the point of pulling it out of handleConfirm:
  //   - automatically, when the roster could not be fetched at all, and
  //   - by the pilot pressing "Offline sign-in", at any time.
  // The second exists because the automatic path only triggers when the roster
  // fetch FAILS. A rig with a live-but-dead uplink (a captive portal, a satellite
  // link that accepts the connection and then stalls) leaves the app believing it
  // is online, so it waits on a server check that will never answer and the pilot
  // cannot get in. A button they can press does not depend on us detecting the
  // network state correctly.
  //
  // Returns true when the pilot is signed in.
  async function signInOffline() {
    if (!password.trim()) { setPwError(TEXT.enterPassword); setSaving(false); return false; }
    try {
      const r = await verifyOffline(selected, password);
      if (!r.ok) {
        setPwError(
          (OFFLINE_LOGIN_REASONS[r.reason] || "Could not sign in.") +
          (r.attemptsLeft > 0 ? ` ${r.attemptsLeft} attempt(s) left before this device forgets the sign-in.` : "")
        );
        setPassword("");
        setSaving(false);
        if (r.reason === "locked" || r.reason === "expired") load();
        return false;
      }
    } catch (err) {
      setPwError("Could not sign in offline: " + err.message);
      setSaving(false);
      return false;
    }
    await setPairedPilotCode(selected);
    // recordCrewLogin is skipped: there is no connection to record it on, and
    // queuing a login event would file it at the wrong time. The audit trail is
    // honest about what it saw.
    onPaired(selected);
    return true;
  }

  // The explicit button. Kept separate from handleConfirm so pressing it never
  // touches the network, however healthy the app currently believes it to be.
  async function handleOfflineSignIn() {
    if (!selected) return;
    setSaving(true);
    setPwError("");
    await signInOffline();
  }

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    setPwError("");

    if (offline) {
      await signInOffline();
      return;
    }

    try {
      // Password gate: if the Admin has set a password for this pilot, it's
      // required. Pilots with no password set yet (e.g. during rollout) are
      // let straight through, so nobody is locked out before the Admin has
      // assigned them one. Verification is server-side (verify_pilot_password
      // RPC) - the stored hash never reaches the browser.
      const needsPw = await pilotHasPassword(selected);
      if (needsPw) {
        if (!password.trim()) { setPwError("Enter your password."); setSaving(false); return; }
        const ok = await verifyPilotPassword(selected, password);
        if (!ok) { setPwError("Incorrect password."); setPassword(""); setSaving(false); return; }
        // Remembered ONLY now: the server has just confirmed this password, so
        // storing a hash of it grants no new authority - it only lets the same
        // check run later without a connection. Also refreshes the 30 days.
        rememberCredential(selected, password, roster.find((p) => p.code === selected)?.name || "")
          .catch(() => { /* offline sign-in is a convenience; never block the login */ });
      } else {
        // No password set for this pilot, so there is nothing to verify offline
        // either. Any stale credential is dropped rather than left as a way in.
        forgetCredential(selected);
      }
    } catch (err) {
      // THE CONNECTION DROPPED BETWEEN LOADING THE PAGE AND PRESSING SIGN IN.
      //
      // The `offline` flag is set when the roster fetch fails, which only
      // happens on page load. A pilot who opens the app in the crew room and
      // presses Sign In after walking out to the aircraft takes this path
      // instead: online flag still true, but the RPC cannot reach the server
      // ("Failed to fetch"). Reported as an unhelpful "Could not verify
      // password" until now.
      //
      // If this device remembers the pilot, fall through to the offline check
      // rather than refusing - the pilot's situation is identical to having
      // loaded the page offline, so the outcome should be too.
      if (hasOfflineCredential(selected)) {
        setOffline(true);   // so the screen explains itself if the check fails
        await signInOffline();   // reports its own errors and clears `saving`
        return;
      }

      // Nothing stored for this pilot, so there is genuinely no way in from
      // here. Say what the actual problem is - a connection - rather than
      // implying the password was wrong.
      const noNetwork = /failed to fetch|networkerror|load failed/i.test(err.message || "");
      setPwError(
        noNetwork
          ? "No connection to the server, and this device has no saved sign-in for that pilot. Sign in once with a connection first."
          : "Could not verify password: " + err.message
      );
      setSaving(false);
      return;
    }
    await setPairedPilotCode(selected);
    // Log this "opened Crew" event for the admin Utility monitor - fire and
    // forget, never blocks the pilot from getting in (recordCrewLogin
    // swallows its own errors).
    const picked = roster.find((p) => p.code === selected);
    recordCrewLogin(selected, picked?.name || "");
    onPaired(selected);
  }

  return (
    <LoginShell>
      <span className="web-version-badge">v{__APP_VERSION__}</span>

      <div className="web-login-card">
        {/* Laid out to match AviCore Flight Planner's sign-in screen (Capt.
            Weera supplied it as the reference): brand mark and wordmark, a
            product line, "Welcome back", uppercase field labels, then a primary
            cyan action with an amber offline action beneath it.
            What is NOT copied is how sign-in works. Flight Planner uses Firebase
            email + password; Crew pairs a browser to ONE pilot chosen from the
            fleet roster, because pilots here have no individual accounts. So the
            first field is PILOT, not EMAIL. */}
        <div className="login-brand">
          <span aria-hidden="true">✣</span>
          <div>
            <strong>AVICORE</strong>
            <small>CREW · V{__APP_VERSION__}</small>
          </div>
        </div>
        <p className="login-series">FLIGHT CREW · DUTY · ROSTER · TRAINING</p>
        <h1>Welcome back</h1>
        <p className="login-copy">Sign in to continue to your duty and roster records.</p>

        {/* Said plainly, because the two paths are not equivalent: offline the
            password is checked against a copy held on this device, and only
            pilots who have signed in here before appear at all. A pilot who
            cannot find their name needs to know it is the device, not them. */}
        {offline && (
          <div className="web-login-offline">
            <b>No connection — signing in offline.</b> Only pilots who have signed in
            on this device before are listed, and the password is checked against a copy
            saved here. It stays valid for {CREDENTIAL_TTL_DAYS} days from the last
            sign-in with a connection.
          </div>
        )}

        {pendingByOwner.length > 0 && (
          <div className="web-login-pending">
            <b>Unsent work on this device</b>
            <ul>
              {pendingByOwner.map(([owner, count]) => (
                <li key={owner}>{owner}: {count} change{count === 1 ? "" : "s"}</li>
              ))}
            </ul>
            <small>Sign in as that pilot with a connection to send it. Clearing this browser's data will lose it.</small>
          </div>
        )}

        {loading && <div className="web-login-status">Loading pilot list...</div>}

        {/* The roster could not be fetched AND this device remembers nobody, so
            there is genuinely no way in from here - offline sign-in needs a
            previous online sign-in on this same browser. Said plainly, rather
            than leaving a pilot pressing Try Again wondering what is wrong. */}
        {!loading && error && (
          <>
            <div className="web-login-status error">Could not load the pilot list: {error}</div>
            <div className="web-login-status">
              This device has no saved sign-in for anyone, so it cannot sign in offline.
              A pilot must sign in here once with a connection first.
            </div>
            <button onClick={load}>Try Again</button>
          </>
        )}

        {!loading && !error && roster.length === 0 && (
          <div className="web-login-status error">No pilots found yet — ask your Admin to add your Pilot Experience record first.</div>
        )}

        {!loading && !error && roster.length > 0 && (
          // A real <form>, so Enter submits and password managers behave. The
          // pilot dropdown replaces Flight Planner's EMAIL field.
          <form onSubmit={(e) => { e.preventDefault(); if (!saving) handleConfirm(); }}>
            <label>
              <span>PILOT</span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">-- Select your name --</option>
                {orderedRoster.map((p) => (
                  <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
                ))}
              </select>
            </label>

            {selected && (
              <label>
                <span>PASSWORD</span>
                <input
                  type="password" lang="en" autoComplete="current-password"
                  value={password}
                  placeholder="Password (if set by your admin)"
                  onChange={(e) => { setPassword(e.target.value); setPwError(""); }}
                />
              </label>
            )}

            {pwError && <p className="login-message">{pwError}</p>}

            <button className="login-primary" disabled={!selected || saving}>
              {saving ? "PLEASE WAIT…" : "SIGN IN"}
            </button>

            {/* EXPLICIT OFFLINE SIGN-IN.
                Only shown once a pilot is selected AND this device actually holds
                a credential for them - offering it otherwise would invite a pilot
                to press a button that cannot possibly work, and then blame their
                password. type="button" so it never submits the form.
                Hidden when already in offline mode, where SIGN IN does the same
                thing and a second button would only confuse. */}
            {selected && !offline && hasOfflineCredential(selected) && (
              <button
                className="login-offline" type="button"
                disabled={saving} onClick={handleOfflineSignIn}
              >
                {TEXT.offlineButton}
              </button>
            )}
          </form>
        )}

        {/* Status line under the form, like the reference. Shown whenever this
            browser cannot reach the server, whether that was detected at load or
            reported by the operating system. */}
        {(offline || browserOffline) && (
          <p className="offline-login-hint">
            ● OFFLINE · {TEXT.offlineHint}
          </p>
        )}

        <div className="login-links">
          <span>Authorized users only</span>
          {/* Crew has no self-service password reset - pilots have no accounts of
              their own, and the Admin sets the password. Says who to ask instead
              of offering a link that cannot work. */}
          <span className="login-links-muted">Password set by your Admin</span>
        </div>

        {/* Moved INSIDE the card, as in the reference. The old floating credit
            line sat in the bottom-right corner of the screen; it carried a phone
            number, kept here so nothing is lost. */}
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
