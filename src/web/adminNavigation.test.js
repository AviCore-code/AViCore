import { describe, expect, it } from "vitest";
import {
  ADMIN_SECTIONS,
  ADMIN_SCREEN_KEYS,
  defaultScreenForSection,
  sectionForScreen,
} from "./adminNavigation.js";

describe("Admin two-level navigation", () => {
  it("exposes exactly five main sections", () => {
    expect(ADMIN_SECTIONS.map((section) => section.label)).toEqual([
      "Dashboard",
      "Operations",
      "Compliance",
      "Reports",
      "Administration",
    ]);
  });

  it("keeps every existing Admin screen reachable exactly once", () => {
    const screens = ADMIN_SECTIONS.flatMap((section) => section.screens.map((screen) => screen.key));
    expect(screens).toEqual(expect.arrayContaining([
      "dashboard",
      "pilotRoster",
      "crews",
      "fatigue",
      "statistics",
      "training",
      "logbook",
      "settings",
      "access",
      "utility",
    ]));
    expect(new Set(screens).size).toBe(10);
    expect(screens).toHaveLength(10);
    expect(ADMIN_SCREEN_KEYS).toEqual(screens);
  });

  it("maps remembered screens to their main section and defaults safely", () => {
    expect(sectionForScreen("pilotRoster")?.key).toBe("operations");
    expect(sectionForScreen("training")?.key).toBe("compliance");
    expect(sectionForScreen("statistics")?.key).toBe("reports");
    expect(sectionForScreen("utility")?.key).toBe("administration");
    expect(sectionForScreen("removed-screen")?.key).toBe("dashboard");
    expect(defaultScreenForSection("administration")).toBe("settings");
    expect(defaultScreenForSection("missing")).toBe("dashboard");
  });
});
