// A short click when a button is pressed.
//
// Generated with the Web Audio API rather than shipped as an audio file: it is
// a few hundred bytes of code instead of a download, works offline, and never
// has to be fetched before the first press makes a sound.
//
// Three different sounds, because "did that work?" is the question the sound is
// answering:
//
//   click    a normal press
//   ok       something was saved / sent
//   error    something was refused
//
// Deliberately quiet and short (~40 ms). This runs in a cockpit crew room and
// on phones in public; a loud or musical noise would get the app muted, and a
// muted app can't tell anyone anything.

let ctx = null;
let enabled = true;

const STORAGE_KEY = "avicore_click_sound";

try {
  // Remembered per device. Somebody who turns it off should not have to do it
  // again tomorrow.
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "off") enabled = false;
} catch { /* private mode - default on */ }

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on) {
  enabled = !!on;
  try { localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off"); } catch { /* ignore */ }
  if (enabled) playClick();   // so the choice is audible immediately
}

function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers start the audio engine suspended until a user gesture. Every
  // call here IS inside a gesture (a button press), so resuming is safe and
  // is what makes the very first click audible.
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone({ frequency, duration = 0.04, volume = 0.06, type = "square", sweepTo }) {
  if (!enabled) return;
  const audioCtx = audio();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const now = audioCtx.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, now + duration);

    // A hard start or stop is heard as a pop, which sounds like a fault.
    // Ramping the volume in and out keeps it a click instead.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch {
    // Sound is never important enough to break anything over.
  }
}

export function playClick() {
  tone({ frequency: 620, duration: 0.035, volume: 0.05, type: "square" });
}

// Rising: something completed.
export function playOk() {
  tone({ frequency: 660, sweepTo: 990, duration: 0.09, volume: 0.06, type: "sine" });
}

// Falling, lower: something was refused. Distinguishable without looking.
export function playError() {
  tone({ frequency: 320, sweepTo: 180, duration: 0.16, volume: 0.07, type: "sawtooth" });
}

// One listener for the whole app, instead of adding playClick() to hundreds of
// onClick handlers - which would be a long, error-prone edit that the next new
// button would immediately be missing from.
//
// Capture phase, so it is heard even when the handler stops propagation, and
// it fires on the press regardless of what the handler then does.
export function startClickSound() {
  if (typeof document === "undefined") return () => {};

  const onPointerDown = (event) => {
    if (!enabled) return;
    const el = event.target?.closest?.(
      'button, [role="button"], .training-tab, .settings-hub-tab, a.file-btn, label.file-btn, label.trainingdue-import-btn'
    );
    if (!el) return;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return;
    // Destructive controls get the lower, falling tone: a delete should not
    // sound the same as any other press.
    const text = (el.textContent || "").toLowerCase();
    if (/delete|discard|remove|ลบ|เคลียร์/.test(text)) tone({ frequency: 420, sweepTo: 300, duration: 0.06, volume: 0.06, type: "triangle" });
    else playClick();
  };

  // pointerdown, not click: the sound belongs to the moment of pressing, and
  // this also covers touch, where click is delayed.
  document.addEventListener("pointerdown", onPointerDown, true);
  return () => document.removeEventListener("pointerdown", onPointerDown, true);
}
