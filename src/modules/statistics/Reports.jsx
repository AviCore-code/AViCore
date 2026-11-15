import { useState } from "react";
import FdtStatistics from "./FdtStatistics.jsx";
import FtMonthlyHr from "./FtMonthlyHr.jsx";
import DtWorkHr from "./DtWorkHr.jsx";
import PairCheck from "./PairCheck.jsx";
import "./FtMonthlyHr.css";

// Admin → Reports → Statistics & Reports: the FDT & Fatigue statistics, and
// FT Monthly for HR (each pilot's flight time per day for the pay run), and
// DT Work for HR (roster days worked / overtime per pilot).
const VIEWS = [
  { key: "stats", label: "📈 Statistics", Component: FdtStatistics },
  { key: "hr", label: "🧾 FT Monthly for HR", Component: FtMonthlyHr },
  { key: "dt", label: "🗓️ DT Work for HR", Component: DtWorkHr },
  { key: "pair", label: "👥 Pair Check", Component: PairCheck }
];
const KEY = "avicore_reports_view";

export default function Reports() {
  const [view, setView] = useState(() => {
    try { return (VIEWS.some((v) => v.key === localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : "stats"); } catch { return "stats"; }
  });
  const choose = (v) => { setView(v); try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } };
  const Active = VIEWS.find((v) => v.key === view).Component;
  return (
    <div>
      <div className="reports-tabs no-print" role="tablist" aria-label="Reports">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? "active" : ""} onClick={() => choose(v.key)}>{v.label}</button>
        ))}
      </div>
      <Active />
    </div>
  );
}
