import { useEffect, useState } from "react";
import { getSetting, saveSetting } from "../../services/desktopDatabase.js";
import { DEFAULT_FTL_LIMITS, FTL_ROLLING_FIELDS, withFtlDefaults } from "../../utils/ftlLimits.js";
import { DEFAULT_FLEET_CONFIG, withFleetDefaults } from "../../utils/fleetConfig.js";
import SettingsProfilePanel from "./SettingsProfilePanel.jsx";
import "./Settings.css";

function ListEditor({ label, items, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim().toUpperCase();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  }
  function remove(item) {
    onChange(items.filter((i) => i !== item));
  }
  return (
    <div className="settings-field">
      <span>{label}</span>
      {items.length > 0 && (
        <div className="settings-chip-row">
          {items.map((item) => (
            <span className="settings-chip" key={item}>
              {item}
              <button type="button" onClick={() => remove(item)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="settings-hwid-row">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add}>Add</button>
      </div>
    </div>
  );
}

// Settings that are actually about flight crew operations - FTL Limits (the
// numbers that drive every pilot's My Status/All Status badges) and Fleet
// Configuration (aircraft types/registrations offered in Daily Duty). Split
// out of the old single Settings page so a captain looking for these isn't
// mixed in with app-wide/system settings like Sync, License, or Software
// Update (see AdminSettingsTab.jsx) - same data and save behavior as before,
// just regrouped by what it's actually for.
export default function FlightCrewSettingsTab() {
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  const [limitsCustom, setLimitsCustom] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [limitsMsg, setLimitsMsg] = useState(null);

  const [fleet, setFleet] = useState(DEFAULT_FLEET_CONFIG);
  const [savingFleet, setSavingFleet] = useState(false);
  const [fleetMsg, setFleetMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refreshLimits() {
    const saved = await getSetting("ftl_limits");
    setLimits(withFtlDefaults(saved));
    setLimitsCustom(!!saved);
  }

  async function refreshFleet() {
    const saved = await getSetting("fleet_config");
    setFleet(withFleetDefaults(saved));
  }

  useEffect(() => { refreshLimits(); refreshFleet(); }, []);

  function updateLimit(key, field, value) {
    const n = value === "" ? "" : Number(value);
    setLimits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: n } }));
  }

  function updateScalar(key, value) {
    setLimits((prev) => ({ ...prev, [key]: value === "" ? "" : Number(value) }));
  }

  function updateFdpRow(index, field, value) {
    setLimits((prev) => ({
      ...prev,
      fdpByReportTime: (prev.fdpByReportTime || []).map((row, i) =>
        i === index ? { ...row, [field]: value === "" ? "" : Number(value) } : row
      )
    }));
  }

  async function handleSaveLimits() {
    setSavingLimits(true);
    setLimitsMsg(null);
    try {
      await saveSetting("ftl_limits", limits);
      setLimitsCustom(true);
      setLimitsMsg({ ok: true, text: "FTL limits saved — will sync to every device next cycle" });
    } catch (err) {
      setLimitsMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSavingLimits(false);
    }
  }

  async function handleResetLimits() {
    if (!confirm("Reset FTL limits back to defaults?")) return;
    setLimits(DEFAULT_FTL_LIMITS);
    await saveSetting("ftl_limits", DEFAULT_FTL_LIMITS);
    setLimitsCustom(false);
    setLimitsMsg({ ok: true, text: "Reset to defaults." });
  }

  async function handleSaveFleet() {
    setSavingFleet(true);
    setFleetMsg(null);
    try {
      await saveSetting("fleet_config", fleet);
      setFleetMsg({ ok: true, text: "Fleet configuration saved." });
    } catch (err) {
      setFleetMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSavingFleet(false);
    }
  }

  return (
    <div className={fullScreen ? "page-fullscreen" : ""}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "10px" }}>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>
      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>FTL Limits (Flight/Duty Time Limits)</h2>
            <p>Shown on every pilot's My Status page — the defaults are generic placeholders, not yet confirmed against the company's CAAT-approved FTL Scheme. Edit here once real numbers are confirmed, or whenever they change.</p>
          </div>
        </div>

        <div className={`settings-status settings-status-${limitsCustom ? "on" : "off"}`}>
          {limitsCustom ? "✓ Using company-defined values" : "Still using defaults (placeholder)"}
        </div>

        {["Flight Time", "Duty Time"].map((section) => (
          <div className="settings-ftl-section" key={section}>
            <div className="settings-ftl-section-label">{section}</div>
            <div className="settings-ftl-grid">
              {FTL_ROLLING_FIELDS.filter((f) => f.section === section).map((f) => (
                <div className="settings-ftl-field" key={f.key}>
                  <span>{f.label}</span>
                  <div className="settings-ftl-pair">
                    <label>Warning <input type="number" step="0.1" value={limits[f.key]?.warn ?? ""} onChange={(e) => updateLimit(f.key, "warn", e.target.value)} /></label>
                    <label>Max <input type="number" step="0.1" value={limits[f.key]?.max ?? ""} onChange={(e) => updateLimit(f.key, "max", e.target.value)} /></label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="settings-ftl-section">
          <div className="settings-ftl-section-label">Currency</div>
          <div className="settings-ftl-grid">
            <div className="settings-ftl-field">
              <span>Instrument Approach minimum (180 days)</span>
              <label>count <input type="number" step="1" value={limits.iappMin180d ?? ""} onChange={(e) => updateScalar("iappMin180d", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Take Off + Landing minimum (90 days)</span>
              <label>count <input type="number" step="1" value={limits.takeoffLandingMin90d ?? ""} onChange={(e) => updateScalar("takeoffLandingMin90d", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>IFR Hours minimum (180 days)</span>
              <label>hrs <input type="number" step="0.25" value={limits.ifrMin180d ?? ""} onChange={(e) => updateScalar("ifrMin180d", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Flight Time minimum (90 days) — Customer Requirement</span>
              <label>hrs <input type="number" step="1" value={limits.ft90dMin ?? ""} onChange={(e) => updateScalar("ft90dMin", e.target.value)} /></label>
            </div>
          </div>
        </div>

        <div className="settings-ftl-section">
          <div className="settings-ftl-section-label">Recovery Rest (168 hrs)</div>
          <div className="settings-ftl-grid">
            <div className="settings-ftl-field">
              <span>Minimum rest (continuous hours)</span>
              <label>hrs <input type="number" step="1" value={limits.recoveryRestMinHours ?? ""} onChange={(e) => updateScalar("recoveryRestMinHours", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Min overlap per local night</span>
              <label>hrs <input type="number" step="0.5" value={limits.recoveryRestMinNightOverlapHours ?? ""} onChange={(e) => updateScalar("recoveryRestMinNightOverlapHours", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Local night starts at (24hr)</span>
              <label>hr <input type="number" step="1" min="0" max="23" value={limits.recoveryRestNightStartHour ?? ""} onChange={(e) => updateScalar("recoveryRestNightStartHour", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Local night ends at (next day, 24hr)</span>
              <label>hr <input type="number" step="1" min="0" max="23" value={limits.recoveryRestNightEndHour ?? ""} onChange={(e) => updateScalar("recoveryRestNightEndHour", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>168 hrs Duty Cycle</span>
              <div className="settings-ftl-pair">
                <label>Warning <input type="number" step="1" value={limits.recoveryRestCycleWarnHours ?? ""} onChange={(e) => updateScalar("recoveryRestCycleWarnHours", e.target.value)} /></label>
                <label>Max <input type="number" step="1" value={limits.recoveryRestCycleMaxHours ?? ""} onChange={(e) => updateScalar("recoveryRestCycleMaxHours", e.target.value)} /></label>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-ftl-section">
          <div className="settings-ftl-section-label">Duty Period (FDP)</div>
          <div className="settings-ftl-grid">
            <div className="settings-ftl-field">
              <span>Report Time before the day's first activity</span>
              <label>min <input type="number" step="1" value={limits.dutyReportOffsetMinutes ?? ""} onChange={(e) => updateScalar("dutyReportOffsetMinutes", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Post Flight Time (after last engine shutdown)</span>
              <label>min <input type="number" step="1" value={limits.dutyPostFlightOffsetMinutes ?? ""} onChange={(e) => updateScalar("dutyPostFlightOffsetMinutes", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Extension allowed (Unforeseen, must involve flying)</span>
              <label>hrs <input type="number" step="0.5" value={limits.dutyPeriodUnforeseenExtensionHours ?? ""} onChange={(e) => updateScalar("dutyPeriodUnforeseenExtensionHours", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Minimum rest — Oil &amp; Gas customer requirement (Warning)</span>
              <label>hrs <input type="number" step="0.5" value={limits.dutyMinRestHours ?? ""} onChange={(e) => updateScalar("dutyMinRestHours", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Minimum rest — CAAT requirement (Exceeded)</span>
              <label>hrs <input type="number" step="0.5" value={limits.dutyMinRestCaatHours ?? ""} onChange={(e) => updateScalar("dutyMinRestCaatHours", e.target.value)} /></label>
            </div>
          </div>

          <div className="settings-ftl-section-label" style={{ marginTop: "10px" }}>Max FDP / Flight Time by Report Time (OPS-CM-01 §7.4.1)</div>
          <div className="settings-ftl-grid">
            {(limits.fdpByReportTime || []).map((row, i) => (
              <div className="settings-ftl-field" key={i}>
                <span>Report {row.from}–{row.to}</span>
                <div className="settings-ftl-pair">
                  <label>FDP <input type="number" step="0.5" value={row.maxFdp ?? ""} onChange={(e) => updateFdpRow(i, "maxFdp", e.target.value)} /></label>
                  <label>FT <input type="number" step="0.5" value={row.maxFt ?? ""} onChange={(e) => updateFdpRow(i, "maxFt", e.target.value)} /></label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-ftl-section">
          <div className="settings-ftl-section-label">Standby Credit</div>
          <div className="settings-ftl-field">
            <span>Percentage credited as Duty Time (Standby)</span>
            <label>% <input type="number" step="1" min="0" max="100" value={limits.stbyCreditPercent ?? ""} onChange={(e) => updateScalar("stbyCreditPercent", e.target.value)} /></label>
          </div>
        </div>

        <div className="settings-ftl-section">
          <div className="settings-ftl-section-label">Report A — Pilot Qualification Summary (As Customer Requirement)</div>
          <div className="settings-ftl-grid">
            <div className="settings-ftl-field">
              <span>Total Time minimum</span>
              <label>hrs <input type="number" step="1" value={limits.reportTotalTimeMin ?? ""} onChange={(e) => updateScalar("reportTotalTimeMin", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>M-Eng. (PIC) minimum</span>
              <label>hrs <input type="number" step="1" value={limits.reportMEngPicMin ?? ""} onChange={(e) => updateScalar("reportMEngPicMin", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>PIC (all types) minimum</span>
              <label>hrs <input type="number" step="1" value={limits.reportPicMin ?? ""} onChange={(e) => updateScalar("reportPicMin", e.target.value)} /></label>
            </div>
            <div className="settings-ftl-field">
              <span>Aircraft Type minimum</span>
              <div className="settings-ftl-pair">
                <label>Captain <input type="number" step="1" value={limits.reportAw139Min ?? ""} onChange={(e) => updateScalar("reportAw139Min", e.target.value)} /></label>
                <label>Co-pilot <input type="number" step="1" value={limits.reportAw139SecondaryMin ?? ""} onChange={(e) => updateScalar("reportAw139SecondaryMin", e.target.value)} /></label>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button className="primary" onClick={handleSaveLimits} disabled={savingLimits}>{savingLimits ? "Saving..." : "Save FTL Limits"}</button>
          <button onClick={handleResetLimits}>Reset to Defaults</button>
        </div>

        {limitsMsg && <div className={`settings-msg ${limitsMsg.ok ? "ok" : "error"}`}>{limitsMsg.text}</div>}
      </div>

      <div className="settings-card">
        <div className="module-header settings-subheader">
          <div>
            <h2>Fleet Configuration</h2>
            <p>Aircraft types and tail registrations offered as dropdowns in Daily Duty. Synced to every device.</p>
          </div>
        </div>
        <ListEditor
          label="Aircraft Types"
          items={fleet.aircraftTypes}
          onChange={(aircraftTypes) => setFleet({ ...fleet, aircraftTypes })}
          placeholder="e.g. AW139, R-44"
        />
        <ListEditor
          label="Registrations"
          items={fleet.registrations}
          onChange={(registrations) => setFleet({ ...fleet, registrations })}
          placeholder="e.g. HS-UOA"
        />
        <div className="settings-actions">
          <button className="primary" onClick={handleSaveFleet} disabled={savingFleet}>{savingFleet ? "Saving..." : "Save Fleet Configuration"}</button>
        </div>
        {fleetMsg && <div className={`settings-msg ${fleetMsg.ok ? "ok" : "error"}`}>{fleetMsg.text}</div>}
      </div>

      {/* Save/load the whole configuration to a dated file. Placed at the foot
          of this tab because it is where the FTL limits and fleet setup live -
          the settings that take longest to re-enter by hand. It covers the
          other settings tabs too; the panel says which. */}
      <div className="settings-card settings-card-wide">
        <SettingsProfilePanel />
      </div>
    </div>
  );
}
