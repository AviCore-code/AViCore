import { useEffect, useMemo, useState } from "react";
import { getSetting, saveSetting, getEmailConfig, sendEmail, listTraining, exportLogbookPdf } from "../../services/desktopDatabase.js";
import { DEFAULT_FTL_LIMITS } from "../../utils/ftlLimits.js";
import { loadAllPilotStatusRows, buildRecommendations, formatDateTime, STATUS_LABEL } from "../../utils/statusCompute.js";
import { computeTrainingRow, withTrainingThresholdDefaults, withTrainingDisabledDefaults, buildTrainingRecommendations } from "../../utils/trainingDue.js";
import { pilotWeeklyFatigue, TOTAL_INDEX_MAX } from "../../utils/fatigueMonitor.js";
import { buildDutyPeriods, periodDutyCreditHours } from "../../utils/dutyPeriods.js";
import { FATIGUE_CRITERIA_KEY, isModified } from "../../utils/fatigueCriteria.js";
import "../myStatus/MyStatus.css";
import "./Dashboard.css";

// Emails only the recommendations that are genuinely new since the last
// check (tracked by each recommendation's stable `key` in a synced setting)
// - a warning that's still active on the next Dashboard load does NOT
// re-send, but one that clears and later recurs is treated as new again.
async function notifyNewWarnings(recs, onSent) {
  const emailCfg = await getEmailConfig();
  if (!emailCfg.enabled) return;

  const notifiedRaw = await getSetting("email_notified_warnings");
  const notified = new Set(Array.isArray(notifiedRaw) ? notifiedRaw : []);
  const currentKeys = recs.map((r) => r.key);
  const newOnes = recs.filter((r) => !notified.has(r.key));

  if (newOnes.length > 0) {
    const subject = `AviCore: ${newOnes.length} new FTL warning${newOnes.length > 1 ? "s" : ""}`;
    const text = newOnes.map((r) => `[${STATUS_LABEL[r.status]}] ${r.text}`).join("\n\n");
    const result = await sendEmail({ subject, text });
    if (!result.ok) return; // leave the tracked set alone so it retries next check
    // Record the successful send so Dashboard can show "last alert email
    // sent" - a separate setting from email_notified_warnings (which tracks
    // WHICH warnings were sent, not WHEN the last send happened).
    const sentAt = new Date().toISOString();
    await saveSetting("last_email_sent_at", sentAt);
    if (onSent) onSent(sentAt);
  }

  const changed = currentKeys.length !== notified.size || currentKeys.some((k) => !notified.has(k));
  if (changed) await saveSetting("email_notified_warnings", currentKeys);
}

// How stale "last checked" is allowed to be before the Dashboard flags the
// background alert system as not-running. scripts/alertCheck.mjs (Task
// Scheduler) defaults to a 30-minute interval, and the app itself checks
// every time the Dashboard is opened - 90 minutes gives 3x the default
// background interval as slack before calling it "stale" (covers a slow
// tick or a machine that just wasn't touched for a bit) without staying
// silent for hours if the scheduled task actually stopped running.
const STALE_AFTER_MINUTES = 90;

function alertSystemHealth(lastCheckedAt) {
  if (!lastCheckedAt) return "unknown";
  const minutesAgo = (Date.now() - new Date(lastCheckedAt).getTime()) / 60000;
  return minutesAgo <= STALE_AFTER_MINUTES ? "active" : "stale";
}

// Fleet-wide summary built from the same per-pilot computation as All
// Status, plus a plain-language recommendations list for anything not OK.
export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  // null = the approved OPS-CM-01 criteria (what the engine defaults to).
  const [fatigueCriteria, setFatigueCriteria] = useState(null);
  const [trainingPilots, setTrainingPilots] = useState([]);
  const [trainingThresholds, setTrainingThresholds] = useState(withTrainingThresholdDefaults());
  const [trainingDisabledItems, setTrainingDisabledItems] = useState(withTrainingDisabledDefaults());
  const [lastEmailSentAt, setLastEmailSentAt] = useState(null);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [branding, setBranding] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    getSetting("customer_branding").then((saved) => setBranding(saved || null));
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  async function refresh() {
    setLoading(true);
    const [{ rows: loaded, limits: lim }, tPilots, tThresholds, tDisabled, sentAt, checkedAt, fatCriteria] = await Promise.all([
      loadAllPilotStatusRows(),
      listTraining(),
      getSetting("training_thresholds"),
      getSetting("training_disabled_items"),
      getSetting("last_email_sent_at"),
      getSetting("last_check_at"),
      getSetting(FATIGUE_CRITERIA_KEY).catch(() => null)
    ]);
    setLimits(lim);
    setFatigueCriteria(fatCriteria || null);
    setRows(loaded);
    setTrainingPilots(tPilots);
    setTrainingThresholds(withTrainingThresholdDefaults(tThresholds));
    setTrainingDisabledItems(withTrainingDisabledDefaults(tDisabled));
    setLastEmailSentAt(sentAt || null);
    setLastCheckedAt(checkedAt || null);
    setLoading(false);
  }

  const counts = useMemo(() => {
    const c = { ok: 0, warn: 0, exc: 0 };
    rows.forEach((r) => { c[r.status]++; });
    return c;
  }, [rows]);

  // --- Fatigue Index summary (OPS-CM-01 §7.17.3.2) --------------------------
  //
  // Computed through the SAME pilotWeeklyFatigue helper the Fatigue Monitor and
  // the Crew dashboard use, with the same saved criteria. That is deliberate:
  // three screens quoting a pilot's fatigue index must quote one number, or
  // none of them is trustworthy. Re-deriving it here would be a fourth
  // implementation free to drift.
  //
  // Bands come from TOTAL_INDEX_BANDS, so the counts below mean exactly what
  // the manual's action bands mean - 3.00+ requires a 36-hour recovery rest,
  // 2.50+ is "closely monitor".
  const fatigue = useMemo(() => {
    const list = [];
    for (const r of rows) {
      if (!r.entries?.length) continue;
      try {
        const week = pilotWeeklyFatigue({
          entries: r.entries,
          limits,
          dt7d: r.stats?.dt7d,
          buildDutyPeriods,
          periodDutyCreditHours,
          criteria: fatigueCriteria
        });
        if (!Number.isFinite(week?.total)) continue;
        list.push({
          code: r.pilot.code,
          name: r.pilot.name,
          total: week.total,
          dutyIndex: week.dutyIndex,
          fatigueIndex: week.fatigueIndex,
          band: week.band,
          totalMax: week.totalMax ?? TOTAL_INDEX_MAX
        });
      } catch { /* a pilot whose figures cannot be built is left out, not zeroed */ }
    }
    list.sort((a, b) => b.total - a.total);
    const rest = list.filter((p) => p.band?.key === "rest");
    const monitor = list.filter((p) => p.band?.key === "monitor");
    return {
      list,
      rest,
      monitor,
      clear: list.length - rest.length - monitor.length,
      worst: list[0] || null,
      // Fleet average, over pilots who actually have duty in the window - an
      // average that counted pilots with no records would read artificially low.
      average: list.length ? list.reduce((s, p) => s + p.total, 0) / list.length : 0
    };
  }, [rows, limits, fatigueCriteria]);

  // Same ok/warn/exc classification already used on the Training pages -
  // reused here so the fleet-wide count on Dashboard always matches what
  // All Training Status shows, with no separate logic to keep in sync.
  const trainingCounts = useMemo(() => {
    const c = { ok: 0, warn: 0, exc: 0 };
    trainingPilots.forEach((p) => { c[computeTrainingRow(p.record, trainingThresholds, trainingDisabledItems).status]++; });
    return c;
  }, [trainingPilots, trainingThresholds, trainingDisabledItems]);

  const recommendations = useMemo(() => {
    const ftl = rows.flatMap((r) => buildRecommendations(r, limits));
    const training = trainingPilots.flatMap((p) => buildTrainingRecommendations(p, trainingThresholds, trainingDisabledItems));
    const rank = { exc: 0, warn: 1 };
    return [...ftl, ...training].sort((a, b) => rank[a.status] - rank[b.status]);
  }, [rows, limits, trainingPilots, trainingThresholds, trainingDisabledItems]);

  useEffect(() => {
    if (loading) return;
    // Record that a check happened right now, independent of whether it
    // found anything new to email - this is what lets the status card below
    // tell "the system is actively checking" apart from "nothing new to
    // report lately". Shares the same app_settings row scripts/alertCheck.mjs
    // (the Task Scheduler background checker) writes to, so opening the app
    // and the background script both keep this one timestamp current.
    const checkedAt = new Date().toISOString();
    saveSetting("last_check_at", checkedAt).then(() => setLastCheckedAt(checkedAt));
    notifyNewWarnings(recommendations, setLastEmailSentAt);
  }, [recommendations, loading]);

  const alertHealth = useMemo(() => alertSystemHealth(lastCheckedAt), [lastCheckedAt]);

  const activePilots = useMemo(() => rows.filter((r) => r.entries.length > 0).length, [rows]);

  async function handleExport() {
    setExporting(true);
    setExportMsg("");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const result = await exportLogbookPdf(`Dashboard_${stamp}.pdf`);
      if (result?.ok && result.filePath) setExportMsg(`Saved: ${result.filePath}`);
    } catch (err) {
      setExportMsg("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`dashboard-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Dashboard</h1>
          <p>Fleet-wide FTL and Training summary, built from All Status and Training.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={refresh}>Refresh</button>
            <button onClick={() => window.print()} disabled={loading}>Print</button>
            <button onClick={handleExport} disabled={exporting || loading}>{exporting ? "Exporting..." : "Export PDF"}</button>
            <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
          </div>
          <div className="dashboard-email-status">
            <span className={`dashboard-health-dot ${alertHealth}`} />
            Last checked: {lastCheckedAt ? formatDateTime(new Date(lastCheckedAt)) : "Never"} · Last alert email sent: {lastEmailSentAt ? formatDateTime(new Date(lastEmailSentAt)) : "Never"}
          </div>
        </div>
      </div>
      {exportMsg && <div className="dashboard-export-msg no-print">{exportMsg}</div>}

      {loading && <div className="dashboard-empty">Loading...</div>}

      {!loading && (
        <div className="dashboard-print-area">
          {(branding?.logo || branding?.name) && (
            <div className="dashboard-print-brand">
              {branding.logo && <img src={branding.logo} alt="" />}
              {branding.name && <span>{branding.name}</span>}
            </div>
          )}
          <div className="dashboard-print-title">Dashboard — Fleet Summary</div>

          <h3 className="dashboard-section">Alert System Status</h3>
          <div className="dashboard-alert-status">
            <div className={`dashboard-alert-status-item ${alertHealth}`}>
              <span className={`mystatus-badge ${alertHealth === "active" ? "ok" : "exc"}`}>
                {alertHealth === "active" ? "Active" : alertHealth === "stale" ? "Not Running" : "Never Checked"}
              </span>
              <div className="dashboard-alert-status-text">
                <div>Last checked: {lastCheckedAt ? formatDateTime(new Date(lastCheckedAt)) : "Never"}</div>
                <div>Last alert email sent: {lastEmailSentAt ? formatDateTime(new Date(lastEmailSentAt)) : "Never"}</div>
              </div>
            </div>
            {alertHealth !== "active" && (
              <div className="dashboard-alert-status-hint">
                {alertHealth === "unknown"
                  ? "No check has been recorded yet — open this Dashboard, or set up the background checker (scripts\\install-task.ps1) so alerts fire even when the app is closed."
                  : `No check in over ${STALE_AFTER_MINUTES} minutes — if the app is closed on this machine, the background Task Scheduler task may not be running. See scripts\\README-alertCheck.md.`}
              </div>
            )}
          </div>

          <div className="dashboard-summary">
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{rows.length}</div>
              <div className="dashboard-stat-label">Total Pilots</div>
            </div>
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{activePilots}</div>
              <div className="dashboard-stat-label">With Daily Duty Records</div>
            </div>
            <div className="dashboard-stat ok">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✓</span>{counts.ok}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.ok}</div>
            </div>
            <div className="dashboard-stat warn">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">⚠</span>{counts.warn}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.warn}</div>
            </div>
            <div className="dashboard-stat exc">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✕</span>{counts.exc}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.exc}</div>
            </div>
          </div>

          <h3 className="dashboard-section">Training Status Summary</h3>
          <div className="dashboard-summary">
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{trainingPilots.length}</div>
              <div className="dashboard-stat-label">Pilots With Training Records</div>
            </div>
            {/* Spacer keeps this row's 4 real stats in the same 5-column
                grid as the row above, so card edges line up vertically
                instead of each row centering its own narrower set. */}
            <div className="dashboard-stat dashboard-stat-spacer" aria-hidden="true" />
            <div className="dashboard-stat ok">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✓</span>{trainingCounts.ok}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.ok}</div>
            </div>
            <div className="dashboard-stat warn">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">⚠</span>{trainingCounts.warn}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.warn}</div>
            </div>
            <div className="dashboard-stat exc">
              <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✕</span>{trainingCounts.exc}</div>
              <div className="dashboard-stat-label">{STATUS_LABEL.exc}</div>
            </div>
          </div>

          <h3 className="dashboard-section">Fatigue Index Summary</h3>
          {isModified(fatigueCriteria) && (
            <div className="dashboard-fatigue-warn">
              ⚠ Computed with <b>modified criteria</b> — not the approved OPS-CM-01 §7.17.3
              calculation. See Settings → Fatigue Criteria.
            </div>
          )}
          {fatigue.list.length === 0 ? (
            <div className="dashboard-empty">No duty records in the last 7 days.</div>
          ) : (
            <>
              <div className="dashboard-summary">
                <div className="dashboard-stat">
                  <div className="dashboard-stat-value">{fatigue.average.toFixed(2)}</div>
                  <div className="dashboard-stat-label">Fleet Average Index</div>
                </div>
                <div className="dashboard-stat dashboard-stat-spacer" aria-hidden="true" />
                <div className="dashboard-stat ok">
                  <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✓</span>{fatigue.clear}</div>
                  <div className="dashboard-stat-label">Below 2.50</div>
                </div>
                <div className="dashboard-stat warn">
                  <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">⚠</span>{fatigue.monitor.length}</div>
                  <div className="dashboard-stat-label">Closely Monitor (2.50+)</div>
                </div>
                <div className="dashboard-stat exc">
                  <div className="dashboard-stat-value"><span className="dashboard-stat-icon" aria-hidden="true">✕</span>{fatigue.rest.length}</div>
                  <div className="dashboard-stat-label">Recovery Rest (3.00+)</div>
                </div>
              </div>

              {/* The pilots at the top of the scale, named. A count alone tells
                  the Chief Pilot that someone needs a 36-hour rest but not who,
                  which is the one thing needed to act on it. */}
              {(fatigue.rest.length > 0 || fatigue.monitor.length > 0) && (
                <div className="dashboard-fatigue-list">
                  {[...fatigue.rest, ...fatigue.monitor].map((p) => (
                    <div key={p.code} className={`dashboard-rec ${p.band?.key === "rest" ? "exc" : "warn"}`}>
                      <span className={`mystatus-badge ${p.band?.key === "rest" ? "exc" : "warn"}`}>
                        {p.total.toFixed(2)}
                      </span>
                      <span>
                        <b>{p.code}</b>{p.name ? ` — ${p.name}` : ""} · TOTAL INDEX {p.total.toFixed(2)} of {p.totalMax.toFixed(2)}
                        {" "}(DT {p.dutyIndex.toFixed(2)} + Fatigue {p.fatigueIndex.toFixed(2)}) — {p.band?.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {fatigue.rest.length === 0 && fatigue.monitor.length === 0 && fatigue.worst && (
                <div className="dashboard-empty">
                  Every pilot is below 2.50. Highest: <b>{fatigue.worst.code}</b> at{" "}
                  {fatigue.worst.total.toFixed(2)}.
                </div>
              )}
            </>
          )}

          <h3 className="dashboard-section">Recommendations (FTL &amp; Training)</h3>
          {recommendations.length === 0 ? (
            <div className="dashboard-empty">No issues — every pilot is within limits.</div>
          ) : (
            <div className="dashboard-recs">
              {recommendations.map((r, i) => (
                <div key={i} className={`dashboard-rec ${r.status}`}>
                  <span className={`mystatus-badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
