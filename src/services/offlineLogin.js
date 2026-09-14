// Offline sign-in for the Crew app.
//
// Capt. Weera asked for this after confirming the trade-off: a pilot who signs
// OUT and then loses signal currently cannot get back in, because the password
// is checked by the server (verify_pilot_password) and nothing is held on the
// device.
//
// ---------------------------------------------------------------------------
// WHAT THIS COSTS, stated plainly
// ---------------------------------------------------------------------------
//
// Checking a password on the device is weaker than checking it on the server,
// and no amount of care changes that. What IS in our control is how much
// weaker. Four decisions below exist for that reason:
//
//   1. The password is never stored. Only a PBKDF2 hash with a per-pilot random
//      salt, so the file on the device cannot be read back into a password.
//
//   2. 210,000 iterations of SHA-256. Enough that guessing offline is slow even
//      with the file in hand - and it is only paid once per sign-in, which a
//      person does not notice.
//
//   3. It EXPIRES. A stored credential is good for 30 days from the last
//      successful ONLINE sign-in. A device that stops checking in with the
//      server stops being able to sign in at all, which limits how long a lost
//      tablet stays useful to whoever has it.
//
//   4. Failed attempts are counted and lock the credential. Without that, an
//      offline hash is a target you can attack at your leisure; with it, the
//      device is useless after a handful of wrong guesses and the pilot has to
//      sign in online again.
//
// Deliberately NOT done: no offline sign-in for admins. Admin sign-in is
// Supabase auth with real privileges behind it, and admins work where there is
// a connection. Only the pilot's own Crew login is cached.

const STORE_KEY = "avicore_offline_login";
const ITERATIONS = 210000;
const SALT_BYTES = 16;

// A credential is good for this long after the last successful ONLINE sign-in.
// Long enough for a full offshore rotation plus travel; short enough that a
// device out of contact for a month cannot be used at all.
export const CREDENTIAL_TTL_DAYS = 30;

// Wrong guesses before the credential is destroyed. Small on purpose: a pilot
// who has typed their own password wrong five times can sign in online instead,
// whereas anyone working through a dictionary needs far more than five.
export const MAX_ATTEMPTS = 5;

function hasCrypto() {
  return typeof crypto !== "undefined" && crypto.subtle && crypto.getRandomValues;
}

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * PBKDF2-SHA256. Returns base64.
 *
 * Not a plain SHA-256 of the password: a single hash of a short password is
 * recovered from a lookup table in seconds. The point of PBKDF2 with a high
 * iteration count is to make each guess expensive.
 */
async function derive(password, saltBytes, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(String(password || "")), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    key, 256
  );
  return toB64(bits);
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}

const normalize = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Remembers a pilot's password for offline use, AFTER a successful online
 * sign-in.
 *
 * Called only on the online path: the server has already said the password is
 * correct, so storing a hash of it adds no new authority - it only lets the
 * same check happen later without a connection.
 */
export async function rememberCredential(code, password, name = "") {
  const key = normalize(code);
  if (!key || !password || !hasCrypto()) return { ok: false };

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);

  const store = readStore();
  store[key] = {
    code: key,
    name: String(name || ""),
    salt: toB64(salt),
    hash,
    iterations: ITERATIONS,
    savedAt: new Date().toISOString(),
    attempts: 0
  };
  writeStore(store);
  return { ok: true };
}

// Which pilots this device can sign in offline, for the login screen's list.
// Expired entries are removed as a side effect rather than being listed and
// then refused - offering a name that cannot work is worse than not offering it.
export function listOfflinePilots(now = new Date()) {
  const store = readStore();
  const out = [];
  let changed = false;

  for (const [key, rec] of Object.entries(store)) {
    if (isExpired(rec, now) || rec.attempts >= MAX_ATTEMPTS) {
      delete store[key];
      changed = true;
      continue;
    }
    out.push({ code: rec.code, name: rec.name, savedAt: rec.savedAt });
  }

  if (changed) writeStore(store);
  return out.sort((a, b) => (a.name || a.code).localeCompare(b.name || b.code));
}

function isExpired(rec, now = new Date()) {
  const at = rec?.savedAt ? new Date(rec.savedAt).getTime() : NaN;
  if (!Number.isFinite(at)) return true;
  const ageDays = (now.getTime() - at) / 86400000;
  // A negative age means the clock moved backwards. Treated as NOT expired but
  // not as extra time either - the stored date is what it is; only a genuine
  // online sign-in refreshes it.
  return ageDays >= CREDENTIAL_TTL_DAYS;
}

export function hasOfflineCredential(code, now = new Date()) {
  const rec = readStore()[normalize(code)];
  return !!rec && !isExpired(rec, now) && rec.attempts < MAX_ATTEMPTS;
}

/**
 * Checks a password against the stored hash.
 *
 * Returns { ok, reason, attemptsLeft }. On failure the attempt is counted and
 * persisted immediately, so closing the app does not reset the counter.
 */
export async function verifyOffline(code, password, now = new Date()) {
  if (!hasCrypto()) return { ok: false, reason: "unsupported" };

  const key = normalize(code);
  const store = readStore();
  const rec = store[key];

  if (!rec) return { ok: false, reason: "not-stored" };
  if (rec.attempts >= MAX_ATTEMPTS) {
    delete store[key];
    writeStore(store);
    return { ok: false, reason: "locked" };
  }
  if (isExpired(rec, now)) {
    delete store[key];
    writeStore(store);
    return { ok: false, reason: "expired" };
  }

  const hash = await derive(password, fromB64(rec.salt), rec.iterations || ITERATIONS);

  // Constant-time comparison. A normal === on strings returns as soon as it
  // finds a difference, and the time it took leaks how much of the hash matched.
  if (!timingSafeEqual(hash, rec.hash)) {
    rec.attempts = (rec.attempts || 0) + 1;
    const left = MAX_ATTEMPTS - rec.attempts;
    if (left <= 0) {
      // Destroyed, not just flagged: a locked-but-present hash is still a hash
      // somebody can take away and attack.
      delete store[key];
      writeStore(store);
      return { ok: false, reason: "locked", attemptsLeft: 0 };
    }
    store[key] = rec;
    writeStore(store);
    return { ok: false, reason: "wrong", attemptsLeft: left };
  }

  // Correct: the counter resets, but savedAt is NOT refreshed. Only a real
  // online sign-in extends the 30 days, otherwise a device could stay usable
  // for ever without ever contacting the server again.
  rec.attempts = 0;
  store[key] = rec;
  writeStore(store);
  return { ok: true, name: rec.name };
}

export function forgetCredential(code) {
  const store = readStore();
  delete store[normalize(code)];
  writeStore(store);
}

// Clears every stored credential. Offered in Crew Settings so a pilot handing a
// device on can remove their own access without waiting for it to expire.
export function forgetAllCredentials() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
}

export function credentialStatus(code, now = new Date()) {
  const rec = readStore()[normalize(code)];
  if (!rec) return { stored: false };
  const at = new Date(rec.savedAt).getTime();
  const ageDays = Number.isFinite(at) ? (now.getTime() - at) / 86400000 : Infinity;
  return {
    stored: true,
    name: rec.name,
    savedAt: rec.savedAt,
    daysLeft: Math.max(0, Math.ceil(CREDENTIAL_TTL_DAYS - ageDays)),
    expired: isExpired(rec, now),
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - (rec.attempts || 0))
  };
}

function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export const OFFLINE_LOGIN_REASONS = {
  "not-stored": "This device has not signed in as that pilot before, so there is nothing to check the password against. Sign in once with a connection first.",
  expired: `The saved sign-in for this pilot has expired (${CREDENTIAL_TTL_DAYS} days). Sign in with a connection to renew it.`,
  locked: "Too many incorrect attempts — the saved sign-in has been removed from this device. Sign in with a connection.",
  wrong: "Incorrect password.",
  unsupported: "This browser cannot store a sign-in for offline use."
};
