import { useEffect, useRef, useState } from "react";

// Signs a pilot out after a period of no activity.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
//
// AviCore Crew on a shared office or crew-room PC stays signed in until someone
// presses Log Out. Walk away and the next person at that machine is looking at
// your duty records - and can enter flights under your name.
//
// ---------------------------------------------------------------------------
// WHAT IT DOES NOT DO
// ---------------------------------------------------------------------------
//
// It never discards work. Before signing out it flushes the offline queue, so
// anything typed but not yet sent goes to the server first. If the flush cannot
// complete (no connection), the entries stay safely in the device queue exactly
// as they would after a manual log out - they are sent next time this pilot
// signs in here.
//
// It also never shows a confirm() dialog. The manual Log Out asks before
// abandoning unsent work, which is right when a person is standing there; an
// automatic timeout has nobody to answer it, and a modal left open on an
// unattended screen would defeat the whole point.
//
// ---------------------------------------------------------------------------
// DESKTOP ONLY, ON PURPOSE
// ---------------------------------------------------------------------------
//
// Asked for on Windows. A phone is a personal device that locks itself, and a
// pilot on a rig re-entering a password every half hour on a handset - often
// with no signal to verify it - is a much worse trade. Enabled only where the
// risk it addresses actually exists.

// Activity that counts as "someone is there". `visibilitychange` is included so
// returning to the tab counts, and scroll/touch so reading a long roster does.
const EVENTS = [
  "mousedown", "mousemove", "keydown", "wheel", "scroll",
  "touchstart", "click", "visibilitychange"
];

// app_settings key holding the timeout, in MINUTES. Set by the office in
// Admin > Settings > Auto Sign-Out and synced to every Crew device, so the
// policy is the company's rather than each machine's.
export const IDLE_KEY = "crew_idle_timeout_minutes";

// Used when the setting has never been saved, or cannot be read.
export const IDLE_DEFAULT_MINUTES = 30;

// 0 means OFF. Anything else is clamped: above 8 hours the feature is not
// really doing anything.
//
// The floor is 1 minute rather than a comfortable 5 so that the office can pick
// 2 minutes to TEST the behaviour without waiting half an hour. Short values
// are unsuitable for daily use - a pilot reading a long roster would be signed
// out mid-page - and the Settings screen says so next to those options.
export const IDLE_MIN_MINUTES = 1;
export const IDLE_MAX_MINUTES = 480;

// Warn for the last 60 seconds - but never for more than a third of the whole
// period. At the 2-minute test setting a flat 60s would put the countdown on
// screen for half the time, which is not what the real 30-minute setting looks
// like and would make the test misleading.
export const IDLE_WARN_MS = 60 * 1000;

export function warnMsFor(limitMs) {
  return Math.min(IDLE_WARN_MS, Math.floor(limitMs / 3));
}

export function normalizeIdleMinutes(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return IDLE_DEFAULT_MINUTES;
  if (n <= 0) return 0;                                    // disabled
  return Math.min(IDLE_MAX_MINUTES, Math.max(IDLE_MIN_MINUTES, Math.round(n)));
}

function isDesktop() {
  if (typeof navigator === "undefined") return false;
  // Coarse pointer + small screen = phone/tablet. Checked rather than sniffing
  // the user agent, which is unreliable and changes with every browser release.
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;
  return !coarse;
}

/**
 * @param {boolean} enabled  usually "is a pilot signed in"
 * @param {() => Promise<void>|void} onIdle  called once when the time is up
 * @returns {{secondsLeft: number|null, minutes: number|null}}
 *   secondsLeft counts down during the warning only; minutes is the company
 *   setting, so the warning can name it rather than hard-coding "30".
 */
export default function useIdleSignOut(enabled, onIdle) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  // null until the company setting has been read. The timer does not start
  // before then, so a slow settings fetch can never sign someone out early
  // using a default they did not choose.
  const [minutes, setMinutes] = useState(null);
  const lastActive = useRef(Date.now());
  const firing = useRef(false);

  useEffect(() => {
    let alive = true;
    import("../services/desktopDatabase.js")
      .then(({ getSetting }) => getSetting(IDLE_KEY))
      .then((v) => { if (alive) setMinutes(normalizeIdleMinutes(v ?? IDLE_DEFAULT_MINUTES)); })
      .catch(() => { if (alive) setMinutes(IDLE_DEFAULT_MINUTES); });
    return () => { alive = false; };
  }, []);
  // Held in a ref so a changing callback identity cannot restart the timer -
  // otherwise a parent re-render would keep resetting the countdown and the
  // sign-out would never happen.
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    // minutes === null: setting not read yet. minutes === 0: switched off.
    if (!enabled || !isDesktop() || minutes === null || minutes === 0) {
      setSecondsLeft(null);
      return;
    }
    const limitMs = minutes * 60 * 1000;
    const warnMs = warnMsFor(limitMs);

    const bump = () => {
      lastActive.current = Date.now();
      if (!firing.current) setSecondsLeft(null);
    };
    for (const e of EVENTS) window.addEventListener(e, bump, { passive: true });

    // Polled once a second rather than one long setTimeout: a laptop that
    // sleeps freezes timers, and on wake a timeout would fire late (or not at
    // all) while a clock comparison correctly sees the whole idle period.
    const tick = setInterval(async () => {
      if (firing.current) return;
      const idle = Date.now() - lastActive.current;

      if (idle >= limitMs) {
        firing.current = true;
        setSecondsLeft(0);
        try {
          await onIdleRef.current?.();
        } finally {
          firing.current = false;
          setSecondsLeft(null);
          lastActive.current = Date.now();
        }
        return;
      }

      const left = limitMs - idle;
      setSecondsLeft(left <= warnMs ? Math.ceil(left / 1000) : null);
    }, 1000);

    return () => {
      clearInterval(tick);
      for (const e of EVENTS) window.removeEventListener(e, bump);
    };
  }, [enabled, minutes]);

  return { secondsLeft, minutes };
}
