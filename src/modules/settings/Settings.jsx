import { useEffect, useState } from "react";
import { getSetting, listTraining } from "../../services/desktopDatabase.js";
import { withTrainingThresholdDefaults, withTrainingDisabledDefaults, withTrainingDurationDefaults } from "../../utils/trainingDue.js";
import TrainingSettingsTab from "../trainingDue/TrainingSettingsTab.jsx";
import FlightCrewSettingsTab from "./FlightCrewSettingsTab.jsx";
import AdminSettingsTab from "./AdminSettingsTab.jsx";
import FatigueCriteriaTab from "./FatigueCriteriaTab.jsx";
import "./Settings.css";

const TABS = [
  { key: "flightCrew", label: "Flight Crew Setting", icon: "👥" },
  { key: "training", label: "Training Setting", icon: "🎓" },
  { key: "fatigue", label: "Fatigue Criteria", icon: "😴" },
  { key: "admin", label: "Admin Setting", icon: "🛠️" }
];

// Settings hub - three tabs grouped by what the setting is actually about,
// rather than one long page mixing crew-specific numbers (FTL Limits, Fleet
// Configuration) with training thresholds and app-wide/system config (Sync,
// License, Software Update, Branding, ...). The Training tab reuses the same
// threshold editor that used to live inside the Training page's own
// "Settings" tab - now there's a single place to edit it instead of two.
export default function Settings() {
  const [tab, setTab] = useState("flightCrew");
  const [trainingThresholds, setTrainingThresholds] = useState(withTrainingThresholdDefaults());
  const [trainingDisabledItems, setTrainingDisabledItems] = useState(withTrainingDisabledDefaults());
  const [trainingPilots, setTrainingPilots] = useState([]);
  const [trainingDurations, setTrainingDurations] = useState(withTrainingDurationDefaults());

  useEffect(() => { refreshTraining(); }, []);

  async function refreshTraining() {
    const [saved, savedDisabled, savedDurations, pilots] = await Promise.all([
      getSetting("training_thresholds"),
      getSetting("training_disabled_items"),
      getSetting("training_durations"),
      listTraining()
    ]);
    setTrainingThresholds(withTrainingThresholdDefaults(saved));
    setTrainingDisabledItems(withTrainingDisabledDefaults(savedDisabled));
    setTrainingDurations(withTrainingDurationDefaults(savedDurations));
    setTrainingPilots(pilots);
  }

  return (
    <div className="settings-page">
      <div className="settings-hub-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`settings-hub-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="settings-hub-tab-body">
        {tab === "flightCrew" && <FlightCrewSettingsTab />}
        {tab === "training" && <TrainingSettingsTab thresholds={trainingThresholds} disabledItems={trainingDisabledItems} durations={trainingDurations} pilots={trainingPilots} onSaved={refreshTraining} />}
        {tab === "fatigue" && <FatigueCriteriaTab />}
        {tab === "admin" && <AdminSettingsTab />}
      </div>
    </div>
  );
}
