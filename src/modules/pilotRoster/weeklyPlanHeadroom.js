// "Has this pilot got enough left to be given flying?" - asked AS OF a
// particular date, not just today.
//
// This matters as soon as you plan more than a few days out. A pilot's
// standing on FDT Monitor is a snapshot of today; by day 25 of a 30-day plan
// it's meaningless, because the rolling windows have moved. A 28-day window
// ending on day 25 covers three days of history and twenty-five days of
// plan - so the check has to be recomputed for every date, looking back the
// full window from THAT date over recorded history plus everything already
// planned.
//
// Two things behave differently and are handled separately:
//
//   * DUTY TIME - the plan knows exactly how much duty each assignment
//     books (12h for Crew 1, 3h for a night standby), so the projection is
//     exact: recorded hours + planned hours.
//   * FLIGHT TIME - the plan does NOT know how many hours will actually be
//     flown. So flight time is projected from RECORDED history only, which
//     is still meaningful: as the window rolls forward, old flights drop out
//     and headroom grows. It answers "is this pilot's flight-time window
//     still blocked on that date?" without inventing future flying.
//
// Everything is reported the way the monitors report it: ok / warn (yellow,
// approaching) / exc (red, at or over).

const MS_PER_DAY = 86400000;

export function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function isoDiffDays(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

// Sum a { "YYYY-MM-DD": hours } map over the `days`-long window ending on
// (and including) endIso.
export function rollingSum(byDate, endIso, days) {
  if (!byDate) return 0;
  let total = 0;
  for (let i = 0; i < days; i++) {
    const key = isoAddDays(endIso, -i);
    total += (byDate instanceof Map ? byDate.get(key) : byDate[key]) || 0;
  }
  return total;
}

function classify(used, limit) {
  if (!limit) return "ok";
  if (limit.max != null && used >= limit.max) return "exc";
  if (limit.warn != null && used >= limit.warn) return "warn";
  return "ok";
}

const DUTY_WINDOWS = [
  { key: "dt7d", days: 7, label: "Duty Time 7 days" },
  { key: "dt14d", days: 14, label: "Duty Time 14 days" },
  { key: "dt28d", days: 28, label: "Duty Time 28 days" }
];

const FLIGHT_WINDOWS = [
  { key: "ft7d", days: 7, label: "Flight Time 7 days" },
  { key: "ft28d", days: 28, label: "Flight Time 28 days" },
  { key: "ft365d", days: 365, label: "Flight Time 365 days" }
];

// Headroom for one pilot on one date.
//   dutyByDate   - recorded PLUS planned duty hours (the caller merges them)
//   flightByDate - recorded flight hours only
export function headroomAsOf({ dutyByDate, flightByDate, limits, iso, addingHours = 0 }) {
  const metrics = [];
  let severity = "ok";

  function push(label, used, limit) {
    const status = classify(used, limit);
    if (status === "exc" || (status === "warn" && severity !== "exc")) severity = status;
    metrics.push({
      label,
      used: +used.toFixed(1),
      max: limit?.max ?? null,
      remaining: limit?.max != null ? +(limit.max - used).toFixed(1) : null,
      status
    });
  }

  for (const w of DUTY_WINDOWS) {
    push(w.label, rollingSum(dutyByDate, iso, w.days) + addingHours, limits?.[w.key]);
  }
  for (const w of FLIGHT_WINDOWS) {
    push(w.label, rollingSum(flightByDate, iso, w.days), limits?.[w.key]);
  }

  return { iso, severity, metrics, blocked: severity === "exc" };
}

// --- 168-hour Recovery Rest cycle, projected forward -----------------------
//
// OPS-CM-01 7.12.4: the next Recovery Rest must START within 168 hours of the
// end of the last qualifying one. Planning forward, the question is: does the
// plan leave the pilot a gap long enough to take that rest before the
// deadline? A pilot planned to work every day for three weeks will blow the
// cycle even though no individual day breaks a rule.
//
// This is deliberately coarse - it works in whole planned days, not exact
// clock times - because its job is to raise a yellow flag early enough to be
// fixed, not to replace the precise calculation FDT Monitor already does on
// recorded data.
export function projectRecoveryRestCycle({
  lastQualifyingRestEnd,
  plannedDutyDates,
  through,
  cycleMaxHours = 168,
  restMinHours = 36
}) {
  if (!lastQualifyingRestEnd) return { status: "ok", reason: null };
  const startIso = new Date(lastQualifyingRestEnd).toISOString().slice(0, 10);
  const dutyDays = new Set(plannedDutyDates || []);

  // Walk forward day by day looking for a gap of consecutive non-duty days
  // long enough to be a Recovery Rest. The cycle resets when one is found.
  let cycleStart = startIso;
  let freeRun = 0;
  const restDaysNeeded = Math.ceil(restMinHours / 24);

  for (let iso = startIso; isoDiffDays(iso, through) >= 0; iso = isoAddDays(iso, 1)) {
    if (dutyDays.has(iso)) {
      freeRun = 0;
    } else {
      freeRun += 1;
      if (freeRun >= restDaysNeeded) {
        cycleStart = iso;
        freeRun = 0;
        continue;
      }
    }
    const hoursIntoCycle = isoDiffDays(cycleStart, iso) * 24;
    if (hoursIntoCycle > cycleMaxHours) {
      return {
        status: "exc",
        reason: `no Recovery Rest planned before the 168h cycle expires (${iso})`,
        onDate: iso
      };
    }
    if (hoursIntoCycle > cycleMaxHours - restMinHours) {
      return {
        status: "warn",
        reason: `168h cycle runs out around ${iso} — plan a Recovery Rest (${restMinHours}h, 2 local nights) before then`,
        onDate: iso
      };
    }
  }
  return { status: "ok", reason: null };
}
