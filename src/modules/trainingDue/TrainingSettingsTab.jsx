import { useEffect, useMemo, useState } from "react";
import { saveSetting, saveTraining } from "../../services/desktopDatabase.js";
import {
  TRAINING_ITEMS,
  DEFAULT_TRAINING_THRESHOLDS,
  settingsVisibleTrainingItems,
  withTrainingDurationDefaults,
  describeTrainingDuration
} from "../../utils/trainingDue.js";
import { isoToDisplay } from "../../components/DateField.jsx";
import "./Training.css";
import "../settings/Settings.css";

// Training Setting - one merged place per item to (a) turn its Caution
// threshold, (b) turn its Monitor toggle (whether it can drag a pilot's
// overall badge/Dashboard recommendations - see monitoredTrainingItems in
// trainingDue.js) on/off, and (c) bulk-set its due date across many pilots
// at once without needing an Excel re-import. I.APP (180D) is excluded from
// the tab bar (settingsVisibleTrainingItems) since it's auto-rolled from
// Daily Duty - nothing here to set for it.
export default function TrainingSettingsTab({ thresholds, disabledItems, durations, pilots, onSaved }) {
  const items = useMemo(() => settingsVisibleTrainingItems(), []);
  const [activeKey, setActiveKey] = useState(items[0]?.key || "");
  const [values, setValues] = useState(thresholds);
  const [disabled, setDisabled] = useState(() => new Set(disabledItems || []));
  // How long each course/document takes. Kept as strings while editing so a
  // half-typed field doesn't get coerced to 0 and read as "takes no time".
  const [times, setTimes] = useState(() => withTrainingDurationDefaults(durations));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => setValues(thresholds), [thresholds]);
  useEffect(() => setDisabled(new Set(disabledItems || [])), [disabledItems]);
  useEffect(() => setTimes(withTrainingDurationDefaults(durations)), [durations]);

  useEffect(() => {
    if (!fullScreen) return;
    function onKey(e) {
      if (e.key === "Escape") setFullScreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const activeItem = items.find((i) => i.key === activeKey) || items[0];

  function update(key, val) {
    setValues((v) => ({ ...v, [key]: val === "" ? "" : Number(val) }));
  }

  function updateTime(key, field, val) {
    setTimes((cur) => ({ ...cur, [key]: { ...(cur[key] || {}), [field]: val } }));
  }

  function toggleMonitored(key, monitored) {
    setDisabled((cur) => {
      const next = new Set(cur);
      if (monitored) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const cleaned = {};
      for (const item of TRAINING_ITEMS) {
        const n = Number(values[item.key]);
        cleaned[item.key] = isNaN(n) ? DEFAULT_TRAINING_THRESHOLDS[item.key] : n;
      }
      // Blank stays blank: an unfilled duration must read as "nobody has
      // told us", not as zero.
      const cleanedTimes = {};
      for (const item of TRAINING_ITEMS) {
        const entry = times[item.key] || {};
        const days = Number(entry.days);
        const hours = Number(entry.hours);
        const out = {};
        if (Number.isFinite(days) && days > 0) out.days = days;
        if (Number.isFinite(hours) && hours > 0) out.hours = hours;
        if (Object.keys(out).length) cleanedTimes[item.key] = out;
      }
      await saveSetting("training_thresholds", cleaned);
      await saveSetting("training_disabled_items", Array.from(disabled));
      await saveSetting("training_durations", cleanedTimes);
      setMsg({ ok: true, text: "Saved." });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setValues(DEFAULT_TRAINING_THRESHOLDS);
    setDisabled(new Set());
    setTimes({});
  }

  return (
    <div className={fullScreen ? "page-fullscreen" : ""}>
      <div className="training-subtab-toolbar">
        <p className="training-subtitle">Pick an item below to edit its Caution window, turn its Monitor toggle on/off, and (for date items) bulk-set due dates across pilots — all in one place, synced to every device.</p>
        <button onClick={() => setFullScreen((v) => !v)}>{fullScreen ? "Exit Full Screen" : "Full Screen"}</button>
      </div>

      <div className="training-tabs">
        {items.map((item) => (
          <button
            key={item.key}
            className={`training-tab${activeKey === item.key ? " active" : ""}`}
            onClick={() => setActiveKey(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {activeItem && (
        <div className="settings-training-item-panel">
          <div className="settings-training-item-row">
            <label className="settings-training-monitor">
              <input
                type="checkbox"
                checked={!disabled.has(activeItem.key)}
                onChange={(e) => toggleMonitored(activeItem.key, e.target.checked)}
              />
              Monitor this item (counts toward overall status &amp; Dashboard recommendations)
            </label>
            <label className="settings-training-threshold">
              {activeItem.type === "count" ? "Minimum count" : "Caution window (days before due)"}
              <input
                type="number" step="1" min="0"
                value={values[activeItem.key] ?? ""}
                onChange={(e) => update(activeItem.key, e.target.value)}
              />
            </label>
          </div>

          <div className="settings-training-item-row">
            <label className="settings-training-threshold">
              How long it takes — days
              <input
                type="number" step="0.5" min="0" placeholder="e.g. 2"
                value={times[activeItem.key]?.days ?? ""}
                onChange={(e) => updateTime(activeItem.key, "days", e.target.value)}
              />
            </label>
            <label className="settings-training-threshold">
              Hours
              <input
                type="number" step="0.5" min="0" placeholder="e.g. 16"
                value={times[activeItem.key]?.hours ?? ""}
                onChange={(e) => updateTime(activeItem.key, "hours", e.target.value)}
              />
            </label>
            <p className="settings-training-hint">
              How much of the pilot&rsquo;s time this course or document costs, so the
              weekly plan knows how many days to keep free. Leave blank if it isn&rsquo;t
              known — blank shows as blank rather than as &ldquo;no time needed&rdquo;.
              {describeTrainingDuration(times, activeItem.key)
                ? ` Currently: ${describeTrainingDuration(times, activeItem.key)}.`
                : ""}
            </p>
          </div>

          {activeItem.type !== "count" && (
            <DueDateBulkEditor item={activeItem} pilots={pilots} onSaved={onSaved} />
          )}
        </div>
      )}

      <div className="settings-actions" style={{ marginTop: "16px" }}>
        <button className="primary" onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Thresholds, Monitor & Course Times"}</button>
        <button onClick={handleReset} disabled={saving}>Reset to Defaults</button>
      </div>
      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}

const DUE_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DURATION_PRESETS = ["1", "2", "3", "6", "12"];

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Bulk due-date tool for one item across many pilots at once - useful when
// a batch of pilots trained together on the same date, so the whole batch
// can be set in one go instead of opening each pilot separately in Input.
// "Month" is for when only the month is known (e.g. an old paper record) -
// picks the 1st of that month (current year) unless "End of month" is
// checked; "Actual + duration" is for when the exact completion date is
// known. Both add the same +duration (Years/Months/Days) on top to get the
// due date. "For life" bypasses both and just marks the item as lifetime.
function DueDateBulkEditor({ item, pilots, onSaved }) {
  const [lifetime, setLifetime] = useState(false);
  const [mode, setMode] = useState("actual");
  const [actualDate, setActualDate] = useState("");
  const [monthIndex, setMonthIndex] = useState("");
  const [endOfMonth, setEndOfMonth] = useState(false);
  const [durationPreset, setDurationPreset] = useState("");
  const [duration, setDuration] = useState("");
  const [durationUnit, setDurationUnit] = useState("years");
  const [selected, setSelected] = useState(() => new Set());
  const [allChecked, setAllChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const sorted = useMemo(
    () => pilots.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [pilots]
  );

  useEffect(() => {
    setLifetime(false);
    setActualDate("");
    setMonthIndex("");
    setEndOfMonth(false);
    setDurationPreset("");
    setDuration("");
    setDurationUnit("years");
    setMsg(null);
  }, [item.key]);

  function pickDurationPreset(val) {
    setDurationPreset(val);
    if (val !== "") setDuration(val);
  }

  const dueIso = useMemo(() => {
    if (lifetime) return null;
    const dur = Number(duration) || 0;
    let base;
    if (mode === "actual") {
      if (!actualDate) return null;
      base = new Date(`${actualDate}T00:00:00Z`);
    } else {
      if (monthIndex === "") return null;
      const y = new Date().getFullYear();
      const day = endOfMonth ? daysInMonth(y, Number(monthIndex)) : 1;
      base = new Date(Date.UTC(y, Number(monthIndex), day));
    }
    if (isNaN(base.getTime())) return null;
    if (durationUnit === "years") base.setUTCFullYear(base.getUTCFullYear() + dur);
    else if (durationUnit === "months") base.setUTCMonth(base.getUTCMonth() + dur);
    else base.setUTCDate(base.getUTCDate() + dur);
    return base.toISOString().slice(0, 10);
  }, [lifetime, mode, actualDate, monthIndex, endOfMonth, duration, durationUnit]);

  function toggleAll(checked) {
    setAllChecked(checked);
    setSelected(checked ? new Set(sorted.map((p) => p.code)) : new Set());
  }
  function togglePilot(code, checked) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (checked) next.add(code); else next.delete(code);
      return next;
    });
    setAllChecked(false);
  }

  async function applyToSelected(value, label) {
    if (selected.size === 0) { setMsg({ ok: false, text: "Select at least one pilot first." }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const targets = sorted.filter((p) => selected.has(p.code));
      for (const p of targets) {
        const record = { ...(p.record || {}), [item.key]: value };
        await saveTraining(p.code, p.name, record);
      }
      setMsg({ ok: true, text: `${label} for ${targets.length} pilot${targets.length > 1 ? "s" : ""}.` });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: "Save failed: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  // Loads the first selected pilot's currently-saved value for this item
  // back into the form, so it can be reviewed/adjusted before Save.
  function handleEdit() {
    if (selected.size === 0) { setMsg({ ok: false, text: "Select a pilot first." }); return; }
    const code = sorted.find((p) => selected.has(p.code))?.code;
    const pilot = sorted.find((p) => p.code === code);
    const raw = pilot?.record?.[item.key];
    setMsg(null);
    if (typeof raw === "string" && /life/i.test(raw)) {
      setLifetime(true);
      return;
    }
    setLifetime(false);
    if (raw == null || raw === "") return;
    const d = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(d.getTime())) return;
    setMode("actual");
    setDurationPreset(""); setDuration(""); setDurationUnit("years");
    setActualDate(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`);
  }

  const dueText = lifetime ? "For life" : (dueIso ? isoToDisplay(dueIso) : "-");
  const saveValue = lifetime ? "For life" : dueIso;
  const canSave = lifetime || !!dueIso;

  return (
    <div className="settings-bulk-editor">
      <h3 className="mystatus-section">Bulk-set {item.label} due date</h3>
      <p className="training-subtitle">Useful when a batch of pilots trained together on the same date.</p>

      <div className="settings-bulk-pilots">
        <label className="settings-bulk-all"><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} /> ALL pilots</label>
        <div className="settings-bulk-pilotlist">
          {sorted.map((p) => (
            <label key={p.code}>
              <input type="checkbox" checked={selected.has(p.code)} onChange={(e) => togglePilot(p.code, e.target.checked)} />
              {p.code} — {p.name || "(no name)"}
            </label>
          ))}
        </div>
      </div>

      <label className="settings-bulk-lifetime">
        <input type="checkbox" checked={lifetime} onChange={(e) => setLifetime(e.target.checked)} />
        For life
      </label>

      <div className="settings-bulk-mode">
        <label><input type="radio" name={`mode-${item.key}`} disabled={lifetime} checked={mode === "month"} onChange={() => setMode("month")} /> Month</label>
        <label><input type="radio" name={`mode-${item.key}`} disabled={lifetime} checked={mode === "actual"} onChange={() => setMode("actual")} /> Actual + duration</label>
      </div>

      {mode === "month" ? (
        <div className="settings-bulk-inputs">
          <select disabled={lifetime} value={monthIndex} onChange={(e) => setMonthIndex(e.target.value)}>
            <option value="">-- Month --</option>
            {DUE_MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
          <label className="settings-bulk-checkbox"><input type="checkbox" disabled={lifetime} checked={endOfMonth} onChange={(e) => setEndOfMonth(e.target.checked)} /> End of month</label>
        </div>
      ) : (
        <div className="settings-bulk-inputs">
          <label>Actual date <input type="date" disabled={lifetime} value={actualDate} onChange={(e) => setActualDate(e.target.value)} /></label>
        </div>
      )}

      <div className="settings-bulk-inputs">
        <label>+ duration:
          <select disabled={lifetime} value={durationPreset} onChange={(e) => pickDurationPreset(e.target.value)}>
            <option value="">—</option>
            {DURATION_PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <input type="number" min="0" step="1" disabled={lifetime} placeholder="or type a number" value={duration} onChange={(e) => { setDuration(e.target.value); setDurationPreset(""); }} />
        <select disabled={lifetime} value={durationUnit} onChange={(e) => setDurationUnit(e.target.value)}>
          <option value="years">Years</option>
          <option value="months">Months</option>
          <option value="days">Days</option>
        </select>
      </div>

      <div className="settings-bulk-preview">Due date: {dueText}</div>

      <div className="settings-actions" style={{ marginTop: "10px" }}>
        <button className="primary" onClick={() => applyToSelected(saveValue, "Saved")} disabled={saving || !canSave}>Save</button>
        <button onClick={handleEdit} disabled={saving}>Edit</button>
        <button onClick={() => applyToSelected(null, "Cleared")} disabled={saving}>Clear</button>
      </div>
      {msg && <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>{msg.text}</div>}
    </div>
  );
}
