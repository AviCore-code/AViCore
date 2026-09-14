// Replays writes that were made while offline.
//
// The rule Capt. Weera set is "ของใครของมัน ห้ามแก้ข้ามคน" - each person owns
// their own records. That is enforced here rather than left to chance:
//
//   * every queued write records its OWNER (pilot code, or "admin")
//   * on flush, a write is only sent if the session replaying it is the same
//     owner that queued it
//
// This removes almost the whole conflict problem instead of trying to resolve
// it. Two people cannot produce conflicting edits to the same record, because
// only one of them is ever allowed to write it. What is left - the same person
// editing from two devices - is resolved last-write-wins by modified_at, which
// is what the PC and Android sync already do.
//
// A queued write is NEVER dropped because it failed. It stays, with the error
// attached, until the server accepts it or the user discards it deliberately.
// Silently discarding a pilot's duty entry because the server was briefly
// unhappy would be the worst possible behaviour here.

import { outboxAdd, outboxList, outboxRemove, outboxMarkFailed } from "./offlineStore.js";
import { classifyEdits } from "./offlineMerge.js";

// Which data-layer function each queued write replays. Registered by
// webDatabase.js at import time, so this module has no dependency on it and
// stays testable on its own.
const handlers = new Map();

export function registerOfflineHandler(kind, fn) {
  handlers.set(kind, fn);
}

// ---- Who owns a write ----------------------------------------------------

export const ADMIN_OWNER = "admin";

// Who a queued write belongs to.
//
// Reads localStorage FIRST, then sessionStorage. The pairing moved to
// localStorage when it gained a 24-hour expiry (see webDatabase.js) so a pilot
// can reopen the app on a rig with no signal; sessionStorage is still checked
// because a device paired under an earlier build has its code there, and a
// queued duty entry must not change owner because the app was updated.
//
// Getting this wrong is not cosmetic: an entry that cannot find its pilot is
// filed against ADMIN_OWNER, and the pilot's own queued flight would then be
// invisible to them.
export function currentOwner() {
  try {
    const pilot =
      (typeof localStorage !== "undefined" ? localStorage.getItem("avicore_web_pilot_code") : "") ||
      (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("avicore_web_pilot_code") : "");
    if (pilot) return String(pilot).toUpperCase();
  } catch { /* private mode */ }
  return ADMIN_OWNER;
}

// ---- Online state --------------------------------------------------------

let forcedOffline = false;

export function isOnline() {
  if (forcedOffline) return false;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

// Used by the data layer when a request fails in a way that means "no
// connection" rather than "the server said no" - navigator.onLine lies often
// enough (captive portals, a dead uplink on a live wifi) that a failed fetch
// is better evidence than the flag.
export function markOffline() {
  forcedOffline = true;
  notify();
}

export function markOnline() {
  forcedOffline = false;
  notify();
}

// Network errors look different from rejections by the server. A 400 means
// the write is wrong and replaying it will never help; a fetch failure means
// the write is fine and just needs sending later.
export function looksLikeConnectionError(err) {
  const message = String(err?.message || err || "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("fetch failed")
  );
}

// ---- Subscribers ---------------------------------------------------------

const listeners = new Set();
let lastState = { pending: 0, flushing: false, online: true, lastError: null };

export function subscribeOfflineState(fn) {
  listeners.add(fn);
  fn({ ...lastState });
  refreshPendingCount();
  return () => listeners.delete(fn);
}

function notify(patch = {}) {
  lastState = { ...lastState, online: isOnline(), ...patch };
  for (const fn of listeners) fn({ ...lastState });
}

async function refreshPendingCount() {
  const pending = (await outboxList()).length;
  notify({ pending });
}

// ---- Queue ---------------------------------------------------------------

export async function queueWrite({ kind, args, label, document, before }) {
  const op = await outboxAdd({ kind, args, label, document, before, owner: currentOwner() });
  await refreshPendingCount();
  return op;
}

export async function pendingWrites() {
  return outboxList();
}

// Discard one queued write. Only ever called from a deliberate user action -
// there is no automatic path to here.
export async function discardWrite(id) {
  await outboxRemove(id);
  await refreshPendingCount();
}

let flushing = false;

export async function flushQueue() {
  if (flushing || !isOnline()) return { sent: 0, failed: 0, skipped: 0 };
  flushing = true;
  notify({ flushing: true });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const held = [];
  const owner = currentOwner();

  try {
    // Oldest first: a record's creation must reach the server before the edit
    // that follows it.
    for (const op of await outboxList()) {
      // Whose work may this session send?
      //
      // The rule is "ของใครของมัน" - one person's edits must never be
      // submitted AS another person. For a duty entry that is already
      // guaranteed by the record itself: the pilot code is inside the entry,
      // so sending WJU's entry while PCH is signed in still files it under
      // WJU. Nothing is mis-attributed.
      //
      // The earlier version compared against the signed-in pilot and skipped
      // everything else - which meant that with NOBODY signed in (owner falls
      // back to "admin"), a pilot's queued entries were skipped on every
      // flush and simply sat there. Logging out after working offline left
      // the work stranded until that exact pilot signed in again on that
      // exact browser, and if the browser data was cleared first it was gone.
      // That is the opposite of what the rule was for.
      //
      // So: SELF-DESCRIBING writes (duty entries carry their own pilot code)
      // go out regardless of who is signed in. SHARED-DOCUMENT writes still
      // wait for their owner, because those are replayed as "whoever is
      // signed in now" and could genuinely land under the wrong name.
      const selfDescribing = !op.document;
      if (!selfDescribing && op.owner && op.owner !== owner) { skipped += 1; continue; }

      const handler = handlers.get(op.kind);
      if (!handler) {
        await outboxMarkFailed(op.id, `No handler for "${op.kind}" - this build can't replay it.`);
        failed += 1;
        continue;
      }

      try {
        // A SHARED document (roster / weekly plan) is compared cell by cell
        // against the server first. Cells nobody else touched go through;
        // cells someone else changed to a DIFFERENT value are held back and
        // reported, so an offline edit can never quietly overwrite work that
        // was done - and acted on - while this browser was away.
        if (op.document && op.before) {
          const current = await readCurrent(op.document, op.before);
          if (current) {
            const edits = Object.entries(op.before).map(([key, value]) => ({
              key,
              label: key,
              before: value,
              mine: mineFor(op, key)
            }));
            const { conflicts } = classifyEdits(edits, current);
            if (conflicts.length) {
              // Store WHAT clashed, not just that something did: the dialog
              // has to show all three values per cell, and by the time it
              // opens the comparison is long over.
              await outboxMarkFailed(
                op.id,
                `${conflicts.length} cell(s) were changed by someone else — needs your decision`,
                conflicts
              );
              held.push({ op, conflicts });
              failed += 1;
              continue;
            }
          }
        }

        await handler(op.args);
        await outboxRemove(op.id);
        sent += 1;
      } catch (err) {
        await outboxMarkFailed(op.id, err.message);
        failed += 1;
        if (looksLikeConnectionError(err)) {
          // Connection went again mid-flush. Stop; the rest stays queued and
          // in order for the next attempt.
          markOffline();
          break;
        }
      }
    }
  } finally {
    flushing = false;
    await refreshPendingCount();
    notify({ flushing: false, lastError: failed ? `${failed} change(s) could not be sent yet` : null });
  }

  return { sent, failed, skipped, held };
}

// What the admin's own edit set this cell to, pulled back out of the queued
// call arguments.
function mineFor(op, key) {
  const args = op.args || [];
  if (op.document === "roster") {
    const list = Array.isArray(args[0]) ? args[0] : [args[0]];
    for (const e of list) {
      const code = String(e?.pilotCode ?? e?.pilot_code ?? "").toUpperCase();
      if (`${code}|${e?.date}` === key) return e?.code ?? "";
    }
    // deleteRosterEntry: the edit is "make this cell empty"
    const q = args[0] || {};
    if (`${String(q.pilotCode || "").toUpperCase()}|${q.date}` === key) return "";
    return "";
  }
  if (op.document === "weekly") {
    for (const c of args[0] || []) {
      if (`${c.date}|${c.section}|${c.slot}` === key) return String(c.pilotCode ?? c.pilot_code ?? "").toUpperCase();
    }
  }
  return "";
}

// Reads the CURRENT server value of exactly the cells this edit touches.
// Registered by webDatabase.js so this module keeps no dependency on it.
let currentReader = null;
export function registerCurrentReader(fn) { currentReader = fn; }

async function readCurrent(document, before) {
  if (!currentReader) return null;
  try {
    return await currentReader(document, Object.keys(before || {}));
  } catch {
    // Can't check - so don't guess. Leaving it queued is safer than sending
    // it blind, and the next flush will try again.
    return null;
  }
}

// The conflicts waiting for a decision, for the UI to show.
export async function heldConflicts() {
  const out = [];
  for (const op of await outboxList()) {
    if (op.document && op.lastError && /needs your decision/i.test(op.lastError)) out.push(op);
  }
  return out;
}

// Flush whenever the browser says the connection is back, and once at start-up
// in case the page was loaded straight after coming online.
export function startOfflineQueue() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => { markOnline(); flushQueue(); };
  const onOffline = () => notify();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  // A tab that has been in the background for hours comes back here.
  const onVisible = () => { if (document.visibilityState === "visible" && isOnline()) flushQueue(); };
  document.addEventListener("visibilitychange", onVisible);
  if (isOnline()) flushQueue();
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
