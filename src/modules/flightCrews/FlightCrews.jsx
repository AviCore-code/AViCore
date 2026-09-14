import { useState } from "react";
import AllStatus from "../allStatus/AllStatus.jsx";
import Tools from "../tools/Tools.jsx";
import PilotRoster from "../pilotRoster/PilotRoster.jsx";
import HoursSummary from "../pilotRoster/HoursSummary.jsx";
import MyLogbook from "../myLogbook/MyLogbook.jsx";
import Reports from "../reports/Reports.jsx";
import DutyEntry from "../dutyEntry/DutyEntry.jsx";
import { isWeb } from "../../services/desktopDatabase.js";
import "./FlightCrews.css";

// Groups the crew-data Admin pages that were previously separate sidebar
// entries (All Status, Tools, Pilot Roster, Logbook, Reports) under one
// "Flight Crews" sidebar entry with an internal tab bar - same pattern as
// the Training page's tabs. Each tab renders the existing page component
// completely untouched (no props needed, each one loads its own data), so
// none of those five modules had to change. Settings is deliberately NOT
// included here - it's app-wide/system configuration, not flight crew data,
// so it now lives at its own top-level "Settings" sidebar entry (see
// src/modules/settings/Settings.jsx) alongside Dashboard/Training/Flight
// Crews rather than nested a level down under a crew-specific page.
// The third slot differs by build. On PC, Daily Duty already has its own
// sidebar entry (App.jsx, "My Flight Data"), so this slot stays Pilot Roster.
// On the web/admin build the two are swapped: Pilot Roster is promoted to a
// top-level tab right of Dashboard, and Daily Duty takes its place here.
const MIDDLE_TAB = isWeb()
  ? { key: "duty", label: "Daily Duty", icon: "📝", Component: DutyEntry }
  : { key: "pilotRoster", label: "Pilot Roster", icon: "🗓️", Component: PilotRoster };

const TABS = [
  { key: "allStatus", label: "All Status", icon: "📋", Component: AllStatus },
  // Hours Summary sits straight after All Status: both are fleet-wide,
  // one-row-per-pilot compliance views, so they read as a pair. It used to
  // be the second tab inside Pilot Roster (see PilotRoster.jsx).
  { key: "hours", label: "Hours Summary", icon: "⏱️", Component: HoursSummary },
  { key: "tools", label: "Import & Setup", icon: "📥", Component: Tools },
  MIDDLE_TAB,
  { key: "logbook", label: "Logbook", icon: "📔", Component: MyLogbook },
  { key: "reports", label: "Report", icon: "📈", Component: Reports }
];

export default function FlightCrews() {
  const [tab, setTab] = useState("allStatus");
  const Active = TABS.find((t) => t.key === tab)?.Component;

  return (
    <div className="flightcrews-page">
      <div className="flightcrews-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`flightcrews-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="flightcrews-tab-body">
        {Active && <Active />}
      </div>
    </div>
  );
}
