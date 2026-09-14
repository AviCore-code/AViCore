import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";

// Local offline database for the Android Crew app - a small subset of the
// desktop app's schema (only what My Status / Daily Duty / My Logbook / My
// Experience actually need): pilot_experience and app_settings are
// read-only mirrors pulled from Supabase; pilot_duty_entries is read/write
// and is what a pilot actually creates offline on the phone, pushed up once
// back online. sync_meta tracks per-table "last pulled at" cursors and this
// device's own uuid, same idea as electron/sync.cjs's sync_meta table.
const DB_NAME = "avicore_crew";
const DB_VERSION = 1;

const sqliteConnection = new SQLiteConnection(CapacitorSQLite);
let dbConn = null;
let ready = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pilot_experience (
    uuid TEXT PRIMARY KEY,
    licence TEXT,
    licence_key TEXT,
    code TEXT,
    name TEXT,
    update_date TEXT,
    record_json TEXT,
    created_at TEXT,
    modified_at TEXT,
    deleted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS pilot_duty_entries (
    uuid TEXT PRIMARY KEY,
    local_id INTEGER,
    pilot_code TEXT,
    date TEXT,
    duty_type TEXT,
    entry_json TEXT,
    created_at TEXT,
    modified_at TEXT,
    deleted_at TEXT,
    synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT,
    modified_at TEXT
  );
  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`;

// Opens (creating on first run) the on-device SQLite database. Safe to call
// many times - subsequent calls reuse the same open connection. Must only
// ever be called on a real Android device/emulator (window.Capacitor must
// be a native platform) - there is no browser fallback here, that's handled
// one level up in mobileDatabase.js.
export async function getDb() {
  if (dbConn) return dbConn;
  if (!ready) {
    ready = (async () => {
      const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;
      dbConn = isConn
        ? await sqliteConnection.retrieveConnection(DB_NAME, false)
        : await sqliteConnection.createConnection(DB_NAME, false, "no-encryption", DB_VERSION, false);
      await dbConn.open();
      await dbConn.execute(SCHEMA);
      return dbConn;
    })();
  }
  await ready;
  return dbConn;
}

// Thin query helpers - @capacitor-community/sqlite's query()/run() both
// return { values: [...] } / { changes: { changes, lastId } } shapes.
export async function all(sql, values = []) {
  const db = await getDb();
  const res = await db.query(sql, values);
  return res.values || [];
}

export async function get(sql, values = []) {
  const rows = await all(sql, values);
  return rows[0] || null;
}

export async function run(sql, values = []) {
  const db = await getDb();
  return db.run(sql, values);
}

export async function exec(sql) {
  const db = await getDb();
  return db.execute(sql);
}
