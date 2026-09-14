import { useState } from "react";
import DutySchedule from "./DutySchedule.jsx";
import WeeklySchedule from "./WeeklySchedule.jsx";
import "./PilotRoster.css";

// Pilot Roster holds the two forward-looking views of the fleet:
//   * Duty Schedule  - the PUBLISHED month calendar of duty codes
//                      (O/X/RR/N/...), imported from the roster workbook.
//   * Weekly Schedule - the PLANNING board for the coming week (which crew
//                      flies, who's on night standby, who's off), modelled
//                      on the company's "SKL Weekly Plan" spreadsheet.
// Hours Summary used to be a third tab here; it moved to the FDT tab bar
// next to All Status (see modules/flightCrews/FlightCrews.jsx).
const TABS = [
  { key: "schedule", label: "Duty Schedule", icon: "🗓️", Component: DutySchedule },
  { key: "weekly", label: "Weekly Schedule", icon: "📆", Component: WeeklySchedule }
];

export default function PilotRoster() {
  const [tab, setTab] = useState("schedule");
  const Active = TABS.find((t) => t.key === tab)?.Component;

  return (
    <div className="pilotroster-tabwrap">
      <div className="pilotroster-tabs no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`pilotroster-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {Active && <Active />}
    </div>
  );
}
