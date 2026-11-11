import { describe, expect, it } from "vitest";
import { checkAccessChange, checkCreate, checkUpdate } from "./rules.js";
import { adminUserFormProblem } from "../../../../src/modules/settings/AdminUsersPanel.jsx";

const members = [
  { user_id: "weera", admin_web: true },
  { user_id: "thiti", admin_web: true },
  { user_id: "fso1", admin_web: false },
];

describe("avicore-admin-users rules", () => {
  it("requires a valid email and a 5+ character password to create", () => {
    expect(checkCreate({ email: "bad", password: "12345678" })).toBeTruthy();
    expect(checkCreate({ email: "a@uoathai.com", password: "abcd" })).toBeTruthy();
    expect(checkCreate({ email: "a@uoathai.com", password: "longenough" })).toBeNull();
    expect(checkCreate({ email: "a@uoathai.com", password: "abcde" })).toBeNull();
  });

  it("lets an update keep the password when none is given", () => {
    expect(checkUpdate({ userId: "fso1", email: "fso1@uoathai.com" })).toBeNull();
    expect(checkUpdate({ userId: "fso1", password: "abcd" })).toBeTruthy();
  });

  it("blocks removing or switching off your own access", () => {
    expect(checkAccessChange({ callerId: "weera", targetId: "weera", members, removing: true })).toBeTruthy();
    expect(checkAccessChange({ callerId: "weera", targetId: "weera", members, nextAdminWeb: false })).toBeTruthy();
  });

  it("blocks removing the last admin, allows removing one of two", () => {
    expect(checkAccessChange({ callerId: "weera", targetId: "thiti", members, removing: true })).toBeNull();
    const onlyOne = [{ user_id: "weera", admin_web: true }, { user_id: "thiti", admin_web: true }];
    expect(checkAccessChange({ callerId: "x", targetId: "thiti", members: onlyOne.slice(1), removing: true })).toBeTruthy();
  });

  it("allows turning access on, or removing a member without access", () => {
    expect(checkAccessChange({ callerId: "weera", targetId: "fso1", members, nextAdminWeb: true })).toBeNull();
    expect(checkAccessChange({ callerId: "weera", targetId: "fso1", members, removing: true })).toBeNull();
  });
});

describe("Admin Users form", () => {
  const base = { userId: null, email: "a@uoathai.com", name: "", password: "longenough", confirm: "longenough", adminWeb: true };
  it("needs a password for a new user, not for an edit", () => {
    expect(adminUserFormProblem({ ...base, password: "", confirm: "" })).toBeTruthy();
    expect(adminUserFormProblem({ ...base, userId: "u1", password: "", confirm: "" })).toBeNull();
  });
  it("catches mismatched confirmation", () => {
    expect(adminUserFormProblem({ ...base, confirm: "different1" })).toMatch(/match/);
  });
});
