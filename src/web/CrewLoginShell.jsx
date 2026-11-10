import { useState } from "react";
import ocean from "./crew-backgrounds/ocean.webp";
import sunset from "./crew-backgrounds/sunset.webp";
import night from "./crew-backgrounds/night.webp";
import "./CrewLoginShell.css";

const STORAGE_KEY = "avicore_crew_login_theme";
const THEMES = [
  { id: "ocean", name: "Ocean Blue", image: ocean },
  { id: "sunset", name: "Sunset Amber", image: sunset },
  { id: "night", name: "Night Flight", image: night }
];
function savedTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.some((theme) => theme.id === saved) ? saved : "ocean";
  } catch { return "ocean"; }
}
// Personal appearance only: never changes the selected pilot or auth state.
export default function CrewLoginShell({ children }) {
  const [themeId, setThemeId] = useState(savedTheme);
  const theme = THEMES.find((item) => item.id === themeId);
  function chooseTheme(id) {
    setThemeId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Session-only if storage is blocked. */ }
  }
  return (
    <div className={`web-login crew-login crew-login--${themeId}`} style={{ "--login-bg": `url("${theme.image}")` }}>
      <section className="crew-login-scene" aria-label="AviCore Crew">
        <h2>Your next flight starts here.</h2>
        <p>Duty · Roster · Training</p>
      </section>
      <div className="crew-login-panel">
        <fieldset className="crew-theme-picker">
          <legend>เลือกธีม / Theme</legend>
          <div className="crew-theme-options">
            {THEMES.map((item) => (
              <button key={item.id} type="button" aria-pressed={themeId === item.id} onClick={() => chooseTheme(item.id)}>
                <span className={`crew-theme-swatch crew-theme-swatch--${item.id}`} aria-hidden="true" />
                {item.name}
              </button>
            ))}
          </div>
        </fieldset>
        {children}
      </div>
    </div>
  );
}
