// Daily Duty - Pairing & Copy screens (logic in pairing.js).
//   PairingPanel  - under the flight form: one row per pilot flown with, a
//                   "Copy to TYO" tick, or "already logged" + Pairing Check.
//   PairingCheck  - both pilots' flights side by side, differences marked;
//                   add / edit / delete the partner's flights and save.

import React, { useMemo, useState } from "react";
import { legsWithHours } from "./legTotals.js";
import { isoToDisplay } from "../../components/DateField.jsx";
import {
  partnersOf, partnerOf, pairRoles, partnerLeg, comparePair, compareDay, dayFieldsFromLegs,
  PAIR_COMPARE_FIELDS, PAIR_NO_COPY, upCode
} from "./pairing.js";

const nameOf = (pilots, code) => pilots.find((p) => upCode(p.code) === upCode(code))?.name || "";
const posOf = (pilots, code) => pilots.find((p) => upCode(p.code) === upCode(code))?.position || "";

export function PairingPanel({ me, flight, pilots, positions, partnerData, copyTo, setCopy, onOpenCheck, legsOf }) {
  const partners = useMemo(() => [...partnersOf(flight.legs, me).entries()], [flight.legs, me]);
  if (!me || !partners.length) return null;
  return (
    <div className="duty-pair" aria-label="Pairing and copy">
      <div className="duty-pair-head">
        <span className="duty-pair-title">Pairing &amp; Copy</span>
        <span className="duty-pair-note">Copies every field to the pilot you flew with, except T/O, LDG and I.App (they log their own). Role: Captain = PIC, the other = SIC.</span>
      </div>
      {partners.map(([code, idx]) => {
        const known = pilots.some((p) => upCode(p.code) === code);
        const data = partnerData[code] || { loading: true };
        const roles = pairRoles(me, code, positions);
        const flights = idx.map((i) => i + 1).join(", ");
        const existing = data.entry;
        let cmp = null;
        if (existing) {
          const mine = idx.map((i) => flight.legs[i]);
          const theirLegs = legsWithHours(existing, legsOf(existing)).filter((l) => partnerOf(l, code) === upCode(me));
          cmp = comparePair(mine, theirLegs);
          cmp.diffCount += compareDay(flight, existing).length;
        }
        return (
          <div key={code} className={`duty-pair-row${existing ? " logged" : ""}`}>
            <div className="duty-pair-who">
              <b>{code}</b>
              <span>{nameOf(pilots, code) || (known ? "" : "not in the pilot list")}</span>
              <small>{posOf(pilots, code) || "—"} · flight {flights} · role <b>{roles.theirs}</b></small>
            </div>
            {!known ? (
              <span className="duty-pair-status warn">Unknown pilot code — not copied</span>
            ) : data.loading ? (
              <span className="duty-pair-status">Checking {code}'s log…</span>
            ) : data.error ? (
              <span className="duty-pair-status warn">Couldn't read {code}'s log: {data.error}</span>
            ) : existing ? (
              <div className="duty-pair-actions">
                <span className={`duty-pair-status ${cmp.diffCount ? "warn" : "ok"}`}>
                  Already logged · {cmp.diffCount ? `${cmp.diffCount} difference${cmp.diffCount > 1 ? "s" : ""}` : "all match ✓"}
                </span>
                <button type="button" className="duty-pair-btn" onClick={() => onOpenCheck(code)}>Pairing Check</button>
              </div>
            ) : (
              <label className="duty-pair-copy">
                <input type="checkbox" aria-label={`Copy to ${code}`} checked={copyTo[code] !== false} onChange={(e) => setCopy(code, e.target.checked)} />
                <span>Copy to {code} when saving</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

const COLS = [
  { f: "flightType", label: "Type" }, { f: "aircraftType", label: "A/C" }, { f: "registration", label: "Reg" },
  { f: "rs", label: "RS" }, { f: "ls", label: "LS" }, { f: "route", label: "Route", wide: true }, { f: "role", label: "Role" },
  ...PAIR_COMPARE_FIELDS.filter((c) => c.time).map((c) => ({ ...c, time: true })),
  { f: "toDay", label: "T/O D" }, { f: "toNight", label: "T/O N" }, { f: "landDay", label: "LDG D" }, { f: "landNight", label: "LDG N" }, { f: "iApp", label: "I.App" }
];
const COMPARED = new Set([...PAIR_COMPARE_FIELDS.map((c) => c.f), "rs", "ls"]);

export function PairingCheck({ me, myEntry, partner, partnerEntry, pilots, positions, legsOf, onSave, onDelete, onClose }) {
  const roles = pairRoles(me, partner, positions);
  const [draft, setDraft] = useState(() => ({
    schDep: partnerEntry.schDep || "", stop: partnerEntry.stop || "",
    legs: legsWithHours(partnerEntry, legsOf(partnerEntry)).map((l) => ({ ...l }))
  }));
  const [busy, setBusy] = useState(false);
  const myIdx = useMemo(() => [...(partnersOf(myEntry.legs, me).get(upCode(partner)) || [])], [myEntry.legs, me, partner]);
  const myLegs = myIdx.map((i) => myEntry.legs[i]);
  const theirIdx = draft.legs.map((l, i) => (partnerOf(l, partner) === upCode(me) ? i : -1)).filter((i) => i >= 0);
  const otherIdx = draft.legs.map((_, i) => i).filter((i) => !theirIdx.includes(i));
  const cmp = comparePair(myLegs, theirIdx.map((i) => draft.legs[i]));
  const dayDiffs = compareDay(myEntry, draft);
  const total = cmp.diffCount + dayDiffs.length;

  const setLeg = (i, f, v) => setDraft((d) => ({ ...d, legs: d.legs.map((l, j) => (j === i ? { ...l, [f]: v } : l)) }));
  const copyInto = (i, mine) => setDraft((d) => ({
    ...d,
    legs: d.legs.map((l, j) => {
      if (j !== i) return l;
      const keep = Object.fromEntries(PAIR_NO_COPY.map((f) => [f, l[f] ?? ""]));
      return { ...partnerLeg(mine, l.role || roles.theirs), ...keep };
    })
  }));
  const addLeg = (mine) => setDraft((d) => ({ ...d, legs: [...d.legs, partnerLeg(mine, roles.theirs)] }));
  const removeLeg = (i) => setDraft((d) => ({ ...d, legs: d.legs.filter((_, j) => j !== i) }));
  const copyAll = () => setDraft((d) => {
    const legs = d.legs.map((l) => ({ ...l }));
    const theirs = legs.map((l, i) => (partnerOf(l, partner) === upCode(me) ? i : -1)).filter((i) => i >= 0);
    myLegs.forEach((mine, k) => {
      if (theirs[k] != null) {
        const old = legs[theirs[k]];
        const keep = Object.fromEntries(PAIR_NO_COPY.map((f) => [f, old[f] ?? ""]));
        legs[theirs[k]] = { ...partnerLeg(mine, old.role || roles.theirs), ...keep };
      } else legs.push(partnerLeg(mine, roles.theirs));
    });
    return { schDep: myEntry.schDep || "", stop: myEntry.stop || "", legs };
  });

  async function save() {
    if (!draft.legs.length) {
      if (window.confirm(`${partner} has no flights left for this day.\n\nDelete ${partner}'s entry for ${partnerEntry.date} instead?`)) await remove();
      return;
    }
    setBusy(true);
    try {
      const { id: _id, pending: _p, pendingError: _pe, ...rest } = partnerEntry;
      await onSave({
        ...rest, schDep: draft.schDep, stop: draft.stop, legs: draft.legs, ...dayFieldsFromLegs(draft.legs),
        pairEdit: { by: upCode(me), at: new Date().toISOString() }
      });
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Delete ${partner}'s flight entry for ${partnerEntry.date}?\n\nThis cannot be undone.`)) return;
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); }
  }

  const cellIn = (i, c, diff) => (
    <td key={c.f} className={`${diff ? "diff" : ""}${c.wide ? " wide" : ""}`}>
      <input aria-label={`${partner} flight ${i + 1} ${c.label}`} value={draft.legs[i][c.f] ?? ""} onChange={(e) => setLeg(i, c.f, e.target.value)}
        inputMode={c.time ? "text" : (["toDay", "toNight", "landDay", "landNight", "iApp"].includes(c.f) ? "numeric" : "text")} />
    </td>
  );
  const cellRo = (leg, c, diff) => <td key={c.f} className={`${diff ? "diff" : ""}${c.wide ? " wide" : ""}`}>{leg?.[c.f] || <span className="muted">–</span>}</td>;
  const isDiff = (pair, f) => COMPARED.has(f) && pair.diffs.includes(f);

  return (
    <div className="duty-pcheck" role="dialog" aria-label={`Pairing Check ${me} and ${partner}`}>
      <div className="duty-pcheck-head">
        <div>
          <h3>Pairing Check — {upCode(me)} ↔ {upCode(partner)}</h3>
          <p>{isoToDisplay(partnerEntry.date)} · {nameOf(pilots, partner)} already logged this day. Amber = different. Edit {partner}'s rows, then Save.</p>
        </div>
        <span className={`duty-pair-status ${total ? "warn" : "ok"}`}>{total ? `${total} difference${total > 1 ? "s" : ""}` : "All match ✓"}</span>
      </div>

      <div className="duty-pcheck-day">
        {[["schDep", "Sch Dep"], ["stop", "Last Engine Stop"]].map(([f, label]) => (
          <label key={f} className={dayDiffs.includes(f) ? "diff" : ""}>
            <span>{label}</span>
            <em>{upCode(me)}: {myEntry[f] || "–"}</em>
            <input aria-label={`${partner} ${label}`} value={draft[f]} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} placeholder="HH:MM" />
          </label>
        ))}
      </div>

      <div className="duty-pcheck-scroll">
        <table className="duty-pcheck-table">
          <thead>
            <tr><th>#</th><th>Pilot</th><th className="acts-h" />{COLS.map((c) => <th key={c.f} className={c.wide ? "wide" : ""}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {cmp.pairs.map((pair) => {
              const ti = theirIdx[pair.k];
              return (
                <React.Fragment key={pair.k}>
                  <tr className="mine">
                    <td rowSpan={2} className="no">{pair.k + 1}</td>
                    <td className="who">{upCode(me)}</td>
                    <td className="acts" />
                    {pair.mine ? COLS.map((c) => cellRo(pair.mine, c, isDiff(pair, c.f))) : <td colSpan={COLS.length} className="muted">— not in {upCode(me)}'s entry —</td>}
                  </tr>
                  <tr className="theirs">
                    <td className="who">{upCode(partner)}</td>
                    <td className="acts">
                      {ti != null && pair.mine && <button type="button" onClick={() => copyInto(ti, pair.mine)} title={`Copy ${me}'s flight into ${partner}'s (keeps ${partner}'s T/O, LDG, I.App)`}>Copy</button>}
                      {ti == null && pair.mine && <button type="button" onClick={() => addLeg(pair.mine)}>Add</button>}
                      {ti != null && <button type="button" className="del" onClick={() => removeLeg(ti)} aria-label={`Delete ${partner} flight ${pair.k + 1}`}>Delete</button>}
                    </td>
                    {ti != null ? COLS.map((c) => cellIn(ti, c, isDiff(pair, c.f))) : <td colSpan={COLS.length} className="muted">— not logged by {upCode(partner)} —</td>}
                  </tr>
                </React.Fragment>
              );
            })}
            {otherIdx.map((i) => (
              <tr key={`o${i}`} className="other">
                <td className="no">·</td>
                <td className="who">{upCode(partner)}</td>
                <td className="acts"><button type="button" className="del" onClick={() => removeLeg(i)}>Delete</button></td>
                {COLS.map((c) => cellIn(i, c, false))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {otherIdx.length > 0 && <p className="duty-pcheck-note">Rows marked · are {partner}'s flights with another pilot — kept as they are unless you change them.</p>}

      <div className="duty-pcheck-actions">
        <button type="button" className="primary" disabled={busy} onClick={save}>Save {partner}'s entry</button>
        <button type="button" disabled={busy} onClick={copyAll}>Copy all from {upCode(me)}</button>
        <button type="button" className="del" disabled={busy} onClick={remove}>Delete {partner}'s entry</button>
        <button type="button" disabled={busy} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
