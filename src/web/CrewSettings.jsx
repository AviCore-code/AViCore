import { useEffect, useState } from "react";
import { getCrewDisplay, setCrewDisplay } from "./crewDisplay.js";
import { prefetchForOffline, PREFETCH_COVERAGE } from "../services/offlinePrefetch.js";
import { getPairedPilotCode } from "../services/webDatabase.js";
import { credentialStatus, forgetCredential } from "../services/offlineLogin.js";
import "./CrewSettings.css";

// Pilot-facing Settings tab for the AviCore Crew web app: read-only app info
// (About) plus per-browser display preferences (text size + screen
// brightness/contrast). Nothing here writes to Supabase.
const TEXT_OPTIONS = [
  { key: "small", label: "Small" },
  { key: "normal", label: "Normal" },
  { key: "large", label: "Large" },
  { key: "xlarge", label: "Extra Large" }
];
const SCREEN_OPTIONS = [
  { key: "normal", label: "Normal" },
  { key: "bright", label: "Brighter" },
  { key: "dim", label: "Dimmer" },
  { key: "contrast", label: "High Contrast" }
];

export default function CrewSettings() {
  // "Prepare for offline". Pressing through every page by hand does NOT give
  // full offline coverage: the roster and weekly plan cache per date range,
  // so opening this week caches this week only. This fetches the whole
  // window in one go, which is the difference between an app that works
  // offshore and one that half-works.
  const [prep, setPrep] = useState({ running: false, done: 0, total: 0, label: "", result: null });

  async function handlePrepare() {
    setPrep({ running: true, done: 0, total: 0, label: "Starting…", result: null });
    try {
      const code = String((await getPairedPilotCode()) || "").toUpperCase();
      const result = await prefetchForOffline(code, ({ done, total, label }) =>
        setPrep((p) => ({ ...p, done, total, label }))
      );
      setPrep((p) => ({ ...p, running: false, result }));
    } catch (err) {
      setPrep((p) => ({ ...p, running: false, result: { ok: false, failed: [{ label: "Download", error: err.message }] } }));
    }
  }

  const [pilotCode, setPilotCode] = useState("");
  const [display, setDisplay] = useState(getCrewDisplay());
  // Whether this device can sign this pilot in without a connection, and for
  // how much longer. Null until the pilot code is known.
  const [cred, setCred] = useState(null);

  function handleForgetCredential() {
    if (!pilotCode) return;
    if (!confirm(
      "Remove the offline sign-in from this device?\n\n" +
      "You will need a connection to sign in here again."
    )) return;
    forgetCredential(pilotCode);
    setCred(credentialStatus(pilotCode));
  }

  useEffect(() => { getPairedPilotCode().then(setPilotCode).catch(() => {}); }, []);
  // Read once the pilot code is known - credentialStatus is keyed by pilot, so
  // it cannot be looked up before then.
  useEffect(() => {
    if (pilotCode) setCred(credentialStatus(pilotCode));
  }, [pilotCode]);

  function choose(patch) {
    const next = { ...display, ...patch };
    setDisplay(next);
    setCrewDisplay(patch);
  }

  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

  return (
    <div className="crewset-page">
      <h1 className="crewset-title">Settings</h1>

      <section className="crewset-card">
        <h2>Offline</h2>
        <p className="crewset-note">
          Download everything to this device so the app keeps working with no signal —
          your duty records, the roster, and the flying programme for the next{" "}
          {PREFETCH_COVERAGE.weeksAhead} weeks. Do this before you go offshore.
        </p>

        <div className="crewset-row">
          <span className="crewset-label">Prepare for offline</span>
          <div className="crewset-choices">
            <button onClick={handlePrepare} disabled={prep.running}>
              {prep.running ? "Downloading…" : "Download now"}
            </button>
          </div>
        </div>

        {prep.running && (
          <div className="crewset-prep">
            <div className="crewset-prep-bar">
              <i style={{ width: `${prep.total ? Math.round((prep.done / prep.total) * 100) : 0}%` }} />
            </div>
            <small>{prep.done} / {prep.total} · {prep.label}</small>
          </div>
        )}

        {prep.result && !prep.running && (
          prep.result.ok
            ? <p className="crewset-prep-ok">Ready for offline — {prep.result.done} item(s) saved to this device.</p>
            : (
              <div className="crewset-prep-warn">
                <b>Partly ready.</b> {prep.result.failed.length} item(s) could not be downloaded:
                <ul>{prep.result.failed.slice(0, 5).map((f, i) => <li key={i}>{f.label} — {f.error}</li>)}</ul>
                Everything else is saved. Try again when the connection is better.
              </div>
            )
        )}

        {/* OFFLINE SIGN-IN.
            Shown here so the pilot knows this device can be signed into without
            a connection, and can remove that ability before handing it on -
            waiting 30 days for it to expire is not good enough on a shared
            tablet. Only appears once there is something to report. */}
        {cred?.stored && (
          <>
            <div className="crewset-row">
              <span className="crewset-label">Offline sign-in</span>
              <div className="crewset-choices">
                <button onClick={handleForgetCredential}>Remove from this device</button>
              </div>
            </div>
            <p className="crewset-note">
              This device can sign you in without a connection for{" "}
              <b>{cred.daysLeft} more day{cred.daysLeft === 1 ? "" : "s"}</b>. Your
              password is not stored — only a scrambled copy that cannot be turned back
              into it. Remove it before lending this device to anyone.
            </p>
          </>
        )}
      </section>

      <section className="crewset-card">
        <h2>Display</h2>
        <p className="crewset-note">Applies to this browser only — pick what's easiest to read on your device.</p>

        <div className="crewset-row">
          <span className="crewset-label">Text Size</span>
          <div className="crewset-choices">
            {TEXT_OPTIONS.map((o) => (
              <button key={o.key} className={display.text === o.key ? "active" : ""} onClick={() => choose({ text: o.key })}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className="crewset-row">
          <span className="crewset-label">Screen</span>
          <div className="crewset-choices">
            {SCREEN_OPTIONS.map((o) => (
              <button key={o.key} className={display.screen === o.key ? "active" : ""} onClick={() => choose({ screen: o.key })}>{o.label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="crewset-card">
        <h2>About</h2>
        <div className="crewset-about">
          <div><span>App</span><b>AviCore Crew</b></div>
          <div><span>Version</span><b>v{version || "—"}</b></div>
          <div><span>Signed in as</span><b>{pilotCode || "—"}</b></div>
          <div><span>Copyright</span><b>© 2026 Capt. Weera Juntaklud</b></div>
        </div>
        <p className="crewset-note">Flight &amp; duty data comes from your company's central records. If something looks wrong, contact your Admin.</p>
      </section>
    </div>
  );
}
