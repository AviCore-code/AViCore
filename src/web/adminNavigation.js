export const ADMIN_SECTIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "dashboard",
    screens: [{ key: "dashboard", label: "Fleet Summary", icon: "dashboard" }],
  },
  {
    key: "operations",
    label: "Operations",
    icon: "operations",
    screens: [
      { key: "pilotRoster", label: "Pilot Roster", icon: "roster" },
      { key: "logbook", label: "Logbook", icon: "logbook" },
      { key: "experience", label: "Pilot Experience Summary", icon: "experience" },
    ],
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: "compliance",
    screens: [
      { key: "crews", label: "FDT & Daily Duty", icon: "status" },
      { key: "fatigue", label: "Fatigue", icon: "dutyhistory" },
      { key: "training", label: "Training", icon: "training" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: "reports",
    screens: [{ key: "statistics", label: "Statistics & Reports", icon: "reports" }],
  },
  {
    key: "administration",
    label: "Administration",
    icon: "administration",
    screens: [
      { key: "settings", label: "Settings", icon: "settings" },
      { key: "access", label: "Crew Access", icon: "access" },
      { key: "utility", label: "Login Monitor", icon: "utility" },
      { key: "autoImport", label: "Auto Import", icon: "import" },
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
