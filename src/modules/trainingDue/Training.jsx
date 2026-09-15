import { useEffect, useState } from "react";
// isWeb covers Crew + admin - Admin-only is handled by import.meta.env.MODE === "admin".
// isAdminBuild is captured at module-load time so TABS below reflects the build target.
const isAdminBuild = import.meta.env.MODE === "admin";
import { listTraining, getSetting } from "../../services/desktopDatabase.js";
import { TRAINING_ITEMS, withTrainingThresholdDefaults, withTrainingDisabledDefaults } from "../../utils/trainingDue.js";
import TrainingAllStatus from "./TrainingAllStatus.jsx";
import TrainingPersonStatus from "./TrainingPersonStatus.jsx";
import TrainingInput from "./TrainingInput.jsx";
import TrainingImportTab from "./TrainingImportTab.jsx";
import StaffTraining from "../staffTraining/StaffTraining.jsx";
import "./Training.css";

const TABS = [
  { key: "all", label: "All Training Status", icon: "📋" },
  { key: "person", label: "Person Training Status", icon: "👤" },
  { key: "input", label: "Input", icon: "✍️" },
  { key: "import", label: "Import PDF / Excel", icon: "📥" },
  ...(isAdminBuild ? [{ key: "staff", label: "All Staff Training", icon: "👥" }] : []),
];

// Flight crew training/certificate module - one main page with four
// sections (see TABS above). Fleet-wide data (pilots + thresholds) is
// loaded once here and passed down, so switching tabs never needs a fresh
// round trip; each tab that mutates data (Input, Import) takes a refresh()
// callback to pull the latest state back into this shared state after a
// save/import. The Caution-threshold editor that used to be a fifth tab
// here now lives in the main Settings page's "Training Setting" tab (see
// src/modules/settings/Settings.jsx) - one place to edit it instead of two.
export default function Training() {
  const [tab, setTab] = useState("all");
  const [pilots, setPilots] = useState([]);
  const [thresholds, setThresholds] = useState(withTrainingThresholdDefaults());
  const [disabledItems, setDisabledItems] = useState(withTrainingDisabledDefaults());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    const [list, savedThresholds, savedDisabled] = await Promise.all([
      listTraining(),
      getSetting("training_thresholds"),
      getSetting("training_disabled_items")
    ]);
    setPilots(list);
    setThresholds(withTrainingThresholdDefaults(savedThresholds));
    setDisabledItems(withTrainingDisabledDefaults(savedDisabled));
    setLoading(false);
  }

  return (
    <div className="training-page">
      <div className="module-header">
        <div>
          <h1>Training</h1>
          <p>Flight crew training and certificate records ({TRAINING_ITEMS.length} items per pilot) — due-date monitoring, manual entry, document attachments, and Excel import in one place.</p>
        </div>
      </div>

      <div className="training-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`training-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span aria-hidden="true">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="training-tab-body">
        {tab === "all" && <TrainingAllStatus pilots={pilots} thresholds={thresholds} disabledItems={disabledItems} loading={loading} onRefresh={refresh} />}
        {tab === "person" && <TrainingPersonStatus pilots={pilots} thresholds={thresholds} disabledItems={disabledItems} loading={loading} />}
        {tab === "input" && <TrainingInput pilots={pilots} onSaved={refresh} />}
        {tab === "import" && <TrainingImportTab pilots={pilots} thresholds={thresholds} onImported={refresh} />}
        {tab === "staff" && <StaffTraining />}
      </div>
    </div>
  );
}
