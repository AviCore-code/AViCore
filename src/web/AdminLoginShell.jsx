import { useState } from "react";
import ocean from "./admin-backgrounds/ocean.webp";
import sunset from "./admin-backgrounds/sunset.webp";
import night from "./admin-backgrounds/night.webp";
import "./AdminLoginShell.css";

const STORAGE_KEY = "avicore_admin_login_theme";
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
// Personal appearance only: never changes the entered credentials or auth state.
export default function AdminLoginShell({ children }) {
  const [themeId, setThemeId] = useState(savedTheme);
  const theme = THEMES.find((item) => item.id === themeId);
  function chooseTheme(id) {
    setThemeId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Session-only if storage is blocked. */ }
  }
  return (
    <div className={`web-login admin-theme-login admin-theme-login--${themeId}`} style={{ "--login-bg": `url("${theme.image}")` }}>
      <section className="admin-theme-login-scene" aria-label="AviCore Admin">
        <h2>Operations, organized.</h2>
        <p>Fleet · Roster · Duty · Training</p>
      </section>
      <div className="admin-theme-login-panel">
        <fieldset className="admin-theme-picker">
          <legend>เลือกธีม / Theme</legend>
          <div className="admin-theme-options">
            {THEMES.map((item) => (
              <button key={item.id} type="button" aria-pressed={themeId === item.id} onClick={() => chooseTheme(item.id)}>
                <span className={`admin-theme-swatch admin-theme-swatch--${item.id}`} aria-hidden="true" />
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
