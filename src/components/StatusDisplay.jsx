import { classify, decimalToHHMM, formatDateTime, STATUS_LABEL } from "../utils/statusCompute.js";

// Wraps in mystatus-note styling, red for a hard violation, amber otherwise.
function Note({ exc, children }) {
  return <div className={`mystatus-note${exc ? " exc" : ""}`}>{children}</div>;
}

export function Bar({ label, value, limit, s: sOverride }) {
  const s = sOverride || classify(value, limit);
  const pct = Math.min(100, (value / limit.max) * 100);
  return (
    <div className="mystatus-bar">
      <div className="mystatus-bar-head">
        <span>{label}</span>
        <span className={`mystatus-badge ${s}`}>{STATUS_LABEL[s]}</span>
      </div>
      <div className="mystatus-bar-track"><div className={`mystatus-bar-fill ${s}`} style={{ width: `${pct}%` }} /></div>
      <div className="mystatus-bar-value">{decimalToHHMM(value)} / {decimalToHHMM(limit.max)}</div>
    </div>
  );
}

export function Metric({ label, value, unit, s }) {
  return (
    <div className="mystatus-metric">
      <div className="mystatus-metric-label">{label}</div>
      <div className="mystatus-metric-row">
        <span>{value}{unit && <small>{unit}</small>}</span>
        {s && <span className={`mystatus-badge ${s}`}>{STATUS_LABEL[s]}</span>}
      </div>
    </div>
  );
}

// Shared between My Status and All Status so the two never drift.
export function CurrencySection({ stats, limits }) {
  const toCount = stats.toDay90 + stats.toNight90;
  const landCount = stats.landDay90 + stats.landNight90;
  return (
    <div className="mystatus-metric-grid">
      <Metric label="T/O (90D)" value={toCount} s={toCount >= limits.takeoffLandingMin90d ? "ok" : "warn"} unit={`/ ≥${limits.takeoffLandingMin90d}`} />
      <Metric label="LANDING (90D)" value={landCount} s={landCount >= limits.takeoffLandingMin90d ? "ok" : "warn"} unit={`/ ≥${limits.takeoffLandingMin90d}`} />
      <Metric label="I.APP (180D)" value={stats.iApp180} s={stats.iApp180 >= limits.iappMin180d ? "ok" : "warn"} unit={`/ ≥${limits.iappMin180d}`} />
      <Metric label="IFR HOURS (180D)" value={decimalToHHMM(stats.ifr180)} s={stats.ifr180 >= limits.ifrMin180d ? "ok" : "warn"} unit={`[h]:mm / ≥${decimalToHHMM(limits.ifrMin180d)}`} />
      <Metric label="FLIGHT TIME (90D)" value={decimalToHHMM(stats.ft90d)} s={stats.ft90d >= limits.ft90dMin ? "ok" : "warn"} unit={`[h]:mm / ≥${decimalToHHMM(limits.ft90dMin)}`} />
    </div>
  );
}

// End of the last COMPLETED qualifying rest = report time of the first
// duty after it = the start of the current 168h Duty Cycle. The hours
// shown keep counting even while the pilot is currently resting - the
// cycle only resets when that rest is closed by the next duty. The next
// Recovery Rest must START within cycleMaxHours of the cycle start
// (OPS-CM-01 7.12.4).
export function RecoveryRestCard({ result, limits }) {
  const { lastQualifyingRestStart, lastQualifyingRestEnd, hoursSinceLastRest, ongoing, ongoingRestStart, restInProgress, restInProgressStart, status } = result;
  const deadline = lastQualifyingRestEnd
    ? new Date(lastQualifyingRestEnd.getTime() + limits.recoveryRestCycleMaxHours * 3600000)
    : null;

  // The most recent rest to display: one already qualifying right now
  // ("Resting") takes priority, then one that's started but hasn't reached
  // 36h/2 local nights yet ("On Process"), otherwise the last completed one.
  const now = new Date();
  const restStart = ongoing ? ongoingRestStart : restInProgress ? restInProgressStart : lastQualifyingRestStart;
  const restEnd = (ongoing || restInProgress) ? null : lastQualifyingRestEnd;
  const restHours = restStart ? ((restEnd || now) - restStart) / 3600000 : null;

  return (
    <div className="mystatus-metric-grid">
      <div className="mystatus-metric">
        <div className="mystatus-metric-label">Current 168 hr Duty Cycle</div>
        <div className="mystatus-metric-row">
          <span>
            {lastQualifyingRestEnd
              ? `Started ${formatDateTime(lastQualifyingRestEnd)} (first duty after Recovery Rest)`
              : ongoing ? "Not started yet (currently resting)" : "No Recovery Rest found in Daily Duty"}
          </span>
          <span className={`mystatus-badge ${status}`}>{STATUS_LABEL[status]}</span>
        </div>
        {lastQualifyingRestEnd && ongoing && (
          <div className="mystatus-note">Currently resting — already counts as the next Recovery Rest (started on time)</div>
        )}
        {lastQualifyingRestEnd && !ongoing && deadline && (
          <div className="mystatus-note">Next Recovery Rest must start before {formatDateTime(deadline)}</div>
        )}
        {!lastQualifyingRestEnd && ongoing && (
          <div className="mystatus-note">The 168 hr cycle will start counting at the next return to duty.</div>
        )}
      </div>
      <Bar
        label="168 hrs. Duty Cycle"
        // Once the ongoing rest already qualifies (36h+/2 nights, checked
        // within dutyPeriods.js), the next 168h requirement is already
        // secured even though the cycle isn't formally closed until a new
        // duty starts - showing 0 here communicates "covered" instead of
        // the old cycle's climbing hours, which would otherwise look
        // alarming right when there's nothing left to worry about. This is
        // distinct from an ongoing rest that HASN'T qualified yet, where
        // hoursSinceLastRest is still shown (handled by dutyPeriods.js
        // never setting ongoing=true until qualification is reached; note
        // that figure is capped at the last logged duty's Stop time, not
        // live wall-clock - see cappedAsOfDate in checkRecoveryRest168).
        value={ongoing ? 0 : (hoursSinceLastRest ?? 0)}
        limit={{ warn: limits.recoveryRestCycleWarnHours ?? 132, max: limits.recoveryRestCycleMaxHours }}
        s={status}
      />
      <div className="mystatus-metric">
        <div className="mystatus-metric-label">Latest Recovery Rest</div>
        <div className="mystatus-metric-row">
          <span>
            {restStart
              ? `${formatDateTime(restStart)} – ${restEnd ? formatDateTime(restEnd) : "now"} (${decimalToHHMM(restHours)} hrs)`
              : "Not found in Daily Duty"}
          </span>
          {restStart && ongoing && <span className="mystatus-badge ok">Resting</span>}
          {restStart && !ongoing && restInProgress && <span className="mystatus-badge info">On Process</span>}
        </div>
        {restStart && !ongoing && restInProgress && (
          <div className="mystatus-note">On Process — needs 36 hrs including 2 local nights off duty to qualify as a Recovery Rest.</div>
        )}
      </div>
    </div>
  );
}

// OPS-CM-01 7.9.2 - Standby Other Than Base Airport. Shows every Duty
// Period that was led by a Standby run escalating into an actual duty
// report (buildDutyPeriods's `standby` field), plus any standby period on
// its own that broke the 16h cap even without ever escalating into duty
// (checkStandbyDurationViolations - buildDutyPeriods only evaluates
// standby duration in the context of an escalation, so a standby that was
// simply released without being called out still needs this separate,
// unconditional check).
export function StandbyFdpSection({ periods, standbyViolations, limits }) {
  const escalated = periods.filter((p) => p.standby);
  // Standalone violations already covered by an escalated period above
  // (same standby start) are skipped here to avoid listing the same
  // standby twice.
  const escalatedStarts = new Set(escalated.map((p) => p.standby.start.getTime()));
  const standaloneExceeded = (standbyViolations || [])
    .filter((v) => v.status === "exc" && !escalatedStarts.has(v.start.getTime()));

  if (!escalated.length && !standaloneExceeded.length) {
    return <div className="mystatus-note">No Standby found in Daily Duty that needs an FDP adjustment.</div>;
  }

  return (
    <div className="mystatus-standby-list">
      {escalated.map((p, i) => (
        <div key={`e${i}`} className="mystatus-standby-row">
          <div className="mystatus-metric-row">
            <span>{formatDateTime(p.standby.start)} – {formatDateTime(p.standby.end)} Standby ({decimalToHHMM(p.standby.hours)} hrs) → report {formatDateTime(p.start)}</span>
            <span className={`mystatus-badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <Note>
            Max FDP {decimalToHHMM(p.maxFdp)} hrs
            {p.standby.reductionHours > 0
              ? ` (reduced by ${decimalToHHMM(p.standby.reductionHours)} hrs — standby ran over the ${limits.standbyFdpReductionFreeHours}h free window)`
              : " (no reduction — standby stayed within the free window, or most of it fell overnight)"}
          </Note>
          {p.standby.exceedsMaxStandby && (
            <Note exc>Standby itself ran {decimalToHHMM(p.standby.hours)} hrs, over the {limits.standbyMaxHours}h max (7.9.2(a))</Note>
          )}
          {p.standby.exceedsCombinedAwake && (
            <Note exc>Standby + FDP combined = {decimalToHHMM(p.standby.combinedAwakeHours)} hrs, over the {limits.standbyPlusFdpMaxAwakeHours}h max (7.9.2(b))</Note>
          )}
        </div>
      ))}
      {standaloneExceeded.map((v, i) => (
        <div key={`s${i}`} className="mystatus-standby-row">
          <div className="mystatus-metric-row">
            <span>{formatDateTime(v.start)} – {formatDateTime(v.end)} Standby ({decimalToHHMM(v.hours)} hrs), not called out</span>
            <span className="mystatus-badge exc">{STATUS_LABEL.exc}</span>
          </div>
          <Note exc>Standby duration exceeds the {limits.standbyMaxHours}h max (7.9.2(a))</Note>
        </div>
      ))}
    </div>
  );
}
