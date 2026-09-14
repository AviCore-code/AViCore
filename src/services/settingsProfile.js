// Save the app's configuration to a file, and load it back.
//
// Capt. Weera: "save profile setting ต่าง ๆ และตั้งชื่อไฟล์ให้มีวันเวลาด้วย
// เพื่อเอามา load ได้ภายหลัง ไม่ต้องนั่งเซ็ทใหม่".
//
// WHAT THIS IS NOT
//
// This is not the server backup (serverBackup.js). That one carries the DATA -
// pilots, duty records, roster. This carries the SETUP: FTL limits, fleet
// configuration, training thresholds, fatigue criteria. The two are separated
// on purpose, because they are restored in different situations:
//
//   the server was lost          -> restore the data
//   a new install, or a setting  -> load a settings profile
//   was changed by mistake
//
// Mixing them would mean loading a saved configuration also rewrote every duty
// record, which nobody would expect from a button labelled "load settings".
//
// WHY A FILE AND NOT JUST "UNDO"
//
// These figures are regulatory: FTL limits and fatigue criteria are approved in
// OPS-CM-01 and feed a quarterly CAAT submission. A file dated at the moment it
// was taken is evidence of what the system was configured to do on that date -
// which is a different and more useful thing than being able to step backwards.

const FORMAT = "avicore-settings";
const FORMAT_VERSION = 1;

// Every configuration key, grouped so the load screen can say what it is about
// to change rather than listing raw key names.
//
// `regulatory` marks the ones that feed a CAAT submission. The load screen
// calls those out separately: overwriting a branding colour is a preference,
// overwriting an FTL limit changes what the app reports to the regulator.
export const PROFILE_GROUPS = [
  {
    key: "flightCrew",
    label: "Flight Crew",
    settings: [
      { key: "ftl_limits", label: "FTL limits", regulatory: true },
      { key: "fleet_config", label: "Fleet configuration" }
    ]
  },
  {
    key: "fatigue",
    label: "Fatigue",
    settings: [
      { key: "fatigue_criteria", label: "Fatigue criteria (OPS-CM-01 §7.17.3)", regulatory: true }
    ]
  },
  {
    key: "training",
    label: "Training",
    settings: [
      { key: "training_thresholds", label: "Training warning thresholds" },
      { key: "training_disabled_items", label: "Which courses are monitored" },
      { key: "training_durations", label: "Course durations" }
    ]
  },
  {
    key: "appearance",
    label: "Appearance",
    settings: [
      { key: "customer_branding", label: "Branding (name and logo)" },
      // Two separate settings on purpose - see AdminSettingsTab.jsx. The first is
      // the sign-in screen picture (web builds); the second is the in-app
      // backdrop, which only the PC build renders.
      { key: "login_background", label: "Sign-in screen background" },
      { key: "background_theme", label: "In-app background (PC)" }
    ]
  }
];

export const ALL_PROFILE_KEYS = PROFILE_GROUPS.flatMap((g) => g.settings.map((s) => s.key));

export function settingLabel(key) {
  for (const g of PROFILE_GROUPS) {
    const s = g.settings.find((x) => x.key === key);
    if (s) return s.label;
  }
  return key;
}

export function isRegulatory(key) {
  for (const g of PROFILE_GROUPS) {
    const s = g.settings.find((x) => x.key === key);
    if (s) return !!s.regulatory;
  }
  return false;
}

/**
 * Reads the current configuration into a profile object.
 *
 * A key that is not set is recorded as absent rather than as null, so loading
 * the profile later does not overwrite a configured value with an empty one -
 * "this was never set" and "this was set to nothing" are different, and only
 * the second should be written back.
 *
 * @param getSetting  the app's getSetting(key)
 * @param keys        which keys to include (defaults to all)
 */
export async function createProfile(getSetting, keys = ALL_PROFILE_KEYS, meta = {}) {
  const settings = {};
  const absent = [];

  for (const key of keys) {
    let value = null;
    try {
      value = await getSetting(key);
    } catch {
      // Treated as absent rather than failing the whole profile: one
      // unreadable setting should not stop the other nine being saved.
      absent.push(key);
      continue;
    }
    if (value === null || value === undefined) absent.push(key);
    else settings[key] = value;
  }

  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    note: String(meta.note || "").slice(0, 200),
    appVersion: meta.appVersion || "",
    keys: Object.keys(settings),
    absent,
    settings
  };
}

export function validateProfile(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== "object") {
    return { ok: false, errors: ["Not a readable settings file."], warnings, keys: [] };
  }
  if (data.format !== FORMAT) {
    // Named specifically, because the server backup file looks similar enough
    // that someone will try to load one here.
    errors.push(
      data.format === "avicore-backup"
        ? "This is a server DATA backup, not a settings profile. Restore it under Server Backup instead."
        : "This is not an AviCore settings profile."
    );
  }
  if (Number(data.formatVersion) > FORMAT_VERSION) {
    errors.push(`This profile was saved by a newer version of AviCore (format ${data.formatVersion}). Update before loading it.`);
  }

  const settings = data.settings && typeof data.settings === "object" ? data.settings : null;
  if (!settings) errors.push("The file contains no settings.");

  const keys = settings ? Object.keys(settings) : [];
  if (settings && keys.length === 0) errors.push("The file contains no settings to load.");

  // Keys the app does not recognise are reported, not silently written - a
  // profile from a much later build could otherwise put unknown values into
  // app_settings where nothing reads them.
  const unknown = keys.filter((k) => !ALL_PROFILE_KEYS.includes(k));
  if (unknown.length) warnings.push(`Ignoring setting(s) this version does not use: ${unknown.join(", ")}.`);

  const known = keys.filter((k) => ALL_PROFILE_KEYS.includes(k));
  const missing = ALL_PROFILE_KEYS.filter((k) => !known.includes(k));
  if (missing.length) {
    warnings.push(`Not in this profile (left unchanged): ${missing.map(settingLabel).join(", ")}.`);
  }

  const regulatory = known.filter(isRegulatory);
  if (regulatory.length) {
    warnings.push(
      `This will change figures reported to the CAAT: ${regulatory.map(settingLabel).join(", ")}.`
    );
  }

  return { ok: errors.length === 0, errors, warnings, keys: known, regulatory };
}

/**
 * Writes a validated profile back.
 *
 * Only the keys the profile actually carries are written. Anything it does not
 * mention is left exactly as it is, so loading a partial profile cannot blank a
 * setting it never knew about.
 */
export async function applyProfile(saveSetting, data, keys = null) {
  const check = validateProfile(data);
  if (!check.ok) return { ok: false, errors: check.errors, applied: [] };

  const wanted = keys ? check.keys.filter((k) => keys.includes(k)) : check.keys;
  const applied = [];
  const errors = [];

  for (const key of wanted) {
    try {
      await saveSetting(key, data.settings[key]);
      applied.push(key);
    } catch (err) {
      // Recorded per key and then carried on: a failure on one setting should
      // not leave the rest unapplied with no explanation.
      errors.push(`${settingLabel(key)}: ${err.message}`);
    }
  }

  return { ok: errors.length === 0, errors, applied, warnings: check.warnings };
}

// Filename with the date AND time, as asked for.
//
// The time matters as much as the date: settings are often adjusted several
// times while being tuned, and two files from the same afternoon called
// "..._2026-07-29" would collide and be indistinguishable. An optional label
// is appended so a file can say what it was for ("before-CAAT-audit").
export function profileFileName(at = new Date(), label = "") {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}` +
                `_${p(at.getHours())}${p(at.getMinutes())}`;
  const safe = String(label || "")
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return safe
    ? `AviCore_Settings_${stamp}_${safe}.json`
    : `AviCore_Settings_${stamp}.json`;
}
