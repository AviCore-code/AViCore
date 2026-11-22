const ICONS = {
  brand: <><path d="M3 12h18"/><path d="m13 5 7 7-7 7"/><path d="M5 8l3 4-3 4"/></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  operations: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9 16 2 2 4-4"/></>,
  compliance: <><path d="M12 3 4.5 6v5c0 5 3.2 8.3 7.5 10 4.3-1.7 7.5-5 7.5-10V6L12 3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  administration: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></>,
  duty: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
  status: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  dutyhistory: <><path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/></>,
  training: <><path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/></>,
  roster: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M7 14h3M14 14h3M7 18h3"/></>,
  weekly: <><path d="M3 12h7l3-8 3 16 3-8h2"/><path d="M5 5 3 8l2 3"/></>,
  logbook: <><path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3V4Z"/><path d="M7 8h7M7 12h7"/></>,
  experience: <><circle cx="12" cy="8" r="4"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 21l3-2 3 2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l-2.8 2.8A1.7 1.7 0 0 0 15 19.4 1.7 1.7 0 0 0 14 21v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3L4.3 17a1.7 1.7 0 0 0 .3-2A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L7.1 4.3A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l2.8 2.8a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  access: <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 4h4v4M5 21h6"/></>,
  utility: <><path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L3 18l3 3 6.5-6.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-3-3 2.4-2.4Z"/></>,
  import: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></>,
  refresh: <><path d="M20 6v5h-5"/><path d="M19 11a8 8 0 1 0 1 5"/></>,
  signout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/></>,
  pin: <><path d="m9 4 6 6M8 9l7-6 6 6-6 7M12 13l-9 8"/></>,
  "pin-filled": <><path d="m9 4 6 6M8 9l7-6 6 6-6 7M12 13l-9 8"/><circle cx="12" cy="13" r="1.5" fill="currentColor" stroke="none"/></>,
};

export const NAVIGATION_ICON_NAMES = Object.freeze(Object.keys(ICONS));

const FALLBACK = <circle cx="12" cy="12" r="8"/>;

export default function NavigationIcon({ name, className = "" }) {
  return (
    <svg
      className={`navigation-icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] || FALLBACK}
    </svg>
  );
}
