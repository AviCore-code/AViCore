import { useEffect, useMemo, useState } from "react";
import { loadAllPilotStatusRows, decimalToHHMM } from "../../utils/statusCompute.js";
import { pilotHistory, pastDays, localIso, FT_WINDOWS, DT_WINDOWS } from "./dutyHistory.js";
import { isoAddDays } from "./weeklyPlanHeadroom.js";
import "./PilotRoster.css";
import "./DutyHistory.css";

// Pilot Roster -> Duty & Flight History.
// Looks BACK at what each pilot actually flew and was on duty, day by day, and
// FORWARD at how much flight time the limits still allow over the next week -
// for planning who can be given flying. Read-only: the source is Daily Duty.

const RANGE_OPTIONS = [7, 14, 28, 56];
const AHEAD_DAYS = 7;
const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dayHeader(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return { dd: d, mm: m, wd: WEEKDAY[wd], weekend: wd === 0 || wd === 6 };
}

const hhmm = (h) => (h > 0 ? decimalToHHMM(h) : "");

function aheadTitle(a) {
  const ft = a.left == null ? "—" : decimalToHHMM(a.left);
  const dt = a.dtLeft == null ? "—" : decimalToHHMM(a.dtLeft);
  const rr = a.cycle.hoursLeft != null
    ? (a.cycle.hoursLeft > 0 ? `${Math.floor(a.cycle.hoursLeft)}h left before a Recovery Rest (36h, 2 nights) must start` : "Recovery Rest is due")
    : a.cycle.label === "RR ✓" ? "in a Recovery Rest now - a new 168h cycle starts at the next report"
    : a.cycle.label === "no RR" ? "no Recovery Rest found in the duty records" : "no duty records";
  return `${a.iso}
FT left: ${ft}
DT left: ${dt}
168h cycle: ${rr}`;
}

// loadRows is injectable for tests; the app uses the same loader as All Status.
export default function DutyHistory({ loadRows = loadAllPilotStatusRows }) {
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(28);
  const [search, setSearch] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await loadRows();
      setRows(res.rows);
      setLimits(res.limits);
      setLoadedAt(new Date());
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const todayIso = localIso(loadedAt || new Date());
  const days = useMemo(() => pastDays(todayIso, range), [todayIso, range]);
  const aheadIsos = useMemo(
    () => Array.from({ length: AHEAD_DAYS }, (_, i) => isoAddDays(todayIso, i + 1)),
    [todayIso]
  );

  const histories = useMemo(() => {
    if (!limits) return [];
    return rows.map((r) => ({
      pilot: r.pilot,
      h: pilotHistory(r.entries, limits, { todayIso, asOf: loadedAt || new Date(), aheadDays: AHEAD_DAYS })
    }));
  }, [rows, limits, todayIso, loadedAt]);

  const q = search.trim().toLowerCase();
  const visible = q
    ? histories.filter(({ pilot }) => `${pilot.code} ${pilot.name}`.toLowerCase().includes(q))
    : histories;

  return (
    <div className={`roster-page dutyhist-page${fullScreen ? " roster-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Duty &amp; Flight History</h1>
          <p>What each pilot has flown (FT) and been on duty (DT) day by day, their rolling totals, and the flight time the limits still allow over the next {AHEAD_DAYS} days — for planning who can be given flying.</p>
        </div>
        <div className="header-tools">
          <input className="roster-search" placeholder="Search pilot name/code..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="dutyhist-range">
            <span>Show last</span>
            <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
              {RANGE_OPTIONS.map((n) => <option key={n} value={n}>{n} days</option>)}
            </select>
          </label>
          <button onClick={refresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
          <button onClick={() => window.print()} disabled={!visible.length}>Print</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      <div className="dutyhist-legend no-print">
        <span><b className="dutyhist-swatch flight" /> Flight day: <b>FT</b> on top, DT below</span>
        <span><b className="dutyhist-swatch nonflight" /> Non-flight duty (DSB / NSB / GT …) with DT</span>
        <span><b className="dutyhist-swatch warn" /> Near a limit</span>
        <span><b className="dutyhist-swatch exc" /> Over a limit / nothing left</span>
        <span><b className="dutyhist-swatch ok" /> Within all limits</span>
        <span>Next {AHEAD_DAYS} days: <b>FT left</b> / DT left / 168h cycle (hours until a 36h Recovery Rest must start; RR ✓ = resting now). Counts recorded duty only.</span>
      </div>

      {error && <div className="settings-msg error">Could not load duty records: {error}</div>}
      {!loading && !error && visible.length === 0 && <div className="mystatus-empty">No pilots found.</div>}

      {visible.length > 0 && (
        <div className="roster-scroll">
          <table className="duty-schedule-table dutyhist-table">
            <thead>
              <tr>
                <th className="pilot-col" rowSpan={2}>Pilot</th>
                <th colSpan={days.length} className="dutyhist-group">Past {range} days — FT / DT</th>
                <th colSpan={FT_WINDOWS.length + DT_WINDOWS.length} className="dutyhist-group dutyhist-sep">Rolling totals (used / max · left)</th>
                <th colSpan={AHEAD_DAYS} className="dutyhist-group dutyhist-sep">Next {AHEAD_DAYS} days — left: FT / DT / 168h cycle</th>
              </tr>
              <tr>
                {days.map((iso) => {
                  const d = dayHeader(iso);
                  return (
                    <th key={iso} className={`${d.weekend ? "weekend" : ""}${iso === todayIso ? " today" : ""}`}>
                      <div>{d.dd}/{d.mm}</div><div className="dutyhist-wd">{d.wd}</div>
                    </th>
                  );
                })}
                {[...FT_WINDOWS, ...DT_WINDOWS].map((w, i) => (
                  <th key={w.key} className={i === 0 ? "dutyhist-sep" : ""}>{w.label}</th>
                ))}
                {aheadIsos.map((iso, i) => {
                  const d = dayHeader(iso);
                  return (
                    <th key={iso} className={`${d.weekend ? "weekend" : ""}${i === 0 ? " dutyhist-sep" : ""}`}>
                      <div>{d.dd}/{d.mm}</div><div className="dutyhist-wd">{d.wd}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ pilot, h }) => (
                <tr key={pilot.code}>
                  <td className="pilot-col" title={pilot.name}>
                    <div className="dutyhist-code">{pilot.code}</div>
                    <div className="dutyhist-name">{pilot.name}</div>
                  </td>
                  {days.map((iso) => {
                    const d = h.day(iso);
                    const kind = d.flew ? "flight" : d.nonFlight.length ? "nonflight" : "";
                    const title = [
                      iso,
                      d.flew ? `FT ${decimalToHHMM(d.ft)}` : null,
                      d.dt > 0 ? `DT ${decimalToHHMM(d.dt)}` : null,
                      d.nonFlightFull.length ? d.nonFlightFull.join(", ") : null
                    ].filter(Boolean).join(" · ");
                    return (
                      <td key={iso} className={`dutyhist-day ${kind}${iso === todayIso ? " today" : ""}`} title={title}>
                        {kind && (
                          <>
                            <div className="dutyhist-ft">{d.flew ? hhmm(d.ft) || "0:00" : d.nonFlight.join("/")}</div>
                            <div className="dutyhist-dt">{hhmm(d.dt)}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                  {h.totals.map((t, i) => (
                    <td key={t.key} className={`dutyhist-total ${t.status}${i === 0 ? " dutyhist-sep" : ""}`}
                      title={`${t.label}: ${decimalToHHMM(t.used)} used${t.max != null ? ` of ${decimalToHHMM(t.max)}, ${decimalToHHMM(Math.max(0, t.left))} left` : ""}`}>
                      <div className="dutyhist-used">{decimalToHHMM(t.used)}<small>/{t.max != null ? Math.round(t.max) : "—"}</small></div>
                      {t.left != null && <div className="dutyhist-left">{t.left > 0 ? `${decimalToHHMM(t.left)} left` : "none left"}</div>}
                    </td>
                  ))}
                  {h.ahead.map((a, i) => (
                    <td key={a.iso} className={`dutyhist-ahead ${a.status}${i === 0 ? " dutyhist-sep" : ""}`}
                      title={aheadTitle(a)}>
                      <div className={`dutyhist-line ft ${a.ftStatus}`}>{a.left == null ? "—" : decimalToHHMM(a.left)}</div>
                      <div className={`dutyhist-line dt ${a.dtStatus}`}>{a.dtLeft == null ? "—" : decimalToHHMM(a.dtLeft)}</div>
                      <div className={`dutyhist-line rr ${a.cycle.status}`}>{a.cycle.label || "—"}</div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
