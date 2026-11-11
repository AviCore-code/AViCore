// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/webDatabase.js", () => ({
  listAdminUsers: vi.fn(async () => [
    { userId: "1", email: "weera@uoathai.com", name: "Weera", adminWeb: true, isYou: true },
    { userId: "2", email: "thitiwaree@uoathai.com", name: "", adminWeb: true },
    { userId: "3", email: "fso1@uoathai.com", name: "", adminWeb: false },
  ]),
  createAdminUser: vi.fn(),
  updateAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
}));

import AdminUsersPanel from "./AdminUsersPanel.jsx";

afterEach(cleanup);

describe("AdminUsersPanel", () => {
  it("lists who is Active now and badges each row", async () => {
    render(<AdminUsersPanel />);
    expect(await screen.findByText(/Active now \(2\)/)).toBeTruthy();
    expect(screen.getByText(/weera@uoathai.com, thitiwaree@uoathai.com/)).toBeTruthy();
    expect(screen.getAllByText("Active")).toHaveLength(2);
    expect(screen.getAllByText("Off")).toHaveLength(1);
  });

  it("eye button shows and hides the password being typed", async () => {
    render(<AdminUsersPanel />);
    fireEvent.click(await screen.findByText("+ Add User"));
    const [password] = document.querySelectorAll(".admin-users-password input");
    fireEvent.change(password, { target: { value: "secret123" } });
    expect(password.type).toBe("password");
    fireEvent.click(screen.getAllByLabelText("Show password")[0]);
    expect(password.type).toBe("text");
    expect(password.value).toBe("secret123");
    fireEvent.click(screen.getAllByLabelText("Hide password")[0]);
    expect(password.type).toBe("password");
  });
});
