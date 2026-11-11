// Automatic sign-out of AviCore Crew after 10 minutes with no activity.
//
// Capt. Weera: "ถ้า log in แล้วเกิน 10 นาที ไม่มีการขยับเมาส์ หรือป้อนข้อมูลใน
// ระบบ ให้ log out ก่อน log out ให้ save ก่อน". Crew is used on shared
// devices (crew-room PCs, kiosk shortcuts, tablets), so a session left open
// shows one pilot's records to the next person and lets them be edited.
//
// "Save first" has two parts, both run before the session is closed:
//   1. Work already saved but not yet sent (the offline queue) is pushed to
//      the server if there is a connection. If there isn't, it stays queued
//      on the device - exactly as on a manual logout - and goes up the next
//      time that pilot signs in here.
//   2. A form still being filled in is kept as a DRAFT on this device and put
//      back when the same pilot signs in again. It is deliberately NOT
//      submitted: a half-typed duty entry saved as a real record would feed
//      wrong figures into FDT and Fatigue, and nobody would be there to check
//      it. Screens register what they need to keep via registerBeforeLogout.
//
// The timer reads the clock rather than counting ticks, so a laptop that
// slept with the app open is signed out as soon as it wakes.

export const IDLE_LIMIT_MS = 10 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000; // countdown shown for the last minute

export const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart", "pointerdown", "input"];

const savers = new Set();

// A screen holding unsaved input registers a function that stores it.
// Returns the unregister function (use it as a useEffect cleanup).
export function registerBeforeLogout(fn) {
  savers.add(fn);
  return () => savers.delete(fn);
}

// Runs every registered saver. One failing never stops the others, or the
// sign-out itself.
export async function runBeforeLogout(reason) {
  for (const fn of Array.from(savers)) {
    try { await fn(reason); } catch { /* keep going */ }
  }
}

// Pure: how long until sign-out, given the last activity time.
export function idleState(lastActivityAt, now = Date.now(), limit = IDLE_LIMIT_MS, warnFor = IDLE_WARNING_MS) {
  const remaining = Math.max(0, limit - (now - lastActivityAt));
  return { remaining, expired: remaining === 0, warning: remaining > 0 && remaining <= warnFor };
}

// ---- Drafts kept across an automatic sign-out --------------------------

const DRAFT_PREFIX = "avicore_idle_draft:";

export function saveDraft(scope, pilotCode, data) {
  try {
    localStorage.setItem(DRAFT_PREFIX + scope + ":" + String(pilotCode || "").toUpperCase(),
      JSON.stringify({ savedAt: new Date().toISOString(), data }));
  } catch { /* storage full or blocked - nothing more we can do */ }
}

// Returns {savedAt, data} once and removes it, or null.
export function takeDraft(scope, pilotCode) {
  const key = DRAFT_PREFIX + scope + ":" + String(pilotCode || "").toUpperCase();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    return JSON.parse(raw);
  } catch { return null; }
}
