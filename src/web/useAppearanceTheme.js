import { useEffect, useState } from "react";

const CHANGE_EVENT = "avicore-appearance-change";
const THEMES = ["ocean", "sunset", "night"];
const keyFor = (app) => `avicore_${app}_login_theme`;
const normalize = (value) => THEMES.includes(value) ? value : "ocean";
function readTheme(app) {
  try { return normalize(localStorage.getItem(keyFor(app))); }
  catch { return "ocean"; }
}

// Login and the already-mounted app shell share the same appearance state.
// The event also keeps them synchronized when browser storage is unavailable.
export default function useAppearanceTheme(app) {
  const [theme, setTheme] = useState(() => readTheme(app));
  useEffect(() => {
    function changed(event) {
      if (event.detail?.app === app) setTheme(normalize(event.detail.theme));
    }
    function stored(event) {
      if (event.key === keyFor(app) || event.key === null) setTheme(readTheme(app));
    }
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener("storage", stored);
    return () => {
      window.removeEventListener(CHANGE_EVENT, changed);
      window.removeEventListener("storage", stored);
    };
  }, [app]);
  function chooseTheme(value) {
    const next = normalize(value);
    setTheme(next);
    try { localStorage.setItem(keyFor(app), next); } catch { /* Current page still updates. */ }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { app, theme: next } }));
  }
  return [theme, chooseTheme];
}
