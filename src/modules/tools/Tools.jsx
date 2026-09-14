import { useState } from "react";
import PilotExperienceBuilder from "../pilotExperience/PilotExperienceBuilder.jsx";
import DutyImport from "../dutyImport/DutyImport.jsx";
import "./Tools.css";

// Pilot Experience Builder and Import FDT are both one-off/setup admin
// utilities rather than day-to-day pages, so they share a single "Tools"
// menu entry with a tab switcher. Each keeps its own header/title below.
export default function Tools() {
  const [tab, setTab] = useState("experience");

  return (
    <div className="tools-page">
      <div className="tools-tabs">
        <button className={tab === "experience" ? "active" : ""} onClick={() => setTab("experience")}><span aria-hidden="true">🪪</span> Pilot Experience</button>
        <button className={tab === "import" ? "active" : ""} onClick={() => setTab("import")}><span aria-hidden="true">📥</span> Import FDT</button>
      </div>

      {tab === "experience" ? <PilotExperienceBuilder /> : <DutyImport />}
    </div>
  );
}
