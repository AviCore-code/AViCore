// Merges raw Daily Duty entries (each independently timestamped, no report/
// release-time concept - see src/modules/dutyEntry/DutyEntry.jsx) into
// continuous "busy" blocks and the off-duty gaps between them, so FTL rules
// that need real rest periods (not per-entry sums) have something to work
// with. Built as a reusable engine, not a one-off - future rules (max FDP,
// max consecutive duty days) can reuse buildBusyBlocks/buildRestGaps.

function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Resolves a duty entry's date + HH:MM fields into an absolute {start, end}.
// Activities that cross midnight (end-time-of-day earlier than start) have
// their end pushed to the next calendar day - the same rule MyStatus.jsx's
// hoursBetweenClock uses, just resolved to real Date objects here since
// duty-period merging needs true timestamps, not a bare duration.
export function entryToInterval(entry) {
  const startStr = entry.dutyType === "flight" ? entry.schDep : entry.start;
  const endStr = entry.dutyType === "flight" ? entry.stop : entry.end;
  if (!entry.date || !startStr || !endStr) return null;

  const [y, m, d] = entry.date.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  start.setMinutes(toMinutes(startStr));

  // Non-flight entries may carry an explicit endDate (e.g. a Night Standby
  // that runs 17:30 -> 05:30 the next day). Honor it when present;
  // otherwise fall back to the same-day + midnight-wrap rule.
  let end;
  if (entry.dutyType !== "flight" && entry.endDate) {
    const [ey, em, ed] = entry.endDate.split("-").map(Number);
    end = new Date(ey, em - 1, ed, 0, 0, 0, 0);
    end.setMinutes(toMinutes(endStr));
  } else {
    end = new Date(y, m - 1, d, 0, 0, 0, 0);
    end.setMinutes(toMinutes(endStr));
    if (end < start) end.setDate(end.getDate() + 1);
  }

  return { start, end, entry };
}

// Sorts all of a pilot's entries chronologically and merges touching/
// overlapping ones into continuous busy blocks.
export function buildBusyBlocks(entries) {
  const intervals = (entries || [])
    .map(entryToInterval)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const blocks = [];
  for (const iv of intervals) {
    const last = blocks[blocks.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
      last.entries.push(iv.entry);
    } else {
      blocks.push({ start: iv.start, end: iv.end, entries: [iv.entry] });
    }
  }
  return blocks;
}

// Off-duty gaps between consecutive busy blocks - candidate rest periods.
// The gap before the first block / after the last block is unbounded (we
// don't know what happened before the earliest logged entry or after the
// latest), so those are excluded.
export function buildRestGaps(busyBlocks) {
  const gaps = [];
  for (let i = 1; i < busyBlocks.length; i++) {
    const prev = busyBlocks[i - 1];
    const next = busyBlocks[i];
    gaps.push({ start: prev.end, end: next.start, hours: (next.start - prev.end) / 3600000 });
  }
  return gaps;
}

// Counts how many distinct local nights (recoveryRestNightStartHour:00 to
// next-day recoveryRestNightEndHour:00) the gap covers. Walks every
// calendar day from (gap.start - 1 day) through gap.end so a night already
// in progress when the gap starts (e.g. gap starts at 23:00) is still
// found - without the -1-day seed that night would be missed.
//
// A night counts when EITHER:
//  1. the overlap with the gap is >= recoveryRestMinNightOverlapHours; OR
//  2. the rest ran continuously from the night's start (22:00) past
//     midnight right up to the moment the rest itself ended for the next
//     duty's report (confirmed with the domain expert on real WJU data: a
//     48h rest ending at an 05:30 report for an 06:30 STD covers its final
//     night with only 7:30 in-window overlap - the pilot still had the
//     whole night off until duty called, so it counts. Without this rule
//     NO recovery rest could ever end with a pre-07:00-STD morning flight,
//     which is the normal offshore schedule). Not applied to a still-
//     ongoing rest (gap.ongoing) - there the "rest end" is just "now",
//     not a duty report, so only the plain overlap rule applies.
export function nightsCoveredByGap(gap, limits) {
  const covered = [];
  const cursor = new Date(gap.start);
  cursor.setDate(cursor.getDate() - 1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= gap.end) {
    const nightStart = new Date(cursor);
    nightStart.setHours(limits.recoveryRestNightStartHour, 0, 0, 0);
    const nightEnd = new Date(cursor);
    nightEnd.setDate(nightEnd.getDate() + 1);
    nightEnd.setHours(limits.recoveryRestNightEndHour, 0, 0, 0);

    const overlapStart = gap.start > nightStart ? gap.start : nightStart;
    const overlapEnd = gap.end < nightEnd ? gap.end : nightEnd;
    const overlapHours = (overlapEnd - overlapStart) / 3600000;

    const midnight = new Date(nightStart);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const truncatedByReport = !gap.ongoing &&
      gap.start <= nightStart && gap.end > midnight && gap.end < nightEnd;

    if (overlapHours >= limits.recoveryRestMinNightOverlapHours || truncatedByReport) {
      covered.push({ nightStart, nightEnd, overlapHours });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return covered;
}

function isStandbyEntry(e) {
  return e.dutyType === "non_flight" && (e.nonFlightType === "Day Standby" || e.nonFlightType === "Night Standby");
}

// OPS-CM-01 7.9.2(f)/(g): how many hours a standby run should shave off the
// max FDP that follows it. The first standbyFdpReductionFreeHours (6h) of
// standby before the crew is called don't reduce anything; every hour beyond
// that reduces the max FDP one-for-one.
//
// ALL standby hours count towards that 6h clock, including any that fell in
// the night - confirmed with the Capt on a real Night Standby called out at
// 02:00: standby 17:30 -> 01:00 = 7.5h must reduce the max FDP by 1.5h (the
// excess over 6h), not stay unreduced. (An earlier build excluded the local
// 23:00-07:00 window from the count per 7.9.2(i); that exclusion has been
// removed so the reduction reflects the full time on standby.)
export function standbyReductionHours(standbyStart, standbyEnd, limits) {
  const totalMin = (standbyEnd - standbyStart) / 60000;
  const freeMin = limits.standbyFdpReductionFreeHours * 60;
  return Math.max(0, totalMin - freeMin) / 60;
}

// Within a merged busy-block group, finds a leading run of Standby entries
// (Day/Night Standby) that escalates directly into further duty (a flight,
// or any other activity) with no gap - the exact scenario OPS-CM-01 7.9.2
// governs. A standby that ends the group (nothing follows it) is just a
// "quiet" standby - already credited via stbyCreditPercent in
// statusCompute.js - and has no FDP of its own, so this returns null for
// it rather than treating the whole group as standby-led.
//
// The report/"standby ceases" point (7.9.2(e)) is the start of the FIRST
// non-standby activity, full stop - NOT whatever end time is logged on the
// standby entry itself. A pilot is commonly logged on a full scheduled
// standby block (e.g. Day Standby 08:00-16:00) but actually gets called out
// mid-window (e.g. flying starts at 12:00, inside that block) - the real
// call happened at 12:00, so that's the report time and the standby credit
// only covers 08:00-12:00, not the full logged 08:00-16:00. buildBusyBlocks
// already guarantees every entry in this group touches/overlaps the next,
// so simply walking the leading run of standby-typed entries and stopping
// at the first non-standby one is enough - no need to separately track how
// far each standby entry's own end reaches.
function splitLeadingStandby(group) {
  const sorted = group.entries
    .map(entryToInterval)
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length || !isStandbyEntry(sorted[0].entry)) return null;

  let i = 0;
  while (i < sorted.length && isStandbyEntry(sorted[i].entry)) i++;
  if (i >= sorted.length) return null; // standby-only group, never escalated to duty

  const standbyStart = sorted[0].start;
  const standbyEnd = sorted[i].start; // first non-standby activity's start = the actual call/report point
  return { standbyStart, standbyEnd };
}

// Whether a group's leading (earliest) entry is a plain Non-Duty activity -
// Meeting, Ground Training, Positioning, Office, Travel, Ground Run, Other -
// as opposed to a flight or a Standby. Used by deriveAdjusted below to
// decide whether the dutyReportOffsetMinutes pre-report buffer applies.
function isPlainNonDutyEntry(e) {
  return e.dutyType === "non_flight" && !isStandbyEntry(e);
}

// Derives the adjusted {start, end, hasFlight, standby} for a group of
// entries per the FDP rules.
//
// start: the dutyReportOffsetMinutes (1h) pre-report buffer exists to model
// UNLOGGED prep time before the first activity nothing else accounts for -
// a flight's own Sch Dep with nothing logged before it, or (per 7.9.2) the
// moment a Standby gets called out. It does NOT apply when the group is led
// by an already-logged plain Non-Duty entry (Meeting/Training/Positioning/
// etc.) - that entry's own Start time already IS the actual report/duty
// start, so subtracting another hour before it would double-count time that
// was never actually spent waiting (confirmed by the Capt: "ถ้า NON-DUTY เวลา
// START ไม่ต้องลบ หนึ่ง ชม."). The two Duty pages (Flight / Non-Flight) for the
// same touching group then simply add together into one Total Duty, with no
// extra padding at the seam.
//
// If the group contains a flight, end = last flight's shutdown +
// dutyPostFlightOffsetMinutes; if not, end = the group's own raw
// last-activity end (no padding - there's no "engine shutdown" to anchor to
// on a no-flight day, per confirmed rule). Defensive floor not explicitly
// covered by the stated rules: end can never be earlier than the group's
// raw end, so a trailing non-flight activity logged after the last flight's
// shutdown+30min (e.g. a post-flight debrief) still gets covered rather
// than silently truncated.
//
// This same {start, end} pair is used both for the regulatory max-FDP
// compliance check AND for the "Actual Duty" figure shown on Daily Duty
// Entry / the 7/14/28-day rolling Duty Time sums (confirmed directly,
// including the +30min post-flight buffer in both - a worked example with
// Standby escalating into a flight: report 01:00, Last Engine Stop 05:30 ->
// Actual Duty for that FDT portion runs 01:00-06:00, i.e. Stop + 0:30).
//
// OPS-CM-01 7.9.2(e)/(f): when the group is led by a Standby run that
// escalates into duty, "start" is anchored to the point standby CEASES
// (the report), not to when standby itself began - the report-time offset
// above still applies from there (a Standby is never a "plain Non-Duty"
// entry for this purpose - it keeps its own dedicated 7.9.2 treatment).
// buildDutyPeriods below separately reduces the period's allowed max FDP
// (not its start) when that standby ran long enough per 7.9.2(g).
function deriveAdjusted(group, limits) {
  const flightIntervals = group.entries
    .filter((e) => e.dutyType === "flight")
    .map(entryToInterval)
    .filter(Boolean);
  const hasFlight = flightIntervals.length > 0;
  const standby = splitLeadingStandby(group);
  const reportPoint = standby ? standby.standbyEnd : group.rawStart;

  const sortedEntries = group.entries.map(entryToInterval).filter(Boolean).sort((a, b) => a.start - b.start);
  const leadsWithPlainNonDuty = !standby && sortedEntries.length > 0 && isPlainNonDutyEntry(sortedEntries[0].entry);

  const start = leadsWithPlainNonDuty
    ? reportPoint
    : new Date(reportPoint.getTime() - limits.dutyReportOffsetMinutes * 60000);

  let end;
  if (hasFlight) {
    const lastFlightEnd = flightIntervals.reduce((max, iv) => (iv.end > max ? iv.end : max), flightIntervals[0].end);
    const postFlightEnd = new Date(lastFlightEnd.getTime() + limits.dutyPostFlightOffsetMinutes * 60000);
    end = postFlightEnd > group.rawEnd ? postFlightEnd : group.rawEnd;
  } else {
    end = group.rawEnd;
  }
  return { start, end, hasFlight, standby };
}

// Max FDP / max daily flight time for a Duty Period, looked up by its
// report time-of-day in limits.fdpByReportTime (OPS-CM-01 7.4.1 - limits
// vary by when the duty starts, e.g. a 2100-0459 report allows only 9h FDP
// and 6h flight vs 12h/8h for a 0700-1259 report). The 2100-0459 window
// wraps midnight: from > to means "match if at-or-after from OR at-or-
// before to". Falls back to the flat dutyPeriodMaxHours (no FT cap) if a
// saved override leaves a gap in the table.
export function maxFdpForReportTime(start, limits) {
  const hhmm = String(start.getHours()).padStart(2, "0") + String(start.getMinutes()).padStart(2, "0");
  for (const row of limits.fdpByReportTime || []) {
    const wraps = row.from > row.to;
    const match = wraps ? hhmm >= row.from || hhmm <= row.to : hhmm >= row.from && hhmm <= row.to;
    if (match) return { maxFdp: row.maxFdp, maxFt: row.maxFt };
  }
  return { maxFdp: limits.dutyPeriodMaxHours, maxFt: null };
}

function hhmmStrToDecimal(str) {
  if (!str) return 0;
  const [h, m] = String(str).split(":");
  return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60;
}

// Builds actual Duty Periods (FDP) from raw entries: starts from
// buildBusyBlocks's raw merge, then applies the report-time/post-flight
// padding above. Widening each block by that padding can make two
// previously-separate raw blocks now overlap (e.g. a block ending 08:50
// padded to 09:20 overlapping a second block whose raw start was 09:15,
// even though 08:50-09:15 didn't touch in raw entry time) - so adjusted
// candidates are re-merged to a fixed point, recomputing hasFlight/end from
// each final group's full entry list rather than naively combining two
// already-adjusted end timestamps.
export function buildDutyPeriods(entries, limits) {
  let groups = buildBusyBlocks(entries).map((b) => ({ rawStart: b.start, rawEnd: b.end, entries: b.entries }));

  let changed = true;
  while (changed) {
    changed = false;
    groups.sort((a, b) => a.rawStart - b.rawStart);
    const next = [];
    for (const g of groups) {
      const last = next[next.length - 1];
      if (last) {
        const gAdj = deriveAdjusted(g, limits);
        const lastAdj = deriveAdjusted(last, limits);
        if (gAdj.start <= lastAdj.end) {
          last.rawStart = last.rawStart < g.rawStart ? last.rawStart : g.rawStart;
          last.rawEnd = last.rawEnd > g.rawEnd ? last.rawEnd : g.rawEnd;
          last.entries = [...last.entries, ...g.entries];
          changed = true;
          continue;
        }
      }
      next.push(g);
    }
    groups = next;
  }

  return groups
    .map((g) => {
      const adj = deriveAdjusted(g, limits);
      const durationHours = (adj.end - adj.start) / 3600000;
      let { maxFdp, maxFt } = maxFdpForReportTime(adj.start, limits);

      // OPS-CM-01 7.9.2: a standby run that escalated straight into this
      // duty period reduces the max FDP allowed (g), and separately flags
      // if the standby itself ran over 16h (a) or standby+FDP combined ran
      // over 18h (b) - both surfaced on the period regardless of whether
      // the reduced maxFdp was actually exceeded, since they're their own
      // violations under 7.9.2, not just inputs to the FDP check.
      //
      // Standby is counted only up to adj.start (the report buffer
      // boundary = Sch Dep - dutyReportOffsetMinutes), NOT up to the raw
      // report/Sch Dep time itself - confirmed directly: Sch Dep 12:00 ->
      // report 11:00 -> standby counted 08:00-11:00, not 08:00-12:00. The
      // dutyReportOffsetMinutes window right before Sch Dep is already
      // report/duty time, not standby.
      let standby = null;
      if (adj.standby) {
        const standbyEnd = adj.start;
        const standbyHours = (standbyEnd - adj.standby.standbyStart) / 3600000;
        const reductionHours = standbyReductionHours(adj.standby.standbyStart, standbyEnd, limits);
        maxFdp = Math.max(0, maxFdp - reductionHours);
        standby = {
          start: adj.standby.standbyStart,
          end: standbyEnd,
          hours: standbyHours,
          reductionHours,
          exceedsMaxStandby: standbyHours > limits.standbyMaxHours,
          combinedAwakeHours: standbyHours + durationHours,
          exceedsCombinedAwake: standbyHours + durationHours > limits.standbyPlusFdpMaxAwakeHours
        };
      }

      // Max FDP is a FLIGHT Duty Period limit - it only applies to a period
      // that actually contains a flight. A no-flight period (a quiet Standby
      // that was never called out, or a plain non-flight duty day like a
      // meeting) has no FDP to exceed, so its raw span must NOT be judged
      // against Max FDP: e.g. a Night Standby 17:30-05:30 never called out is
      // a 12h standby credited at 25% = 3h actual duty - it is OK, not
      // EXCEEDED, even though its 13h raw span is larger than the Max FDP
      // that WOULD apply to a 16:30 report if it had been a flight duty. A
      // standby's own over-length is caught separately (16h rule, via
      // checkStandbyDurationViolations / the exceedsMaxStandby flag below).
      let status = "ok";
      if (adj.hasFlight && durationHours > maxFdp) {
        const extendedMax = maxFdp + limits.dutyPeriodUnforeseenExtensionHours;
        status = durationHours <= extendedMax ? "warn" : "exc";
      }
      if (standby && (standby.exceedsMaxStandby || standby.exceedsCombinedAwake)) status = "exc";

      // Daily flight time within this period vs the report-time-dependent
      // cap (7.4.1's "Flight time (hours)" column) - binary, no unforeseen
      // tier (the 2h extension in 7.4.3 applies to the FDP, not flight time).
      const ftHours = g.entries
        .filter((e) => e.dutyType === "flight")
        .reduce((s, e) => s + hhmmStrToDecimal(e.totalFlightTime), 0);
      const ftStatus = maxFt != null && ftHours > maxFt ? "exc" : "ok";
      return {
        start: adj.start, end: adj.end, entries: g.entries, hasFlight: adj.hasFlight, durationHours, status, maxFdp, maxFt, ftHours, ftStatus, standby
      };
    })
    .sort((a, b) => a.start - b.start);
}

// How much a Duty Period counts towards the 7/14/28-day rolling Duty Time
// sums (statusCompute.js's computeStats). Mirrors OPS-CM-01 7.9.2(c): a
// standby that's released without ever escalating into a duty report only
// counts at stbyCreditPercent% of its actual duration (25% by default),
// not full clock time. Everything else - a normal flying/duty day, or the
// FDP portion of a standby that DID escalate - counts durationHours (report
// -1:00 through Last Engine Stop +0:30, confirmed to include the
// post-flight buffer here too) at full value; an escalated standby's own
// lead-in time (excluded from durationHours, which starts at the report) is
// added back in separately at the same reduced credit rate, so it isn't
// lost from the rolling totals, just not double-counted at full value.
export function periodDutyCreditHours(period, limits) {
  const isPureStandby = period.entries.length > 0 && period.entries.every(isStandbyEntry);
  if (isPureStandby) {
    // Raw standby span, NOT period.durationHours - the latter is built from
    // deriveAdjusted's start, which (like every non-flight duty) has the
    // dutyReportOffsetMinutes pre-report buffer subtracted even though a
    // "quiet" standby that never escalated has no report to buffer before.
    // The 25% credit applies to the standby's own real clock time.
    const ivs = period.entries.map(entryToInterval).filter(Boolean);
    const rawStart = ivs.reduce((min, iv) => (iv.start < min ? iv.start : min), ivs[0].start);
    const rawEnd = ivs.reduce((max, iv) => (iv.end > max ? iv.end : max), ivs[0].end);
    return ((rawEnd - rawStart) / 3600000) * (limits.stbyCreditPercent / 100);
  }
  const standbyCredit = period.standby ? period.standby.hours * (limits.stbyCreditPercent / 100) : 0;
  return period.durationHours + standbyCredit;
}

// OPS-CM-01 7.9.2(a): a standby period must never itself exceed
// standbyMaxHours (16h), independent of whether it escalates into a duty
// report - checked here across EVERY logged Day/Night Standby entry, unlike
// the escalation-only reduction logic above.
export function checkStandbyDurationViolations(entries, limits) {
  return (entries || [])
    .filter(isStandbyEntry)
    .map((e) => {
      const iv = entryToInterval(e);
      if (!iv) return null;
      const hours = (iv.end - iv.start) / 3600000;
      return { entry: e, start: iv.start, end: iv.end, hours, status: hours > limits.standbyMaxHours ? "exc" : "ok" };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

// Rest gaps between consecutive Duty Periods, flagged two-tier per
// OPS-CM-01 7.17.3.1: below dutyMinRestHours (12h, the oil & gas customer
// requirement) = "warn" (yellow); below dutyMinRestCaatHours (8h, the CAAT
// requirement) = "exc" (red). Separate from the 168h/36h Recovery Rest rule
// above. Deliberately built from buildDutyPeriods's ADJUSTED output, not
// raw buildBusyBlocks: the report-time/post-flight padding is defined
// precisely because real off-duty rest is understood to start only after
// the post-flight buffer and end only when the report-time buffer begins -
// a gap computed from raw entry timestamps would overstate actual rest by
// up to (dutyReportOffsetMinutes + dutyPostFlightOffsetMinutes), which
// could pass a gap that's actually too short once real Duty Period
// boundaries apply.
export function checkMinRestViolations(entries, limits) {
  const gaps = buildRestGaps(buildDutyPeriods(entries, limits));
  return gaps.map((g) => ({
    ...g,
    status: g.hours < limits.dutyMinRestCaatHours ? "exc" : g.hours < limits.dutyMinRestHours ? "warn" : "ok"
  }));
}

// Recovery Rest check per OPS-CM-01 7.12.4 (min 36h incl. 2 local nights;
// the gap between the end of one recovery rest and the start of the next
// must not exceed 168h), using the confirmed operational rule: scan back
// from "now" - the most recent qualifying rest's END is the start of the
// current 168h duty cycle. Two things matter here:
//   1. Gaps are computed from adjusted Duty Periods (report-time/post-
//      flight padding applied), consistent with checkMinRestViolations -
//      real rest only starts after post-flight duty ends.
//   2. A rest that is STILL ONGOING (after the last logged duty, no next
//      duty yet) counts too, evaluated up to asOfDate - without this, a
//      pilot 3 days into days-off would wrongly show as overdue just
//      because no later duty entry "closed" the gap yet.
export function checkRecoveryRest168(entries, limits, asOfDate = new Date()) {
  const periods = buildDutyPeriods(entries, limits);
  const gaps = buildRestGaps(periods);

  // The rest currently in progress (after the last logged duty, no next
  // duty yet), evaluated up to asOfDate.
  let ongoingGap = null;
  if (periods.length) {
    const last = periods[periods.length - 1];
    if (asOfDate > last.end) {
      ongoingGap = { start: last.end, end: asOfDate, hours: (asOfDate - last.end) / 3600000, ongoing: true };
    }
  }

  const qualifies = (g) => g.hours >= limits.recoveryRestMinHours && nightsCoveredByGap(g, limits).length >= 2;
  const closedQualifying = gaps.filter(qualifies);
  const ongoingQualifies = ongoingGap != null && qualifies(ongoingGap);

  // A rest gap that's currently open (pilot off duty right now, no next
  // duty logged yet) but hasn't reached 36h/2 local nights yet - the UI
  // shows this as "On Process" so a new Recovery Rest is visibly under way
  // even before it formally qualifies, distinct from "Resting" (below,
  // ongoingQualifies) which only lights up once it's actually qualifying.
  const restInProgress = ongoingGap != null && !ongoingQualifies;
  const restInProgressStart = restInProgress ? ongoingGap.start : null;

  // The 168h Duty Cycle's elapsed-hours figure (drives the Bar value and
  // the ok/warn/exc status below) is capped at the Stop time of the
  // pilot's last logged duty, not the live wall clock - confirmed choice:
  // it should NOT keep climbing in real time once duty stops being logged.
  // It only moves again once a new duty entry pushes "last duty stop"
  // forward, or the ongoing rest reaches 36h/2 nights (ongoingQualifies,
  // handled via ongoingGap.start below, which is already anchored to the
  // last duty's stop and unaffected by this cap). Trade-off accepted: a
  // pilot who logs nothing at all for 168+ hours will not show EXCEEDED
  // from elapsed real time alone - the figure simply stops moving.
  const lastDutyStop = periods.length ? periods[periods.length - 1].end : null;
  const cappedAsOfDate = lastDutyStop && lastDutyStop < asOfDate ? lastDutyStop : asOfDate;

  if (!closedQualifying.length) {
    if (ongoingQualifies) {
      // Resting right now with a qualifying rest, but no completed
      // recovery rest before it - no duty cycle is running yet; it starts
      // when the pilot next reports for duty.
      return { lastQualifyingRestStart: null, lastQualifyingRestEnd: null, hoursSinceLastRest: null, ongoing: true, ongoingRestStart: ongoingGap.start, restInProgress: false, restInProgressStart: null, status: "ok" };
    }
    return { lastQualifyingRestStart: null, lastQualifyingRestEnd: null, hoursSinceLastRest: null, ongoing: false, ongoingRestStart: null, restInProgress, restInProgressStart, status: "exc" };
  }

  // Cycle start = end of the last COMPLETED qualifying rest, which is the
  // report time of the first duty that followed it. The elapsed hours
  // below (cappedAsOfDate - cycleStart) reset once the current rest is
  // closed by the NEXT duty, making it the new "last completed recovery
  // rest" - see cappedAsOfDate above for how the clock behaves in between.
  const latest = closedQualifying.reduce((a, b) => (b.end > a.end ? b : a));
  const cycleStart = latest.end;
  const hoursSinceLastRest = (cappedAsOfDate - cycleStart) / 3600000;

  let status;
  if (ongoingQualifies) {
    // The NEXT recovery rest has already started (and reached 36h/2
    // nights). Per OPS-CM-01 7.12.4 compliance is judged on whether it
    // STARTED within 168h of the cycle start.
    const startedAfterHours = (ongoingGap.start - cycleStart) / 3600000;
    status = startedAfterHours <= limits.recoveryRestCycleMaxHours ? "ok" : "exc";
  } else {
    // Still on the clock (on duty, or resting but not yet 36h/2 nights):
    // warn at/above cycleWarnHours elapsed (default 132 = 36h headroom
    // left), exceeded only once STRICTLY PAST cycleMaxHours (168) - matches
    // the FT/DT bars' convention (classify() in statusCompute.js: `value >
    // limit.max`, not `>=`), so reaching exactly 168h shows the last warn
    // tick, not exceeded, consistent with how every other bar in the app
    // treats hitting the limit exactly vs going past it.
    const warnAt = limits.recoveryRestCycleWarnHours ?? (limits.recoveryRestCycleMaxHours - limits.recoveryRestMinHours);
    if (hoursSinceLastRest > limits.recoveryRestCycleMaxHours) status = "exc";
    else if (hoursSinceLastRest >= warnAt) status = "warn";
    else status = "ok";
  }

  return {
    lastQualifyingRestStart: latest.start,
    lastQualifyingRestEnd: cycleStart,
    hoursSinceLastRest,
    ongoing: ongoingQualifies,
    ongoingRestStart: ongoingQualifies ? ongoingGap.start : null,
    restInProgress,
    restInProgressStart,
    status
  };
}
