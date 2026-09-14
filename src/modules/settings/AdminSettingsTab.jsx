import { useEffect, useState } from "react";
import { getSyncConfig, setSyncConfig, clearSyncConfig, syncNow, getSyncStatus, getSetting, saveSetting, getHardwareId, copyHardwareId, getLicenseStatus, getEmailConfig, setEmailConfig, sendTestEmail, hasAdminPin, setAdminPin, getAppVersion, checkForUpdates, downloadUpdate, installUpdate, onUpdateEvent, listDevices, isWeb } from "../../services/desktopDatabase.js";
import { isClickSoundOn, setClickSoundOn, playClick, CLICK_TONES, getClickTone, setClickTone } from "../../utils/uiSound.js";
import { BACKGROUND_PRESETS } from "../../components/backgroundThemes/presets.jsx";
import ThemeScene from "../../components/backgroundThemes/ThemeScene.jsx";
import { ADMIN_LOCK_ENABLED } from "../../config/adminLock.js";
import { formatDueDate } from "../../utils/trainingDue.js";
import ServerBackupPanel from "./ServerBackupPanel.jsx";
import "./Settings.css";

// Injected by Vite from package.json's version (see vite.config.js). Guarded
// so this file still renders if the define is ever missing.
const WEB_APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

// App-wide/system settings - Central Sync, Sound, Branding, Background
// Theme, Email Notifications, Admin PIN, Software Update, and License/About.
// None of these are about flight crew data specifically (that's
// FlightCrewSettingsTab.jsx - FTL Limits and Fleet Configuration), so they're
// grouped here under their own "Admin Setting" tab.
export default function AdminSettingsTab() {
  const [config, setConfig] = useState({ configured: false, url: "" });
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null);

  const [clickSound, setClickSound] = useState(isClickSoundOn());
  const [clickTone, setClickToneState] = useState(getClickTone());

  const [branding, setBranding] = useState({ name: "", logo: "" });
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState(null);

  const [hardwareId, setHardwareId] = useState("");
  const [license, setLicense] = useState({ valid: false });
  const [hwidCopied, setHwidCopied] = useState(false);

  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const ONLINE_AFTER_MINUTES = 10;

  function deviceOnline(lastSeenAt) {
    if (!lastSeenAt) return false;
    return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_AFTER_MINUTES * 60 * 1000;
  }

  function formatLastSeen(iso) {
    if (!iso) return "Never";
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  async function refreshDevices() {
    setDevicesLoading(true);
    try {
      const list = await listDevices();
      setDevices(list || []);
    } finally {
      setDevicesLoading(false);
    }
  }

  // Short "project ref" from a Supabase URL (https://xxxxxxxx.supabase.co ->
  // xxxxxxxx) so the Connected Devices table can show which project a
  // device is on without a long URL taking up the whole row.
  function projectRef(url) {
    if (!url) return "—";
    const match = String(url).match(/https?:\/\/([^./]+)\.supabase\.co/i);
    return match ? match[1] : url;
  }

  // A device pointed at a different Supabase project than the machine
  // currently viewing this page is exactly why data stops matching between
  // PCs (e.g. a client machine set up with the wrong URL) - flag it clearly
  // rather than just silently listing it as "connected".
  function deviceOnDifferentProject(deviceUrl) {
    return !!deviceUrl && !!config.url && deviceUrl !== config.url;
  }

  const [pinExists, setPinExists] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [pinMsg, setPinMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refreshPinExists() {
    setPinExists(await hasAdminPin());
  }

  async function handleSavePin() {
    setPinMsg(null);
    if (newPin.trim().length < 4) { setPinMsg({ ok: false, text: "PIN must be at least 4 characters." }); return; }
    if (newPin.trim() !== confirmPin.trim()) { setPinMsg({ ok: false, text: "PIN and confirmation do not match." }); return; }
    setSavingPin(true);
    try {
      const result = await setAdminPin(newPin.trim(), currentPin.trim());
      if (result.ok) {
        setPinMsg({ ok: true, text: pinExists ? "Admin PIN changed." : "Admin PIN set — the Admin menu group is now locked on every device." });
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
        await refreshPinExists();
        window.dispatchEvent(new CustomEvent("admin-pin-updated"));
      } else {
        setPinMsg({ ok: false, text: result.error || "Could not save PIN." });
      }
    } finally {
      setSavingPin(false);
    }
  }

  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState({ phase: "idle", version: "", percent: 0, error: "" });

  async function refreshAppVersion() {
    setAppVersion(await getAppVersion());
  }

  useEffect(() => {
    const unsubscribe = onUpdateEvent((evt) => {
      if (evt.type === "checking") setUpdateState({ phase: "checking", version: "", percent: 0, error: "" });
      else if (evt.type === "available") setUpdateState({ phase: "available", version: evt.version, percent: 0, error: "" });
      else if (evt.type === "not-available") setUpdateState({ phase: "up-to-date", version: "", percent: 0, error: "" });
      else if (evt.type === "progress") setUpdateState((prev) => ({ ...prev, phase: "downloading", percent: evt.percent }));
      else if (evt.type === "downloaded") setUpdateState((prev) => ({ ...prev, phase: "downloaded", version: evt.version || prev.version }));
      else if (evt.type === "error") setUpdateState({ phase: "error", version: "", percent: 0, error: evt.message });
    });
    return unsubscribe;
  }, []);

  async function handleCheckForUpdates() {
    setUpdateState({ phase: "checking", version: "", percent: 0, error: "" });
    const result = await checkForUpdates();
    if (!result.ok) setUpdateState({ phase: "error", version: "", percent: 0, error: result.error });
  }

  async function handleDownloadUpdate() {
    setUpdateState((prev) => ({ ...prev, phase: "downloading", percent: 0 }));
    const result = await downloadUpdate();
    if (!result.ok) setUpdateState({ phase: "error", version: "", percent: 0, error: result.error });
  }

  async function handleInstallUpdate() {
    if (!confirm("AviCore will close and reopen to finish installing the update. Continue?")) return;
    await installUpdate();
  }

  // LOGIN-SCREEN background, not the in-app one.
  //
  // Stored under its own key, `login_background`, deliberately NOT the
  // `background_theme` key the PC build's AppBackground reads. The two are
  // different jobs: this picture is the first thing anyone sees and has only a
  // sign-in card over it, whereas the in-app backdrop sits behind duty hours and
  // fatigue scores. Sharing one key would mean changing the login photo silently
  // restyled every FTL page on every PC.
  //
  // "preset" here means one of the bundled photos/scenes; the login screen falls
  // back to the built-in sunset photo when nothing is saved, so a fresh install
  // still looks finished.
  const [theme, setTheme] = useState({ mode: "default", presetId: "offshore-sunset", customImage: "" });
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeMsg, setThemeMsg] = useState(null);

  async function refreshTheme() {
    const saved = await getSetting("login_background");
    setTheme(saved || { mode: "default", presetId: "offshore-sunset", customImage: "" });
  }

  // Same client-side resize as the logo upload - a full-res photo would be
  // wasteful to keep as a data URL in a synced settings row.
  function handleThemeImageFile(file) {
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const maxW = 1600;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        setTheme({ mode: "custom", presetId: theme.presetId, customImage: canvas.toDataURL("image/jpeg", 0.82) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveTheme() {
    setSavingTheme(true);
    setThemeMsg(null);
    try {
      await saveSetting("login_background", theme);
      window.dispatchEvent(new CustomEvent("background-updated"));
      setThemeMsg({ ok: true, text: "Login background saved. Sign out to see it, or reload the sign-in page." });
    } catch (err) {
      setThemeMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSavingTheme(false);
    }
  }

  const [emailCfg, setEmailCfg] = useState({ enabled: false, smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", hasPassword: false, fromAddress: "", toAddress: "" });
  const [emailPass, setEmailPass] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState(null);
  const [testingEmail, setTestingEmail] = useState(false);

  async function refreshEmailConfig() {
    setEmailCfg(await getEmailConfig());
  }

  async function handleSaveEmail() {
    setSavingEmail(true);
    setEmailMsg(null);
    try {
      await setEmailConfig({ ...emailCfg, smtpPass: emailPass });
      setEmailPass("");
      await refreshEmailConfig();
      setEmailMsg({ ok: true, text: "Email settings saved." });
    } catch (err) {
      setEmailMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSavingEmail(false);
    }
  }

  async function handleSendTestEmail() {
    setTestingEmail(true);
    setEmailMsg(null);
    const result = await sendTestEmail();
    setEmailMsg(result.ok ? { ok: true, text: "Test email sent — check the inbox." } : { ok: false, text: "Send failed: " + result.error });
    setTestingEmail(false);
  }

  async function refreshLicense() {
    const [hwid, lic] = await Promise.all([getHardwareId(), getLicenseStatus()]);
    setHardwareId(hwid);
    setLicense(lic);
  }

  async function handleCopyHwid() {
    await copyHardwareId(hardwareId);
    setHwidCopied(true);
    setTimeout(() => setHwidCopied(false), 1500);
  }

  function formatExpiry(iso) {
    if (!iso) return "No expiry";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return formatDueDate(d);
  }

  function handleToggleClickSound(on) {
    setClickSoundOn(on);
    setClickSound(on);
    if (on) playClick();
  }

  function handleChangeTone(id) {
    setClickTone(id);
    setClickToneState(id);
    playClick(id); // preview the newly selected tone immediately
  }

  async function refreshBranding() {
    const saved = await getSetting("customer_branding");
    setBranding(saved || { name: "", logo: "" });
  }

  // Resize client-side to a small max width before storing - a phone-camera
  // photo of a logo can be several MB, which is wasteful to keep as a data
  // URL in a synced settings row that every device pulls on every sync.
  function handleLogoFile(file) {
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const maxW = 240;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        setBranding((prev) => ({ ...prev, logo: canvas.toDataURL("image/png") }));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveBranding() {
    setSavingBranding(true);
    setBrandingMsg(null);
    try {
      await saveSetting("customer_branding", branding);
      window.dispatchEvent(new CustomEvent("branding-updated"));
      setBrandingMsg({ ok: true, text: "Branding saved." });
    } catch (err) {
      setBrandingMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSavingBranding(false);
    }
  }

  async function refresh() {
    const [c, s] = await Promise.all([getSyncConfig(), getSyncStatus()]);
    setConfig(c);
    setStatus(s);
    if (c.url) setUrl(c.url);
  }

  useEffect(() => { refresh(); refreshBranding(); refreshLicense(); refreshEmailConfig(); refreshTheme(); refreshPinExists(); refreshAppVersion(); refreshDevices(); }, []);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      await setSyncConfig(url, serviceKey);
      setServiceKey("");
      setMsg({ ok: true, text: "Settings saved. Testing connection..." });
      await refresh();
      const result = await syncNow();
      setMsg(result.ok
        ? { ok: true, text: `Connected — push ${result.pushed} / pull ${result.pulled} records` }
        : { ok: false, text: `Saved, but connection failed: ${result.error}` });
      await refresh();
      await refreshDevices();
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMsg(null);
    const result = await syncNow();
    setMsg(result.ok
      ? { ok: true, text: `Sync succeeded — push ${result.pushed} / pull ${result.pulled} records` }
      : { ok: false, text: "Sync failed: " + result.error });
    await refresh();
    await refreshDevices();
    setTesting(false);
  }

  async function handleClear() {
    if (!confirm("Disconnect Central Sync? This device will go back to local-only.")) return;
    await clearSyncConfig();
    setUrl("");
    setServiceKey("");
    setMsg({ ok: true, text: "Connection settings cleared." });
    await refresh();
  }

  return (
    <div className={fullScreen ? "page-fullscreen" : ""}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      {/* Web/admin build only: this reads and writes the Supabase tables
          directly. The PC build keeps its own local database and has its own
          backup path, so offering this there would imply it backs up something
          it does not. */}
      {isWeb() && (
        <div className="settings-card settings-card-wide">
          <ServerBackupPanel />
        </div>
      )}
      {!isWeb() && (
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Central Sync Setup</h2>
            <p>Connect this device to the central database (Supabase) so Pilot Experience, Training, and Daily Duty data from every device stays in sync — offline still works as normal; data syncs automatically once online.</p>
          </div>
        </div>

        <div className={`settings-status settings-status-${config.configured ? "on" : "off"}`}>
          {config.configured ? `✓ Connected — ${config.url}` : "Central Sync is not configured (this device is local-only)"}
        </div>

        <label className="settings-field">
          <span>Supabase Project URL</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxxxxxx.supabase.co" />
        </label>

        <label className="settings-field">
          <span>Supabase Service Role Key</span>
          <input
            type="password" value={serviceKey} onChange={(e) => setServiceKey(e.target.value)}
            placeholder={config.configured ? "•••••••• (only re-enter to change it)" : "Paste the service_role key from Supabase → Settings → API"}
          />
        </label>

        <div className="settings-note">
          Get both values from your Supabase Dashboard → Settings → API — <b>the service_role key has full access to all data.</b> Keep it as secret as an admin password; never share it with anyone who doesn't need it.
        </div>

        <div className="settings-actions">
          <button className="primary" onClick={handleSave} disabled={saving || !url.trim() || (!serviceKey.trim() && !config.configured)}>
            {saving ? "Saving..." : "Save and Connect"}
          </button>
          {config.configured && (
            <>
              <button onClick={handleTest} disabled={testing}>{testing ? "Syncing..." : "Test Sync Now"}</button>
              <button className="danger" onClick={handleClear}>Disconnect</button>
            </>
          )}
        </div>

        {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

        {status && config.configured && (
          <div className="settings-detail">
            Pending sync: {status.pending} · Last sync: {status.lastSyncAt || "never"}
            {status.lastError ? ` · Last error: ${status.lastError}` : ""}
          </div>
        )}
      </div>
      )}

      {!isWeb() && (
      <div className="settings-card settings-card-wide">
        <div className="module-header settings-subheader">
          <div>
            <h2>Connected Devices</h2>
            <p>Every PC install and paired pilot phone that has synced with Central Sync, and when it was last seen. A device shows Online if it checked in within the last {ONLINE_AFTER_MINUTES} minutes.</p>
          </div>
        </div>

        <div className="settings-actions">
          <button onClick={refreshDevices} disabled={devicesLoading}>{devicesLoading ? "Refreshing..." : "Refresh"}</button>
        </div>

        {!config.configured ? (
          <div className="settings-status settings-status-off">Connect Central Sync above to see connected devices.</div>
        ) : devices.length === 0 ? (
          <div className="settings-status settings-status-off">{devicesLoading ? "Loading..." : "No devices have synced yet."}</div>
        ) : (
          <>
            {devices.some((d) => deviceOnDifferentProject(d.supabase_url)) && (
              <div className="settings-msg error">
                ⚠ Some devices below are connected to a <b>different Supabase project</b> than this machine — that's a common cause of data not matching between PCs. Fix their Central Sync URL to match this one: <code>{config.url}</code>
              </div>
            )}
            <table className="settings-devices-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Device</th>
                  <th>Pilot</th>
                  <th>Supabase Project</th>
                  <th>Last Seen</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const mismatch = deviceOnDifferentProject(d.supabase_url);
                  return (
                    <tr key={d.device_id} className={mismatch ? "settings-devices-row-warn" : ""}>
                      <td className="settings-devices-icon">{d.device_type === "android" ? "📱" : "💻"}</td>
                      <td>{d.device_name || "—"}{d.app_version ? ` (v${d.app_version})` : ""}</td>
                      <td>{d.pilot_name || (d.pilot_code ? d.pilot_code : "—")}</td>
                      <td>
                        {projectRef(d.supabase_url)}
                        {mismatch && <span className="settings-devices-mismatch" title={d.supabase_url}> ⚠ different project</span>}
                      </td>
                      <td>{formatLastSeen(d.last_seen_at)}</td>
                      <td>
                        <span className={`settings-devices-dot ${deviceOnline(d.last_seen_at) ? "online" : "offline"}`} />
                        {deviceOnline(d.last_seen_at) ? "Online" : "Offline"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
      )}

      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Sound</h2>
            <p>Button click feedback sound. This setting is per-machine and is not synced to other devices.</p>
          </div>
        </div>
        <label className="settings-toggle">
          <input type="checkbox" checked={clickSound} onChange={(e) => handleToggleClickSound(e.target.checked)} />
          <span>Enable button click sound</span>
        </label>
        <label className="settings-tone">
          <span>Tone (plays a preview when selected)</span>
          <select value={clickTone} disabled={!clickSound} onChange={(e) => handleChangeTone(e.target.value)}>
            {CLICK_TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Branding</h2>
            <p>Customer company name and logo, shown top-right on every page. Synced to every device.</p>
          </div>
        </div>
        <label className="settings-field">
          <span>Company Name</span>
          <input value={branding.name} onChange={(e) => setBranding({ ...branding, name: e.target.value })} placeholder="e.g. United Offshore Aviation" />
        </label>
        <div className="settings-field">
          <span>Logo</span>
          <div className="settings-logo-row">
            {branding.logo && <img className="settings-logo-preview" src={branding.logo} alt="Logo preview" />}
            <input type="file" accept="image/*" onChange={(e) => handleLogoFile(e.target.files?.[0])} />
            {branding.logo && <button onClick={() => setBranding({ ...branding, logo: "" })}>Remove logo</button>}
          </div>
        </div>
        <div className="settings-actions">
          <button className="primary" onClick={handleSaveBranding} disabled={savingBranding}>{savingBranding ? "Saving..." : "Save Branding"}</button>
        </div>
        {brandingMsg && <div className={`settings-msg ${brandingMsg.ok ? "ok" : "error"}`}>{brandingMsg.text}</div>}
      </div>

      {/* Shown on EVERY build, unlike most cards on this tab.
          It used to be behind !isWeb(), which also hid it from the Enterprise
          Web admin (isWeb() covers both mode "web" and mode "admin") - so an
          admin working in the browser had no way to change this at all. Nothing
          here needs Electron: it reads and writes a synced setting like the
          Branding card above, and the photo upload is a canvas/data-URL rather
          than a file path. */}
      <div className="settings-card settings-card-wide">
        <div className="module-header settings-subheader">
          <div>
            <h2>Sign-in Screen Background</h2>
            <p>
              The picture behind the sign-in card on AviCore Crew and Enterprise Web —
              the first thing anyone sees. Pick a built-in photo or scene, or upload your
              own. Synced to every device. The app pages themselves stay plain, so duty
              hours and fatigue figures are never competing with a picture.
            </p>
          </div>
        </div>

        <div className="settings-theme-grid">
          {/* "Default", not "None": this is the photo the app ships with. A blank
              sign-in screen behind a single card looks unfinished rather than
              deliberate, so there is no "no background" option here - unlike the
              in-app backdrop, where None was genuinely useful. */}
          <button
            type="button"
            className={`settings-theme-tile settings-theme-none${theme.mode === "default" ? " selected" : ""}`}
            onClick={() => setTheme({ ...theme, mode: "default" })}
          >
            <span>Default photo</span>
          </button>
          {BACKGROUND_PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`settings-theme-tile${theme.mode === "preset" && theme.presetId === p.id ? " selected" : ""}`}
              onClick={() => setTheme({ ...theme, mode: "preset", presetId: p.id })}
              title={p.name}
            >
              <ThemeScene Component={p.Component} image={p.image} className="settings-theme-thumb" />
              <span>{p.name}</span>
            </button>
          ))}
          <label className={`settings-theme-tile settings-theme-upload${theme.mode === "custom" ? " selected" : ""}`}>
            {theme.mode === "custom" && theme.customImage
              ? <img className="settings-theme-thumb" src={theme.customImage} alt="" />
              : <span className="settings-theme-upload-icon">+</span>}
            <span>{theme.mode === "custom" ? "Your Photo" : "Upload Photo"}</span>
            <input type="file" accept="image/*" hidden onChange={(e) => handleThemeImageFile(e.target.files?.[0])} />
          </label>
        </div>

        <div className="settings-actions">
          <button className="primary" onClick={handleSaveTheme} disabled={savingTheme}>{savingTheme ? "Saving..." : "Save Sign-in Background"}</button>
        </div>
        {themeMsg && <div className={`settings-msg ${themeMsg.ok ? "ok" : "error"}`}>{themeMsg.text}</div>}
      </div>

      {!isWeb() && (
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Email Notifications</h2>
            <p>Sends an email when a new WARNING or EXCEEDED item first appears on the Dashboard - each item only triggers once, not every time the app opens. SMTP credentials are stored on this device only, never synced.</p>
          </div>
        </div>

        <label className="settings-toggle">
          <input type="checkbox" checked={emailCfg.enabled} onChange={(e) => setEmailCfg({ ...emailCfg, enabled: e.target.checked })} />
          <span>Enable email notifications</span>
        </label>

        <label className="settings-field">
          <span>Notification Recipients (comma-separated, up to 10)</span>
          <input value={emailCfg.toAddress} onChange={(e) => setEmailCfg({ ...emailCfg, toAddress: e.target.value })} placeholder="dispatch@uoathai.com, ops@uoathai.com" />
        </label>
        {emailCfg.toAddress.split(",").filter((a) => a.trim()).length > 10 && (
          <div className="settings-msg error">Too many recipients ({emailCfg.toAddress.split(",").filter((a) => a.trim()).length}) - max 10 allowed.</div>
        )}

        <div className="settings-ftl-grid">
          <label className="settings-field">
            <span>SMTP Host</span>
            <input value={emailCfg.smtpHost} onChange={(e) => setEmailCfg({ ...emailCfg, smtpHost: e.target.value })} placeholder="smtp.gmail.com" />
          </label>
          <label className="settings-field">
            <span>SMTP Port</span>
            <input type="number" value={emailCfg.smtpPort} onChange={(e) => setEmailCfg({ ...emailCfg, smtpPort: Number(e.target.value) })} placeholder="587" />
          </label>
          <label className="settings-field">
            <span>SMTP Username</span>
            <input value={emailCfg.smtpUser} onChange={(e) => setEmailCfg({ ...emailCfg, smtpUser: e.target.value })} placeholder="you@gmail.com" />
          </label>
          <label className="settings-field">
            <span>SMTP Password{emailCfg.hasPassword ? " (already set)" : ""}</span>
            <input type="password" value={emailPass} onChange={(e) => setEmailPass(e.target.value)} placeholder={emailCfg.hasPassword ? "•••••••• (leave blank to keep)" : "App password / SMTP password"} />
          </label>
          <label className="settings-field">
            <span>From Address</span>
            <input value={emailCfg.fromAddress} onChange={(e) => setEmailCfg({ ...emailCfg, fromAddress: e.target.value })} placeholder="Same as username if blank" />
          </label>
        </div>

        <label className="settings-toggle">
          <input type="checkbox" checked={emailCfg.smtpSecure} onChange={(e) => setEmailCfg({ ...emailCfg, smtpSecure: e.target.checked })} />
          <span>Use SSL (port 465) instead of STARTTLS (port 587)</span>
        </label>

        <div className="settings-actions">
          <button className="primary" onClick={handleSaveEmail} disabled={savingEmail || emailCfg.toAddress.split(",").filter((a) => a.trim()).length > 10}>{savingEmail ? "Saving..." : "Save Email Settings"}</button>
          <button onClick={handleSendTestEmail} disabled={testingEmail || !emailCfg.hasPassword && !emailPass}>{testingEmail ? "Sending..." : "Send Test Email"}</button>
        </div>
        {emailMsg && <div className={`settings-msg ${emailMsg.ok ? "ok" : "error"}`}>{emailMsg.text}</div>}
      </div>
      )}

      {!isWeb() && (
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Admin Access</h2>
            <p>
              {pinExists
                ? "The Admin PIN protects the whole Admin menu group (Dashboard, Training, Flight Crews, Settings — including FTL Limits) from anyone who just has the app open. It syncs to every device, so it's one company-wide PIN, not per-machine."
                : "No Admin PIN is set yet — the Admin menu group is currently open to anyone using this app. Set a PIN below to lock it (recommended before this build is used operationally)."}
            </p>
          </div>
        </div>

        {!ADMIN_LOCK_ENABLED && (
          <div className="settings-status settings-status-off">
            🔓 Admin lock is temporarily turned off app-wide — the Admin menu is open to everyone right now regardless of any PIN set here. You can still set/change a PIN below; it will take effect immediately once the lock is turned back on.
          </div>
        )}

        <div className={`settings-status settings-status-${pinExists ? "on" : "off"}`}>
          {pinExists ? "✓ Admin PIN is set" : "⚠ Admin PIN not set — Admin area is unlocked"}
        </div>

        {pinExists && (
          <label className="settings-field">
            <span>Current PIN</span>
            <input type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} placeholder="Required to change the PIN" />
          </label>
        )}
        <label className="settings-field">
          <span>{pinExists ? "New PIN" : "Set PIN"}</span>
          <input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="At least 4 characters" />
        </label>
        <label className="settings-field">
          <span>Confirm PIN</span>
          <input type="password" inputMode="numeric" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} placeholder="Re-enter the PIN" />
        </label>

        <div className="settings-actions">
          <button className="primary" onClick={handleSavePin} disabled={savingPin || !newPin.trim()}>
            {savingPin ? "Saving..." : pinExists ? "Change PIN" : "Set Admin PIN"}
          </button>
        </div>
        {pinMsg && <div className={`settings-msg ${pinMsg.ok ? "ok" : "error"}`}>{pinMsg.text}</div>}
      </div>
      )}

      {!isWeb() && (
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Software Update</h2>
            <p>Checks the same Supabase project used for Central Sync (Storage bucket "app-updates") for a newer version. Nothing downloads or installs without you clicking through each step.</p>
          </div>
        </div>

        <div className="settings-field">
          <span>Current Version</span>
          <div className="settings-about-value">{appVersion || "—"}</div>
        </div>

        {updateState.phase === "idle" && (
          <div className="settings-actions">
            <button className="primary" onClick={handleCheckForUpdates}>Check for Updates</button>
          </div>
        )}

        {updateState.phase === "checking" && (
          <div className="settings-status settings-status-off">Checking for updates...</div>
        )}

        {updateState.phase === "up-to-date" && (
          <>
            <div className="settings-status settings-status-on">✓ You're on the latest version</div>
            <div className="settings-actions">
              <button onClick={handleCheckForUpdates}>Check Again</button>
            </div>
          </>
        )}

        {updateState.phase === "available" && (
          <>
            <div className="settings-status settings-status-off">A new version is available: {updateState.version}</div>
            <div className="settings-actions">
              <button className="primary" onClick={handleDownloadUpdate}>Download Update</button>
            </div>
          </>
        )}

        {updateState.phase === "downloading" && (
          <>
            <div className="settings-status settings-status-off">Downloading update... {updateState.percent}%</div>
            <div className="settings-update-progress">
              <div className="settings-update-progress-fill" style={{ width: `${updateState.percent}%` }} />
            </div>
          </>
        )}

        {updateState.phase === "downloaded" && (
          <>
            <div className="settings-status settings-status-on">✓ Update {updateState.version} downloaded — ready to install</div>
            <div className="settings-actions">
              <button className="primary" onClick={handleInstallUpdate}>Restart &amp; Install</button>
            </div>
          </>
        )}

        {updateState.phase === "error" && (
          <>
            <div className="settings-msg error">{updateState.error}</div>
            <div className="settings-actions">
              <button onClick={handleCheckForUpdates}>Try Again</button>
            </div>
          </>
        )}
      </div>
      )}

      {/* On the web/admin build there is no per-machine licence or hardware ID
          (it runs in a browser, on any device), so About shows what this web
          app actually is instead - version, modules, data source, access. */}
      {isWeb() && (
      <div className="settings-card settings-card-wide">
        <div className="module-header settings-subheader">
          <div>
            <h2>About</h2>
            <p>Details of this web application.</p>
          </div>
        </div>

        <div className="admin-about-rows">
          <div><span>Application</span><b>AviCore Enterprise — Admin (Web)</b></div>
          <div><span>Version</span><b>v{WEB_APP_VERSION}</b></div>
          <div><span>Purpose</span><b>Flight &amp; duty administration console</b></div>
          <div><span>Modules</span><b>Dashboard · FDT · Training · Settings · Daily Duty · Crew Access · Utility</b></div>
          <div><span>Data source</span><b>Central database (shared with Crew &amp; the PC app)</b></div>
          <div><span>Access</span><b>Authorized admin accounts only (email &amp; password)</b></div>
          <div><span>Companion app</span><b>AviCore Crew — avicore-crew.web.app</b></div>
          <div><span>Regulation basis</span><b>OPS-CM-01 · CAAT Flight &amp; Duty Time Limitations</b></div>
        </div>

        <p className="admin-about-note">
          Supplementary console to the PC application <b>AviCore Enterprise</b>. Everything edited
          here is written to the central database and is live on every device immediately.
          Excel/PDF import and email alerts remain PC-only.
        </p>
        <p className="admin-about-note">
          © Copyright 2026 Capt. Weera Juntaklud · email: freeman201@yahoo.com · tel. 081-8406275
        </p>
      </div>
      )}

      {!isWeb() && (
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>About</h2>
            <p>License and hardware information for this installation.</p>
          </div>
        </div>

        <div className={`settings-status ${license.valid ? "settings-status-on" : "settings-status-error"}`}>
          {license.valid ? "✓ Licensed" : `✕ Not Licensed${license.reason ? " — " + license.reason : ""}`}
        </div>

        {license.valid && (
          <div className="settings-field">
            <span>Valid Until</span>
            <div className="settings-about-value">{formatExpiry(license.payload?.expiresAt)}</div>
          </div>
        )}

        <div className="settings-field">
          <span>Hardware ID</span>
          <div className="settings-hwid-row">
            <input value={hardwareId} readOnly />
            <button onClick={handleCopyHwid}>{hwidCopied ? "Copied!" : "Copy"}</button>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
