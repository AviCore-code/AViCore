export const ADMIN_SECTIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "📊",
    screens: [{ key: "dashboard", label: "Fleet Summary", icon: "📊" }],
  },
  {
    key: "operations",
    label: "Operations",
    icon: "🗓️",
    screens: [
      { key: "pilotRoster", label: "Pilot Roster", icon: "🗓️" },
      { key: "logbook", label: "Logbook", icon: "📖" },
    ],
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: "✓",
    screens: [
      { key: "crews", label: "FDT & Daily Duty", icon: "✈️" },
      { key: "fatigue", label: "Fatigue", icon: "😴" },
      { key: "training", label: "Training", icon: "🎓" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: "📈",
    screens: [{ key: "statistics", label: "Statistics & Reports", icon: "📈" }],
  },
  {
    key: "administration",
    label: "Administration",
    icon: "⚙️",
    screens: [
      { key: "settings", label: "Settings", icon: "⚙️" },
      { key: "access", label: "Crew Access", icon: "🔑" },
      { key: "utility", label: "Login Monitor", icon: "🛠️" },
    ],
  },
];

export const ADMIN_SCREEN_KEYS = ADMIN_SECTIONS.flatMap((section) =>
  section.screens.map((screen) => screen.key),
);

export function sectionForScreen(screenKey) {
  return ADMIN_SECTIONS.find((section) =>
    section.screens.some((screen) => screen.key === screenKey),
  ) || ADMIN_SECTIONS[0];
}

export function defaultScreenForSection(sectionKey) {
  return ADMIN_SECTIONS.find((section) => section.key === sectionKey)?.screens[0]?.key
    || ADMIN_SECTIONS[0].screens[0].key;
}
