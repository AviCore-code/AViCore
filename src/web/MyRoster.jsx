import { useEffect, useMemo, useState } from "react";
import { listRoster, getPairedPilotCode } from "../services/webDatabase.js";
import { CODE_LEGEND, CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_STYLE, CODE_STYLE, getCodeInfo } from "../modules/pilotRoster/rosterCodes.js";
import "./MyRoster.css";

// The published duty roster, as pilots see it: THE WHOLE FLEET, read-only.
//
// Showing everyone rather than only the signed-in pilot is deliberate and was
// asked for: a pilot needs to know who else is on, who they are flying with,
// and who to ask to swap - none of which is answerable from one's own row.
// Their own row is highlighted so it is still findable at a glance.
//
// Read-only in the real sense: there is no edit path in this page at all, and
// the database will not accept a roster write from a pilot's key either (see
// sql/fix-all-table-permissions.sql). Both, deliberately - a screen that looks
// editable and then fails is worse than one that never offered.

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthRange(anchorIso) {
  const [y, m] = anchorIso.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  return { from: toIso(first), to: toIso(last), days: last.getDate(), year: y, month: m };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function MyRoster() {
  const [anchor, setAnchor] = useState(() => toIso(new Date()));
  const [rows, setRows] = useState([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullScreen, setFullScreen] = useState(false);

  const range = useMemo(() => monthRange(anchor), [anchor]);

  useEffect(() => { getPairedPilotCode().then((c) => setMe(String(c || "").toUpperCase())); }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    listRoster({ from: range.from, to: range.to })
      .then((list) => { if (alive) setRows(list || []); })
      .catch((err) => { if (alive) setError(err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range.from, range.to]);

  // pilot -> date -> code
  const byPilot = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const code = String(r.pilot_code || "").toUpperCase();
      if (!code) continue;
      if (!map.has(code)) map.set(code, { name: r.pilot_name || "", days: new Map() });
      map.get(code).days.set(r.date, r.code);
    }
    // Own row first, then alphabetical: the pilot's own line is what they open
    // this for, and hunting for it in a fleet list every time is friction.
    return [...map.entries()].sort((a, b) => {
      if (a[0] === me) return -1;
      if (b[0] === me) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [rows, me]);

  const days = useMemo(
    () => Array.from({ length: range.days }, (_, i) => {
      const iso = `${range.year}-${String(range.month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
      return { iso, day: i + 1, weekday: WEEKDAY[new Date(range.year, range.month - 1, i + 1).getDay()] };
    }),
    [range]
  );

  function shiftMonth(delta) {
    const [y, m] = anchor.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setAnchor(toIso(d));
  }

  const todayIso = toIso(new Date());

  return (
    <div className={`myroster-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header no-print">
        <div>
          <h1>Roster</h1>
          <p>Published duty roster for the whole fleet — view only</p>
        </div>
        <div className="myroster-tools">
          <button onClick={() => shiftMonth(-1)}>‹ Prev</button>
          <b>{MONTHS[range.month - 1]} {range.year}</b>
          <button onClick={() => shiftMonth(1)}>Next ›</button>
          <button onClick={() => window.print()}>Print</button>
          <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
        </div>
      </div>

      {error && <div className="myroster-error">Couldn't load the roster: {error}</div>}
      {loading && <p className="myroster-note">Loading…</p>}
      {!loading && !error && byPilot.length === 0 && (
        <p className="myroster-note">No roster published for this month yet.</p>
      )}

      {byPilot.length > 0 && (
        <div className="myroster-scroll">
          <table className="myroster-table">
            <thead>
              <tr>
                <th className="myroster-code-col">Code</th>
                {days.map((d) => (
                  <th key={d.iso} className={d.iso === todayIso ? "today" : ""}>
                    <span className="myroster-dow">{d.weekday}</span>
                    <span>{d.day}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byPilot.map(([code, info]) => (
                <tr key={code} className={code === me ? "mine" : ""}>
                  <th className="myroster-code-col">
                    {code}
                    {code === me && <small>you</small>}
                  </th>
                  {days.map((d) => {
                    const raw = info.days.get(d.iso);
                    const meta = getCodeInfo(raw);
                    const style = meta ? (CODE_STYLE[meta.code] || CATEGORY_STYLE[meta.category]) : null;
                    return (
                      <td
                        key={d.iso}
                        className={d.iso === todayIso ? "today" : ""}
                        style={style ? { color: style.fg } : undefined}
                        title={meta ? `${meta.code} — ${meta.label}` : ""}
                      >
                        {raw || ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="myroster-legend">
        {CATEGORY_ORDER.filter((c) => c !== "unknown").map((c) => (
          <span key={c} style={{ color: CATEGORY_STYLE[c].fg }}>
            {CODE_LEGEND.filter((x) => x.category === c).map((x) => x.code).join(" ")} = {CATEGORY_LABELS[c]}
          </span>
        ))}
      </div>
    </div>
  );
}
