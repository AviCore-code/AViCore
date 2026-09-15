import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const admin = read("AdminWebApp.css");
const sidebar = read("AppSidebar.css");
const web = read("WebApp.css");
const crewAccess = read("CrewAccess.css");
const loginMonitor = read("CrewLoginMonitor.css");

describe("responsive Admin visual system", () => {
  it("uses local readable type and an 8px spacing/token system", () => {
    expect(admin).toMatch(/\.admin-shell\s*\{[^}]*--admin-font-sans:\s*"IBM Plex Sans"[^;]*system-ui[^;]*;/s);
    expect(admin).toMatch(/\.admin-shell\s*\{[^}]*--admin-font-mono:[^;]*ui-monospace[^;]*;/s);
    expect(admin).toMatch(/\.admin-shell\s*\{[^}]*--admin-space-1:\s*8px;/s);
    expect(admin).toMatch(/\.admin-shell\s*\{[^}]*font-family:\s*var\(--admin-font-sans\);[^}]*font-size:\s*14px;/s);
    expect(admin).toMatch(/\.admin-shell[^,{]*(?:\.crewmon-time|\.crewacc-code)[^{]*\{[^}]*font-family:\s*var\(--admin-font-mono\)/s);
  });

  it("keeps the mobile navigation fixed, safe-area aware, and unobscured", () => {
    expect(sidebar).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.app-sidebar\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;[^}]*padding-bottom:\s*max\([^;]*env\(safe-area-inset-bottom\)/s);
    expect(sidebar).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.admin-shell \.app-sidebar\.pinned\s*\{[^}]*width:\s*100%\s*!important;/s);
    expect(web).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.web-body\s*\{[^}]*padding-bottom:\s*calc\([^;]*env\(safe-area-inset-bottom\)/s);
  });

  it("provides 44px coarse-pointer targets without tablet hover or pin reflow", () => {
    expect(sidebar).toMatch(/@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.app-sidebar-item\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s);
    expect(sidebar).toMatch(/@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.app-sidebar:hover,[\s\S]*?\.app-sidebar\.pinned\s*\{[^}]*width:\s*68px\s*!important;/s);
    expect(sidebar).toMatch(/@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)[\s\S]*?\.app-sidebar-pin\s*\{[^}]*display:\s*none;/s);
  });

  it("uses one non-conflicting tablet shell breakpoint", () => {
    expect(admin).toContain("@media (max-width: 1024px)");
    expect(admin).toContain("@media (max-width: 820px)");
    expect(admin).not.toContain("@media (max-width: 720px)");
  });

  it("keeps Admin body copy readable and all coarse controls reachable", () => {
    expect(admin).toMatch(/\.admin-shell \.module-header p,[\s\S]*?\{[^}]*font-size:\s*14px;/s);
    expect(admin).toContain(".admin-shell .crewacc-page .module-header");
    expect(admin).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.admin-shell button,[\s\S]*?\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/s);
  });

  it("turns Crew Access rows into labeled, touch-friendly mobile cards", () => {
    expect(crewAccess).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.crewacc-th\s*\{[^}]*display:\s*none;/s);
    expect(crewAccess).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.crewacc-tr\s*\{[^}]*grid-template-columns:\s*1fr;/s);
    expect(crewAccess).toMatch(/\.crewacc-tr:not\(\.crewacc-th\)\s*>\s*:nth-child\(1\)::before\s*\{\s*content:\s*"Pilot"/s);
    expect(crewAccess).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.crewacc-page\s+(?:button|input|select)[^{]*\{[^}]*min-height:\s*44px;/s);
  });

  it("turns Login Monitor rows into labeled mobile cards", () => {
    expect(loginMonitor).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.crewmon-th\s*\{[^}]*display:\s*none;/s);
    expect(loginMonitor).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.crewmon-tr\s*\{[^}]*grid-template-columns:\s*44px\s+1fr;/s);
    expect(loginMonitor).toMatch(/\.crewmon-tr:not\(\.crewmon-th\)\s*>\s*:nth-child\(2\)::before\s*\{\s*content:\s*"Date \/ Time"/s);
    expect(loginMonitor).toMatch(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.crewmon-page\s+(?:button|input)[^{]*\{[^}]*min-height:\s*44px;/s);
  });
});
