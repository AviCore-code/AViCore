// Closes the loop the roster and the weekly plan were missing.
//
// The plan already KNOWS, day by day, when a pilot can't be given a line
// because they are near an FDT limit (autoFillWeek's `unplaced`, cause
// "fdt-blocked" / "fdt-limit") - and Training Due already knows which items
// are due soon with nowhere booked (trainingToBook()'s unbooked rows). Until
// this existed, both facts stayed inside the Weekly Schedule page: the
// roster kept showing the pilot as an ordinary working day, so the two
// documents silently drifted apart on exactly the days that mattered most.
//
// Capt. Weera, stating what the two documents are FOR:
//   "ถ้า ใกล้ เงื่อนไข fdt กีจัด off ถ้าใกล้เงื่อนไขการฝึกอบรม ก็จัด booking
//    วัน ฝึกอบรม ตามจำนวนวัน ชั่วโมง ใน roster ได้เลย เป็นการแนะนำ planning"
//
// It only ever SUGGESTS. Nothing is written to the roster on its own - the
// chief pilot ticks the ones he agrees with and books them himself:
//   "เงื่อนไข crosscheck มี tick ให้ crosscheck กับ admin ทำเอง วางแผนเอง ใน
//    การ booking ลง roster เอง และ เราแค่ แนะนำ"
// Same pattern as suggestTrainingSlot() / "Book on roster" already used for
// training - this just applies it to the FDT side too, and lets both kinds
// be reviewed and booked together.
//
// Both use the SAME thresholds FDT Monitor and Training Due already show
// ("ใช้เกณฑ์เดิมที่ตั้งไว้แล้ว") - nothing new is invented here. This module
// only turns an already-computed decision into a list of PROPOSED roster
// rows; it is pure and makes no writes itself, so it can be tested without a
// database. Actually writing them is the caller's job, once the admin has
// ticked which ones to book.

import { suggestTrainingSlot, trainingCodeFor } from "./weeklyPlanTrainingQueue.js";

function normalize(raw) {
  return String(raw || "").trim().toUpperCase();
}

// Adds `codeToAdd` to a combo cell without disturbing what's already there -
// the same merge bookTrainingSlot() has always used ("O,S" keeps the O, which
// is what counts the day toward the 21 working days of the cycle).
function mergeCode(existingRaw, codeToAdd) {
  const existing = normalize(existingRaw);
  const parts = existing ? existing.split(",").map((p) => p.trim()).filter(Boolean) : [];
  if (!parts.includes(codeToAdd)) parts.push(codeToAdd);
  return parts.join(",");
}

function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Every FTL-caused gap the plan just found becomes a PROPOSED explicit OFF
 * on the roster - "O,X", the same "Compensate day off" combo a human already
 * writes by hand, so it reads on the calendar exactly like one would once
 * booked. Never proposes changing a day that's already off, leave, rest or
 * training - the cause is only ever "fdt-blocked" / "fdt-limit" for a pilot
 * who was still on an ordinary duty day - and never touches a date outside
 * what was just planned, because that's exactly the span `unplaced` covers.
 *
 * @param unplaced           autoFillWeek()'s `unplaced` array
 * @param rosterByPilotDate  Map("CODE|YYYY-MM-DD" -> raw roster code)
 * @param pilotInfoByCode    Map(code -> { name, base }), for the roster row
 * @returns [{ id, kind: "fdt-off", pilotCode, date, code, reason, entries }]
 */
export function deriveFdtOffWrites({ unplaced, rosterByPilotDate, pilotInfoByCode }) {
  const suggestions = [];
  for (const u of unplaced || []) {
    if (u.cause !== "fdt-blocked" && u.cause !== "fdt-limit") continue;
    const key = `${u.pilotCode}|${u.date}`;
    const existing = rosterByPilotDate?.get(key) || "";
    const code = mergeCode(existing, "X");
    if (code === normalize(existing)) continue; // already off — nothing to propose
    const info = pilotInfoByCode?.get(u.pilotCode) || {};
    const entry = { pilotCode: u.pilotCode, pilotName: info.name, base: info.base, date: u.date, code };
    suggestions.push({
      id: `fdt-off:${u.pilotCode}:${u.date}`,
      kind: "fdt-off",
      pilotCode: u.pilotCode,
      date: u.date,
      code,
      reason: u.reason,
      entries: [entry]
    });
  }
  return suggestions;
}

/**
 * Every training item Training Due already flags as due-soon-and-unbooked
 * gets a PROPOSED earliest available slot - the SAME proposal the "Book on
 * roster" button already offers (suggestTrainingSlot) - using the course
 * length from Training Setting. A row with no legal slot before its due date
 * comes back as its own "training-unslottable" entry (no `entries` to book -
 * there is nothing to tick) so it's still visible rather than silently
 * dropped: writing nothing is the honest answer when there genuinely isn't
 * room.
 *
 * @param trainingUnbooked   trainingToBook()'s rows, filtered to !booked
 * @param durationsByItem    training_durations setting, e.g. { night: { days: 1 } }
 * @param rosterByPilotDate  the HORIZON roster map (suggestTrainingSlot may
 *                           need to look months ahead of the plan on screen)
 * @param pilotInfoByCode    Map(code -> { name, base })
 * @param busyDatesByPilot   Map(code -> Set<"YYYY-MM-DD">) - dates already
 *                           proposed for this pilot elsewhere in THIS SAME
 *                           run (an FDT-off suggestion, typically), so the
 *                           two write-backs never propose the same date for
 *                           two different things.
 * @returns [{ id, kind: "training"|"training-unslottable", pilotCode, item,
 *             code?, start?, end?, dueIso, reason?, entries? }]
 */
export function deriveTrainingBookWrites({ trainingUnbooked, durationsByItem, rosterByPilotDate, pilotInfoByCode, todayIso, busyDatesByPilot }) {
  const suggestions = [];
  for (const row of trainingUnbooked || []) {
    const code = trainingCodeFor(row.item);
    if (!code) continue;
    const days = durationsByItem?.[row.item]?.days || 1;
    const slot = suggestTrainingSlot({
      pilotCode: row.pilotCode,
      dueIso: row.dueIso,
      days,
      rosterByPilotDate,
      todayIso,
      busyDates: busyDatesByPilot?.get(row.pilotCode)
    });
    if (!slot.start) {
      suggestions.push({
        id: `training-unslottable:${row.pilotCode}:${row.item}`,
        kind: "training-unslottable",
        pilotCode: row.pilotCode,
        item: row.label,
        dueIso: row.dueIso,
        reason: slot.reason
      });
      continue;
    }
    const info = pilotInfoByCode?.get(row.pilotCode) || {};
    const entries = [];
    for (let d = slot.start; d <= slot.end; d = isoAddDays(d, 1)) {
      const existing = rosterByPilotDate?.get(`${row.pilotCode}|${d}`) || "";
      entries.push({ pilotCode: row.pilotCode, pilotName: info.name, base: info.base, date: d, code: mergeCode(existing, code) });
    }
    suggestions.push({
      id: `training:${row.pilotCode}:${row.item}:${slot.start}`,
      kind: "training",
      pilotCode: row.pilotCode,
      item: row.label,
      code,
      start: slot.start,
      end: slot.end,
      dueIso: row.dueIso,
      entries
    });
  }
  return suggestions;
}

// One line per suggestion, ready to print in the review panel and the
// booked-history log alike - kept in one place so the two can never say
// different things about the same item.
export function describeWritebackEntry(e) {
  if (e.kind === "fdt-off") return `${e.pilotCode} — roster OFF ${e.date} (${e.reason})`;
  if (e.kind === "training") {
    const when = e.start === e.end ? e.start : `${e.start} → ${e.end}`;
    return `${e.pilotCode} — ${e.item} ${when} (${e.code}), due ${e.dueIso}`;
  }
  if (e.kind === "training-unslottable") return `${e.pilotCode} — ${e.item} due ${e.dueIso}, could not propose a slot: ${e.reason}`;
  return `${e.pilotCode} — ${e.date || ""}`;
}
