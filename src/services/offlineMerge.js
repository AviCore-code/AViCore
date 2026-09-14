// Comparing an offline edit against what the server holds now, cell by cell.
//
// The roster and the weekly plan are shared documents. If an admin edits them
// with no connection and the queue simply sent those edits later, they would
// land on top of whatever anyone else had done in the meantime - silently, and
// possibly hours after other people had already acted on what they could see.
//
// So a queued admin edit is not "a new value to write". It is:
//
//     this cell was  BEFORE  when I changed it
//     I set it to    MINE
//     the server now says    THEIRS
//
// From those three, every cell falls into exactly one case:
//
//   unchanged   THEIRS === BEFORE          nobody else touched it -> send
//   identical   THEIRS === MINE            someone made the SAME change -> nothing to do
//   conflict    all three differ           a real disagreement -> ask
//
// Only the third needs a human. That distinction is the whole point: an admin
// who changed four cells should be asked about the one that actually clashes,
// not made to re-approve the other three.
//
// Capt. Weera: "ข้อไหนที่แก้เหมือนเรา ... ข้อไหนไม่เหมือนก็บอกรายละเอียดไว้ให้ทราบ".

const EMPTY = "";

function norm(v) {
  return String(v ?? "").trim().toUpperCase();
}

/**
 * @param edits  [{ key, label, before, mine }]
 *   key    - identifies the cell ("WJU|2026-08-03", "2026-08-03|crew1|0")
 *   label  - how to describe it to a person ("WJU · 3 Aug")
 *   before - the value this browser had when the edit was made
 *   mine   - what the admin set it to
 * @param serverByKey  Map(key -> current value on the server)
 */
export function classifyEdits(edits, serverByKey) {
  const send = [];
  const alreadyDone = [];
  const conflicts = [];

  for (const edit of edits || []) {
    const theirs = serverByKey?.get(edit.key);
    const t = norm(theirs);
    const b = norm(edit.before);
    const m = norm(edit.mine);

    if (t === m) {
      // Someone else already made the same change - or this edit was sent
      // once already and the retry is a duplicate. Either way it is done.
      alreadyDone.push({ ...edit, theirs });
      continue;
    }
    if (t === b) {
      // The server still holds what this browser started from: nobody else
      // has touched this cell, so applying the edit loses nothing.
      send.push({ ...edit, theirs });
      continue;
    }
    // Three different values: the cell moved under us.
    conflicts.push({ ...edit, theirs });
  }

  return { send, alreadyDone, conflicts };
}

// Human wording for one conflict, in both languages - this is read at the
// moment of deciding, and getting it wrong means overwriting someone's work.
export function describeConflict(c) {
  const show = (v) => (norm(v) === EMPTY ? "(ว่าง / empty)" : String(v));
  return {
    label: c.label || c.key,
    before: show(c.before),
    mine: show(c.mine),
    theirs: show(c.theirs),
    th: `${c.label || c.key}: ตอนคุณแก้เป็น "${show(c.before)}" คุณเปลี่ยนเป็น "${show(c.mine)}" แต่ตอนนี้บนเซิร์ฟเวอร์เป็น "${show(c.theirs)}"`,
    en: `${c.label || c.key}: was "${show(c.before)}" when you edited it, you set "${show(c.mine)}", the server now has "${show(c.theirs)}"`
  };
}

// Applies the admin's decisions. `keep` is the set of conflict keys the admin
// chose to overwrite with their own value; everything else is left as the
// server has it.
export function resolveConflicts(conflicts, keepKeys) {
  const keep = keepKeys instanceof Set ? keepKeys : new Set(keepKeys || []);
  return {
    overwrite: conflicts.filter((c) => keep.has(c.key)),
    abandon: conflicts.filter((c) => !keep.has(c.key))
  };
}

// ---- Shaping the two document types into the same {key,label,before,mine} --

export function rosterEditsFrom(entries, beforeByKey) {
  return (entries || []).map((e) => {
    const code = String(e.pilotCode ?? e.pilot_code ?? "").toUpperCase();
    const key = `${code}|${e.date}`;
    return {
      key,
      label: `${code} · ${e.date}`,
      before: beforeByKey?.get(key) ?? "",
      mine: e.code ?? ""
    };
  });
}

export function weeklyPlanEditsFrom(cells, beforeByKey) {
  return (cells || []).map((c) => {
    const key = `${c.date}|${c.section}|${c.slot}`;
    return {
      key,
      label: `${c.date} · ${c.section} #${(Number(c.slot) || 0) + 1}`,
      before: beforeByKey?.get(key) ?? "",
      mine: String(c.pilotCode ?? c.pilot_code ?? "").toUpperCase()
    };
  });
}
