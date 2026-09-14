import { useEffect, useMemo, useRef, useState } from "react";
import { listExperience, addDutyEntry, listDutyEntriesByPilot, deleteDutyEntry, updateDutyEntry, getSetting, getPreferredPilotCode, isSinglePilotDevice, isDemoSession } from "../../services/desktopDatabase.js";
import DateField, { isoToDisplay } from "../../components/DateField.jsx";
import { playClick, playOk, playError } from "../../utils/clickSound.js";
import TimeField from "../../components/TimeField.jsx";
import { DEFAULT_FLEET_CONFIG, withFleetDefaults } from "../../utils/fleetConfig.js";
import { DEFAULT_FTL_LIMITS, withFtlDefaults } from "../../utils/ftlLimits.js";
import { buildDutyPeriods, periodDutyCreditHours, entryToInterval } from "../../utils/dutyPeriods.js";
import { decimalToHHMM, formatDateTime, STATUS_LABEL, entryDutyHours } from "../../utils/statusCompute.js";
import "./DutyEntry.css";
import { todayIso } from "../../utils/dateKeys.js";

const FLIGHT_TYPES = ["Revenue Flight", "Ferry Flight", "Test Flight", "Training", "Simulator", "Other"];
const DUTY_ROLES = ["PIC", "PICUS", "SIC", "TRI", "TRE"];
// "Positioning" and standby are non-flying duties. "Night Standby" spans
// two calendar days (see the end-date field), so non-flight entries carry
// their own endDate (defaults to the start date).
const NON_FLIGHT_TYPES = ["Day Standby", "Night Standby", "Positioning", "Ground Training", "Meeting", "Travel", "Office", "Ground Run", "Other"];
const DEFAULT_AIRCRAFT_TYPE = "AW139";
const today = () => todayIso();

function hhmmToMin(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
}
function minToHHMM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

// Live guard, called right after any edit that could push Role hours over
// the day's Total Flight Time - Day + Night combined across every Role row
// must never exceed it. Pops an alert immediately (no need to wait for
// Save) but doesn't block typing; the pilot just needs to fix it before
// saving (handleSave re-checks this too as a final guard).
function checkRoleHours(roles, totalFlightTime) {
  const totalMin = hhmmToMin(totalFlightTime);
  const roleMin = roles.reduce((sum, r) => sum + hhmmToMin(r.dayHours) + hhmmToMin(r.nightHours), 0);
  if (roleMin > totalMin) {
    window.alert(
      `Role hours (Day + Night = ${minToHHMM(roleMin)}) exceed Total Flight Time (${minToHHMM(totalMin)}).\n\nPlease correct the Role Day/Night hours.`
    );
  }
}

// Same live-guard pattern as checkRoleHours, for the other pair that must
// never exceed the day's Total Flight Time: Onshore + Offshore combined.
function checkOnOffshoreHours(onshoreHours, offshoreHours, totalFlightTime) {
  const totalMin = hhmmToMin(totalFlightTime);
  const sumMin = hhmmToMin(onshoreHours) + hhmmToMin(offshoreHours);
  if (sumMin > totalMin) {
    window.alert(
      `Onshore + Offshore (${minToHHMM(sumMin)}) exceed Total Flight Time (${minToHHMM(totalMin)}).\n\nPlease correct the Onshore/Offshore hours.`
    );
  }
}

// A leg's Aircraft Type/Registration default to the previous leg's values
// (the common case is one aircraft all day), but stay fully editable per
// leg for days that switch aircraft mid-duty.
const blankLeg = (prev) => ({
  aircraftType: prev?.aircraftType || DEFAULT_AIRCRAFT_TYPE,
  registration: prev?.registration || "",
  rs: "", ls: "", route: ""
});

const blankFlight = () => ({
  date: today(), flightType: FLIGHT_TYPES[0],
  legs: [blankLeg()],
  aircraftType: DEFAULT_AIRCRAFT_TYPE, registration: "", route: "",
  // No crewNumber here: the Crew is derived from schDep by the Fatigue Monitor
  // rather than typed in - see the note by the removed field below.
  schDep: "", stop: "", flightsPerDay: "1", totalFlightTime: "",
  roles: [{ role: "PIC", dayHours: "", nightHours: "" }],
  // ifrRulesHours = IFR flight-rules time, ifrHours = IMC (time in cloud).
  // Two separate figures - see the fields in the form below.
  ifrRulesHours: "", ifrHours: "", onshoreHours: "", offshoreHours: "",
  toDay: "", toNight: "", landDay: "", landNight: "", iApp: ""
});
const blankNonFlight = () => ({ date: today(), endDate: today(), nonFlightType: NON_FLIGHT_TYPES[0], start: "", end: "", remark: "" });

// Entries saved before the multi-leg redesign have no legs array - synthesize
// a single leg from their old flat aircraftType/registration/route/
// totalFlightTime fields so editing an old entry doesn't show an empty list.
function legsFromEntry(entry) {
  if (Array.isArray(entry.legs) && entry.legs.length) return entry.legs;
  return [{
    aircraftType: entry.aircraftType || DEFAULT_AIRCRAFT_TYPE,
    registration: entry.registration || "",
    rs: "", ls: "",
    route: entry.route || ""
  }];
}

// Ensures a <select>'s current value always has a matching <option>, even
// if it isn't in the configured fleet list (legacy data, or before the
// admin has set up Fleet Configuration) - otherwise the select silently
// shows blank instead of the real saved value.
function withCurrentOption(list, current) {
  if (!current || list.includes(current)) return list;
  return [current, ...list];
}

export default function DutyEntry() {
  const [pilots, setPilots] = useState([]);
  const [pilotCode, setPilotCode] = useState("");
  const [dutyType, setDutyType] = useState("flight");
  const [flight, setFlight] = useState(blankFlight());
  const [nonFlight, setNonFlight] = useState(blankNonFlight());
  const [entries, setEntries] = useState([]);
  const [msg, setMsg] = useState("");
  const [editingId, setEditingId] = useState(null);
  // Where "Edit" scrolls to. The entry list is below the form, so without this
  // an edit loaded into a form that was off the top of the screen and looked
  // as though the button had done nothing.
  const formRef = useRef(null);
  const [fleet, setFleet] = useState(DEFAULT_FLEET_CONFIG);
  const [limits, setLimits] = useState(DEFAULT_FTL_LIMITS);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    Promise.all([listExperience(), getPreferredPilotCode()]).then(([list, preferred]) => {
      setPilots(list);
      if (list.length && !pilotCode) setPilotCode(preferred || list[0].code);
    });
    getSetting("fleet_config").then((saved) => setFleet(withFleetDefaults(saved)));
    getSetting("ftl_limits").then((saved) => setLimits(withFtlDefaults(saved)));
  }, []);

  // Actual Duty for the date currently being entered - the real, calculated
  // Duty Period from buildDutyPeriods, INCLUDING any Standby that escalated
  // into it per OPS-CM-01 7.9.2 (see dutyPeriods.js). Shown next to the
  // pilot's name so "what's my actual duty today" is visible right where
  // the pilot is logging it, not just on the FDT Monitor page.
  //
  // Recalculates live as the pilot types time fields into the form, before
  // Save is even pressed - built from the SAVED entries plus BOTH the
  // Flight Duty and Non-Flight Duty tab's current draft, not just whichever
  // tab happens to be visible right now. A Mixed Duty day (e.g. a Meeting
  // logged on the Non-Flight tab immediately followed by a flight) needs
  // both tabs' typed-but-not-yet-saved data at once to preview correctly -
  // switching tabs to type the flight shouldn't drop the meeting that was
  // just typed into the other tab before Save was pressed (reported by the
  // Capt: Total Duty wasn't adding the FDT-tab and non-FDT-tab values
  // together). If an existing entry is being edited (editingId set), its
  // stale saved copy is swapped out for the matching tab's live draft so it
  // isn't counted twice. A draft missing required time fields (e.g. Stop
  // not filled in yet) naturally contributes nothing - entryToInterval
  // returns null for it, same as any other incomplete entry, so
  // buildDutyPeriods just ignores it until there's enough to compute a span.
  const isEditingFlight = editingId != null && dutyType === "flight";
  const isEditingNonFlight = editingId != null && dutyType === "non_flight";
  const flightDraft = useMemo(() => (
    { ...flight, dutyType: "flight", id: isEditingFlight ? editingId : "__draft_flight__" }
  ), [flight, isEditingFlight, editingId]);
  const nonFlightDraft = useMemo(() => (
    { ...nonFlight, dutyType: "non_flight", id: isEditingNonFlight ? editingId : "__draft_nonflight__" }
  ), [nonFlight, isEditingNonFlight, editingId]);
  const entriesForActualDuty = useMemo(() => {
    const base = entries.filter((e) => e.id !== editingId);
    return [...base, flightDraft, nonFlightDraft];
  }, [entries, flightDraft, nonFlightDraft, editingId]);
  const dutyPeriods = useMemo(() => buildDutyPeriods(entriesForActualDuty, limits), [entriesForActualDuty, limits]);
  const activeDate = dutyType === "flight" ? flight.date : nonFlight.date;
  const todayPeriod = useMemo(() => {
    if (!activeDate) return null;
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return dutyPeriods.find((p) => key(p.start) === activeDate || key(p.end) === activeDate) || null;
  }, [dutyPeriods, activeDate]);

  // Actual Duty as displayed here = Last Engine Stop + 0:30 (post-flight) -
  // (Sch Dep - 1:00 report buffer) - confirmed to use the SAME {start, end}
  // as the regulatory max-FDP compliance figure (todayPeriod.end/
  // durationHours already are exactly this - see the comment on
  // deriveAdjusted in dutyPeriods.js), so no separate "unpadded" figure is
  // kept here anymore.
  const actualEnd = todayPeriod?.end ?? null;
  const actualDurationHours = todayPeriod?.durationHours ?? null;
  // Headline Actual Duty hours credited for the day, per OPS-CM-01 7.9.2(c):
  // 25% of the Standby time + the actual FDT that followed it (or, for a
  // "quiet" Standby that never escalated, just 25% of its raw duration; for
  // an ordinary flying day with no Standby involved, the full actual FDT).
  // Same formula/function used for the DT 7/14/28-day rolling sums in
  // statusCompute.js, so this figure always matches what that day
  // contributes there.
  const actualDutyCreditHours = todayPeriod ? periodDutyCreditHours(todayPeriod, limits) : null;
  // A Standby day that never escalated into a flight (no flight entries,
  // never merged with a report) - shown as "25% credit only" rather than
  // the Max FDP note, which doesn't apply when there was no actual duty.
  const isPureStandbyDay = !!todayPeriod && !todayPeriod.hasFlight && !todayPeriod.standby &&
    todayPeriod.entries.length > 0 &&
    todayPeriod.entries.every((e) => e.dutyType === "non_flight" && (e.nonFlightType === "Day Standby" || e.nonFlightType === "Night Standby"));

  // A day made up only of plain non-flight duty (Meeting/Office/Positioning/
  // Ground Training etc.) with NO flight and NO Standby - counts at full
  // value, so the whole thing is non-FDT in the Total Actual Duty breakdown
  // (there's no flight portion to call FDT). Distinct from a Standby-only
  // day (isPureStandbyDay, 25% credit) and from a Mixed Duty day where a
  // meeting leads into a flight (hasFlight, folded into FDT).
  const isPlainNonFlightDay = !!todayPeriod && !todayPeriod.hasFlight && !todayPeriod.standby &&
    !isPureStandbyDay && todayPeriod.entries.length > 0 &&
    todayPeriod.entries.every((e) => e.dutyType === "non_flight");

  // Raw Start-Stop clock range for a pure ("quiet", never called out)
  // Standby day - todayPeriod.start/end themselves aren't usable here (they
  // carry the report-buffer padding meant for an escalated report, which
  // never happened on a quiet Standby day - see periodDutyCreditHours's own
  // comment on this same distinction), so this re-derives the real logged
  // span straight from the entries, same as that function does.
  const pureStandbySpan = useMemo(() => {
    if (!isPureStandbyDay) return null;
    const ivs = todayPeriod.entries.map(entryToInterval).filter(Boolean);
    if (!ivs.length) return null;
    return {
      start: ivs.reduce((min, iv) => (iv.start < min ? iv.start : min), ivs[0].start),
      end: ivs.reduce((max, iv) => (iv.end > max ? iv.end : max), ivs[0].end)
    };
  }, [isPureStandbyDay, todayPeriod]);

  // The FDT/non-FDT breakdown lines must always literally add up to the
  // headline total shown above them - previously each figure was rounded to
  // H:MM independently (decimalToHHMM on the raw decimal hours), which could
  // land the two halves a minute off from the rounded total (e.g. total
  // 6:53 but FDT 5:00 + non-FDT 1:52 only summing to 6:52), reported by the
  // Capt as "the numbers are separate/don't match". Fixed by rounding the
  // total and FDT to minutes first, then deriving non-FDT as the remainder -
  // guarantees FDT + non-FDT == total exactly, every time.
  const totalCreditMin = actualDutyCreditHours != null ? Math.round(actualDutyCreditHours * 60) : null;
  const fdtMin = actualDurationHours != null ? Math.round(actualDurationHours * 60) : null;
  const nonFdtCreditMin = (totalCreditMin != null && fdtMin != null) ? totalCreditMin - fdtMin : null;

  // Total Actual Duty is presented as an explicit sum the Capt asked for:
  //   Actual FDT time  +  Post-flight  +  non-FDT time  =  Total
  // fdtMin above is the whole flight-side duty span (report -1:00 through
  // Last Engine Stop +0:30), which already INCLUDES the post-flight buffer -
  // so to show post-flight on its own line, pull it back out of FDT here:
  //   postFlightMin       = the +0:30 buffer (only when there's a flight)
  //   fdtExPostMin        = FDT span from report through Last Engine Stop,
  //                         i.e. fdtMin minus that buffer
  //   topNonFdtMin        = the day's non-FDT contribution: Standby's 25%
  //                         credit (escalated or quiet), or a plain
  //                         non-flight duty's full value, else 0
  // These three always add back up to totalCreditMin exactly.
  const postFlightMin = (todayPeriod && todayPeriod.hasFlight) ? Math.round(limits.dutyPostFlightOffsetMinutes) : 0;
  const fdtExPostMin = (fdtMin != null && todayPeriod && todayPeriod.hasFlight) ? Math.max(0, fdtMin - postFlightMin) : 0;
  const topNonFdtMin = !todayPeriod ? 0
    : (isPureStandbyDay || isPlainNonFlightDay) ? totalCreditMin
    : (todayPeriod.standby ? nonFdtCreditMin : 0);

  // The field shown INSIDE each tab's own form is that tab's own slice of
  // the day, not the combined Mixed Duty total (which is already shown up
  // top in the Actual Duty box).
  //
  // Flight Duty tab -> "Actual FDT": the flight portion of today's merged
  // duty period (report -1:00 through Last Engine Stop +0:30). A pure
  // Standby day with no flight has none, so it reads 0:00.
  const actualFdtMin = !todayPeriod ? null : (isPureStandbyDay ? 0 : fdtMin);
  const actualFdtDisplay = actualFdtMin != null ? minToHHMM(actualFdtMin) : "0:00";

  // Non-Flight Duty tab -> "Actual non-FDT": the duty time of the
  // non-flight entry CURRENTLY in the form, computed straight from its own
  // Start/End (and endDate) as soon as both times are filled.
  //
  // Plain non-flight duty (Meeting, Office, Positioning, Ground Training,
  // etc.) counts at full value. Day/Night Standby is credited at
  // stbyCreditPercent (25%), with the exact OPS-CM-01 7.9.2 rule the Capt
  // specified for WHICH span the 25% applies to:
  //   - If a flight's Scheduled Departure time falls INSIDE the standby
  //     window, the standby duty STOPS at (Sch Dep - 1:00) - i.e. the
  //     standby ends when the pre-flight report buffer begins, not when the
  //     logged standby end says. Credit = 25% x (Sch Dep - 1:00 - stby
  //     start).
  //   - If there is no Scheduled Departure, or it falls OUTSIDE the standby
  //     window, the standby ran its full logged course. Credit = 25% x
  //     (stby stop - stby start).
  const nonFlightHasTimes = !!(nonFlight.start && nonFlight.end);
  const draftIsStandby = nonFlight.nonFlightType === "Day Standby" || nonFlight.nonFlightType === "Night Standby";
  const actualNonFdtHours = useMemo(() => {
    if (!nonFlightHasTimes) return 0;
    if (!draftIsStandby) return entryDutyHours(nonFlightDraft, limits);
    const sb = entryToInterval(nonFlightDraft);
    if (!sb) return 0;
    const stbyStart = sb.start;
    let stbyStop = sb.end;
    // Every flight (the one being drafted plus any already-saved that day)
    // whose Sch Dep datetime lands inside [stbyStart, logged stby stop].
    const depsInWindow = [flightDraft, ...entries.filter((e) => e.dutyType === "flight" && e.id !== editingId)]
      .map(entryToInterval)
      .filter(Boolean)
      .map((iv) => iv.start)
      .filter((dep) => dep >= stbyStart && dep <= sb.end)
      .sort((a, b) => a - b);
    if (depsInWindow.length) {
      stbyStop = new Date(depsInWindow[0].getTime() - limits.dutyReportOffsetMinutes * 60000);
    }
    const hours = Math.max(0, (stbyStop - stbyStart) / 3600000);
    return hours * (limits.stbyCreditPercent / 100);
  }, [nonFlightHasTimes, draftIsStandby, nonFlightDraft, flightDraft, entries, editingId, limits]);
  const actualNonFdtDisplay = decimalToHHMM(actualNonFdtHours);

  // Esc exits Full Screen - same pattern used across the app.
  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  useEffect(() => {
    if (pilotCode) refreshEntries();
    else setEntries([]);
  }, [pilotCode]);

  async function refreshEntries() {
    setEntries(await listDutyEntriesByPilot(pilotCode));
  }

  function updateRole(i, field, value) {
    const roles = [...flight.roles];
    roles[i] = { ...roles[i], [field]: value };
    setFlight({ ...flight, roles });
    if (field === "dayHours" || field === "nightHours") checkRoleHours(roles, flight.totalFlightTime);
  }
  function addRole() {
    setFlight({ ...flight, roles: [...flight.roles, { role: "PIC", dayHours: "", nightHours: "" }] });
  }
  function removeRole(i) {
    setFlight({ ...flight, roles: flight.roles.filter((_, idx) => idx !== i) });
  }

  // Flights/Day, top-level Aircraft Type/Registration, and the composed
  // Route text are derived defaults recomputed from the legs on every leg
  // change - still plain editable inputs, so typing a different value after
  // editing legs overrides them until the legs change again. Total Flight
  // Time is no longer derived from legs (the per-leg Flight Time field was
  // removed) - it's entered once, manually, at the top of the form.
  function applyLegs(legs) {
    const route = legs.filter((l) => l.route).map((l) => l.route).join("/");
    setFlight({
      ...flight,
      legs,
      flightsPerDay: String(legs.length),
      aircraftType: legs[0]?.aircraftType || "",
      registration: legs[0]?.registration || "",
      route
    });
  }
  function updateLeg(i, field, value) {
    applyLegs(flight.legs.map((leg, idx) => (idx === i ? { ...leg, [field]: value } : leg)));
  }
  function addLeg() {
    applyLegs([...flight.legs, blankLeg(flight.legs[flight.legs.length - 1])]);
  }
  function removeLeg(i) {
    if (flight.legs.length <= 1) return;
    applyLegs(flight.legs.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!pilotCode) { setMsg("Select a pilot first."); return; }
    const base = dutyType === "flight" ? flight : nonFlight;
    if (!base.date) { setMsg("Enter a date first."); return; }

    // Guard: across every Role row, Day + Night hours combined must never
    // exceed that day's Total Flight Time - a pilot can't log more role
    // hours than they actually flew. Checked here (on Save) rather than on
    // every keystroke so mid-edit states (e.g. Day filled in before Night)
    // don't trigger a false alarm.
    if (dutyType === "flight") {
      const totalMin = hhmmToMin(flight.totalFlightTime);
      const roleMin = flight.roles.reduce((sum, r) => sum + hhmmToMin(r.dayHours) + hhmmToMin(r.nightHours), 0);
      if (roleMin > totalMin) {
        window.alert(
          `Role hours (Day + Night = ${minToHHMM(roleMin)}) exceed Total Flight Time (${minToHHMM(totalMin)}).\n\nPlease correct the Role Day/Night hours before saving.`
        );
        return;
      }
      const onOffMin = hhmmToMin(flight.onshoreHours) + hhmmToMin(flight.offshoreHours);
      if (onOffMin > totalMin) {
        window.alert(
          `Onshore + Offshore (${minToHHMM(onOffMin)}) exceed Total Flight Time (${minToHHMM(totalMin)}).\n\nPlease correct the Onshore/Offshore hours before saving.`
        );
        return;
      }
    }

    // Total Duty is saved as-shown at the moment of Save - this entry's own
    // tab-specific slice (Actual FDT for a Flight entry, Actual non-FDT for
    // a Non-Flight entry), computed live above from buildDutyPeriods/
    // periodDutyCreditHours, not a separately editable value, so it can
    // never drift from what was on screen.
    const withTotalDuty = { pilotCode, dutyType, ...base, totalDuty: dutyType === "flight" ? actualFdtDisplay : actualNonFdtDisplay };

    try {
      if (editingId != null) {
        await updateDutyEntry(pilotCode, editingId, withTotalDuty);
        setMsg(`Updated — ${pilotCode} on ${base.date}`);
        playOk();
        setEditingId(null);
      } else {
        await addDutyEntry(withTotalDuty);
        setMsg(`Saved — ${pilotCode} on ${base.date}`);
        playOk();
      }
      if (dutyType === "flight") setFlight(blankFlight());
      else setNonFlight(blankNonFlight());
      await refreshEntries();
    } catch (err) {
      setMsg("Save failed: " + err.message);
      playError();
    }
  }

  // Opening an entry saved BEFORE the form had separate IFR and IMC boxes.
  //
  // Back then one field labelled "IFR Hours" wrote to `ifrHours`. Capt. Weera
  // confirmed pilots were typing IFR flight-rules time into it, not time in
  // cloud - so on such an entry the value belongs in the IFR box, and IMC should
  // start empty rather than inheriting a number that was never IMC.
  //
  // Detected by `ifrRulesHours` being absent entirely: every entry saved by the
  // new form has the key (even as ""), and FDT-imported entries have always set
  // both. Nothing is written back here - the entry is only corrected in the form,
  // and takes effect if the pilot saves it.
  function splitLegacyIfr(entry) {
    if (entry.ifrRulesHours !== undefined) return {};
    if (!entry.ifrHours) return {};
    return { ifrRulesHours: entry.ifrHours, ifrHours: "" };
  }

  function handleEdit(entry) {
    playClick();
    setDutyType(entry.dutyType);
    if (entry.dutyType === "flight") setFlight({ ...blankFlight(), ...entry, ...splitLegacyIfr(entry), legs: legsFromEntry(entry) });
    else setNonFlight({ ...blankNonFlight(), ...entry });
    setEditingId(entry.id);
    setMsg("");

    // Bring the form into view and put the cursor in it. The entry list sits
    // BELOW the form, so pressing Edit on a row further down used to load the
    // entry into a form that was off the top of the screen - it looked as
    // though nothing had happened, and the obvious next move (press it again)
    // did nothing either.
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      // Focus the form's first field once the scroll has settled - focusing
      // immediately makes the browser jump there instead of animating.
      // Queried rather than passed down as a ref: the first field differs
      // between the Flight and Non-Flight forms, and threading a ref through
      // both would break the moment either form's first field changed.
      setTimeout(() => {
        const first = document.querySelector(".duty-form input, .duty-form select");
        first?.focus?.();
      }, 400);
    });
  }

  function handleCancelEdit() {
    playClick();
    setEditingId(null);
    if (dutyType === "flight") setFlight(blankFlight());
    else setNonFlight(blankNonFlight());
    setMsg("");
  }

  async function handleDelete(id) {
    playClick();
    const entry = entries.find((e) => e.id === id);
    const when = entry?.date ? ` (${entry.date})` : "";
    if (!confirm(`Delete this duty entry${when}?\n\nThis cannot be undone.`)) return;

    // Deleting used to be silent in BOTH directions: no confirmation, and no
    // word either way afterwards. A failure looked exactly like a success that
    // hadn't refreshed yet, which is why this appeared "not to work".
    setMsg("");
    try {
      await deleteDutyEntry(pilotCode, id);
      if (editingId === id) {
        setEditingId(null);
        if (dutyType === "flight") setFlight(blankFlight()); else setNonFlight(blankNonFlight());
      }
      await refreshEntries();
      setMsg("Deleted.");
      playOk();
    } catch (err) {
      setMsg("Delete failed: " + err.message);
      playError();
    }
  }

  return (
    <div className={`duty-entry-page${fullScreen ? " page-fullscreen" : ""}`}>
      <div className="module-header">
        <div>
          <h1>Daily Duty</h1>
          <p>Log a pilot's daily duty — Flight Duty or Non-Flight Duty</p>
        </div>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <div className="duty-entry-toprow" ref={formRef}>
        <div className="duty-entry-topleft">
          <label className="duty-entry-pilot">
            <span>Pilot</span>
            {isSinglePilotDevice() && !isDemoSession() ? (
              <span className="duty-entry-pilot-name">
                {(() => { const p = pilots.find((x) => x.code === pilotCode); return p ? `${p.code} — ${p.name}` : pilotCode; })()}
              </span>
            ) : (
              <select value={pilotCode} onChange={(e) => setPilotCode(e.target.value)}>
                <option value="">— Select pilot —</option>
                {pilots.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
              </select>
            )}
          </label>

          {activeDate && (
            <div className="duty-entry-actual">
              <span>Total Actual Duty — {isoToDisplay(activeDate)}</span>
              {todayPeriod ? (
                <>
                  <div className="duty-entry-actual-row">
                    <span className="duty-entry-actual-hours">{decimalToHHMM(actualDutyCreditHours)} hrs</span>
                    <span className={`duty-entry-actual-badge ${todayPeriod.status}`}>{STATUS_LABEL[todayPeriod.status]}</span>
                  </div>
                  <div className="duty-entry-actual-breakdown">
                    {todayPeriod.hasFlight && (
                      <>
                        <div>Actual FDT: {minToHHMM(fdtExPostMin)} hrs</div>
                        <div>+ Post-flight: {minToHHMM(postFlightMin)} hrs</div>
                      </>
                    )}
                    {todayPeriod.standby && (
                      <div>
                        + non-FDT (Standby ×25%): {minToHHMM(nonFdtCreditMin)} hrs
                        <span className="duty-entry-actual-substby">
                          {" "}(Standby {formatDateTime(todayPeriod.standby.start)} – {formatDateTime(todayPeriod.standby.end)}, {decimalToHHMM(todayPeriod.standby.hours)} hrs)
                        </span>
                      </div>
                    )}
                    {isPureStandbyDay && (
                      <div>
                        + non-FDT (Standby ×25%, not called out): {minToHHMM(totalCreditMin)} hrs
                        {pureStandbySpan && (
                          <span className="duty-entry-actual-substby">
                            {" "}(Standby {formatDateTime(pureStandbySpan.start)} – {formatDateTime(pureStandbySpan.end)})
                          </span>
                        )}
                      </div>
                    )}
                    {isPlainNonFlightDay && (
                      <div>+ non-FDT (non-flight duty): {minToHHMM(totalCreditMin)} hrs</div>
                    )}
                    {todayPeriod.hasFlight && !todayPeriod.standby && (
                      <div>+ non-FDT: {minToHHMM(topNonFdtMin)} hrs</div>
                    )}
                    <div className="duty-entry-actual-eq">= Total Actual Duty: {minToHHMM(totalCreditMin)} hrs</div>
                  </div>
                  <div className="duty-entry-actual-note">
                    {formatDateTime(todayPeriod.start)} – {formatDateTime(actualEnd)}
                    {todayPeriod.hasFlight && <> • Max FDP {decimalToHHMM(todayPeriod.maxFdp)} hrs</>}
                    {todayPeriod.hasFlight && todayPeriod.standby && todayPeriod.standby.reductionHours > 0 && (
                      <span className="duty-entry-actual-substby">
                        {" "}(reduced {decimalToHHMM(todayPeriod.standby.reductionHours)} — Standby {decimalToHHMM(todayPeriod.standby.hours)} hrs over 6:00)
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="duty-entry-actual-note">No duty logged yet for this date</div>
              )}
            </div>
          )}
        </div>

        <div className="duty-entry-tabs">
          <button className={dutyType === "flight" ? "active" : ""} onClick={() => setDutyType("flight")}>Flight Duty</button>
          <button className={dutyType === "non_flight" ? "active" : ""} onClick={() => setDutyType("non_flight")}>Non-Flight Duty</button>
        </div>
      </div>

      {dutyType === "flight" ? (
        <FlightForm
          flight={flight} setFlight={setFlight}
          updateRole={updateRole} addRole={addRole} removeRole={removeRole}
          updateLeg={updateLeg} addLeg={addLeg} removeLeg={removeLeg}
          fleet={fleet} pilots={pilots}
          actualFdtDisplay={actualFdtDisplay}
        />
      ) : (
        <NonFlightForm nonFlight={nonFlight} setNonFlight={setNonFlight} actualNonFdtDisplay={actualNonFdtDisplay} />
      )}

      <div className="duty-entry-actions">
        <button className="primary" onClick={handleSave}>{editingId != null ? "Update Entry" : "Save Entry"}</button>
        <button onClick={handleCancelEdit}>{editingId != null ? "Cancel" : "Clear"}</button>
        {msg && <span className="duty-entry-msg">{msg}</span>}
      </div>

      <h3 className="duty-entry-listtitle">Recent Entries{pilotCode ? ` — ${pilotCode}` : ""}</h3>
      <div className="duty-entry-list">
        {entries.length === 0 && <div className="duty-entry-empty">No entries for this pilot yet.</div>}
        {entries.map((e) => (
          <div key={e.id} className={`duty-entry-row${editingId === e.id ? " editing" : ""}`}>
            <span className={`duty-entry-tag ${e.dutyType}`}>{e.dutyType === "flight" ? "Flight" : (e.nonFlightType || "Non-Flight")}</span>
            <span className="duty-entry-date">{isoToDisplay(e.date)}</span>
            <span className="duty-entry-summary">
              {e.dutyType === "flight"
                ? `${e.flightType} · ${e.aircraftType || "-"} (${e.registration || "-"}) · ${e.route || "-"} · FT ${e.totalFlightTime || "0:00"}${e.legs?.length > 1 ? ` · ${e.legs.length} legs` : ""}`
                : `${e.nonFlightType} · ${e.start || "-"}–${e.end || "-"}${e.remark ? " · " + e.remark : ""}`}
            </span>
            <button className="duty-entry-edit" onClick={() => handleEdit(e)}>Edit</button>
            <button className="duty-entry-del" onClick={() => handleDelete(e.id)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children, className }) {
  return (
    <label className={`duty-field${className ? " " + className : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// Free-typed pilot code with a custom dropdown (not a native <datalist>,
// which browsers render as a single-column list that can't be styled) - the
// panel lays codes out in two columns (fills the left column top-to-bottom,
// then the right) so a 21-pilot roster shows at a glance instead of one
// long scroll.
function PilotPicker({ value, onChange, pilots, placeholder }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = value
    ? pilots.filter((p) => p.code.toUpperCase().includes(value.toUpperCase()))
    : pilots;

  function pick(code) {
    onChange(code);
    setOpen(false);
  }

  return (
    <div className="pilot-picker" ref={wrapRef}>
      <input
        value={value}
        lang="en"
        inputMode="text"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
      />
      {open && filtered.length > 0 && (
        <div className="pilot-picker-list" style={{ gridTemplateRows: `repeat(${Math.ceil(filtered.length / 2)}, auto)` }}>
          {filtered.map((p) => (
            <button type="button" key={p.code} onClick={() => pick(p.code)} title={p.name}>{p.code}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function FlightForm({ flight, setFlight, updateRole, addRole, removeRole, updateLeg, addLeg, removeLeg, fleet, pilots, actualFdtDisplay }) {
  const set = (key, value) => setFlight({ ...flight, [key]: value });
  return (
    <div className="duty-form">
      <div className="duty-form-grid">
        <Field label="Date"><DateField value={flight.date} onChange={(v) => set("date", v)} /></Field>
        <Field label="Flight Type">
          <select value={flight.flightType} onChange={(e) => set("flightType", e.target.value)}>
            {FLIGHT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Sch Dep" className="narrow"><TimeField value={flight.schDep} onChange={(v) => set("schDep", v)} /></Field>
        <Field label="Last Engine Stop" className="narrow"><TimeField value={flight.stop} onChange={(v) => set("stop", v)} /></Field>
        {/* "Crew Number" was removed at Capt. Weera's instruction. It was typed
            in by hand but read by nothing: the Fatigue Monitor derives the Crew
            from Sch Dep above (22:30-06:59 = Crew 1 ... 09:01-22:29 = Crew 6,
            see fatigueMonitor.js crewForDeparture), so a hand-entered value
            could only ever disagree with the computed one. */}
        <Field label="Flights/Day" className="narrow"><input type="number" value={flight.flightsPerDay} onChange={(e) => set("flightsPerDay", e.target.value)} /></Field>
        <Field label="Total Flight Time (H:MM)" className="narrow"><input value={flight.totalFlightTime} onChange={(e) => {
          const v = e.target.value;
          const roles = flight.roles.length ? flight.roles.map((r, idx) => (idx === 0 ? { ...r, dayHours: v } : r)) : flight.roles;
          // Prefills IFR-rules time (and offshore) with the whole flight, which
          // is the norm for this operation. IMC is deliberately NOT prefilled:
          // most flights have no time in cloud at all, and defaulting it to the
          // full flight time would silently overstate every pilot's IFR(IMC)
          // specialty total on the PES report. The pilot types it when it
          // happens.
          setFlight({ ...flight, totalFlightTime: v, ifrRulesHours: v, offshoreHours: v, roles });
          checkRoleHours(roles, v);
          checkOnOffshoreHours(flight.onshoreHours, v, v);
        }} placeholder="0:00" /></Field>
        <Field label="Actual FDT (H:MM)" className="narrow">
          <input value={actualFdtDisplay} readOnly className="duty-field-readonly" title="This tab's FDT contribution to today's Mixed Duty total - auto-calculated" />
        </Field>
      </div>

      <div className="duty-legs">
        <div className="duty-legs-scroll">
          <div className="duty-legs-head">
            <span>A/C Type</span><span>Registration</span><span>RS</span><span>LS</span><span>Route</span><span />
          </div>
          {flight.legs.map((leg, i) => (
            <div key={i} className="duty-legs-row">
              <select value={leg.aircraftType} onChange={(e) => updateLeg(i, "aircraftType", e.target.value)}>
                {withCurrentOption(fleet.aircraftTypes, leg.aircraftType).map((t) => <option key={t}>{t}</option>)}
              </select>
              <select value={leg.registration} onChange={(e) => updateLeg(i, "registration", e.target.value)}>
                <option value="">—</option>
                {withCurrentOption(fleet.registrations, leg.registration).map((r) => <option key={r}>{r}</option>)}
              </select>
              <PilotPicker value={leg.rs} onChange={(v) => updateLeg(i, "rs", v)} pilots={pilots} placeholder="RS" />
              <PilotPicker value={leg.ls} onChange={(v) => updateLeg(i, "ls", v)} pilots={pilots} placeholder="LS" />
              <input value={leg.route} lang="en" inputMode="text" onChange={(e) => updateLeg(i, "route", e.target.value)} placeholder="VTSH-CPOC-VTSH" />
              {flight.legs.length > 1 && <button onClick={() => removeLeg(i)}>×</button>}
            </div>
          ))}
        </div>
        <button className="duty-add-role" onClick={addLeg}>+ Add Leg</button>
      </div>

      <div className="duty-roles">
        <div className="duty-roles-head"><span>Role</span><span>Day (H:MM)</span><span>Night (H:MM)</span><span /></div>
        {flight.roles.map((r, i) => (
          <div key={i} className="duty-roles-row">
            <select value={r.role} onChange={(e) => updateRole(i, "role", e.target.value)}>
              {DUTY_ROLES.map((dr) => <option key={dr}>{dr}</option>)}
            </select>
            <input value={r.dayHours} onChange={(e) => updateRole(i, "dayHours", e.target.value)} placeholder="0:00" />
            <input value={r.nightHours} onChange={(e) => updateRole(i, "nightHours", e.target.value)} placeholder="0:00" />
            {flight.roles.length > 1 && <button onClick={() => removeRole(i)}>×</button>}
          </div>
        ))}
        <button className="duty-add-role" onClick={addRole}>+ Add Role</button>
      </div>

      <div className="duty-form-grid">
        {/* IFR and IMC are two different numbers and always have been - the FDT
            workbook keeps them in separate columns (V = IFR flight-rules time,
            W = IMC). Until now this form offered only one box, labelled "IFR
            Hours", which wrote `ifrHours` - the IMC field. So a pilot entering
            IFR-rules time had it counted as time in cloud, inflating the
            "IFR(IMC)" specialty total on the PES report and the Logbook's IFR
            column.

            Now each writes its own field, matching the importer:
              IFR -> ifrRulesHours   (My Status "IFR HOURS (180D)" recency)
              IMC -> ifrHours        (PES "IFR(IMC)", Logbook IMC column)
            See fdtImport.js, which verified the W = IMC mapping against two
            dated PES snapshots. */}
        <Field label="IFR Hours (H:MM)" className="narrow"><input value={flight.ifrRulesHours} onChange={(e) => set("ifrRulesHours", e.target.value)} placeholder="0:00" /></Field>
        <Field label="IMC Hours (H:MM)" className="narrow"><input value={flight.ifrHours} onChange={(e) => set("ifrHours", e.target.value)} placeholder="0:00" /></Field>
        <Field label="Onshore (H:MM)" className="narrow"><input value={flight.onshoreHours} onChange={(e) => {
          const v = e.target.value;
          set("onshoreHours", v);
          checkOnOffshoreHours(v, flight.offshoreHours, flight.totalFlightTime);
        }} placeholder="0:00" /></Field>
        <Field label="Offshore (H:MM)" className="narrow"><input value={flight.offshoreHours} onChange={(e) => {
          const v = e.target.value;
          set("offshoreHours", v);
          checkOnOffshoreHours(flight.onshoreHours, v, flight.totalFlightTime);
        }} placeholder="0:00" /></Field>
        <Field label="T/O Day" className="narrow"><input type="number" value={flight.toDay} onChange={(e) => set("toDay", e.target.value)} /></Field>
        <Field label="T/O Night" className="narrow"><input type="number" value={flight.toNight} onChange={(e) => set("toNight", e.target.value)} /></Field>
        <Field label="Landing Day" className="narrow"><input type="number" value={flight.landDay} onChange={(e) => set("landDay", e.target.value)} /></Field>
        <Field label="Landing Night" className="narrow"><input type="number" value={flight.landNight} onChange={(e) => set("landNight", e.target.value)} /></Field>
        <Field label="I.App" className="narrow"><input type="number" value={flight.iApp} onChange={(e) => set("iApp", e.target.value)} /></Field>
      </div>
    </div>
  );
}

// Add whole days to a "YYYY-MM-DD" string, returning the same format.
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function NonFlightForm({ nonFlight, setNonFlight, actualNonFdtDisplay }) {
  const set = (key, value) => setNonFlight({ ...nonFlight, [key]: value });

  // Picking a duty type auto-fills the standard clock for that type. Night
  // Standby runs 17:30 -> 05:30 the next day, so it also bumps the end date
  // forward one day. Everything stays fully editable afterward.
  function setType(type) {
    const next = { ...nonFlight, nonFlightType: type };
    if (type === "Night Standby") {
      next.start = "17:30";
      next.end = "05:30";
      next.endDate = addDays(nonFlight.date, 1);
    } else if (type === "Day Standby") {
      next.start = "08:00";
      next.end = "16:00";
      next.endDate = nonFlight.date;
    } else {
      next.endDate = nonFlight.date;
    }
    setNonFlight(next);
  }

  // Keep the end date sensible when the start date changes: Night Standby
  // trails one day behind, others match.
  function setStartDate(date) {
    setNonFlight({ ...nonFlight, date, endDate: nonFlight.nonFlightType === "Night Standby" ? addDays(date, 1) : date });
  }

  const crossDay = nonFlight.nonFlightType === "Night Standby" || (nonFlight.endDate && nonFlight.endDate !== nonFlight.date);

  return (
    <div className="duty-form">
      <div className="duty-form-grid">
        <Field label="Duty Type">
          <select value={nonFlight.nonFlightType} onChange={(e) => setType(e.target.value)}>
            {NON_FLIGHT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Start Date"><DateField value={nonFlight.date} onChange={setStartDate} /></Field>
        <Field label="Start Time" className="narrow"><TimeField value={nonFlight.start} onChange={(v) => set("start", v)} /></Field>
        <Field label="End Date"><DateField value={nonFlight.endDate || nonFlight.date} onChange={(v) => set("endDate", v)} /></Field>
        <Field label="End Time" className="narrow"><TimeField value={nonFlight.end} onChange={(v) => set("end", v)} /></Field>
        <Field label="Actual non-FDT (H:MM)" className="narrow">
          <input value={actualNonFdtDisplay} readOnly className="duty-field-readonly" title="This tab's non-FDT (Standby credit) contribution to today's Mixed Duty total - auto-calculated" />
        </Field>
      </div>
      {crossDay && <div className="duty-crossday-note">Spans two days: {nonFlight.date} {nonFlight.start || "--:--"} → {nonFlight.endDate || nonFlight.date} {nonFlight.end || "--:--"}. Standby counts 25% of its duration as duty time.</div>}
      <Field label="Remark" className="wide"><input value={nonFlight.remark} lang="en" inputMode="text" onChange={(e) => set("remark", e.target.value)} placeholder="Optional note" /></Field>
    </div>
  );
}
