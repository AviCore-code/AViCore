// Just enough of a browser for AviCore's data layer (webDatabase.js /
// desktopDatabase.js) to run under Node on the VPS. Imported FIRST by
// service.mjs, before anything that reads window / localStorage at load.
//
// localStorage is kept in a file, so the Auto Import account's Supabase
// session (webDatabase's importer client, storageKey avicore-autoimport-auth)
// survives a restart - the password itself is never stored, only the session
// the login command obtained.

import fs from "node:fs";
import path from "node:path";

const dir = process.env.AVI_IMPORT_STATE || "/var/lib/avicore-autoimport";
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, "storage.json");

function makeStorage(persist) {
  let data = {};
  if (persist) { try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; } }
  const save = () => { if (persist) fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 }); };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); save(); },
    removeItem: (k) => { delete data[k]; save(); },
    clear: () => { data = {}; save(); },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; }
  };
}

globalThis.window = globalThis;
globalThis.localStorage = makeStorage(true);
globalThis.sessionStorage = makeStorage(false);
globalThis.document = globalThis.document || { addEventListener() {}, removeEventListener() {}, visibilityState: "visible", title: "" };
if (!globalThis.addEventListener) globalThis.addEventListener = () => {};
if (!globalThis.removeEventListener) globalThis.removeEventListener = () => {};
