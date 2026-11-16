// AviCore Auto Import - the VPS service (systemd: avicore-autoimport).
//
//   node avicore-autoimport.mjs login   sign the Auto Import account in (asks
//                                       for an admin email + password; only
//                                       the resulting session is kept)
//   node avicore-autoimport.mjs logout
//   node avicore-autoimport.mjs once    one forced run, then exit
//   node avicore-autoimport.mjs run     the 24-hour service
//
// Files arrive from the office PC (scripts/pc-sync) under
//   $AVI_IMPORT_ROOT/{fdt,roster,training,staff}/   (+ .pc-heartbeat)
// The settings are read from the server every minute (Admin_app_settings
// auto_import_config, edited on the Auto Import page); status and the import
// log are written back (auto_import_status) for every admin to see.
// See src/services/autoImportCore.js.

import "./polyfills.mjs";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { importerSignIn, importerSignOut, getImporterSession, withImporterClient } from "../../src/services/webDatabase.js";
import { getSetting, saveSetting } from "../../src/services/desktopDatabase.js";
import {
  CONFIG_KEY, STATUS_KEY, REQUEST_KEY, SOURCES, withConfigDefaults, isFdtFileName,
  bangkokNow, dueSlots, importFdtFiles, importRosterFile, importTrainingFile, importStaffFile
} from "../../src/services/autoImportCore.js";

const ROOT = process.env.AVI_IMPORT_ROOT || "/srv/avicore-import/files";
const STATE_DIR = process.env.AVI_IMPORT_STATE || "/var/lib/avicore-autoimport";
const STATE_FILE = path.join(STATE_DIR, "state.json");
const TICK_MS = 60_000;
const HEARTBEAT_MS = 5 * 60_000;
const LOG_MAX = 300;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { ranSlots: {}, seen: {}, log: [] }; }
}
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 }); }

const sig = (st) => `${Math.round(st.mtimeMs)}:${st.size}`;

function listFiles(key, cfg) {
  const dir = path.join(ROOT, key);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  let files = names
    .filter((n) => /\.xlsx?$/i.test(n) && !n.startsWith("~$") && !n.endsWith(".part"))
    .map((n) => { const st = fs.statSync(path.join(dir, n)); return { name: n, full: path.join(dir, n), st }; })
    .filter((f) => f.st.isFile());
  if (key === "fdt") files = files.filter((f) => isFdtFileName(f.name));
  if (key === "roster" || key === "training") {
    // One file is expected; prefer the one named in the settings, else the newest.
    const wanted = path.win32.basename(String(cfg.paths?.[key] || "")).toLowerCase();
    const match = files.find((f) => f.name.toLowerCase() === wanted);
    files = match ? [match] : files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).slice(0, 1);
  }
  if (key === "staff") {
    const wanted = new Set((cfg.paths?.staff || []).map((p) => path.win32.basename(String(p)).toLowerCase()).filter(Boolean));
    if (wanted.size) files = files.filter((f) => wanted.has(f.name.toLowerCase()));
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

const asFile = (f) => ({
  name: f.name,
  lastModified: Math.round(f.st.mtimeMs),
  arrayBuffer: async () => { const b = fs.readFileSync(f.full); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
});

async function runSources(cfg, state, force, reason) {
  const logs = [];
  const today = bangkokNow().date;
  for (const src of SOURCES) {
    const files = listFiles(src.key, cfg);
    const seen = state.seen[src.key] || {};
    const todo = force ? files : files.filter((f) => seen[f.name] !== sig(f.st));
    if (!todo.length) continue;
    const mark = (name) => { const f = todo.find((x) => x.name === name); if (f) seen[name] = sig(f.st); };
    if (src.key === "fdt") {
      const r = await importFdtFiles(todo.map(asFile));
      logs.push(...r.logs);
      r.done.forEach(mark);
    } else {
      for (const f of todo) {
        try {
          const text = src.key === "roster" ? await importRosterFile(asFile(f), cfg.rosterSheet, today)
            : src.key === "training" ? await importTrainingFile(asFile(f))
            : await importStaffFile(asFile(f));
          logs.push({ source: src.label, file: f.name, ok: true, text });
          mark(f.name);
        } catch (err) {
          logs.push({ source: src.label, file: f.name, ok: false, text: err.message || String(err) });
        }
      }
    }
    state.seen[src.key] = seen;
  }
  const at = new Date().toISOString();
  const entries = logs.length ? logs : (force ? [{ source: "Auto Import", ok: true, text: "Nothing to import - no files on the VPS yet" }] : []);
  state.log = [...entries.map((l) => ({ at, reason, ...l })), ...(state.log || [])].slice(0, LOG_MAX);
  return logs.length;
}

// "Browse…" on the Auto Import page opens Windows Explorer on the office PC
// (scripts/pc-sync/avicore-pc-browse.ps1), which drops the choice here as
// .pc-pick-<key>.json. It is saved into the shared settings, so every admin
// sees it on the page.
const PICK_KEYS = new Set(["fdt", "roster", "training", "staff"]);
async function applyPcPicks(cfg, state) {
  let names = [];
  try { names = fs.readdirSync(ROOT).filter((n) => /^\.pc-pick-[a-z]+\.json$/.test(n)); } catch { return cfg; }
  if (!names.length) return cfg;
  const paths = { ...cfg.paths };
  const picked = [];
  for (const n of names) {
    const full = path.join(ROOT, n);
    try {
      // PowerShell writes UTF-8 with a byte-order mark; JSON.parse rejects it.
      const pick = JSON.parse(fs.readFileSync(full, "utf8").replace(/^﻿/, ""));
      if (PICK_KEYS.has(pick.key)) {
        const v = pick.key === "staff" ? [].concat(pick.value || []).map(String).filter(Boolean) : String(pick.value || "");
        if (pick.key === "staff" ? v.length : v) {
          paths[pick.key] = v;
          picked.push({ key: pick.key, value: v, by: `${pick.user || "?"} on ${pick.computer || "office PC"}` });
        }
      }
    } catch (err) { log("Bad pick file", n, err.message || err); }
    try { fs.unlinkSync(full); } catch { /* already gone */ }
  }
  if (!picked.length) return cfg;
  const next = { ...cfg, paths, updatedBy: `Browse - ${picked[0].by}`, updatedAt: new Date().toISOString() };
  await saveSetting(CONFIG_KEY, next);
  const at = next.updatedAt;
  state.log = [...picked.map((p) => ({ at, reason: "Browse", source: "Settings", ok: true, text: `${p.key} = ${[].concat(p.value).join("; ")} (${p.by})` })), ...(state.log || [])].slice(0, LOG_MAX);
  state.lastStatusAt = 0;   // report soon
  log("Saved picked path(s):", picked.map((p) => p.key).join(", "));
  return next;
}

// The office PC's sync job cannot read the server settings itself (it has no
// AviCore sign-in), so the paths it must send are published here, in the
// upload folder it can read over SFTP.
function publishPcConfig(cfg) {
  const out = JSON.stringify({ paths: cfg.paths, updatedAt: cfg.updatedAt || null }, null, 2);
  const file = path.join(ROOT, ".pc-config.json");
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === out) return;
    fs.writeFileSync(file + ".tmp", out);
    fs.renameSync(file + ".tmp", file);
  } catch (err) { log("Could not publish .pc-config.json:", err.message || err); }
}

function pcLastSync() {
  try { return new Date(fs.statSync(path.join(ROOT, ".pc-heartbeat")).mtimeMs).toISOString(); } catch { return null; }
}

async function writeStatus(cfg, state, account) {
  const files = {};
  for (const src of SOURCES) {
    const seen = state.seen[src.key] || {};
    files[src.key] = listFiles(src.key, cfg).map((f) => ({
      name: f.name, size: f.st.size, mtime: new Date(f.st.mtimeMs).toISOString(), imported: seen[f.name] === sig(f.st)
    }));
  }
  await saveSetting(STATUS_KEY, {
    heartbeat: new Date().toISOString(),
    account,
    lastCheck: state.lastCheckAt || null,
    lastRun: state.lastRunAt || null,
    pcLastSync: pcLastSync(),
    files,
    log: (state.log || []).slice(0, 200)
  });
  state.lastStatusAt = Date.now();
}

let busy = false;
async function tick({ forceOnce = false } = {}) {
  if (busy) return;
  busy = true;
  const state = loadState();
  try {
    const session = await getImporterSession();
    if (!session) { log("Not signed in - run: avicore-autoimport login"); return; }
    const account = session.user?.email || "";
    await withImporterClient(async () => {
      let cfg = withConfigDefaults(await getSetting(CONFIG_KEY));
      cfg = await applyPcPicks(cfg, state);
      const req = await getSetting(REQUEST_KEY);
      publishPcConfig(cfg);
      const now = bangkokNow();
      let force = forceOnce;
      let reason = forceOnce ? "manual (VPS)" : "";
      if (req?.at && req.at !== state.lastRequestAt) {
        state.lastRequestAt = req.at;
        force = true;
        reason = `Run now by ${req.by || "admin"}`;
      }
      if (!force && cfg.enabled) {
        const due = dueSlots(cfg.times, now, state.ranSlots || {});
        if (due.length) {
          force = true;
          reason = `time ${due.join(", ")}`;
          state.ranSlots = { ...(state.ranSlots || {}) };
          due.forEach((s) => { state.ranSlots[s] = now.date; });
        }
      }
      const every = Math.max(1, Number(cfg.checkMinutes) || 15) * 60_000;
      const changedDue = cfg.enabled && (!state.lastCheckAt || Date.now() - Date.parse(state.lastCheckAt) >= every);
      let ran = 0;
      if (force || changedDue) {
        ran = await runSources(cfg, state, force, reason || "file changed");
        state.lastCheckAt = new Date().toISOString();
        if (ran || force) state.lastRunAt = state.lastCheckAt;
        if (ran) log(`Imported ${ran} item(s) (${reason || "file changed"})`);
      }
      if (ran || force || !state.lastStatusAt || Date.now() - state.lastStatusAt >= HEARTBEAT_MS) {
        await writeStatus(cfg, state, account);
      }
    });
  } catch (err) {
    log("Tick failed:", err.message || err);
  } finally {
    saveState(state);
    busy = false;
  }
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function write(s) { if (s.includes(question)) rl.output.write(s); else rl.output.write("*"); };
    }
    rl.question(question, (ans) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(ans); });
  });
}

const cmd = process.argv[2] || "run";
if (cmd === "login") {
  const email = (await ask("AviCore admin email: ")).trim();
  const password = await ask("Password: ", true);
  const res = await importerSignIn(email, password);
  if (!res.ok) { console.error("Sign-in failed:", res.error); process.exit(1); }
  console.log(`Signed in as ${res.user?.email}. The service keeps this session (not the password).`);
  process.exit(0);
} else if (cmd === "logout") {
  await importerSignOut();
  console.log("Signed out.");
  process.exit(0);
} else if (cmd === "once") {
  await tick({ forceOnce: true });
  process.exit(0);
} else {
  log(`AviCore Auto Import started - files in ${ROOT}`);
  await tick();
  setInterval(() => { tick(); }, TICK_MS);
}
