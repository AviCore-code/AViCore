// Duty entries saved while offline sit in the outbox until the connection
// comes back. Until now they were invisible in the meantime: Recent Entries,
// FDT Monitor and Fatigue read the last copy downloaded from the server, which
// cannot contain them. A pilot on a rig logged a flight and saw no change in
// his FDT. (Capt. Weera: offline "ทุกฟังก์ชันยังคำนวณได้ และเก็บข้อมูลได้".)
//
// This lays the queued writes over whatever list was read - server or cache -
// in the order they were made, so every page computes from what the pilot
// actually entered. Each queued entry is flagged `pending: true` until the
// server accepts it.
//
// Pure: takes the list and the outbox, returns a new list. Nothing is stored.

export const PENDING_ID_PREFIX = "pending:";

export function isPendingDutyId(id) {
  return String(id || "").startsWith(PENDING_ID_PREFIX);
}

export function pendingOpIdOf(id) {
  return isPendingDutyId(id) ? String(id).slice(PENDING_ID_PREFIX.length) : null;
}

const norm = (v) => String(v || "").trim().toUpperCase();

export function applyPendingDutyWrites(entries, ops, pilotCode) {
  const me = norm(pilotCode);
  let list = Array.isArray(entries) ? entries.slice() : [];

  for (const op of ops || []) {
    const args = Array.isArray(op?.args) ? op.args : [];

    if (op.kind === "addDutyEntry") {
      const entry = args[0];
      if (!entry || norm(entry.pilotCode) !== me) continue;
      // The server stores this as an upsert on pilot + date + duty type, so a
      // queued entry REPLACES one already there for that day and type.
      list = list.filter((e) => !(e.date === entry.date && e.dutyType === entry.dutyType));
      list.push({ ...entry, id: PENDING_ID_PREFIX + op.id, pending: true, pendingError: op.lastError || null });
    } else if (op.kind === "updateDutyEntry") {
      const [code, id, entry] = args;
      if (norm(entry?.pilotCode || code) !== me) continue;
      list = list.map((e) => (e.id === id ? { ...e, ...entry, id, pending: true, pendingError: op.lastError || null } : e));
    } else if (op.kind === "deleteDutyEntry") {
      const [code, id] = args;
      if (norm(code) !== me) continue;
      list = list.filter((e) => e.id !== id);
    }
  }

  // Newest first, as the server returns them.
  return list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}
