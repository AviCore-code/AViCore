import { useEffect, useMemo, useState } from "react";
import { listExperience, listDutyEntriesByPilot, getSetting, getPreferredPilotCode, isSinglePilotDevice, isDemoSession } from "../../services/desktopDatabase.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";
import { checkRecoveryRest168 } from "../../utils/dutyPeriods.js";
import { computeStats, computeTomorrowAvailability, decimalToHHMM } from "../../utils/statusCompute.js";
import { Bar, CurrencySection, RecoveryRestCard } from "../../components/StatusDisplay.jsx";
import "./MyStatus.css";

// The limits themselves are company-editable at Settings > FTL Limits.
export default function MyStatus() {
  const [pilots, setPilots] = useState([]);
  const [pilotCode, setPilotCode] = useState("");
  const [entries, setEntries] = useState([]);
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  const [branding, setBranding] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    Promise.all([listExperience(), getPreferredPilotCode()]).then(([list, preferred]) => {
      setPilots(list);
      if (list.length && !pilotCode) setPilotCode(preferred || list[0].code);
    });
    getSetting("ftl_limits").then((saved) => setLimits(withFtlDefaults(saved)));
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  useEffect(() => {
    if (pilotCode) listDutyEntriesByPilot(pilotCode).then(setEntries);
    else setEntries([]);
  }, [pilotCode]);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const stats = useMemo(() => computeStats(entries, limits), [entries, limits]);
  const recoveryRest = useMemo(() => checkRecoveryRest168(entries, limits), [entries, limits]);
  const tomorrow = useMemo(() => computeTomorrowAvailability(entries, limits, { endTime: "17:30" }), [entries, limits]);

  return (
    <div className={`mystatus-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print" style={{ justifyContent: "flex-end" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <label className="mystatus-pilot">
            <span>Pilot</span>
            {isSinglePilotDevice() && !isDemoSession() ? (
              <span className="mystatus-pilot-name">
                {(() => { const p = pilots.find((x) => x.code === pilotCode); return p ? `${p.code} — ${p.name}` : pilotCode; })()}
              </span>
            ) : (
              <select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)}>
                <option value="">— Select pilot —</option>
                {pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            )}
          </label>
          <button onClick={() => { if (isDemoSession()) { alert("Demo account — printing is disabled."); return; } window.print(); }} disabled={!pilotCode || !entries.length}>Print / Save PDF</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {!pilotCode && <div className="mystatus-empty">Select a pilot to view status.</div>}

      {pilotCode && entries.length === 0 && (
        <div className="mystatus-empty">No Daily Duty records yet for this pilot.</div>
      )}

      {pilotCode && entries.length > 0 && (
        <div className="mystatus-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="mystatus-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="mystatus-print-title">My Status — {pilotCode}</div>

          <h3 className="mystatus-section">168 Hr Duty Cycle / Recovery Rest</h3>
          <RecoveryRestCard result={recoveryRest} limits={limits} />

          <h3 className="mystatus-section">Duty Time (Rolling)</h3>
          <div className="mystatus-grid">
            <Bar label="DT 7D" value={stats.dt7d} limit={limits.dt7d} />
            <Bar label="DT 14D" value={stats.dt14d} limit={limits.dt14d} />
            <Bar label="DT 28D" value={stats.dt28d} limit={limits.dt28d} />
          </div>

          <h3 className="mystatus-section">Flight Time (Rolling)</h3>
          <div className="mystatus-grid">
            <Bar label="FT 7D" value={stats.ft7d} limit={limits.ft7d} />
            <Bar label="FT 28D" value={stats.ft28d} limit={limits.ft28d} />
            <Bar label="FT 365D" value={stats.ft365d} limit={limits.ft365d} />
          </div>

          <h3 className="mystatus-section">Available for Tomorrow (duty until {tomorrow.endTime})</h3>
          <div className="mystatus-avail">
            <div className="mystatus-avail-card">
              <span className="mystatus-avail-label">Flight Time available</span>
              <span className="mystatus-avail-value">{decimalToHHMM(tomorrow.flightAvailable)} hrs</span>
              <span className="mystatus-avail-note">limited by {tomorrow.flightLimiter}</span>
            </div>
            <div className="mystatus-avail-card">
              <span className="mystatus-avail-label">Duty Time available</span>
              <span className="mystatus-avail-value">{decimalToHHMM(tomorrow.dutyAvailable)} hrs</span>
              <span className="mystatus-avail-note">limited by {tomorrow.dutyLimiter}</span>
            </div>
          </div>
          <p className="mystatus-avail-foot">
            Based on the rolling FT/DT limits plus tomorrow's single-day caps
            (Max FDP {decimalToHHMM(tomorrow.dailyMaxFdp)} hrs, flight {tomorrow.dailyMaxFt != null ? `${decimalToHHMM(tomorrow.dailyMaxFt)} hrs` : "n/a"}) for a duty ending {tomorrow.endTime}.
          </p>

          <h3 className="mystatus-section">Currency (90 / 180 Days)</h3>
          <CurrencySection stats={stats} limits={limits} />
        </div>
      )}
    </div>
  );
}
