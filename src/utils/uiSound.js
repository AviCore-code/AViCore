// UI click sounds generated with the Web Audio API (no audio files) - a set
// of sci-fi-movie-style button tones, selectable from Settings. Per-machine
// preference stored in localStorage - a sound setting is personal to the
// workstation, so it deliberately does NOT go through the synced
// app_settings store like the FTL limits do.
let ctx = null;

export const CLICK_TONES = [
  { id: "console", label: "Console Beep (spaceship console)" },
  { id: "scanner", label: "Scanner Blip" },
  { id: "comm", label: "Comm Chirp (communicator)" },
  { id: "reactor", label: "Reactor Pulse (heavy machine)" },
  { id: "soft", label: "Soft Click (standard)" }
];

export function isClickSoundOn() {
  return localStorage.getItem("uiClickSound") !== "off";
}

export function setClickSoundOn(on) {
  localStorage.setItem("uiClickSound", on ? "on" : "off");
}

export function getClickTone() {
  const saved = localStorage.getItem("uiClickTone");
  return CLICK_TONES.some((t) => t.id === saved) ? saved : "console";
}

export function setClickTone(id) {
  localStorage.setItem("uiClickTone", id);
}

function ensureCtx() {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone({ type = "sine", from, to, dur, gain = 0.06, at = 0 }) {
  const c = ensureCtx();
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.01);
}

export function playClick(toneId) {
  if (!isClickSoundOn()) return;
  try {
    switch (toneId || getClickTone()) {
      case "console":
        // Classic spaceship-console beep: square wave falling pitch
        tone({ type: "square", from: 1250, to: 620, dur: 0.07, gain: 0.035 });
        break;
      case "scanner":
        // Rising scanner blip
        tone({ type: "sine", from: 480, to: 1650, dur: 0.06, gain: 0.06 });
        break;
      case "comm":
        // Two-tone communicator chirp
        tone({ type: "triangle", from: 950, dur: 0.04, gain: 0.05 });
        tone({ type: "triangle", from: 1500, dur: 0.05, gain: 0.05, at: 0.045 });
        break;
      case "reactor":
        // Deep machine pulse
        tone({ type: "sawtooth", from: 190, to: 85, dur: 0.11, gain: 0.08 });
        break;
      default:
        // Soft click
        tone({ type: "sine", from: 880, dur: 0.07, gain: 0.06 });
    }
  } catch {
    // Audio unavailable (no output device etc.) - never break the click.
  }
}
