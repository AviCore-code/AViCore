import { useEffect, useState } from "react";
import { getSetting } from "../services/webDatabase.js";
import { BACKGROUND_PRESETS } from "../components/backgroundThemes/presets.jsx";
import defaultLoginBg from "../../public-web/avicore-crew-login-background.png";

// Show each app's current branded artwork immediately, then apply any
// administrator-selected custom image or photo preset. Read failures keep
// the bundled artwork so sign-in never depends on the settings request.
export default function useLoginBackground(fallback = defaultLoginBg) {
  const [image, setImage] = useState(fallback);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const saved = await getSetting("login_background");
        if (!alive) return;
        setImage(resolveLoginBackground(saved, fallback));
      } catch {
        // Offline, misconfigured, or the row does not exist yet - all mean
        // "use what we ship with".
        if (alive) setImage(fallback);
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallback]);

  return image;
}

// Pulled out of the hook so it can be unit-tested without React or a network.
export function resolveLoginBackground(saved, fallback = defaultLoginBg) {
  if (!saved) return fallback;

  if (saved.mode === "custom" && saved.customImage) return saved.customImage;

  if (saved.mode === "preset") {
    const preset = BACKGROUND_PRESETS.find((p) => p.id === saved.presetId);
    // `image` is only present on the photo presets - see the note above about
    // why an SVG scene cannot be used here.
    if (preset?.image) return preset.image;
  }

  return fallback;
}
