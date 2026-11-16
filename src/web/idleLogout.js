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

// What counts as someone using the app. Two events that used to be here never
// did, and kept the session open for ever (Capt. Weera, 17 Nov 2026: auto
// logout "ไม่ work"):
//   - "scroll" also fires when the APP scrolls itself (scrollIntoView after a
//     save, a list jumping to today). A person scrolling still shows up as
//     wheel / touchmove / keydown, or mousedown on the scrollbar.
//   - "mousemove" is sent by Chrome and Edge with the mouse lying still,
//     whenever what is under the pointer changes - an animated background,
//     a clock, a list refreshing. So a move only counts if the pointer really
//     went somewhere (see isRealActivity).
export const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "touchmove", "pointerdown", "input"];

// Least distance, in screen pixels, a mouse must travel to count as activity.
export const MIN_MOUSE_TRAVEL_PX = 3;

// Decides whether an event is a real person. `pointer` holds the last
// position seen ({ x, y } or null) and is updated in place.
export function isRealActivity(event, pointer) {
  if (!event) return false;
  if (event.type !== "mousemove") return true;
  const x = Number(event.screenX), y = Number(event.screenY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const last = pointer.last;
  pointer.last = { x, y };
  if (!last) return false; // first sighting: nothing to compare with yet
  return Math.abs(x - last.x) + Math.abs(y - last.y) >= MIN_MOUSE_TRAVEL_PX;
}

// How long sending queued work may hold up an automatic sign-out. On a poor
// offshore connection a request can hang for minutes; the work is safe in
// the queue either way and goes up at the next sign-in.
export const FLUSH_BEFORE_LOGOUT_MS = 8000;

export function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

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
