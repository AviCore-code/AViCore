// Auto Import keeps its settings on THIS computer: the folder / file handles
// the admin picked (File System Access API) can only live in the browser's
// IndexedDB - they point at this PC's disk, so they mean nothing on the server
// or on another machine. One small key-value store.

const DB_NAME = "avicore-autoimport";
const STORE = "kv";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("This browser has no IndexedDB.")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const kvGet = (key) => tx("readonly", (s) => s.get(key));
export const kvSet = (key, value) => tx("readwrite", (s) => s.put(value, key));
export const kvDel = (key) => tx("readwrite", (s) => s.delete(key));
