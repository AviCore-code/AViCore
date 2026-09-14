// Turns a plain online-only data function into one that works offline.
//
// Deliberately a wrapper rather than edits scattered through webDatabase.js:
// the offline behaviour is then in ONE place, identical for every table, and
// a page can't accidentally get half of it. It also means the underlying
// functions stay exactly what they were - simple calls to Supabase - so they
// remain easy to read and to test.
//
// READS  (cacheable): try the server; on success keep a copy and return it.
//        On a CONNECTION failure fall back to the last copy, tagged with when
//        it was taken. If there is no copy, the error is real and is thrown.
//
// WRITES (queueable): if offline, queue and report success - the write is
//        safely stored and will be sent. If online, send it; if THAT fails
//        because the connection dropped mid-request, queue it rather than
//        losing it. A rejection by the server (bad data, no permission) is
//        NOT queued: replaying it would fail forever, so it is raised now
//        while the user still has the form in front of them.

import { cacheGet, cachePut } from "./offlineStore.js";
import {
  isOnline, markOffline, markOnline, looksLikeConnectionError,
  queueWrite, flushQueue, registerOfflineHandler
} from "./offlineQueue.js";

// Set by the read wrapper whenever cached data is served, so the UI can say
// how old what it is showing is.
let servedFromCacheAt = null;
export function lastCacheServedAt() {
  return servedFromCacheAt;
}

export function cacheableRead(key, fn) {
  return async (...args) => {
    const cacheKey = typeof key === "function" ? key(...args) : key;

    if (isOnline()) {
      try {
        const result = await fn(...args);
        markOnline();
        servedFromCacheAt = null;
        await cachePut(cacheKey, result);
        return result;
      } catch (err) {
        if (!looksLikeConnectionError(err)) throw err;   // a real server error
        markOffline();
      }
    }

    const cached = await cacheGet(cacheKey);
    if (cached) {
      servedFromCacheAt = cached.cachedAt;
      return cached.value;
    }
    throw new Error("You are offline and this hasn't been loaded on this device yet.");
  };
}

/**
 * @param kind   stable name used to replay the write later. Must not change
 *               between releases, or writes queued by an older build become
 *               unreplayable after an update.
 * @param fn     the real write
 * @param label  (args) => string, shown in the pending list
 * @param options.document  "roster" | "weekly" - a SHARED document. Edits to
 *   these are not replayed blindly: the queued write records what each cell
 *   held at the time, and on reconnect every cell is compared against the
 *   server before anything is written (see offlineMerge.js). Omit for records
 *   only one person can own, like a pilot's own duty entry.
 */
export function queueableWrite(kind, fn, label, options = {}) {
  registerOfflineHandler(kind, (args) => fn(...args));

  return async (...args) => {
    const describe = () => {
      try { return label ? label(...args) : kind; } catch { return kind; }
    };

    if (!isOnline()) {
      await queueWrite({ kind, args, label: describe(), document: options.document, before: await snapshot(options.document, args) });
      return { ok: true, queued: true };
    }

    try {
      const result = await fn(...args);
      markOnline();
      // Anything queued earlier goes out now that we know the line is up.
      flushQueue();
      return result;
    } catch (err) {
      if (!looksLikeConnectionError(err)) throw err;
      markOffline();
      await queueWrite({ kind, args, label: describe(), document: options.document, before: await snapshot(options.document, args) });
      return { ok: true, queued: true };
    }
  };
}


// What the cells being edited held BEFORE this change, taken from the cache -
// which is what the admin was looking at when they made it. Without this there
// is no way to tell "I changed this" from "it was already like that", and so no
// way to detect a real conflict later.
async function snapshot(document, args) {
  if (!document) return null;
  try {
    if (document === "roster") {
      const entries = args?.[0];
      const list = Array.isArray(entries) ? entries : [entries];
      const out = {};
      for (const e of list) {
        if (!e?.date) continue;
        const code = String(e.pilotCode ?? e.pilot_code ?? "").toUpperCase();
        const cached = await cacheGet(`roster:${e.date}:${e.date}`);
        const row = (cached?.value || []).find(
          (r) => String(r.pilot_code || "").toUpperCase() === code && r.date === e.date
        );
        out[`${code}|${e.date}`] = row?.code ?? "";
      }
      return out;
    }
    if (document === "weekly") {
      const cells = args?.[0] || [];
      const out = {};
      for (const c of cells) {
        const cached = await cacheGet(`weekly:${c.date}:${c.date}`);
        const row = (cached?.value || []).find(
          (r) => r.date === c.date && r.section === c.section && Number(r.slot) === Number(c.slot)
        );
        out[`${c.date}|${c.section}|${c.slot}`] = String(row?.pilot_code || "").toUpperCase();
      }
      return out;
    }
  } catch {
    // A missing snapshot is not fatal: the cell is then treated as a conflict
    // rather than silently overwritten, which is the safe direction.
    return null;
  }
  return null;
}
