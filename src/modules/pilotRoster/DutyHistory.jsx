import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { loadAllPilotStatusRows, decimalToHHMM } from "../../utils/statusCompute.js";
import { listRoster } from "../../services/desktopDatabase.js";
import { pilotHistory, pastDays, localIso, FT_WINDOWS, DT_WINDOWS, rosterRemark, remarkLabel, preOffRrDays, simTrips, simReadiness, simDayMarks, simMarkText, REMARK_LOOKBACK_DAYS, REMARK_LOOKAHEAD_DAYS } from "./dutyHistory.js";
import SimTrainingPanel from "./SimTrainingPanel.jsx";
import DutyHistoryHelp from "./DutyHistoryHelp.jsx";
import { isoAddDays } from "./weeklyPlanHeadroom.js";
import "./PilotRoster.css";
import "./DutyHistory.css";

// Pilot Roster -> Duty & Flight History.
// Looks BACK at what each pilot actually flew and was on duty, day by day, and
// FORWARD at how much flight time the limits still allow over the next week -
// for planning who can be given flying. Read-only: the source is Daily Duty.

const RANGE_OPTIONS = [7, 14, 28, 56];
// Days ahead in the table (Capt. Weera, 20 Nov 2026: 7 -> 14).
const AHEAD_DAYS = 14;
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
export function nextWeekScore(h, rosterDays, preOffRr, simMarks = null) {
  const score = { green: 0, off: 0, red: 0 };
  for (const a of h?.ahead || []) {
    // A sim trip day, or a day before S/T that must stay free of duty, is not
    // a day to give flying either.
    const sim = simMarks?.get(a.iso);
    if (sim && (sim.kind === "trip" || sim.keepFree)) { score.off++; if (a.status === "exc") score.red++; continue; }
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
// personal: the Crew app's own-pilot view (one row, the signed-in pilot) -
// no search box and no Captain / Co-pilot group header.
export default function DutyHistory({ loadRows = loadAllPilotStatusRows, loadRoster = listRoster, personal = false }) {
  const [rows, setRows] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // One pilot on a phone or tablet: 14 days keeps the table readable.
  const [range, setRange] = useState(personal ? 14 : 28);
  const [search, setSearch] = useState("");
  // Legend details open / closed - remembered on this device only.
  const [legendOpen, setLegendOpenState] = useState(() => { try { return localStorage.getItem("dutyhist_legend") === "1"; } catch { return false; } });
  const setLegendOpen = (v) => { setLegendOpenState(v); try { localStorage.setItem("dutyhist_legend", v ? "1" : "0"); } catch { /* fine */ } };
  // Which group to show (Capt. Weera: see the Co-pilot rows without
  // scrolling past every Captain). "all" | 0 (Captain) | 1 (Co-pilot).
  // Remembered on this device only.
  const [groupShown, setGroupShownState] = useState(() => {
    try { const v = localStorage.getItem("dutyhist_group"); return v === "0" || v === "1" ? Number(v) : "all"; } catch { return "all"; }
  });
  const setGroupShown = (g) => {
    setGroupShownState(g);
    try { localStorage.setItem("dutyhist_group", String(g)); } catch { /* not stored - fine */ }
  };
  const [fullScreen, setFullScreen] = useState(false);
  // "table" = the history itself, "help" = the manual (TH / EN).
  const [view, setView] = useState("table");
  const [loadedAt, setLoadedAt] = useState(null);
  const [roster, setRoster] = useState([]);
  const [rosterError, setRosterError] = useState("");
  // Table zoom, set with -/+. Starts at 80% (Capt. Weera, 17 Nov 2026 - the
  // Fit button was removed).
  const [zoom, setZoom] = useState(0.8);
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
      const sims = simTrips(days, todayIso).map((t) => simReadiness(h, t, limits, days, todayIso));
      const simMarks = simDayMarks(sims, days);
      return {
        pilot: r.pilot,
        h,
        remark: rosterRemark(days, todayIso, AHEAD_DAYS),
        rosterDays: days,
        preOffRr,
        sims,
        simMarks,
        score: nextWeekScore(h, days, preOffRr, simMarks)
      };
    });
  }, [rows, limits, todayIso, loadedAt, rosterByPilot]);

  const q = search.trim().toLowerCase();
  const visible = sortForPlanning((q
    ? histories.filter(({ pilot }) => `${pilot.code} ${pilot.name}`.toLowerCase().includes(q))
    : histories).filter(({ pilot }) => personal || groupShown === "all" || pilotGroup(pilot) === groupShown));
  const groupCount = (g) => histories.filter(({ pilot }) => pilotGroup(pilot) === g).length;
  const totalCols = 1 + range + AHEAD_DAYS + 1 + FT_WINDOWS.length + DT_WINDOWS.length;
  const hasTable = visible.length > 0;

  useDragToScroll(scrollRef, hasTable);

  const scale = zoom;
  const stepZoom = (dir) => {
    const next = Math.round((scale + dir * ZOOM_STEP) * 10) / 10;
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)));
  };

  return (
    <div className={`roster-page dutyhist-page${fullScreen ? " roster-fullscreen" : ""}`}>
      {/* Compact header (Capt. Weera, 20 Nov 2026): title, view tabs and tools
          share one row so the table starts higher; the description moved to
          the title's tooltip (and the Help tab). */}
      <div className="module-header no-print dutyhist-head">
        <div className="dutyhist-titlebar">
          <h1 title={personal
            ? `What you have flown (FT) and been on duty (DT) day by day, your rolling totals, and the flight and duty time the limits still allow you over the next ${AHEAD_DAYS} days, with your roster.`
            : `What each pilot has flown (FT) and been on duty (DT) day by day, their rolling totals, and the flight time the limits still allow over the next ${AHEAD_DAYS} days - for planning who can be given flying.`}>Duty &amp; Flight History</h1>
          <div className="dutyhist-viewtabs" role="tablist" aria-label="Duty & Flight History view">
            <button type="button" role="tab" aria-selected={view === "table"} className={view === "table" ? "active" : ""} onClick={() => setView("table")}>📊 History</button>
            <button type="button" role="tab" aria-selected={view === "help"} className={view === "help" ? "active" : ""} onClick={() => setView("help")}>📖 Help · คู่มือ</button>
          </div>
        </div>
        <div className="header-tools">
          {!personal && <input className="roster-search" placeholder="Search pilot name/code..." value={search} onChange={(e) => setSearch(e.target.value)} />}
          {!personal && (
            <div className="dutyhist-groups" role="group" aria-label="Show pilots">
              {[["all", "All", histories.length], [0, GROUP_LABELS[0], groupCount(0)], [1, GROUP_LABELS[1], groupCount(1)]].map(([g, label, n]) => (
                <button key={label} type="button" aria-pressed={groupShown === g} className={groupShown === g ? "active" : ""} onClick={() => setGroupShown(g)}>
                  {label} <span className="dutyhist-groups-n">{n}</span>
                </button>
              ))}
            </div>
          )}
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
          </div>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {view === "help" && <DutyHistoryHelp />}

      {/* Hidden, not unmounted, so the table keeps its scroll position. */}
      <div className="dutyhist-view" hidden={view !== "table"}>
      {/* One line of colours; the full explanation opens on "Details". */}
      <details className="dutyhist-legend no-print" open={legendOpen} onToggle={(e) => setLegendOpen(e.currentTarget.open)}>
        <summary>
          <span><b className="dutyhist-swatch flight" /> Flight</span>
          <span><b className="dutyhist-swatch nonflight" /> Non-flight</span>
          <span><b className="dutyhist-swatch ok" /> OK</span>
          <span><b className="dutyhist-swatch warn" /> Near limit</span>
          <span><b className="dutyhist-swatch exc" /> Over / not available</span>
          <span>Next {AHEAD_DAYS} days: <b>FT</b> / DT / 168h</span>
          <span><b className="dutyhist-simtag">S/T</b> <b className="dutyhist-simtag">S</b> sim</span>
          <span className="dutyhist-legend-more">ℹ {legendOpen ? "Hide" : "Details"}</span>
        </summary>
        <div className="dutyhist-legend-body">
          <span><b className="dutyhist-swatch flight" /> Flight day: <b>FT</b> on top, DT below · <b className="dutyhist-swatch nonflight" /> Non-flight duty (DSB / NSB / GT …) with DT</span>
          <span>Next {AHEAD_DAYS} days: <b>FT left</b> / DT left / 168h cycle (hours until a 36h Recovery Rest must start; RR ✓ = resting now). Counts recorded duty only.</span>
          <span><b className="dutyhist-swatch exc" /> <b className="dutyhist-offtext">red text on a red cell</b> = roster OFF, SL / VL leave, or a limit reached (not available) · <b className="dutyhist-offtext">Red text</b> only = the RR pair right before a 7-day OFF</span>
          <span><b className="dutyhist-simtag">S/T</b> positioning to / from the sim · <b className="dutyhist-simtag">S</b> sim training · <b className="dutyhist-simtag">Free · S/T −3</b> keep free of duty before S/T (DT 7D on S/T must cover 10h a trip day; FT 4h a sim day) · <b className="dutyhist-simtag">RR ok</b> an RR here carries the trip in the 168h cycle</span>
          <span>🖱 Drag the table to move it.</span>
        </div>
      </details>

      {error && <div className="settings-msg error">Could not load duty records: {error}</div>}
      {rosterError && <div className="settings-msg error">Remark column: could not load the roster ({rosterError}). Hours are unaffected.</div>}
      {!loading && !error && visible.length === 0 && <div className="mystatus-empty">{personal ? "No duty records found for you yet." : "No pilots found."}</div>}

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
              {visible.map(({ pilot, h, remark, rosterDays, preOffRr, simMarks }, idx) => (
                <Fragment key={pilot.code}>
                {!personal && (idx === 0 || pilotGroup(visible[idx - 1].pilot) !== pilotGroup(pilot)) && (
                  <tr className="dutyhist-grouprow">
                    <td colSpan={totalCols}>
                      {GROUP_LABELS[pilotGroup(pilot)]}{" "}
                      <span className="dutyhist-grouprow-note">
                        ({visible.filter((v) => pilotGroup(v.pilot) === pilotGroup(pilot)).length}) · most green days in the next {AHEAD_DAYS} first
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
                    // Sim training (Capt. Weera): the 7 days before S/T and
                    // the trip itself are marked, so the run-up is planned.
                    const sim = simMarks?.get(a.iso);
                    const awayDay = !!leave || !!off || ["rest", "off", "leave"].includes(remarkLabel(rosterDays?.get(a.iso))?.category);
                    const simCls = sim ? (sim.kind === "trip" ? " sim-trip" : sim.kind === "after" ? (sim.left < 24 ? " sim-after-rr" : " sim-after") : sim.rrOk && !awayDay ? " sim-rrok" : sim.keepFree && !awayDay ? " sim-keepfree" : " sim-lead") : "";
                    const simTag = sim ? (sim.kind === "trip" ? (sim.code || "SIM") : sim.kind === "after" ? (sim.left < 24 ? "RR · after S/T" : `${Math.floor(sim.left)}h · after S/T`) : awayDay ? `S/T −${sim.daysTo}` : sim.rrOk ? `RR ok · S/T −${sim.daysTo}` : sim.keepFree ? `Free · S/T −${sim.daysTo}` : `≤${decimalToHHMM(sim.spare)} · S/T −${sim.daysTo}`) : "";
                    const tip = [why, sim ? simMarkText(sim) : "", aheadTitle(a)].filter(Boolean).join("\n");
                    return (
                    <td key={a.iso} className={`dutyhist-ahead ${a.status}${redText ? " rostered-off" : ""}${redCell ? " rostered-redcell" : ""}${leave ? " rostered-leave" : ""}${simCls}${i === 0 ? " dutyhist-sep" : ""}`}
                      title={tip}>
                      {simTag && <div className="dutyhist-simtag">{simTag}</div>}
                      <div className={`dutyhist-line ft ${a.ftStatus}`}>{a.left == null ? "—" : decimalToHHMM(a.left)}</div>
                      <div className={`dutyhist-line dt ${a.dtStatus}`}>{a.dtLeft == null ? "—" : decimalToHHMM(a.dtLeft)}</div>
                      <div className={`dutyhist-line rr ${a.cycle.status}`}>{a.cycle.label || "—"}</div>
                    </td>
                    );
                  })}
                  <td className="dutyhist-remark" title={remark.map((it) => it.text).join("\n") || `No RR / OFF / leave on the roster in the next ${AHEAD_DAYS} days`}>
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

      {!personal && <SimTrainingPanel items={histories.flatMap(({ pilot, sims }) => sims.map((sim) => ({ pilot, sim })))} />}
      </div>
    </div>
  );
}
