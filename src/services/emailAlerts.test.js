import { describe, expect, it } from "vitest";
import { normalizeAlertEmailConfig } from "./emailAlertConfig.js";

describe("normalizeAlertEmailConfig", () => {
  it("stores only enabled and normalized recipients", () => {
    expect(normalizeAlertEmailConfig({
      enabled: true,
      toAddress: " dispatch@uoathai.com, ,ops@uoathai.com ",
      smtpPass: "must-not-be-persisted",
      apiKey: "must-not-be-persisted"
    })).toEqual({
      enabled: true,
      toAddress: "dispatch@uoathai.com, ops@uoathai.com"
    });
  });

  it("rejects more than ten recipients instead of silently truncating", () => {
    const recipients = Array.from({ length: 11 }, (_, index) => `ops${index}@uoathai.com`).join(",");
    expect(() => normalizeAlertEmailConfig({ enabled: true, toAddress: recipients }))
      .toThrow("up to 10 recipients");
  });

  it("requires a recipient when notifications are enabled", () => {
    expect(() => normalizeAlertEmailConfig({ enabled: true, toAddress: "  " }))
      .toThrow("at least one recipient");
  });

  it("allows notifications to be disabled with no recipients", () => {
    expect(normalizeAlertEmailConfig({ enabled: false, toAddress: "" }))
      .toEqual({ enabled: false, toAddress: "" });
  });
});
