import { useEffect, useState } from "react";
import DutyHistory from "../modules/pilotRoster/DutyHistory.jsx";
import { loadOnePilotStatusRows } from "../utils/statusCompute.js";
import { getPreferredPilotCode, listRoster } from "../services/desktopDatabase.js";

// Duty & Flight History for the signed-in pilot only (Capt. Weera: each
// pilot sees their own). Same screen and rules as the Admin tab - past days,
// next 7 days with the 168h cycle and roster colours, rolling totals - with
// one row: theirs. The roster is read for that pilot alone.
export default function MyDutyHistory() {
  const [code, setCode] = useState(null);
  useEffect(() => {
    let alive = true;
    getPreferredPilotCode()
      .then((c) => { if (alive) setCode(String(c || "").trim().toUpperCase()); })
      .catch(() => { if (alive) setCode(""); });
    return () => { alive = false; };
  }, []);

  if (code === null) return <div className="mystatus-empty">Loading…</div>;
  if (!code) return <div className="mystatus-empty">Sign in as a pilot to see your Duty &amp; Flight History.</div>;
  return (
    <DutyHistory
      key={code}
      personal
      loadRows={() => loadOnePilotStatusRows(code)}
      loadRoster={async (range) => ((await listRoster(range)) || [])
        .filter((r) => String(r.pilot_code || r.pilotCode || "").trim().toUpperCase() === code)}
    />
  );
}
