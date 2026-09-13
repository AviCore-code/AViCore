import { useEffect, useState } from "react";
import { getSetting } from "../services/desktopDatabase.js";
import { BACKGROUND_PRESETS } from "./backgroundThemes/presets.jsx";
import ThemeScene from "./backgroundThemes/ThemeScene.jsx";

const DEFAULT_THEME = { mode: "preset", presetId: "dusk-horizon", customImage: "" };

// Subtle offshore-aviation backdrop, configurable at Settings > Background
// Theme: one of several original SVG scenes (no external image assets,
// keeps the app fully offline - see backgroundThemes/), a custom uploaded
// photo, or none. Kept at low opacity so it never competes with foreground
// text/cards.
export default function AppBackground() {
  const [theme, setTheme] = useState(DEFAULT_THEME);

  useEffect(() => {
    load();
    window.addEventListener("background-updated", load);
    return () => window.removeEventListener("background-updated", load);
  }, []);

  async function load() {
    const saved = await getSetting("background_theme");
    setTheme(saved || DEFAULT_THEME);
  }

  if (theme.mode === "none") return null;

  if (theme.mode === "custom" && theme.customImage) {
    return (
      <div className="app-bg" aria-hidden="true">
        <img className="app-bg-custom" src={theme.customImage} alt="" />
      </div>
    );
  }

  const preset = BACKGROUND_PRESETS.find((p) => p.id === theme.presetId) || BACKGROUND_PRESETS[0];
  return (
    <div className="app-bg" aria-hidden="true">
      {/* `image` is set on the photo presets, `Component` on the SVG scenes -
          ThemeScene picks whichever it is given. The extra class only applies
          here, not to the Settings thumbnails, which stay bright so the picker
          shows what the photo actually looks like. */}
      <ThemeScene
        Component={preset.Component}
        image={preset.image}
        className={preset.image ? "app-bg-photo" : undefined}
      />
    </div>
  );
}
