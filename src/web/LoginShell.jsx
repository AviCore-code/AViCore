import useLoginBackground from "./useLoginBackground.js";

// The <div className="web-login"> root that every sign-in screen shares, with the
// admin-chosen background applied.
//
// A component rather than each screen calling the hook itself, because there are
// four of these roots across three files (Crew's pilot picker and its
// config-error screen, plus Enterprise Web's PIN gate and its config-error
// screen) and they must not drift apart - the background is meant to look the
// same wherever someone signs in.
//
// The image arrives as a CSS variable consumed by .web-login::before in
// WebApp.css, which keeps all the sizing rules (cover, focal point, the vignette
// over the top) in one place instead of splitting them between CSS and JS.
export default function LoginShell({ children, className = "", defaultBackground }) {
  const bg = useLoginBackground(defaultBackground);

  return (
    <div
      className={`web-login ${className}`.trim()}
      // Nothing until the setting resolves, so the CSS fallback shows the bundled
      // photo - the screen is never blank while waiting on the network.
      //
      // Escaped rather than interpolated raw: a base64 data URL (what an uploaded
      // photo becomes) contains no quotes, but a stray one would end the url()
      // early and silently kill the background, so this does not rely on that.
      style={bg ? { "--login-bg": `url("${String(bg).replace(/["\\]/g, "\\$&")}")` } : undefined}
    >
      {children}
    </div>
  );
}
