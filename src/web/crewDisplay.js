// Per-browser display preferences for the AviCore Crew web app (Settings tab).
// Applied globally with `zoom` (text size) and a CSS `filter` (brightness /
// contrast) on the page body, so they work on EVERY page regardless of
// whether that page's CSS uses the theme variables or hard-coded colours -
// which is why this is a screen adjustment, not a full light theme (the app
// is designed dark; a real light theme would need every page restyled).

const TEXT_KEY = "avicore_crew_textsize";
const SCREEN_KEY = "avicore_crew_screen";

export const TEXT_SIZES = { small: 0.9, normal: 1, large: 1.15, xlarge: 1.3 };
export const SCREEN_MODES = ["normal", "bright", "dim", "contrast"];

export function getCrewDisplay() {
  let text = "normal";
  let screen = "normal";
  try {
    text = localStorage.getItem(TEXT_KEY) || "normal";
    screen = localStorage.getItem(SCREEN_KEY) || "normal";
  } catch { /* private mode */ }
  if (!(text in TEXT_SIZES)) text = "normal";
  if (!SCREEN_MODES.includes(screen)) screen = "normal";
  return { text, screen };
}

export function setCrewDisplay(patch) {
  try {
    if (patch.text) localStorage.setItem(TEXT_KEY, patch.text);
    if (patch.screen) localStorage.setItem(SCREEN_KEY, patch.screen);
  } catch { /* ignore */ }
  applyCrewDisplay();
}

// Reads the saved prefs and applies them to the document. Call once on app
// mount (so they persist across a session) and again whenever they change.
export function applyCrewDisplay() {
  if (typeof document === "undefined") return;
  const { text, screen } = getCrewDisplay();
  const root = document.documentElement;
  root.style.setProperty("--crew-zoom", String(TEXT_SIZES[text] || 1));
  root.setAttribute("data-crew-screen", screen);
}
