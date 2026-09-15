import { useEffect, useState } from "react";
import { getSetting } from "../services/webDatabase.js";
import { BACKGROUND_PRESETS } from "../components/backgroundThemes/presets.jsx";
import defaultLoginBg from "./login-bg.jpg";

// The picture behind the sign-in card, chosen by the admin at
// Settings > Admin Setting > Sign-in Screen Background (key `login_background`).
// Shared by the Crew and Enterprise Web login screens so both look the same.
//
// Returns a CSS value ready for `background-image`, or null while loading.
//
// THREE THINGS SHAPE THIS:
//
// 1. It runs BEFORE anyone is signed in, so it can only use an anonymous read.
//    That works: `app_settings` is selected with the public anon key, the same
//    way the Crew login screen already fetches the pilot roster.
//
// 2. It must never delay or break the sign-in screen. A pilot on a rig with one
//    weak bar needs the card, not the scenery - so a failure, a slow network, or
//    a missing setting all fall back to the bundled photo rather than surfacing
//    an error or leaving the screen blank.
//
// 3. Only PHOTO presets are offered. The hand-drawn SVG scenes in presets.jsx are
//    React components, not URLs, and cannot go into a CSS background-image; if an
//    admin picks one, this falls back to the default photo rather than showing
//    nothing. The picker labels the photo ones "(photo)".
// `fallback` lets a caller swap the built-in default photo shown when the
// admin hasn't configured Settings > Sign-in Screen Background yet (or the
// read failed/is offline) - Admin passes its own dashboard-mockup image here
// (see AdminWebApp.jsx) so its default look differs from Crew's oil-rig
// photo, while an admin-configured custom/preset background still wins for
// both, since only the built-in fallback changes.
export default function useLoginBackground(fallback = defaultLoginBg) {
  const [image, setImage] = useState(null);

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
