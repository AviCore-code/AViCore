import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

async function loadNavigationIcons() {
  try {
    return await import("./NavigationIcon.jsx");
  } catch {
    return null;
  }
}

describe("stable navigation icons and touch targets", () => {
  it("renders navigation icons as accessible inline SVG instead of platform glyphs", async () => {
    const NavigationIcon = (await loadNavigationIcons())?.default;
    expect(NavigationIcon).toBeTypeOf("function");

    const markup = renderToStaticMarkup(<NavigationIcon name="dashboard" />);
    expect(markup).toContain("<svg");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('class="navigation-icon"');
    expect(markup).not.toMatch(/[📊🗓️✈️😴📈🎓📖🪪⚙️🔑🛠️📥🏠📝⏱️🚁]/u);
  });

  it("defines every referenced icon name and keeps an explicit unknown-name fallback", async () => {
    const iconModule = await loadNavigationIcons();
    const referenced = ["AdminWebApp.jsx", "WebApp.jsx", "adminNavigation.js"]
      .flatMap((name) => [...read(name).matchAll(/icon:\s*"([^"]+)"/g)].map((match) => match[1]));

    expect(iconModule?.NAVIGATION_ICON_NAMES).toEqual(expect.arrayContaining([...new Set(referenced)]));
    expect(renderToStaticMarkup(<iconModule.default name="unknown-navigation-icon" />))
      .toContain('<circle cx="12" cy="12" r="8"></circle>');
  });

  it("routes Admin and Crew navigation through named icon assets", () => {
    const sidebar = read("AppSidebar.jsx");
    const adminNavigation = read("adminNavigation.js");
    const crew = read("WebApp.jsx");

    expect(sidebar).toContain('import NavigationIcon from "./NavigationIcon.jsx"');
    expect(sidebar).toMatch(/<NavigationIcon\s+name=\{item\.icon\}/);
    expect(sidebar).toMatch(/<NavigationIcon\s+name=\{pinned\s*\?\s*"pin-filled"\s*:\s*"pin"\}/);
    expect(adminNavigation).not.toMatch(/[📊🗓️✈️😴📈🎓📖🪪⚙️🔑🛠️📥]/u);
    expect(crew).toMatch(/<NavigationIcon\s+name=\{t\.icon\}/);
    expect(crew).not.toMatch(/[🏠📝⏱️📈🎓🗓️🚁📖📊⚙️]/u);
  });

  it("keeps every coarse-pointer navigation and header action at least 44px", () => {
    const sidebarCss = read("AppSidebar.css");
    const webCss = read("WebApp.css");
    const adminCss = read("AdminWebApp.css");

    expect(webCss).toMatch(/\.navigation-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(sidebarCss).toMatch(/\.admin-shell\s+\.app-sidebar-item,[\s\S]*?min-height:\s*44px;/s);
    expect(webCss).toMatch(/\.web-tabbar\s+button\s*\{[^}]*min-height:\s*44px;/s);
    expect(adminCss).toMatch(/\.admin-subtabs\s+button\s*\{[^}]*min-height:\s*44px;/s);
    expect(webCss).toMatch(/@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.web-header-refresh,[\s\S]*?\.web-header-logout\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  });
});
