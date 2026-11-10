// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import useAppearanceTheme from "./useAppearanceTheme.js";
function Probe({ app, name }) {
  const [theme, choose] = useAppearanceTheme(app);
  return <div><output data-testid={name}>{theme}</output><button onClick={() => choose("sunset")}>{name}</button></div>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("updates an already mounted app shell when its login theme changes without changing the other app", () => {
  render(<><Probe app="admin" name="admin shell" /><Probe app="admin" name="admin login" /><Probe app="crew" name="crew shell" /></>);
  fireEvent.click(screen.getByRole("button", { name: "admin login" }));
  expect(screen.getByTestId("admin shell").textContent).toBe("sunset");
  expect(screen.getByTestId("crew shell").textContent).toBe("ocean");
});
it("updates the shell even when storage writes are blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
  render(<><Probe app="crew" name="shell" /><Probe app="crew" name="login" /></>);
  fireEvent.click(screen.getByRole("button", { name: "login" }));
  expect(screen.getByTestId("shell").textContent).toBe("sunset");
});
it("responds to another tab and safely resets invalid stored values", () => {
  localStorage.setItem("avicore_admin_login_theme", "night");
  render(<Probe app="admin" name="shell" />);
  expect(screen.getByTestId("shell").textContent).toBe("night");
  localStorage.setItem("avicore_admin_login_theme", "invalid");
  fireEvent(window, new StorageEvent("storage", { key: "avicore_admin_login_theme" }));
  expect(screen.getByTestId("shell").textContent).toBe("ocean");
});
