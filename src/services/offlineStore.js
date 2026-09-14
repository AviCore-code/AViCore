// Local storage for the web build, so it keeps working with no connection.
//
// Two separate jobs, deliberately not mixed:
//
//   CACHE   - a copy of what the server last told us. Read from when offline.
//             Always safe to throw away; it can be fetched again.
//   OUTBOX  - writes made while offline that the server has NOT accepted yet.
//             This is the only data in the browser that exists nowhere else,
//             so it is never cleared except when the server confirms it.
//
// IndexedDB, not localStorage: localStorage is ~5 MB, synchronous (it blocks
// the page), and stores strings only. A year of duty entries for a fleet is
// past that limit, and blocking the UI thread on every read is exactly what
// an offline app must not do.
//
// Everything degrades rather than throws. A browser in private mode may
// refuse IndexedDB entirely; in that case this falls back to memory, the app
// still runs for the session, and the caller is told storage isn't durable so
// it can warn before someone types in an hour of work that won't survive a
// refresh.

const DB_NAME = "avicore_offline";
const DB_VERSION = 1;
const CACHE_STORE = "cache";
const OUTBOX_STORE = "outbox";

let dbPromise = null;
let durable = true;

// Memory fallback, used only when IndexedDB is unavailable.
const memory = { cache: new Map(), outbox: new Map() };

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      durable = false;
      return resolve(null);
    }
    let request;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      durable = false;
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
        // Flushed in the order the user made the changes - a create followed
        // by an edit of the same record must not be sent the other way round.
        outbox.createIndex("queuedAt", "queuedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { durable = false; resolve(null); };
    request.onblocked = () => { durable = false; resolve(null); };
  });
  return dbPromise;
}

// True when writes made offline will survive a page reload. False means the
// browser refused persistent storage (private mode, or storage disabled) and
// the UI should say so rather than promise something it can't keep.
export async function storageIsDurable() {
  await openDb();
  return durable;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Cache ---------------------------------------------------------------

export async function cachePut(key, value) {
  const db = await openDb();
  const record = { key, value, cachedAt: new Date().toISOString() };
  if (!db) { memory.cache.set(key, record); return; }
  try {
    await asPromise(tx(db, CACHE_STORE, "readwrite").put(record));
  } catch {
    memory.cache.set(key, record);
  }
}

// Returns { value, cachedAt } or null. cachedAt is handed back so the UI can
// say HOW OLD the offline data is - "roster as of 14:30" is trustworthy in a
// way that an undated screen is not.
export async function cacheGet(key) {
  const db = await openDb();
  if (!db) return memory.cache.get(key) || null;
  try {
    const record = await asPromise(tx(db, CACHE_STORE, "readonly").get(key));
    return record || memory.cache.get(key) || null;
  } catch {
    return memory.cache.get(key) || null;
  }
}

export async function cacheClear() {
  const db = await openDb();
  memory.cache.clear();
  if (!db) return;
  try { await asPromise(tx(db, CACHE_STORE, "readwrite").clear()); } catch { /* ignore */ }
}

// ---- Outbox --------------------------------------------------------------

let counter = 0;
function nextId() {
  counter += 1;
  return `${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Queue one write for later.
 *
 * @param op {{ kind: string, args: any, label: string, owner?: string }}
 *   kind  - which data-layer function to replay ("addDutyEntry", ...)
 *   args  - exactly what that function takes, so replaying is a plain call
 *   label - human wording for the pending list ("Duty 12 Aug - WJU")
 *   owner - pilot code / admin id this write belongs to. Used to keep one
 *           person's offline edits from ever being replayed over another's.
 */
export async function outboxAdd(op) {
  const record = {
    id: nextId(),
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    ...op
  };
  const db = await openDb();
  if (!db) { memory.outbox.set(record.id, record); return record; }
  try {
    await asPromise(tx(db, OUTBOX_STORE, "readwrite").put(record));
  } catch {
    memory.outbox.set(record.id, record);
  }
  return record;
}

export async function outboxList() {
  const db = await openDb();
  if (!db) return [...memory.outbox.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  try {
    const all = await asPromise(tx(db, OUTBOX_STORE, "readonly").getAll());
    const merged = [...(all || []), ...memory.outbox.values()];
    return merged.sort((a, b) => String(a.queuedAt).localeCompare(String(b.queuedAt)));
  } catch {
    return [...memory.outbox.values()];
  }
}

export async function outboxRemove(id) {
  memory.outbox.delete(id);
  const db = await openDb();
  if (!db) return;
  try { await asPromise(tx(db, OUTBOX_STORE, "readwrite").delete(id)); } catch { /* ignore */ }
}

// Records a failed attempt WITHOUT dropping the write. A write is only ever
// removed when the server has accepted it, or when the user explicitly
// discards it - never because it failed a few times.
export async function outboxMarkFailed(id, message, conflictDetail) {
  const db = await openDb();
  const existing = memory.outbox.get(id) || (db ? await asPromise(tx(db, OUTBOX_STORE, "readonly").get(id)).catch(() => null) : null);
  if (!existing) return;
  const updated = {
    ...existing,
    attempts: (existing.attempts || 0) + 1,
    lastError: String(message || "").slice(0, 300),
    ...(conflictDetail ? { conflictDetail } : {})
  };
  if (!db) { memory.outbox.set(id, updated); return; }
  try { await asPromise(tx(db, OUTBOX_STORE, "readwrite").put(updated)); } catch { memory.outbox.set(id, updated); }
}

export async function outboxCount() {
  return (await outboxList()).length;
}
