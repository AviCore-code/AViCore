import { describe, expect, it } from "vitest";
import { ADMIN_ALLOWED_EMAILS } from "./adminAllowlist.js";

const normalized = ADMIN_ALLOWED_EMAILS.map((email) => email.trim().toLowerCase());

describe("AviCore Admin allowlist", () => {
  it("authorizes Captain Weera and Thitiwaree only", () => {
    expect(normalized).toEqual([
      "weera@uoathai.com",
      "thitiwaree@uoathai.com",
    ]);
  });
});
