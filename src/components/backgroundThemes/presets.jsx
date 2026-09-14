import { SkySea, Glow, Moon, Stars, SeaTexture, Rain, Platform, Helicopter } from "./pieces.jsx";
// Imported so Vite fingerprints and bundles them; referenced by the two photo
// presets at the foot of BACKGROUND_PRESETS.
import offshoreDay from "./img/offshore-day.jpg";
import offshoreSunset from "./img/offshore-sunset.jpg";

// Offshore-aviation background scenes. Each is framed 1600x900; Settings renders
// them small as thumbnails, AppBackground renders the selected one full-bleed at
// low opacity.
//
// The first eleven are hand-drawn SVG (see AppBackground.jsx for why: no external
// image fetch, no licensing risk, works fully offline). The last two are bundled
// photos - see the note beside them; they are still local files, so the offline
// guarantee holds.

function DuskHorizon() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#020617" }, { offset: "55%", color: "#0f1f3d" }, { offset: "82%", color: "#1e2f4a" }, { offset: "100%", color: "#3a2a2e" }]}
        seaStops={[{ offset: "0%", color: "#0b2436" }, { offset: "100%", color: "#020617" }]} />
      <Glow cx={1220} cy={612} r={140} color="#f59e0b" />
      <Stars opacity={0.5} seed={1} />
      <SeaTexture />
      <Platform x={275} y={600} />
      <Helicopter x={940} y={300} rotate={-6} />
    </>
  );
}

function NightOps() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#010208" }, { offset: "70%", color: "#050b1a" }, { offset: "100%", color: "#0a1626" }]}
        seaStops={[{ offset: "0%", color: "#040c18" }, { offset: "100%", color: "#010208" }]} />
      <Moon cx={1300} cy={130} r={38} />
      <Stars opacity={0.8} seed={7} />
      <SeaTexture color="#334155" opacity={0.15} />
      <Platform x={280} y={610} color="#475569" flareColor="#f59e0b" opacity={0.55} />
      <Helicopter x={880} y={340} rotate={-4} color="#94a3b8" opacity={0.65} navLights />
    </>
  );
}

function DawnDeparture() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#1e1b4b" }, { offset: "45%", color: "#5b3a5c" }, { offset: "78%", color: "#c2694f" }, { offset: "100%", color: "#f2a65a" }]}
        seaStops={[{ offset: "0%", color: "#2a2140" }, { offset: "100%", color: "#100a1f" }]} />
      <Glow cx={800} cy={640} r={170} color="#fcd34d" opacity={0.85} />
      <SeaTexture color="#f2a65a" opacity={0.15} />
      <Platform x={780} y={615} flareColor="#fcd34d" />
      <Helicopter x={1050} y={260} rotate={-16} scale={1.05} color="#fde68a" opacity={0.6} />
    </>
  );
}

function ClearDayCruise() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#1d4ed8" }, { offset: "55%", color: "#3b82c4" }, { offset: "100%", color: "#8fc9dd" }]}
        seaStops={[{ offset: "0%", color: "#0e6ba8" }, { offset: "100%", color: "#083a5c" }]} />
      <SeaTexture color="#e0f2fe" opacity={0.22} />
      <Platform x={340} y={615} color="#e0f2fe" opacity={0.35} />
      <Helicopter x={950} y={280} rotate={-3} color="#f8fafc" opacity={0.55} />
    </>
  );
}

function StormApproach() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#0f172a" }, { offset: "60%", color: "#334155" }, { offset: "100%", color: "#475569" }]}
        seaStops={[{ offset: "0%", color: "#1e293b" }, { offset: "100%", color: "#0f172a" }]} />
      <Rain opacity={0.22} />
      <SeaTexture color="#94a3b8" opacity={0.2} />
      <Platform x={300} y={605} color="#cbd5e1" opacity={0.45} />
      <Helicopter x={920} y={320} rotate={-2} color="#e2e8f0" opacity={0.55} navLights />
    </>
  );
}

function MoonlitSea() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#020412" }, { offset: "60%", color: "#0a1730" }, { offset: "100%", color: "#132a4a" }]}
        seaStops={[{ offset: "0%", color: "#0a1730" }, { offset: "100%", color: "#020412" }]} />
      <Moon cx={1150} cy={220} r={70} />
      <Stars opacity={0.6} seed={13} />
      <SeaTexture color="#7dd3fc" opacity={0.16} />
      <Helicopter x={780} y={360} rotate={-8} scale={1.1} color="#bae6fd" opacity={0.55} />
    </>
  );
}

function GoldenHourFormation() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#3b2a1a" }, { offset: "50%", color: "#8a5a2f" }, { offset: "100%", color: "#f0a94e" }]}
        seaStops={[{ offset: "0%", color: "#3a2412" }, { offset: "100%", color: "#160d06" }]} />
      <Glow cx={1350} cy={600} r={160} color="#fde68a" opacity={0.85} />
      <SeaTexture color="#fbbf24" opacity={0.18} />
      <Platform x={260} y={610} flareColor="#fde68a" />
      <Helicopter x={760} y={310} rotate={-5} scale={0.85} color="#fde68a" opacity={0.6} />
      <Helicopter x={950} y={260} rotate={-5} scale={0.85} color="#fde68a" opacity={0.5} />
    </>
  );
}

function RigCluster() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#04101f" }, { offset: "60%", color: "#0d2540" }, { offset: "100%", color: "#1c3f5c" }]}
        seaStops={[{ offset: "0%", color: "#082033" }, { offset: "100%", color: "#020617" }]} />
      <Stars opacity={0.4} seed={21} />
      <SeaTexture color="#38bdf8" opacity={0.16} />
      <Platform x={220} y={618} color="#38bdf8" opacity={0.35} />
      <Platform x={480} y={628} color="#38bdf8" opacity={0.28} />
      <Platform x={1330} y={622} color="#38bdf8" opacity={0.3} />
      <Helicopter x={850} y={310} rotate={-4} color="#7dd3fc" opacity={0.55} navLights />
    </>
  );
}

function ArcticDawn() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#0b2942" }, { offset: "55%", color: "#4a7fa5" }, { offset: "100%", color: "#c9e6f0" }]}
        seaStops={[{ offset: "0%", color: "#1c4a63" }, { offset: "100%", color: "#08202f" }]} />
      <Glow cx={500} cy={640} r={130} color="#f8fafc" opacity={0.55} />
      <SeaTexture color="#e0f2fe" opacity={0.2} />
      <Platform x={1250} y={610} color="#e0f2fe" opacity={0.35} />
      <Helicopter x={780} y={290} rotate={-6} color="#f0f9ff" opacity={0.55} />
    </>
  );
}

function MinimalLineArt() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#0b1220" }, { offset: "100%", color: "#111c30" }]}
        seaStops={[{ offset: "0%", color: "#0a1524" }, { offset: "100%", color: "#060b14" }]} horizonY={640} />
      <line x1="0" y1="640" x2="1600" y2="640" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.3" />
      <Helicopter x={900} y={340} rotate={-4} scale={0.9} color="#7dd3fc" opacity={0.45} />
      <g stroke="#7dd3fc" strokeWidth="1.5" opacity="0.22" fill="none">
        <line x1="260" y1="640" x2="230" y2="710" />
        <line x1="320" y1="640" x2="350" y2="710" />
        <line x1="270" y1="670" x2="310" y2="670" />
      </g>
    </>
  );
}

function DeepBlueMinimal() {
  return (
    <>
      <SkySea skyStops={[{ offset: "0%", color: "#020617" }, { offset: "100%", color: "#0b1a33" }]}
        seaStops={[{ offset: "0%", color: "#081428" }, { offset: "100%", color: "#020617" }]} horizonY={660} />
      <Stars opacity={0.35} seed={33} />
      <SeaTexture color="#1e40af" opacity={0.12} baseY={690} />
      <Helicopter x={1000} y={260} rotate={-5} scale={0.8} color="#60a5fa" opacity={0.4} />
    </>
  );
}

export const BACKGROUND_PRESETS = [
  { id: "dusk-horizon", name: "Dusk Horizon", Component: DuskHorizon },
  { id: "night-ops", name: "Night Ops", Component: NightOps },
  { id: "dawn-departure", name: "Dawn Departure", Component: DawnDeparture },
  { id: "clear-day-cruise", name: "Clear Day Cruise", Component: ClearDayCruise },
  { id: "storm-approach", name: "Storm Approach", Component: StormApproach },
  { id: "moonlit-sea", name: "Moonlit Sea", Component: MoonlitSea },
  { id: "golden-hour-formation", name: "Golden Hour Formation", Component: GoldenHourFormation },
  { id: "rig-cluster", name: "Rig Cluster", Component: RigCluster },
  { id: "arctic-dawn", name: "Arctic Dawn", Component: ArcticDawn },
  { id: "minimal-line-art", name: "Minimal Line Art", Component: MinimalLineArt },
  { id: "deep-blue-minimal", name: "Deep Blue Minimal", Component: DeepBlueMinimal },

  // PHOTO presets, unlike the ten hand-drawn scenes above.
  //
  // The comment at the top of this file says the scenes are SVG to avoid any
  // licensing risk. These two are AI-generated (confirmed by Capt. Weera), so
  // there is no third-party image right to worry about - which is what made
  // shipping them acceptable.
  //
  // Carried as `image` rather than `Component`: ThemeScene renders an <img>, not
  // an SVG scene. Bundled at 1600x900 / ~200KB each, the same shape and roughly
  // the same weight the app's own custom-image upload produces, so a built-in
  // photo costs no more than one a user adds.
  { id: "offshore-day", name: "Offshore Day (photo)", image: offshoreDay, photo: true },
  { id: "offshore-sunset", name: "Offshore Sunset (photo)", image: offshoreSunset, photo: true }
];
