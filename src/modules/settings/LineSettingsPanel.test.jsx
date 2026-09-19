// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  getSetting: vi.fn(),
  saveSetting: vi.fn(),
  sendLineTestMessage: vi.fn()
}));

vi.mock("../../services/desktopDatabase.js", () => services);

import LineSettingsPanel from "./LineSettingsPanel.jsx";

describe("LineSettingsPanel", () => {
  beforeEach(() => {
    services.getSetting.mockReset();
    services.saveSetting.mockReset();
    services.sendLineTestMessage.mockReset();
  });
  afterEach(cleanup);

  it("loads all three LINE settings and restores the four exact controls", async () => {
    services.getSetting.mockImplementation(async (key) => ({
      alert_line_config: { enabled: true },
      line_bot_config: {
        replyEnabled: false,
        groupConversationEnabled: true,
        knowledgeEnabled: false
      },
      line_alert_status: { checkedAt: "2026-09-15T05:00:00.000Z", state: "ready" }
    })[key]);

    render(<LineSettingsPanel />);

    const alert = await screen.findByLabelText("เปิดแจ้งเตือนเข้ากลุ่ม LINE นักบิน");
    expect(alert.checked).toBe(true);
    expect(screen.getByLabelText("เปิดให้ AviCore Bot โต้ตอบข้อความ").checked).toBe(false);
    expect(screen.getByLabelText("เปิดการสนทนาใน LINE กลุ่ม").checked).toBe(true);
    expect(screen.getByLabelText("เปิดให้ AviCore Bot ค้นหาและให้ข้อมูลจาก IQSMS").checked).toBe(false);
    expect(screen.getByRole("button", { name: "บันทึกการแจ้งเตือน LINE" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "ทดสอบส่ง LINE" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "บันทึกการควบคุมบอต" }).disabled).toBe(false);
    await waitFor(() => expect(services.getSetting).toHaveBeenCalledTimes(3));
    expect(services.getSetting.mock.calls.map(([key]) => key)).toEqual([
      "alert_line_config",
      "line_bot_config",
      "line_alert_status"
    ]);
    expect(screen.getByText(/ready/)).toBeTruthy();
  });

  it("saves the alert toggle and all bot-control toggles under their original setting keys", async () => {
    services.getSetting.mockImplementation(async (key) => ({
      alert_line_config: { enabled: false },
      line_bot_config: {
        replyEnabled: true,
        groupConversationEnabled: true,
        knowledgeEnabled: true
      },
      line_alert_status: null
    })[key]);
    services.saveSetting.mockResolvedValue({ ok: true });
    render(<LineSettingsPanel />);

    const alert = await screen.findByLabelText("เปิดแจ้งเตือนเข้ากลุ่ม LINE นักบิน");
    fireEvent.click(alert);
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการแจ้งเตือน LINE" }));
    await waitFor(() => expect(services.saveSetting).toHaveBeenCalledWith(
      "alert_line_config",
      { enabled: true }
    ));

    fireEvent.click(screen.getByLabelText("เปิดให้ AviCore Bot โต้ตอบข้อความ"));
    fireEvent.click(screen.getByLabelText("เปิดการสนทนาใน LINE กลุ่ม"));
    fireEvent.click(screen.getByLabelText("เปิดให้ AviCore Bot ค้นหาและให้ข้อมูลจาก IQSMS"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกการควบคุมบอต" }));
    await waitFor(() => expect(services.saveSetting).toHaveBeenCalledWith(
      "line_bot_config",
      {
        replyEnabled: false,
        groupConversationEnabled: false,
        knowledgeEnabled: false
      }
    ));
  });

  it("reports both successful group and private recipient counts from the response payload", async () => {
    services.getSetting.mockResolvedValue(null);
    services.sendLineTestMessage.mockResolvedValue({ ok: true, groupRecipients: 2, privateRecipients: 3 });
    render(<LineSettingsPanel />);

    const button = await screen.findByRole("button", { name: "ทดสอบส่ง LINE" });
    fireEvent.click(button);

    await waitFor(() => expect(services.sendLineTestMessage).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("status")).textContent).toBe(
      "LINE รับข้อความทดสอบแล้ว: กลุ่ม 2 แห่ง + แชตส่วนตัว 3 รายการ กรุณาตรวจ LINE (การกดซ้ำภายในนาทีเดียวอาจรวมเป็นข้อความเดียว)"
    );
  });

  it("reports a private-only delivery without claiming a group send", async () => {
    services.getSetting.mockResolvedValue(null);
    services.sendLineTestMessage.mockResolvedValue({
      ok: true,
      groupRecipients: 0,
      privateRecipients: 3,
    });
    render(<LineSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "ทดสอบส่ง LINE" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe(
      "LINE รับข้อความทดสอบแล้ว: แชตส่วนตัว 3 รายการ กรุณาตรวจ LINE (การกดซ้ำภายในนาทีเดียวอาจรวมเป็นข้อความเดียว)"
    );
    expect(status.textContent).not.toContain("กลุ่ม");
  });

  it("shows a delivery error without claiming any destination succeeded", async () => {
    services.getSetting.mockResolvedValue(null);
    services.sendLineTestMessage.mockResolvedValue({
      ok: false,
      error: "LINE ไม่สามารถส่งข้อความทดสอบไปยังปลายทางใดได้",
      groupRecipients: 0,
      privateRecipients: 0,
    });
    render(<LineSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "ทดสอบส่ง LINE" }));

    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("LINE ไม่สามารถส่งข้อความทดสอบไปยังปลายทางใดได้");
    expect(status.textContent).not.toContain("รับข้อความทดสอบแล้ว");
  });

  it("reports a group-only delivery and explains how to register a private recipient", async () => {
    services.getSetting.mockResolvedValue(null);
    services.sendLineTestMessage.mockResolvedValue({ ok: true, groupRecipients: 1, privateRecipients: 0 });
    render(<LineSettingsPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "ทดสอบส่ง LINE" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "LINE รับข้อความทดสอบแล้ว: กลุ่ม 1 แห่ง กรุณาตรวจ LINE (การกดซ้ำภายในนาทีเดียวอาจรวมเป็นข้อความเดียว) แต่ยังไม่พบ LINE User ID ส่วนตัว กรุณาเปิดแชตกับ AviCore Bot และกด Add/ส่งข้อความ 1 ครั้ง แล้วกดทดสอบใหม่"
    );
  });
});
