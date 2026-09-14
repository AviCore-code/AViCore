import { useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import {
  PROFILE_GROUPS, ALL_PROFILE_KEYS, createProfile, validateProfile,
  applyProfile, profileFileName, settingLabel, isRegulatory
} from "../../services/settingsProfile.js";
import "./Settings.css";

const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

// Save the whole configuration to a dated file, and load it back.
//
// Capt. Weera: "save profile setting ต่าง ๆ และตั้งชื่อไฟล์ให้มีวันเวลาด้วย
// เพื่อเอามา load ได้ภายหลัง ไม่ต้องนั่งเซ็ทใหม่".
//
// Two things this screen does that a plain save/load would not:
//
//   It names what will change BEFORE anything is written, grouped the way the
//   settings screens are - not as raw keys. Loading a profile silently is how
//   an FTL limit gets changed and nobody notices for a month.
//
//   It calls out the REGULATORY settings separately. FTL limits and fatigue
//   criteria feed the quarterly CAAT submission; branding does not. Both are
//   "settings", and treating them the same on the way in is how the wrong one
//   gets overwritten casually.

export default function SettingsProfilePanel() {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(null);   // { file, data, check, chosen }

  async function handleSave() {
    setBusy("save");
    setMsg(null);
    try {
      const profile = await createProfile(getSetting, ALL_PROFILE_KEYS, {
        note: label.trim(),
        appVersion: APP_VERSION
      });

      if (profile.keys.length === 0) {
        setMsg({ ok: false, text: "Nothing to save — none of these settings have been configured yet." });
        return;
      }

      const name = profileFileName(new Date(), label);
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Revoked late: some browsers have not started reading the blob when
      // click() returns, and revoking early yields a zero-byte file.
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      setMsg({
        ok: true,
        text: `Saved ${name} — ${profile.keys.length} setting(s)` +
              (profile.absent.length ? `, ${profile.absent.length} not yet configured and left out.` : ".")
      });
    } catch (err) {
      setMsg({ ok: false, text: "Could not save: " + err.message });
    } finally {
      setBusy("");
    }
  }

  // Reads and checks the file. Writes nothing yet.
  async function handleFile(file) {
    setMsg(null);
    setPending(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const check = validateProfile(data);
      setPending({ file, data, check, chosen: new Set(check.keys) });
      if (!check.ok) setMsg({ ok: false, text: "This file cannot be loaded — see below." });
    } catch (err) {
      setMsg({ ok: false, text: "Could not read that file: " + err.message });
    }
  }

  function toggleKey(key) {
    setPending((p) => {
      if (!p) return p;
      const next = new Set(p.chosen);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...p, chosen: next };
    });
  }

  async function handleLoad() {
    if (!pending?.check?.ok) return;
    const keys = [...pending.chosen];
    if (keys.length === 0) return;
    setBusy("load");
    setMsg(null);
    try {
      const out = await applyProfile(saveSetting, pending.data, keys);
      if (out.ok) {
        setMsg({
          ok: true,
          text: `Loaded ${out.applied.length} setting(s). Reopen the settings tabs to see the new values.`
        });
        setPending(null);
      } else {
        setMsg({ ok: false, text: `Loaded ${out.applied.length} of ${keys.length}; the rest failed — see below.` });
        setPending((p) => ({ ...p, loadErrors: out.errors }));
      }
    } catch (err) {
      setMsg({ ok: false, text: "Could not load: " + err.message });
    } finally {
      setBusy("");
    }
  }

  const chosenCount = pending?.chosen?.size || 0;
  const chosenRegulatory = pending ? [...pending.chosen].filter(isRegulatory) : [];

  return (
    <div className="settings-section">
      <h2>Settings Profile</h2>

      <p className="settings-note">
        Saves the whole setup — FTL limits, fleet configuration, fatigue criteria,
        training thresholds and appearance — to one dated file, so a new install or
        a machine being rebuilt does not have to be configured by hand again.
        This is the SETUP only; pilots, duty records and roster are covered by
        Server Backup.
      </p>

      <label className="settings-field" style={{ maxWidth: 320 }}>
        <span>Label for the file (optional)</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. before-CAAT-audit"
          disabled={!!busy}
        />
      </label>

      <div className="bk-actions">
        <button className="primary" onClick={handleSave} disabled={!!busy}>
          {busy === "save" ? "Saving…" : "Save settings to file"}
        </button>
        <label className={`bk-file${busy ? " disabled" : ""}`}>
          Choose a settings file to load…
          <input
            type="file"
            accept=".json,application/json"
            disabled={!!busy}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {/* What a saved file will contain, grouped as the settings screens are. */}
      <div className="sp-groups">
        {PROFILE_GROUPS.map((g) => (
          <div className="sp-group" key={g.key}>
            <h4>{g.label}</h4>
            <ul>
              {g.settings.map((s) => (
                <li key={s.key}>
                  {s.label}
                  {s.regulatory && <span className="sp-reg">CAAT</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {msg && <div className={`roster-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}

      {/* ---- Load, itemised ---- */}
      {pending && (
        <div className="bk-restore">
          <h3>Load from {pending.file.name}</h3>

          <div className="bk-meta">
            {pending.data?.createdAt && <span>Saved {new Date(pending.data.createdAt).toLocaleString()}</span>}
            {pending.data?.note && <span>“{pending.data.note}”</span>}
            {pending.data?.appVersion && <span>App {pending.data.appVersion}</span>}
          </div>

          {pending.check.errors.length > 0 && (
            <ul className="bk-errors">{pending.check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
          {pending.check.warnings.length > 0 && (
            <ul className="bk-warnings">{pending.check.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {pending.loadErrors?.length > 0 && (
            <ul className="bk-errors">{pending.loadErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}

          {pending.check.ok && (
            <>
              {/* Individually selectable. Loading a whole profile to recover one
                  mis-typed limit would drag every other setting back to its
                  state at save time - including ones deliberately changed since. */}
              <p className="settings-note" style={{ margin: "8px 0" }}>
                Choose what to load. Anything left unticked stays exactly as it is now.
              </p>
              <div className="sp-pick">
                {pending.check.keys.map((k) => (
                  <label key={k} className="sp-pick-item">
                    <input
                      type="checkbox"
                      checked={pending.chosen.has(k)}
                      onChange={() => toggleKey(k)}
                      disabled={!!busy}
                    />
                    <span>
                      {settingLabel(k)}
                      {isRegulatory(k) && <span className="sp-reg">CAAT</span>}
                    </span>
                  </label>
                ))}
              </div>

              {chosenRegulatory.length > 0 && (
                <div className="bk-danger">
                  <b>This changes figures reported to the CAAT.</b>{" "}
                  {chosenRegulatory.map(settingLabel).join(", ")} feed the quarterly
                  submission under OPS-CM-01 §7.17.3. Check the values on those tabs
                  after loading.
                </div>
              )}

              <div className="bk-actions">
                <button className="primary" onClick={handleLoad} disabled={!!busy || chosenCount === 0}>
                  {busy === "load" ? "Loading…" : `Load ${chosenCount} setting${chosenCount === 1 ? "" : "s"}`}
                </button>
                <button onClick={() => { setPending(null); setMsg(null); }} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
