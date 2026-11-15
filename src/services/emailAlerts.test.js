import { describe, expect, it } from "vitest";
import { normalizeAlertEmailConfig, alertRecipients, ALERT_TIME_OPTIONS } from "./emailAlertConfig.js";

describe("normalizeAlertEmailConfig", () => {
  it("stores only enabled and normalized recipients (old comma list -> 05:00 each)", () => {
    expect(normalizeAlertEmailConfig({
      enabled: true,
      toAddress: " dispatch@uoathai.com, ,ops@uoathai.com ",
      smtpPass: "must-not-be-persisted",
      apiKey: "must-not-be-persisted"
    })).toEqual({
      enabled: true,
      recipients: [
        { email: "dispatch@uoathai.com", time: "05:00" },
        { email: "ops@uoathai.com", time: "05:00" }
      ],
      toAddress: "dispatch@uoathai.com, ops@uoathai.com"
    });
  });

  it("keeps each recipient's own time", () => {
    expect(normalizeAlertEmailConfig({
      enabled: true,
      recipients: [{ email: "a@uoathai.com", time: "05:00" }, { email: " b@uoathai.com ", time: "07:30" }, { email: "", time: "08:00" }]
    })).toEqual({
      enabled: true,
      recipients: [{ email: "a@uoathai.com", time: "05:00" }, { email: "b@uoathai.com", time: "07:30" }],
      toAddress: "a@uoathai.com, b@uoathai.com"
    });
  });

  it("rejects a bad address and a duplicate", () => {
    expect(() => normalizeAlertEmailConfig({ enabled: true, recipients: [{ email: "not-an-email", time: "05:00" }] })).toThrow("not a valid email");
    expect(() => normalizeAlertEmailConfig({ enabled: true, recipients: [{ email: "a@x.com", time: "05:00" }, { email: "A@x.com", time: "06:00" }] })).toThrow("listed twice");
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
      .toEqual({ enabled: false, recipients: [], toAddress: "" });
  });

  it("offers times in 15-minute steps and falls back to 05:00 for an unknown time", () => {
    expect(ALERT_TIME_OPTIONS).toHaveLength(96);
    expect(ALERT_TIME_OPTIONS[1]).toBe("00:15");
    expect(alertRecipients({ recipients: [{ email: "a@x.com", time: "07:07" }] })).toEqual([{ email: "a@x.com", time: "05:00" }]);
  });
});
