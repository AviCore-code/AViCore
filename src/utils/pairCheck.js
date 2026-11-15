// Pair Check (Reports): did the two pilots who flew together log the same
// flight time, and when a pilot changed partner during the day, how long did
// they fly with each one?
//
// Capt. Weera: two pilots flying together all day must show the SAME FT, and
// pairs should not swap. When they do swap, the check should show how long
// the pair flew together and how long each then flew with someone else.
//
// Source: each pilot's FDT file. The Logbook sheet names the pilots of every
// flight (Flight 1/2/3, RS / LS seat - imported as entry.crew), but records
// flight time only as ONE daily total per pilot. So:
//   * who flew with whom, flight by flight, is exact;
//   * hours with each partner on a swap day are worked out from the daily
//     totals: a partner who flew ONLY with this pilot that day gives the
//     hours together exactly (their own total); one remaining partner gets
//     what is left of this pilot's total ("derived"); with two or more
//     unknowns the split cannot be told and is shown as "?".

import { entryFlightHours } from "./statusCompute.js";
import { periodDays } from "./ftMonthlyHr.js";

export const PAIR_TOLERANCE_MIN = 1;

function dayRecords(rows, days) {
  const inRange = new Set(days);
  const known = new Set();
  const byDate = new Map();          // iso -> Map(code -> { code, name, ft, flights:[{partner, seat}], noCrew })
  for (const { pilot, entries } of rows || []) {
    const code = String(pilot?.code || "").toUpperCase();
    if (!code) continue;
    known.add(code);
    for (const e of entries || []) {
      if (e?.dutyType !== "flight" || !inRange.has(e.date)) continue;
      if (!byDate.has(e.date)) byDate.set(e.date, new Map());
      const day = byDate.get(e.date);
      if (!day.has(code)) day.set(code, { code, name: pilot.name || "", ft: 0, flights: [], noCrew: false });
      const rec = day.get(code);
      rec.ft += Math.round(entryFlightHours(e) * 60);
      const crew = Array.isArray(e.crew) ? e.crew : [];
      if (!crew.length) rec.noCrew = true;
      for (const f of crew) {
        const rs = String(f?.rs || "").toUpperCase();
        const ls = String(f?.ls || "").toUpperCase();
        if (rs === code) rec.flights.push({ partner: ls || null, seat: "RS" });
        else if (ls === code) rec.flights.push({ partner: rs || null, seat: "LS" });
        else rec.flights.push({ partner: null, seat: "", names: [rs, ls].filter(Boolean) });
      }
    }
  }
  return { byDate, known };
}

const distinct = (flights) => [...new Set(flights.map((f) => f.partner).filter(Boolean))];

// rows: loadAllPilotStatusRows().rows. Returns { days, items, noCrewDays }.
// items: one per pair (or per pilot on a swap day), problems first.
export function buildPairCheck(rows, from, to) {
  const days = periodDays(from, to);
  const { byDate, known } = dayRecords(rows, days);
  const items = [];
  let noCrewDays = 0;

  for (const iso of days) {
    const day = byDate.get(iso);
    if (!day) continue;
    const done = new Set();
    for (const rec of day.values()) {
      if (rec.ft <= 0 && !rec.flights.length) continue;
      if (rec.noCrew && !rec.flights.length) { noCrewDays++; continue; }
      const partners = distinct(rec.flights);
      const flightText = rec.flights.map((f, i) => `F${i + 1} ${f.partner || (f.names?.join("/") || "?")}`).join(" · ");
      const notes = [];
      if (rec.flights.some((f) => !f.partner)) notes.push(`${rec.code}'s own Logbook does not name ${rec.code} on every flight`);

      if (partners.length <= 1) {
        const p = partners[0];
        if (!p) { items.push({ date: iso, kind: "solo", pilots: [rec.code], ft: [rec.ft], flights: flightText, status: "warn", text: notes.join("; ") || "No partner named" }); continue; }
        const key = [rec.code, p].sort().join("+");
        if (done.has(key)) continue;
        const other = day.get(p);
        if (!known.has(p)) {
          done.add(key);
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, null], flights: flightText, status: "info", text: `${p} is not a pilot in AviCore - FT not compared` });
          continue;
        }
        if (!other || other.ft <= 0) {
          done.add(key);
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other?.ft ?? 0], flights: flightText, status: "exc", text: `${p} has no flight recorded on this day` });
          continue;
        }
        const otherPartners = distinct(other.flights);
        if (otherPartners.length > 1) continue;            // reported from the partner's side (swap)
        done.add(key);
        if (otherPartners.length === 1 && otherPartners[0] !== rec.code) {
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other.ft], flights: flightText, status: "exc", text: `${p}'s Logbook names ${otherPartners[0]}, not ${rec.code}` });
          continue;
        }
        if (other.noCrew && !other.flights.length) {
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other.ft], flights: flightText, status: "warn", text: `${p}'s Logbook has no pilot names on this day` });
          continue;
        }
        const diff = Math.abs(rec.ft - other.ft);
        const sameFlights = other.flights.length === rec.flights.length;
        if (diff > PAIR_TOLERANCE_MIN) {
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other.ft], flights: flightText, status: "exc", diff, text: `Flew together all day but FT differs by ${diff} min` });
        } else if (!sameFlights) {
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other.ft], flights: flightText, status: "warn", text: `Same FT, but ${rec.code} logs ${rec.flights.length} flight(s) and ${p} logs ${other.flights.length}` });
        } else {
          items.push({ date: iso, kind: "pair", pilots: [rec.code, p], ft: [rec.ft, other.ft], flights: flightText, status: "ok", text: notes.join("; ") || "Same pair all day, same FT" });
        }
        continue;
      }

      // Swap day: this pilot flew with two or more partners.
      const split = partners.map((p) => {
        const other = day.get(p);
        const op = other ? distinct(other.flights) : [];
        const exact = other && other.ft > 0 && op.length === 1 && op[0] === rec.code;
        return { partner: p, minutes: exact ? other.ft : null, source: exact ? "exact" : "unknown", flights: rec.flights.filter((f) => f.partner === p).length };
      });
      const unknown = split.filter((s) => s.minutes == null);
      if (unknown.length === 1) {
        const rest = rec.ft - split.reduce((a, s) => a + (s.minutes || 0), 0);
        unknown[0].minutes = Math.max(0, rest);
        unknown[0].source = "derived";
      }
      const missing = partners.filter((p) => known.has(p) && !(day.get(p)?.flights || []).some((f) => f.partner === rec.code));
      if (missing.length) notes.push(`${missing.join(", ")} ${missing.length > 1 ? "do" : "does"} not name ${rec.code} in their Logbook`);
      const over = split.reduce((a, s) => a + (s.minutes || 0), 0) - rec.ft;
      if (over > PAIR_TOLERANCE_MIN) notes.push(`partners' totals exceed ${rec.code}'s FT by ${over} min`);
      items.push({
        date: iso, kind: "swap", pilots: [rec.code, ...partners], ft: [rec.ft], flights: flightText, split,
        status: missing.length || over > PAIR_TOLERANCE_MIN ? "exc" : "warn",
        text: [`${rec.code} changed partner during the day`, ...notes].join("; ")
      });
    }
  }
  const rank = { exc: 0, warn: 1, info: 2, ok: 3 };
  items.sort((a, b) => a.date.localeCompare(b.date) || rank[a.status] - rank[b.status] || a.pilots[0].localeCompare(b.pilots[0]));
  return { days, items, noCrewDays };
}
