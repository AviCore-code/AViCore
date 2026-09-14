import { useEffect, useMemo, useRef, useState } from "react";
import { saveTraining } from "../../services/desktopDatabase.js";
import { TRAINING_ITEMS, formatDueDate } from "../../utils/trainingDue.js";
import "./Training.css";

const NEW_PILOT = "__new__";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isLifetime(v) {
  return typeof v === "string" && /life/i.test(v);
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

// Free-typed "6 Jul 2026" / "6 July 26" / "6/7/2026" / ISO "2026-07-06" ->
// ISO "YYYY-MM-DD". Returns null if unparseable (blocks Save on that field).
function parseTypedDate(text) {
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

// Stored due dates come back either as a Date (fresh from Excel import) or
// an ISO string (Date objects get JSON.stringify'd on save) - both parse
// fine here. Uses UTC getters since due dates are snapped to UTC midnight
// (see trainingImport.js's cleanExcelDate) - a local-time read could roll
// the displayed day back by one depending on the system timezone.
function toDisplayText(v) {
  if (v == null || v === "" || isLifetime(v)) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return "";
  return formatDueDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
}

// ISO "YYYY-MM-DD" (native <input type="date"> value) -> the same "D Mon
// YYYY" display text, for filling the typed field when picked from the
// calendar assist button.
function pickerValueToDisplay(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return formatDueDate(new Date(Date.UTC(y, m - 1, d)));
}

// Typed display text -> "YYYY-MM-DD" for seeding the native date picker's
// current value (so opening the picker starts on the already-typed date
// rather than always today). Returns "" if the text doesn't parse (picker
// then just opens on today, which is fine).
function toPickerValue(text) {
  return parseTypedDate(text) || "";
}

function blankValues() {
  const v = {};
  for (const item of TRAINING_ITEMS) v[item.key] = item.type === "count" ? "" : "";
  return v;
}

function valuesFromRecord(record) {
  const v = {};
  for (const item of TRAINING_ITEMS) {
    const raw = record?.[item.key];
    if (item.type === "count") v[item.key] = raw == null ? "" : String(raw);
    else v[item.key] = isLifetime(raw) ? "For life" : toDisplayText(raw);
  }
  return v;
}

// Single date/lifetime field: one text input (typed "D Mon YYYY" or "For
// life") plus a calendar-icon-only button that opens a hidden native
// input[type=date] via showPicker() for choosing without typing. Left
// blank on Save, an item that was already "For life" stays "For life" -
// there's no separate toggle for it anymore (removed per an earlier
// request), typing "for life" directly still sets it, and typing a real
// date always overrides.
function TrainingDateField({ value, onChange, invalid }) {
  const nativeRef = useRef(null);
  return (
    <div className="row training-datefield">
      <input
        type="text"
        className={invalid ? "invalid" : ""}
        placeholder="d mmm yyyy or 'For life'"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="date-pick-icon"
        title="Pick a date"
        onClick={() => nativeRef.current?.showPicker?.()}
      >
        📅
      </button>
      <input
        ref={nativeRef}
        type="date"
        className="training-datefield-native"
        value={toPickerValue(value)}
        onChange={(e) => onChange(pickerValueToDisplay(e.target.value))}
        tabIndex={-1}
      />
    </div>
  );
}

// Manual single-pilot entry/edit form - the only way to add a pilot's
// training record without an Excel import, or to correct one or two fields
// after import without re-uploading the whole workbook. Saving preserves
// any documents already attached to this pilot via the Import tab's
// document-attach section (record.docs is not shown/edited here).
export default function TrainingInput({ pilots, onSaved }) {
  const [selected, setSelected] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [values, setValues] = useState(blankValues());
  const [invalidKeys, setInvalidKeys] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const sorted = useMemo(
    () => pilots.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [pilots]
  );
  const editingPilot = sorted.find((p) => p.code === selected) || null;

  useEffect(() => {
    setMsg(null);
    setInvalidKeys(new Set());
    if (selected === NEW_PILOT) {
      setNewCode("");
      setNewName("");
      setValues(blankValues());
    } else if (editingPilot) {
      setValues(valuesFromRecord(editingPilot.record));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function updateField(key, val) {
    setValues((v) => ({ ...v, [key]: val }));
    setInvalidKeys((cur) => { if (!cur.has(key)) return cur; const next = new Set(cur); next.delete(key); return next; });
  }

  async function handleSave() {
    const code = selected === NEW_PILOT ? newCode.trim() : editingPilot?.code;
    const name = selected === NEW_PILOT ? newName.trim() : editingPilot?.name;
    if (!code) {
      setMsg({ ok: false, text: "Pilot code is required." });
      return;
    }

    const record = {};
    const badKeys = new Set();
    for (const item of TRAINING_ITEMS) {
      if (item.type === "count") {
        record[item.key] = values[item.key] === "" ? null : Number(values[item.key]);
        continue;
      }
      const text = (values[item.key] || "").trim();
      const wasLifetime = isLifetime(editingPilot?.record?.[item.key]);
      if (text === "") {
        record[item.key] = wasLifetime ? "For life" : null; // blank preserves an existing "For life", clears an existing date
      } else if (/life/i.test(text)) {
        record[item.key] = "For life";
      } else {
        const iso = parseTypedDate(text);
        if (!iso) { badKeys.add(item.key); continue; }
        record[item.key] = iso;
      }
    }

    if (badKeys.size > 0) {
      setInvalidKeys(badKeys);
      setMsg({ ok: false, text: `Couldn't read ${badKeys.size} date${badKeys.size > 1 ? "s" : ""} - use "D Mon YYYY" (e.g. 6 Jul 2026), or "For life".` });
      return;
    }

    // Keep any documents already attached to this pilot - this form doesn't
    // touch record.docs, so overwrite would silently detach every attached
    // certificate on the next save without this.
    if (editingPilot?.record?.docs) record.docs = editingPilot.record.docs;

    setSaving(true);
    setMsg(null);
    try {
      await saveTraining(code, name, record);
      setMsg({ ok: true, text: `Saved ${code}.` });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={fullScreen ? "page-fullscreen" : ""}>
      <div className="training-subtab-toolbar">
        <p className="training-subtitle">Add or correct one pilot's training record by hand — for pilots not in the Excel workbook, or to fix a single field without re-importing.</p>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <div className="training-pilot-picker">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">-- Select pilot to edit --</option>
          <option value={NEW_PILOT}>+ New pilot</option>
          {sorted.map((p) => (
            <option key={p.code} value={p.code}>{p.code} — {p.name || "(no name)"}</option>
          ))}
        </select>

        {selected === NEW_PILOT && (
          <>
            <input type="text" placeholder="Code (3 letters)" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} maxLength={6} />
            <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </>
        )}
      </div>

      {(selected === NEW_PILOT || editingPilot) && (
        <>
          <div className="training-form-grid">
            {TRAINING_ITEMS.map((item) => (
              <div className="training-form-field" key={item.key}>
                <label className="title">{item.label}</label>
                {item.type === "count" ? (
                  <div className="row">
                    <input type="number" min="0" placeholder="count (180d)" value={values[item.key] ?? ""} onChange={(e) => updateField(item.key, e.target.value)} />
                  </div>
                ) : (
                  <TrainingDateField
                    value={values[item.key] || ""}
                    onChange={(v) => updateField(item.key, v)}
                    invalid={invalidKeys.has(item.key)}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="settings-actions" style={{ marginTop: "16px" }}>
            <button className="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Pilot"}</button>
          </div>
          {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
        </>
      )}
    </div>
  );
}
