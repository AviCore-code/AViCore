// Sample data for the DEMO login's home page.
//
// DEMO is a view-only account with no records of its own, so the dashboard
// opened completely empty - every card zero, no chart, no schedule. That is a
// poor first impression of a product whose whole point is what it shows.
//
// Three rules this file exists to keep:
//
//   1. It is only ever reached from isDemoPilotCode(). A real pilot's page
//      cannot fall back to it - an empty dashboard for a real pilot is a fact
//      about their records and must stay visible as one.
//   2. It is DUTY ENTRIES, not pre-computed totals. The demo runs through the
//      same summariseYear / computeStats / classifyTrainingValue as everyone
//      else, so what is on screen is really calculated - and if that maths
//      breaks, the demo breaks too and we find out.
//   3. It is generated relative to TODAY, so the demo never goes stale. A
//      hard-coded 2026 would look abandoned in 2028.
//
// The page also labels itself as sample data; see CrewDashboard.jsx.

const AIRCRAFT = "AW139";
const MATES = ["NSO", "PCH", "CSU", "KTO", "TYO", "DBH"];

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A believable offshore month: roughly 9 flying days, a couple of standbys,
// 3-5 hours a day. Deterministic from (year, month, day) rather than random,
// so the demo looks the same on every reload - a chart that reshuffles itself
// each time you refresh looks broken rather than lively.
function seeded(y, m, d) {
  const n = Math.sin(y * 1000 + m * 37 + d * 7) * 10000;
  return n - Math.floor(n);
}

function flightEntry(date, r) {
  const hours = 3 + Math.floor(r * 3);          // 3-5 h
  const minutes = r > 0.5 ? 30 : 0;
  const total = `${hours}:${String(minutes).padStart(2, "0")}`;
  return {
    id: `demo_${date}`,
    pilotCode: "DEMO",
    date,
    dutyType: "flight",
    flightType: "Revenue Flight",
    schDep: "06:30",
    stop: "17:30",
    aircraftType: AIRCRAFT,
    registration: "HS-AVI",
    legs: [{ aircraftType: AIRCRAFT, registration: "HS-AVI", route: "VTBS-PLATFORM-VTBS" }],
    totalFlightTime: total,
    roles: [{ role: "PIC", dayHours: total, nightHours: "" }],
    offshoreHours: total,
    flightsPerDay: "2"
  };
}

function standbyEntry(date) {
  const next = new Date(date + "T00:00:00");
  next.setDate(next.getDate() + 1);
  return {
    id: `demo_sby_${date}`,
    pilotCode: "DEMO",
    date,
    dutyType: "non_flight",
    nonFlightType: "Night Standby",
    start: "17:30",
    end: "05:30",
    endDate: iso(next),
    remark: "Sample data"
  };
}

// Two full years of history so the year selector and the previous-year
// comparison line both have something to show.
export function demoDutyEntries(today = new Date()) {
  const entries = [];
  const thisYear = today.getFullYear();

  for (const year of [thisYear - 1, thisYear]) {
    for (let month = 1; month <= 12; month++) {
      // Don't invent the future: the current year stops at today, which is
      // also what makes the "in progress" month render correctly.
      if (year === thisYear && month > today.getMonth() + 1) break;

      for (let day = 2; day <= 28; day += 3) {
        if (year === thisYear && month === today.getMonth() + 1 && day > today.getDate()) break;
        const r = seeded(year, month, day);
        if (r < 0.25) continue;                  // ~1 day in 4 off
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        entries.push(flightEntry(date, r));
      }

      const sbyDay = 12;
      if (!(year === thisYear && month === today.getMonth() + 1 && sbyDay > today.getDate())) {
        entries.push(standbyEntry(`${year}-${String(month).padStart(2, "0")}-${String(sbyDay).padStart(2, "0")}`));
      }
    }
  }
  return entries;
}

// Training dates spread so the panel shows a realistic mix: one close, one
// mid-range, the rest comfortable. Nothing expired - a demo that opens on a
// red "EXPIRED" badge misrepresents the product.
export function demoTrainingRecord(today = new Date()) {
  const plus = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return iso(d);
  };
  return {
    huet: plus(24),
    lpc: plus(68),
    medical: plus(83),
    opc2: plus(120),
    crm: plus(150),
    thaiLicense: plus(220),
    passport: plus(400),
    night: plus(45),
    lineCheck: plus(190),
    dgs: plus(160),
    sms: plus(210),
    avsec: plus(230),
    fireFighting: plus(175),
    firstAids: plus(185)
  };
}

// A week's lines for the "This week" panel, keyed the way the weekly plan
// stores them so the dashboard's own lookup code is exercised unchanged.
export function demoWeeklyPlan(weekStartIso) {
  const day = (n) => {
    const d = new Date(weekStartIso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  return [
    { date: day(0), section: "crew1", slot: 0, pilot_code: "DEMO" },
    { date: day(0), section: "crew1", slot: 1, pilot_code: MATES[0] },
    { date: day(2), section: "crew3", slot: 0, pilot_code: "DEMO" },
    { date: day(2), section: "crew3", slot: 1, pilot_code: MATES[2] },
    { date: day(4), section: "nightStandby1", slot: 0, pilot_code: "DEMO" },
    { date: day(4), section: "nightStandby1", slot: 1, pilot_code: MATES[1] },
    { date: day(5), section: "crew2", slot: 0, pilot_code: MATES[3] },
    { date: day(5), section: "crew2", slot: 1, pilot_code: MATES[4] }
  ];
}

export const DEMO_PROFILE = { code: "DEMO", name: "Demo Pilot", position: "Captain" };
