import { useEffect, useRef, useState } from "react";
import "./DateField.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ISO "YYYY-MM-DD" -> display "d mmm yyyy", e.g. "6 Jul 2026".
export function isoToDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function fullYear(y) {
  y = Number(y);
  return y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y;
}
function toIso(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Parses "6 Jul 26", "6 July 2026", "6/7/26", "6-7-2026", or ISO "2026-07-06"
// back into ISO. Returns null if unparseable.
export function parseDisplayToIso(text) {
  const s = (text || "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return toIso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
  if (m) {
    const mi = MONTHS.findIndex((mo) => mo.toLowerCase() === m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return toIso(fullYear(m[3]), mi + 1, m[1]);
    return null;
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) return toIso(fullYear(m[3]), m[2], m[1]);
  return null;
}

// Text field showing "d mmm yyyy" with a calendar-picker button (native
// input[type=date] triggered via showPicker()) for choosing without typing.
export default function DateField({ value, onChange, className, placeholder }) {
  const nativeRef = useRef(null);
  const [text, setText] = useState(isoToDisplay(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => { setText(isoToDisplay(value)); setInvalid(false); }, [value]);

  function commit() {
    if (text.trim() === "") { setInvalid(false); if (value) onChange(""); return; }
    const parsed = parseDisplayToIso(text);
    if (parsed) { onChange(parsed); setInvalid(false); }
    else setInvalid(true);
  }

  return (
    <div className={`datefield ${className || ""}`}>
      <input
        type="text"
        className={invalid ? "invalid" : ""}
        value={text}
        placeholder={placeholder || "d mmm yyyy"}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); e.target.blur(); } }}
      />
      <button type="button" className="datefield-pick" title="Pick a date" onClick={() => nativeRef.current?.showPicker?.()}>📅</button>
      <input
        ref={nativeRef}
        type="date"
        className="datefield-native"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        tabIndex={-1}
      />
    </div>
  );
}
