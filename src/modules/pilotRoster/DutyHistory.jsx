import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadAllPilotStatusRows, decimalToHHMM } from "../../utils/statusCompute.js";
import { listRoster } from "../../services/desktopDatabase.js";
import { pilotHistory, pastDays, localIso, FT_WINDOWS, DT_WINDOWS, rosterRemark, remarkLabel, preOffRrDays, REMARK_LOOKBACK_DAYS, REMARK_LOOKAHEAD_DAYS } from "./dutyHistory.js";
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

// "OFF" on a roster OFF day, "RR" only on the RR pair right before a 7-day
// OFF block (preOffRrDays); anything else null.
function rosterOffLabel(rawCode, iso, preOffRr) {
  const lab = remarkLabel(rawCode);
  if (!lab) return null;
  if (lab.category === "off") return "OFF";
  if (preOffRr?.has(iso)) return "RR";
  return null;
}

// Row order for planning (Capt. Weera): Captains, then Co-pilots (SFO / FO),
// then anyone with no Position on their Pilot Experience profile; inside each
// group the pilot with the MOST flight time left tomorrow comes first, then
// the most duty time left - the first names on the list are the ones who can
// be given the most flying.
const RANK_GROUP = { Captain: 0, SFO: 1, FO: 1 };
export const GROUP_LABELS = ["Captain", "Co-pilot", "Position not set"];

export function pilotGroup(pilot) {
  const position = pilot?.position || pilot?.profile?.position || pilot?.record_json?.profile?.position;
  return RANK_GROUP[position] ?? 2;
}

// How the Next-7-days cells of one pilot look, counted:
//   green - within every limit AND not a roster RR/OFF day (can be flown)
//   off   - roster RR/OFF day (red text: not available)
//   red   - a limit already reached (red cell)
export function nextWeekScore(h, rosterDays, preOffRr) {
  const score = { green: 0, off: 0, red: 0 };
  for (const a of h?.ahead || []) {
    // Any day the roster has the pilot away (RR, R, OFF, VL, SL...) is not a
    // day that can be flown, whatever its colour - it never counts as green.
    const cat = remarkLabel(rosterDays?.get(a.iso))?.category;
    const away = cat === "rest" || cat === "off" || cat === "leave";
    const off = rosterOffLabel(rosterDays?.get(a.iso), a.iso, preOffRr) || away;
    if (off) score.off++;
    else if (a.status === "ok") score.green++;
    if (a.status === "exc" || cat === "leave" || cat === "off") score.red++;   // OFF / leave show as a red cell
  }
  return score;
}

// Inside each group (Capt. Weera): the pilot with the most GREEN days in the
// next 7 comes first; then those with some green and red-text roster days;
// red cells last. Ties: fewer red cells, then most FT left tomorrow, then most
// DT left.
export function sortForPlanning(list) {
  const left = (v) => (v == null ? -1 : v);
  const sc = (x) => x.score || { green: 0, off: 0, red: 0 };
  return [...(list || [])].sort((a, b) =>
    pilotGroup(a.pilot) - pilotGroup(b.pilot)
    || sc(b).green - sc(a).green
    || sc(a).red - sc(b).red
    || left(b.h.ahead[0]?.left) - left(a.h.ahead[0]?.left)
    || left(b.h.ahead[0]?.dtLeft) - left(a.h.ahead[0]?.dtLeft)
    || String(a.pilot.code || "").localeCompare(String(b.pilot.code || "")));
}

// "VL" / "SL" (as written on the roster) on a leave day, else null.
function rosterLeaveLabel(rawCode) {
  const lab = remarkLabel(rawCode);
  return lab?.category === "leave" ? lab.label : null;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.2;
const ZOOM_STEP = 0.1;

// Hold the left mouse button anywhere on the table and drag to move it in
// every direction, like a map. Touch screens keep their own native scrolling.
// A press that doesn't move is still a normal click (tooltips, selection).
function useDragToScroll(ref, active) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    let drag = null;
    const down = (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (e.target.closest("button, input, select, a, label")) return;
      drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false, id: e.pointerId };
    };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        drag.moved = true;
        el.classList.add("dragging");
        try { el.setPointerCapture(drag.id); } catch { /* already released */ }
      }
      el.scrollLeft = drag.left - dx;
      el.scrollTop = drag.top - dy;
      e.preventDefault();
    };
    const up = () => {
      if (drag?.moved) el.classList.remove("dragging");
      drag = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [ref, active]);
}

function aheadTitle(a) {
  const ft = a.left == null ? "—" : decimalToHHMM(a.left);
  const dt = a.dtLeft == null ? "—" : decimalToHHMM(a.dtLeft);
  const rr = a.cycle.hoursLeft != null
    ? (a.cycle.hoursLeft > 0 ? `${Math.floor(a.cycle.hoursLeft)}h left before a Recovery Rest (36h, 2 nights) must start` : "Recovery Rest is due")
    : a.cycle.fromRoster ? "roster days off / leave (2+ days) count as a Recovery Rest - a new 168h cycle starts after them"
    : a.cycle.label === "RR ✓" ? "in a Recovery Rest now - a new 168h cycle starts at the next report"
    : a.cycle.label === "no RR" ? "no Recovery Rest found in the duty records" : "no duty records";
  return `${a.iso}
FT left: ${ft}
DT left: ${dt}
168h cycle: ${rr}`;
}

// loadRows / loadRoster are injectable for tests; the app uses the same
// loaders as All Status and Duty Schedule.
export default function DutyHistory({ loadRows = loadAllPilotStatusRows, loadRoster = listRoster }) {
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(28);
  const [search, setSearch] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [roster, setRoster] = useState([]);
  const [rosterError, setRosterError] = useState("");
  // "fit" scales the whole table to the screen width (like zooming out), so
  // the past days, next 7 days and totals are in view together; a number is a
  // fixed zoom set with -/+.
  const [zoom, setZoom] = useState("fit");
  const [fitScale, setFitScale] = useState(1);
  const scrollRef = useRef(null);
  const tableRef = useRef(null);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const now = new Date();
      const today = localIso(now);
      // The roster only feeds the Remark column, so a failure there must not
      // blank the hours: it is loaded alongside and reported on its own.
      const [res, rosterRows] = await Promise.all([
        loadRows(),
        loadRoster({
          from: isoAddDays(today, 1 - REMARK_LOOKBACK_DAYS),
          to: isoAddDays(today, REMARK_LOOKAHEAD_DAYS)
        }).then((list) => { setRosterError(""); return list || []; })
          .catch((err) => { setRosterError(err.message || String(err)); return []; })
      ]);
      setRows(res.rows);
      setLimits(res.limits);
      setRoster(rosterRows);
      setLoadedAt(now);
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

  // pilot code -> (date -> roster code), from the published monthly roster.
  const rosterByPilot = useMemo(() => {
    const map = new Map();
    for (const row of roster) {
      const code = String(row.pilot_code || row.pilotCode || "").trim().toUpperCase();
      if (!code || !row.date) continue;
      if (!map.has(code)) map.set(code, new Map());
      map.get(code).set(row.date, row.code);
    }
    return map;
  }, [roster]);

  const histories = useMemo(() => {
    if (!limits) return [];
    return rows.map((r) => {
      const days = rosterByPilot.get(String(r.pilot.code || "").trim().toUpperCase());
      const h = pilotHistory(r.entries, limits, { todayIso, asOf: loadedAt || new Date(), aheadDays: AHEAD_DAYS, rosterDays: days });
      const preOffRr = preOffRrDays(days);
      return {
        pilot: r.pilot,
        h,
        remark: rosterRemark(days, todayIso, AHEAD_DAYS),
        rosterDays: days,
        preOffRr,
        score: nextWeekScore(h, days, preOffRr)
      };
    });
  }, [rows, limits, todayIso, loadedAt, rosterByPilot]);

  const q = search.trim().toLowerCase();
  const visible = sortForPlanning(q
    ? histories.filter(({ pilot }) => `${pilot.code} ${pilot.name}`.toLowerCase().includes(q))
    : histories);
  const totalCols = 1 + range + AHEAD_DAYS + 1 + FT_WINDOWS.length + DT_WINDOWS.length;
  const hasTable = visible.length > 0;

  // Fit: the table's natural (unzoomed) width against the space available.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const table = tableRef.current;
    if (!box || !table) return undefined;
    const measure = () => {
      const current = Number(getComputedStyle(table).zoom) || 1;
      const natural = table.getBoundingClientRect().width / current;
      const available = box.clientWidth - 14;
      if (natural > 0 && available > 0) {
        setFitScale(Math.max(ZOOM_MIN, Math.min(1, available / natural)));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [hasTable, range, visible.length, fullScreen]);

  useDragToScroll(scrollRef, hasTable);

  const scale = zoom === "fit" ? fitScale : zoom;
  const stepZoom = (dir) => {
    const next = Math.round((scale + dir * ZOOM_STEP) * 10) / 10;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };

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
          <div className="dutyhist-zoom" role="group" aria-label="Zoom">
            <button onClick={() => stepZoom(-1)} disabled={scale <= ZOOM_MIN} title="Zoom out" aria-label="Zoom out">−</button>
            <span className="dutyhist-zoom-value">{Math.round(scale * 100)}%</span>
            <button onClick={() => stepZoom(1)} disabled={scale >= ZOOM_MAX} title="Zoom in" aria-label="Zoom in">+</button>
            <button className={zoom === "fit" ? "primary" : ""} onClick={() => setZoom("fit")} title="Fit the whole table to the screen width">Fit</button>
          </div>
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
        <span><b className="dutyhist-swatch exc" /> <b className="dutyhist-offtext">red text on a red cell</b> = roster OFF, SL / VL leave, or a limit reached (not available) · <b className="dutyhist-offtext">Red text</b> only = the RR pair right before a 7-day OFF</span>
        <span>🖱 Drag the table to move it.</span>
      </div>

      {error && <div className="settings-msg error">Could not load duty records: {error}</div>}
      {rosterError && <div className="settings-msg error">Remark column: could not load the roster ({rosterError}). Hours are unaffected.</div>}
      {!loading && !error && visible.length === 0 && <div className="mystatus-empty">No pilots found.</div>}

      {hasTable && (
        <div className="roster-scroll dutyhist-scroll" ref={scrollRef}>
          <table className="duty-schedule-table dutyhist-table" ref={tableRef} style={{ zoom: scale }}>
            <thead>
              <tr>
                <th className="pilot-col dutyhist-pilot-head" rowSpan={2}>Pilot</th>
                <th colSpan={days.length} className="dutyhist-group past">Past {range} days — FT / DT</th>
                <th colSpan={AHEAD_DAYS + 1} className="dutyhist-group ahead dutyhist-sep">Next {AHEAD_DAYS} days — left: FT / DT / 168h cycle</th>
                <th colSpan={FT_WINDOWS.length + DT_WINDOWS.length} className="dutyhist-group totals dutyhist-sep">Rolling totals (used / max · left)</th>
              </tr>
              <tr>
                {days.map((iso, i) => {
                  const d = dayHeader(iso);
                  return (
                    <th key={iso} className={`past${d.weekend ? " weekend" : ""}${iso === todayIso ? " today" : ""}`} title={iso}>
                      <div>{i === 0 || d.dd === 1 ? `${d.dd}/${d.mm}` : d.dd}</div><div className="dutyhist-wd">{d.wd}</div>
                    </th>
                  );
                })}
                {aheadIsos.map((iso, i) => {
                  const d = dayHeader(iso);
                  return (
                    <th key={iso} className={`ahead${d.weekend ? " weekend" : ""}${i === 0 ? " dutyhist-sep" : ""}`} title={iso}>
                      <div>{i === 0 || d.dd === 1 ? `${d.dd}/${d.mm}` : d.dd}</div><div className="dutyhist-wd">{d.wd}</div>
                    </th>
                  );
                })}
                <th className="ahead dutyhist-remark-head" title="From the published roster (Pilot Roster - Duty Schedule)">Remark (roster)</th>
                {[...FT_WINDOWS, ...DT_WINDOWS].map((w, i) => (
                  <th key={w.key} className={`totals${i === 0 ? " dutyhist-sep" : ""}`}>{w.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ pilot, h, remark, rosterDays, preOffRr }, idx) => (
                <Fragment key={pilot.code}>
                {(idx === 0 || pilotGroup(visible[idx - 1].pilot) !== pilotGroup(pilot)) && (
                  <tr className="dutyhist-grouprow">
                    <td colSpan={totalCols}>
                      {GROUP_LABELS[pilotGroup(pilot)]}{" "}
                      <span className="dutyhist-grouprow-note">
                        ({visible.filter((v) => pilotGroup(v.pilot) === pilotGroup(pilot)).length}) · most green days in the next 7 first
                      </span>
                    </td>
                  </tr>
                )}
                <tr>
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
                  {h.ahead.map((a, i) => {
                    // A day the roster already gives away - RR or OFF (the 21/7
                    // RR pair and 7-day OFF block) - is shown in red: the hours
                    // may allow flying, but the pilot is not available.
                    const off = rosterOffLabel(rosterDays?.get(a.iso), a.iso, preOffRr);
                    // SL / VL: the pilot is away on leave - a red CELL, not
                    // just red text (Capt. Weera).
                    const leave = rosterLeaveLabel(rosterDays?.get(a.iso));
                    const why = leave ? `Roster: ${leave} - on leave, not available` : off ? `Roster: ${off} - not available` : "";
                    // Capt. Weera: VL / SL / OFF (and a limit reached) = red
                    // text on a red cell; the RR pair before a 7-day OFF = red
                    // text only.
                    const redCell = !!leave || off === "OFF";
                    const redText = off === "RR";
                    return (
                    <td key={a.iso} className={`dutyhist-ahead ${a.status}${redText ? " rostered-off" : ""}${redCell ? " rostered-redcell" : ""}${leave ? " rostered-leave" : ""}${i === 0 ? " dutyhist-sep" : ""}`}
                      title={why ? `${why}\n${aheadTitle(a)}` : aheadTitle(a)}>
                      <div className={`dutyhist-line ft ${a.ftStatus}`}>{a.left == null ? "—" : decimalToHHMM(a.left)}</div>
                      <div className={`dutyhist-line dt ${a.dtStatus}`}>{a.dtLeft == null ? "—" : decimalToHHMM(a.dtLeft)}</div>
                      <div className={`dutyhist-line rr ${a.cycle.status}`}>{a.cycle.label || "—"}</div>
                    </td>
                    );
                  })}
                  <td className="dutyhist-remark" title={remark.map((it) => it.text).join("\n") || "No RR / OFF / leave on the roster in the next 7 days"}>
                    {/* One running line, items separated by commas, so the row
                        only grows when the cell is genuinely full. */}
                    {remark.map((it, n) => (
                      <span key={it.from} className="dutyhist-chain">
                        {n > 0 && <span className="dutyhist-comma">, </span>}
                        {it.segments.map((s, i) => (
                          <span key={s.from}>
                            {i > 0 && <span className="dutyhist-arrow" aria-hidden="true">→</span>}
                            <span className={`dutyhist-chip ${s.category}`}>{s.text}</span>
                          </span>
                        ))}
                        {it.segments.length > 1 && (
                          <span className="dutyhist-chain-total">รวม {it.days}{it.continues ? "+" : ""}d</span>
                        )}
                      </span>
                    ))}
                  </td>
                  {h.totals.map((t, i) => (
                    <td key={t.key} className={`dutyhist-total ${t.status}${i === 0 ? " dutyhist-sep" : ""}`}
                      title={`${t.label}: ${decimalToHHMM(t.used)} used${t.max != null ? ` of ${decimalToHHMM(t.max)}, ${decimalToHHMM(Math.max(0, t.left))} left` : ""}`}>
                      <div className="dutyhist-used">{decimalToHHMM(t.used)}<small>/{t.max != null ? Math.round(t.max) : "—"}</small></div>
                      {t.left != null && <div className="dutyhist-left">{t.left > 0 ? `${decimalToHHMM(t.left)} left` : "none left"}</div>}
                    </td>
                  ))}
                </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
