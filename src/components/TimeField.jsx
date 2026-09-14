import { useEffect, useRef, useState } from "react";
import "./DateField.css";

// Normalizes free-typed text to strict 24h "HH:mm" (no seconds). Accepts
// "5:30", "05:30", "0530", "17:05:00" (seconds dropped). Returns null if
// unparseable or out of range.
export function normalizeTime(text) {
  const s = (text || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) m = s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// Short warning beep when a bad time format is committed. Uses the Web Audio
// API (no audio file to bundle/host) and is created lazily on first use -
// browsers only allow an AudioContext to start after a user gesture, and a
// blur/Enter after typing is exactly that. Fails silently if the browser
// has no Web Audio support.
let _audioCtx = null;
function playErrorBeep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _audioCtx = _audioCtx || new Ctx();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 220; // low, "error"-sounding tone
    gain.gain.setValueAtTime(0.14, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.start();
    osc.stop(_audioCtx.currentTime + 0.3);
  } catch {
    /* no-op: audio is a nicety, never block input on it */
  }
}

// Text field always showing/accepting 24h "HH:mm" (never AM/PM, never
// seconds), with a clock-picker button (native input[type=time] triggered
// via showPicker()) for choosing without typing.
export default function TimeField({ value, onChange, className, placeholder }) {
  const nativeRef = useRef(null);
  const [text, setText] = useState(value || "");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => { setText(value || ""); setInvalid(false); }, [value]);

  function commit() {
    if (text.trim() === "") { setInvalid(false); if (value) onChange(""); return; }
    const n = normalizeTime(text);
    if (n) { setText(n); onChange(n); setInvalid(false); }
    else { setInvalid(true); playErrorBeep(); }
  }

  return (
    <div className={`timefield ${className || ""}`}>
      <input
        type="text"
        inputMode="numeric"
        lang="en"
        className={invalid ? "invalid" : ""}
        value={text}
        placeholder={placeholder || "24:00"}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          // Also push the raw (not-yet-normalized) text up on every
          // keystroke, not just on blur/Enter - live calculations that
          // depend on schDep/stop (e.g. Daily Duty's Actual Duty / Total
          // Duty figures) need to react as the pilot types, not only once
          // they tab away. Formatting/validation (normalizeTime, the
          // "invalid" red border) still only happens on commit() below, so
          // typing "1" or "12:0" mid-entry doesn't flash an error - it just
          // briefly feeds a partial value into the live calc until the
          // field is complete.
          onChange(v);
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.target.blur(); } }}
      />
      <button type="button" className="timefield-pick" title="Pick a time" onClick={() => nativeRef.current?.showPicker?.()}>🕐</button>
      <input
        ref={nativeRef}
        type="time"
        className="timefield-native"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
      />
    </div>
  );
}
