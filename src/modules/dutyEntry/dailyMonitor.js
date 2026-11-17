// Daily Duty Monitor (Capt. Weera, 17 Nov 2026): as the start and end times
// of each duty in a day are typed, show each Duty Period's limits live -
// FDP against Max FDP (OPS-CM-01 7.4.1, by report time, reduced by a long
// standby per 7.9.2(g)), daily flight time against the 7.4.1 flight-time
// cap when there is flying, and standby length (7.17.3.4, 12h) and
// standby + FDP (7.9.2(b), 18h) when a standby is involved.
//
// Pure: takes the Duty Periods buildDutyPeriods() already made (saved
// entries + both form drafts) and returns rows for DailyDutyMonitor.jsx.

import { entryToInterval } from "../../utils/dutyPeriods.js";

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isStandby = (e) => e.dutyType === "non_flight" && /standby/i.test(String(e.nonFlightType || ""));
const addHours = (d, h) => new Date(d.getTime() + h * 3600000);

// "ok" under the limit, "warn" from 90% of it, "exc" over it. With an
// extension (Max FDP + 2h unforeseen, 7.4.3): over the limit but within the
// extension is "warn", beyond it "exc".
export function limitStatus(used, limit, extLimit = null) {
  if (limit == null) return "info";
  if (used > limit) return extLimit != null && used <= extLimit ? "warn" : "exc";
  if (used >= limit * 0.9) return "warn";
  return "ok";
}

function bar({ key, label, used, limit, extLimit = null, note = "" }) {
  return { key, label, used, limit, extLimit, remaining: limit == null ? null : limit - used, status: limitStatus(used, limit, extLimit), note };
}

// The standby run at the head of a period that never escalated (a quiet
// standby): its own raw start/end.
function quietStandbySpan(period) {
  const ivs = period.entries.map(entryToInterval).filter(Boolean).filter((iv) => isStandby(iv.entry));
  if (!ivs.length || period.entries.some((e) => !isStandby(e) && entryToInterval(e))) return null;
  const start = ivs.reduce((m, iv) => (iv.start < m ? iv.start : m), ivs[0].start);
  const end = ivs.reduce((m, iv) => (iv.end > m ? iv.end : m), ivs[0].end);
  return { start, end, hours: (end - start) / 3600000 };
}

// One card per Duty Period that starts or ends on `date` ("YYYY-MM-DD").
export function dailyMonitor(periods, date, limits) {
  if (!date) return [];
  const ext = limits.dutyPeriodUnforeseenExtensionHours ?? 2;
  return (periods || [])
    .filter((p) => dayKey(p.start) === date || dayKey(p.end) === date || (p.standby && dayKey(p.standby.start) === date))
    .map((p) => {
      const quiet = !p.hasFlight && !p.standby ? quietStandbySpan(p) : null;
      const kind = p.mixed ? "mixed" : p.hasFlight ? "flight" : quiet ? "standby" : "duty";
      const bars = [];
      const notes = [];

      if (p.standby) {
        bars.push(bar({ key: "stby", label: "Standby", used: p.standby.hours, limit: limits.standbyMaxHours }));
      }
      if (quiet) {
        bars.push(bar({ key: "stby", label: "Standby", used: quiet.hours, limit: limits.standbyMaxHours,
          note: `counts ${limits.stbyCreditPercent}% as duty` }));
      }
      if (p.hasFlight) { // flight or mixed
        bars.push(bar({ key: "fdp", label: "FDP", used: p.fdpHours, limit: p.maxFdp, extLimit: p.maxFdp + ext }));
        notes.push({ key: "latest", label: "Latest engine stop", at: addHours(p.start, p.maxFdp) });
        if (p.mixed) bars.push(bar({ key: "mix", label: "Mixed Duty", used: p.mixedDutyHours, limit: p.maxFdp, extLimit: p.maxFdp + ext, note: "flight + ground vs Max FDP" }));
        if (p.maxFt != null) bars.push(bar({ key: "ft", label: "Flight time", used: p.ftHours, limit: p.maxFt }));
      } else if (kind === "duty") {
        // No flight yet: Max FDP doesn't judge a non-flight day, but show
        // what applies if this duty runs into a flight.
        bars.push(bar({ key: "duty", label: "Duty", used: p.durationHours, limit: null }));
        notes.push({ key: "ifFly", label: "If flying: latest engine stop", at: addHours(p.start, p.maxFdp) });
      }
      if (p.standby) {
        bars.push(bar({ key: "awake", label: "Standby + FDP", used: p.standby.hours + p.fdpHours, limit: limits.standbyPlusFdpMaxAwakeHours }));
      }

      const rank = { exc: 3, warn: 2, ok: 1, info: 0 };
      const status = bars.reduce((s, b) => (rank[b.status] > rank[s] ? b.status : s), "ok");
      return {
        kind, from: p.standby?.start || quiet?.start || p.start, start: p.start, end: p.end, status, bars, notes,
        maxFdp: p.maxFdp, maxFt: p.maxFt, reducedBy: p.standby?.reductionHours || 0,
        dutyHours: p.durationHours
      };
    });
}
