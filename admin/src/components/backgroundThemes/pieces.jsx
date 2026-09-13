// Reusable SVG building blocks shared by every preset background scene in
// ./presets.jsx - keeps the 10 scenes visually consistent (same helicopter
// silhouette, same platform rig) while only varying colors/positions/
// weather per scene, rather than redrawing everything from scratch each
// time.
let uid = 0;
function nextId(prefix) { uid += 1; return `${prefix}${uid}`; }

export function SkySea({ skyStops, seaStops, horizonY = 620, seaEndY = 900 }) {
  const skyId = nextId("sky");
  const seaId = nextId("sea");
  return (
    <>
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          {skyStops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
        <linearGradient id={seaId} x1="0" y1="0" x2="0" y2="1">
          {seaStops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} />)}
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1600" height={horizonY} fill={`url(#${skyId})`} />
      <rect x="0" y={horizonY - 20} width="1600" height={seaEndY - horizonY + 20} fill={`url(#${seaId})`} />
    </>
  );
}

export function Glow({ cx, cy, r, color, opacity = 0.9 }) {
  const id = nextId("glow");
  return (
    <>
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={opacity} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </>
  );
}

export function Moon({ cx, cy, r, color = "#e2e8f0" }) {
  return (
    <>
      <Glow cx={cx} cy={cy} r={r * 3.2} color={color} opacity={0.35} />
      <circle cx={cx} cy={cy} r={r} fill={color} opacity="0.9" />
      <circle cx={cx - r * 0.28} cy={cy - r * 0.15} r={r * 0.85} fill="#0f1f3d" opacity="0.55" />
    </>
  );
}

export function Stars({ opacity = 0.5, seed = 1 }) {
  // Deterministic pseudo-random scatter so it's stable across renders.
  const pts = [];
  let s = seed * 9301 + 49297;
  for (let i = 0; i < 26; i++) {
    s = (s * 9301 + 49297) % 233280;
    const x = (s / 233280) * 1600;
    s = (s * 9301 + 49297) % 233280;
    const y = ((s / 233280) * 260);
    s = (s * 9301 + 49297) % 233280;
    const r = 0.9 + (s / 233280) * 1.1;
    pts.push([x, y, r]);
  }
  return (
    <g fill="#e2e8f0" opacity={opacity}>
      {pts.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}
    </g>
  );
}

export function SeaTexture({ color = "#1677ff", opacity = 0.18, baseY = 660 }) {
  const rows = [0, 60, 130];
  return (
    <g stroke={color} strokeWidth="2" opacity={opacity} fill="none">
      {rows.map((dy, i) => (
        <path key={i} d={`M0,${baseY + dy} Q80,${baseY + dy - 10} 160,${baseY + dy} T320,${baseY + dy} T480,${baseY + dy} T640,${baseY + dy} T800,${baseY + dy} T960,${baseY + dy} T1120,${baseY + dy} T1280,${baseY + dy} T1440,${baseY + dy} T1600,${baseY + dy}`} />
      ))}
    </g>
  );
}

export function Rain({ opacity = 0.25 }) {
  const drops = [];
  let s = 42;
  for (let i = 0; i < 40; i++) {
    s = (s * 9301 + 49297) % 233280;
    const x = (s / 233280) * 1600;
    s = (s * 9301 + 49297) % 233280;
    const y = (s / 233280) * 600;
    drops.push([x, y]);
  }
  return (
    <g stroke="#7dd3fc" strokeWidth="1.5" opacity={opacity} strokeLinecap="round">
      {drops.map(([x, y], i) => <line key={i} x1={x} y1={y} x2={x - 12} y2={y + 34} />)}
    </g>
  );
}

export function Platform({ x = 275, y = 600, color = "#7dd3fc", flareColor = "#f59e0b", opacity = 0.4 }) {
  return (
    <g stroke={color} strokeWidth="3" opacity={opacity} fill="none" strokeLinecap="round">
      <line x1={x - 15} y1={y} x2={x - 55} y2={y + 100} />
      <line x1={x + 55} y1={y} x2={x + 95} y2={y + 100} />
      <line x1={x - 5} y1={y + 40} x2={x + 85} y2={y + 40} />
      <line x1={x - 35} y1={y + 70} x2={x + 75} y2={y + 70} />
      <line x1={x - 25} y1={y} x2={x - 25} y2={y - 40} />
      <rect x={x - 75} y={y - 5} width="150" height="12" fill="#0f172a" opacity="0.6" stroke={color} strokeWidth="2" />
      <circle cx={x} cy={y - 25} r="16" fill="none" stroke={flareColor} strokeWidth="2" opacity="0.7" />
      <line x1={x} y1={y - 41} x2={x} y2={y - 9} stroke={flareColor} strokeWidth="1.5" opacity="0.6" />
      <line x1={x - 16} y1={y - 25} x2={x + 16} y2={y - 25} stroke={flareColor} strokeWidth="1.5" opacity="0.6" />
      <line x1={x + 55} y1={y - 40} x2={x + 70} y2={y - 100} />
      <circle cx={x + 72} cy={y - 108} r="6" fill={flareColor} opacity="0.55" />
    </g>
  );
}

// AW139-style silhouette. navLights adds red/green position lights for
// night scenes.
export function Helicopter({ x = 940, y = 300, scale = 1, rotate = -6, color = "#7dd3fc", opacity = 0.5, navLights = false }) {
  return (
    <g transform={`translate(${x},${y}) rotate(${rotate}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="0" cy="0" rx="150" ry="4" fill={color} opacity="0.35" />
      <ellipse cx="0" cy="0" rx="12" ry="10" fill={color} opacity="0.7" />
      <path d="M -18,4 C -60,10 -110,8 -150,2 C -110,-6 -60,-8 -18,-6 Z" fill={color} opacity="0.85" />
      <path d="M -140,2 L -170,-14" stroke={color} strokeWidth="4" opacity="0.85" strokeLinecap="round" />
      <ellipse cx="-172" cy="-16" rx="16" ry="3" fill={color} opacity="0.5" />
      <path d="M 6,6 C 20,20 24,34 20,40" stroke={color} strokeWidth="5" opacity="0.85" fill="none" strokeLinecap="round" />
      <path d="M -6,16 L 8,26 M -14,16 L 6,20" stroke={color} strokeWidth="3" opacity="0.7" strokeLinecap="round" />
      {navLights && (
        <>
          <circle cx="-14" cy="-5" r="3" fill="#ef4444" opacity="0.9" />
          <circle cx="-14" cy="7" r="3" fill="#4ade80" opacity="0.9" />
        </>
      )}
    </g>
  );
}
