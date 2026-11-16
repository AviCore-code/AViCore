// Daily Duty - hours per flight, totals for the day (Capt. Weera, 16 Nov 2026:
// "ลงข้อมูลทุกเที่ยว และบรรทัดสุดท้ายสรุป total").
//
// Each flight (leg) carries its own Role, Day / Night, IFR, IMC, Onshore,
// Offshore, T/O, Landing and I.App. The entry keeps the day's TOTALS in the
// same fields it always had (totalFlightTime, roles, ifrRulesHours, ifrHours,
// onshoreHours, offshoreHours, toDay ... iApp), so FDT Monitor, Logbook,
// Experience / PES and the reports read it exactly as before.

export const LEG_TIME_FIELDS = ["dayHours", "nightHours", "ifrRulesHours", "ifrHours", "onshoreHours", "offshoreHours"];
export const LEG_COUNT_FIELDS = ["toDay", "toNight", "landDay", "landNight", "iApp"];

export function hhmmToMin(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}
export function minToHHMM(min) {
  const v = Math.max(0, Math.round(min || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

// A flight's flight time = its Day + Night.
export const legFlightMin = (leg) => hhmmToMin(leg?.dayHours) + hhmmToMin(leg?.nightHours);

const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const sumTime = (legs, f) => legs.reduce((a, l) => a + hhmmToMin(l?.[f]), 0);
const sumCount = (legs, f) => legs.reduce((a, l) => a + (parseInt(l?.[f], 10) || 0), 0);

// The day's totals, in the entry's own field names.
export function totalsFromLegs(legs) {
  const list = legs || [];
  const total = list.reduce((a, l) => a + legFlightMin(l), 0);
  const roles = [];
  for (const l of list) {
    const role = l?.role || "PIC";
    const day = hhmmToMin(l?.dayHours);
    const night = hhmmToMin(l?.nightHours);
    let r = roles.find((x) => x.role === role);
    if (!r) { r = { role, day: 0, night: 0 }; roles.push(r); }
    r.day += day;
    r.night += night;
  }
  const time = (f) => (list.some((l) => hasValue(l?.[f])) ? minToHHMM(sumTime(list, f)) : "");
  const count = (f) => (list.some((l) => hasValue(l?.[f])) ? String(sumCount(list, f)) : "");
  return {
    totalFlightTime: list.some((l) => hasValue(l?.dayHours) || hasValue(l?.nightHours)) ? minToHHMM(total) : "",
    roles: roles.length ? roles.map((r) => ({ role: r.role, dayHours: minToHHMM(r.day), nightHours: minToHHMM(r.night) })) : [{ role: "PIC", dayHours: "", nightHours: "" }],
    ifrRulesHours: time("ifrRulesHours"),
    ifrHours: time("ifrHours"),
    onshoreHours: time("onshoreHours"),
    offshoreHours: time("offshoreHours"),
    toDay: count("toDay"),
    toNight: count("toNight"),
    landDay: count("landDay"),
    landNight: count("landNight"),
    iApp: count("iApp"),
    // Who flew each flight - the same shape the FDT import keeps (Pair Check).
    crew: list.filter((l) => l?.rs || l?.ls).map((l) => ({ rs: String(l.rs || "").toUpperCase(), ls: String(l.ls || "").toUpperCase() }))
  };
}

// An entry saved before the hours moved onto each flight (or imported from an
// FDT file) has only the day's totals. Opening it puts those totals on flight 1
// so the Σ row still shows what was saved; the other flights start empty.
export function legsWithHours(entry, legs) {
  const list = (legs || []).map((l) => ({ ...l }));
  const perLeg = list.some((l) => [...LEG_TIME_FIELDS, ...LEG_COUNT_FIELDS].some((f) => hasValue(l[f])));
  if (perLeg || !list.length) return list.map((l) => ({ role: "PIC", ...l }));
  const roles = Array.isArray(entry?.roles) ? entry.roles : [];
  const day = roles.reduce((a, r) => a + hhmmToMin(r.dayHours), 0);
  const night = roles.reduce((a, r) => a + hhmmToMin(r.nightHours), 0);
  const ft = hhmmToMin(entry?.totalFlightTime);
  list[0] = {
    ...list[0],
    role: roles[0]?.role || "PIC",
    // Role hours can be blank on old entries - then the whole Total Flight Time is day.
    dayHours: day + night > 0 ? minToHHMM(day) : (ft ? minToHHMM(ft) : ""),
    nightHours: day + night > 0 ? minToHHMM(night) : "",
    ifrRulesHours: entry?.ifrRulesHours || "",
    ifrHours: entry?.ifrHours || "",
    onshoreHours: entry?.onshoreHours || "",
    offshoreHours: entry?.offshoreHours || "",
    toDay: entry?.toDay ?? "", toNight: entry?.toNight ?? "", landDay: entry?.landDay ?? "", landNight: entry?.landNight ?? "", iApp: entry?.iApp ?? ""
  };
  return list.map((l, i) => (i === 0 ? l : { role: list[0].role, ...l }));
}

// Flights (1-based) whose Onshore + Offshore are more than their flight time.
export function legsOverOnOffshore(legs) {
  const out = [];
  (legs || []).forEach((l, i) => {
    if (hhmmToMin(l?.onshoreHours) + hhmmToMin(l?.offshoreHours) > legFlightMin(l)) out.push(i + 1);
  });
  return out;
}
