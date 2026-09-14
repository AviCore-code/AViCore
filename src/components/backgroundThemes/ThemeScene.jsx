// Renders one preset - shared by the live AppBackground (full-bleed, low
// opacity) and Settings' picker grid (small thumbnail, full opacity so it reads
// clearly at a glance).
//
// Two kinds of preset:
//
//   SVG scenes  drawn in code (presets.jsx), given as `Component`
//   photos      bundled JPEGs, given as `image`
//
// Both are framed to the same 1600x900 box and cropped the same way
// (SVG "slice" / CSS object-fit: cover), so switching between them does not
// change the composition of the page behind the content.
export default function ThemeScene({ Component, image, className }) {
  if (image) {
    return (
      <img
        className={className}
        src={image}
        alt=""
        // Matches preserveAspectRatio="xMidYMid slice" below, so a photo fills
        // the same area an SVG scene would instead of letterboxing.
        style={{ objectFit: "cover", objectPosition: "center" }}
        // Decorative: the background carries no information, and announcing
        // "offshore platform at sunset" on every screen would be noise to a
        // screen reader.
        aria-hidden="true"
        draggable="false"
      />
    );
  }

  // Guarded because a saved theme can name a preset id this build no longer
  // has - returning null leaves a plain background rather than crashing every
  // page behind it.
  if (!Component) return null;

  return (
    <svg className={className} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <Component />
    </svg>
  );
}
