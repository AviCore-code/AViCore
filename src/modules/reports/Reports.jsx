import { useState } from "react";
import ReportA from "./ReportA.jsx";
import ReportB from "./ReportB.jsx";
import "./Reports.css";

export default function Reports() {
  const [tab, setTab] = useState("A");

  return (
    <div className="reports-page">
      <div className="module-header no-print">
        <div>
          <h1>Reports</h1>
          <p>Summary reports for Admin</p>
        </div>
      </div>

      <div className="reports-tabs no-print">
        <button className={tab === "A" ? "active" : ""} onClick={() => setTab("A")}><span aria-hidden="true">🪪</span> Pilot Experience / Qualification</button>
        <button className={tab === "B" ? "active" : ""} onClick={() => setTab("B")}><span aria-hidden="true">✈️</span> Monthly Flight Time / Recency</button>
      </div>

      {tab === "A" ? <ReportA /> : <ReportB />}
    </div>
  );
}
