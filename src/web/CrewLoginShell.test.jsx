// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrewLoginShell from "./CrewLoginShell.jsx";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("Crew login appearance", () => {
  it("switches appearance without resetting entered data and remembers it on next visit", () => {
    const view = render(<CrewLoginShell><input aria-label="Pilot draft" defaultValue="" /></CrewLoginShell>);
    fireEvent.change(screen.getByLabelText("Pilot draft"), { target: { value: "DEMO" } });
    fireEvent.click(screen.getByRole("button", { name: "Night Flight" }));
    expect(screen.getByLabelText("Pilot draft").value).toBe("DEMO");
    expect(localStorage.getItem("avicore_crew_login_theme")).toBe("night");
    view.unmount();
    render(<CrewLoginShell />);
    expect(screen.getByRole("button", { name: "Night Flight" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("falls back safely for a stale stored theme", () => {
    localStorage.setItem("avicore_crew_login_theme", "removed-theme");
    render(<CrewLoginShell />);
    expect(screen.getByRole("button", { name: "Ocean Blue" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("still switches all themes when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<CrewLoginShell />);
    for (const name of ["Sunset Amber", "Night Flight", "Ocean Blue"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    }
  });
});
