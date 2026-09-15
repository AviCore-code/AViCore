import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./staffTraining.css", import.meta.url), "utf8");

describe("All Staff Training visual contrast", () => {
  it("keeps Delete text dark when the admin theme overrides generic buttons", () => {
    const rule = css.match(/\.staff-delete\s*\{([^}]*)\}/)?.[1] || "";

    expect(rule).toMatch(/color:\s*#b91c1c\s*!important/i);
    expect(rule).toMatch(/background:\s*#fff1f2\s*!important/i);
  });
});
