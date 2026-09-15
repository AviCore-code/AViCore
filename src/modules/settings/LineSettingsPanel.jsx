import { useEffect, useState } from "react";
import { getSetting, saveSetting, sendLineTestMessage } from "../../services/desktopDatabase.js";
import "./Settings.css";

export default function LineSettingsPanel() {
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [replyEnabled, setReplyEnabled] = useState(true);
  const [groupConversationEnabled, setGroupConversationEnabled] = useState(true);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(true);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [alertStatus, setAlertStatus] = useState(null);
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getSetting("alert_line_config"),
      getSetting("line_bot_config"),
      getSetting("line_alert_status")
    ])
      .then(([alertConfig, botConfig, status]) => {
        if (!active) return;
        setAlertsEnabled(alertConfig?.enabled === true);
        setReplyEnabled(botConfig?.replyEnabled !== false);
        setGroupConversationEnabled(botConfig?.groupConversationEnabled !== false);
        setKnowledgeEnabled(botConfig?.knowledgeEnabled !== false);
        setAlertStatus(status);
        setReady(true);
      })
      .catch(() => {
        if (active) setMessage("โหลดการตั้งค่า LINE ไม่สำเร็จ กรุณาเปิดหน้านี้ใหม่");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, []);

  async function saveAlerts() {
    setBusy(true);
    setMessage("");
    try {
      const result = await saveSetting("alert_line_config", { enabled: alertsEnabled });
      if (result?.ok === false) throw new Error(result.error || "Save failed");
      setMessage("บันทึกแล้ว — ต้องเชื่อมบอต LINE และตั้งงานบนเซิร์ฟเวอร์ก่อนส่งได้");
    } catch {
      setMessage("บันทึกไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  async function saveBotControl() {
    setBusy(true);
    setMessage("");
    try {
      const result = await saveSetting("line_bot_config", {
        replyEnabled,
        groupConversationEnabled,
        knowledgeEnabled
      });
      if (result?.ok === false) throw new Error(result.error || "Save failed");
      setMessage("บันทึกการควบคุม AviCore Bot แล้ว");
    } catch (error) {
      setMessage(error.message || "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function testLineMessage() {
    setTesting(true);
    setMessage("");
    try {
      const result = await sendLineTestMessage();
      if (result?.ok === false) throw new Error(result.error || "ส่งทดสอบ LINE ไม่สำเร็จ");
      const groupRecipients = Number(result?.groupRecipients || 0);
      const privateRecipients = Number(result?.privateRecipients || 0);
      const retryNote = "กรุณาตรวจ LINE (การกดซ้ำภายในนาทีเดียวอาจรวมเป็นข้อความเดียว)";
      if (groupRecipients > 0 && privateRecipients > 0) {
        setMessage(`LINE รับข้อความทดสอบแล้ว: กลุ่ม ${groupRecipients} แห่ง + แชตส่วนตัว ${privateRecipients} รายการ ${retryNote}`);
      } else if (groupRecipients > 0) {
        setMessage(`LINE รับข้อความทดสอบแล้ว: กลุ่ม ${groupRecipients} แห่ง ${retryNote} แต่ยังไม่พบ LINE User ID ส่วนตัว กรุณาเปิดแชตกับ AviCore Bot และกด Add/ส่งข้อความ 1 ครั้ง แล้วกดทดสอบใหม่`);
      } else if (privateRecipients > 0) {
        setMessage(`LINE รับข้อความทดสอบแล้ว: แชตส่วนตัว ${privateRecipients} รายการ ${retryNote}`);
      } else {
        setMessage("ส่งทดสอบ LINE ไม่สำเร็จ: ไม่มีปลายทางที่รับข้อความ");
      }
    } catch (error) {
      setMessage(error.message || "ส่งทดสอบไม่สำเร็จ");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-card">
      <div className="module-header settings-subheader">
        <div>
          <h2>LINE Due Date Alerts</h2>
          <p>แจ้งเตือน Due Date เข้ากลุ่มนักบินทุกวันเวลา 05:00 น. ตามเวลาไทย หลังติดตั้งงานบนเซิร์ฟเวอร์ ใช้เกณฑ์ Training เดียวกับ Dashboard รวมรายการใกล้ครบกำหนดและหมดอายุ วันละหนึ่งสรุปเมื่อมีรายการ</p>
        </div>
      </div>

      <label className="settings-toggle">
        <input type="checkbox" checked={alertsEnabled} disabled={busy || !ready} onChange={(event) => setAlertsEnabled(event.target.checked)} />
        <span>เปิดแจ้งเตือนเข้ากลุ่ม LINE นักบิน</span>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={replyEnabled} disabled={busy || !ready} onChange={(event) => setReplyEnabled(event.target.checked)} />
        <span>เปิดให้ AviCore Bot โต้ตอบข้อความ</span>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={groupConversationEnabled} disabled={busy || !ready} onChange={(event) => setGroupConversationEnabled(event.target.checked)} />
        <span>เปิดการสนทนาใน LINE กลุ่ม</span>
      </label>
      <label className="settings-toggle">
        <input type="checkbox" checked={knowledgeEnabled} disabled={busy || !ready} onChange={(event) => setKnowledgeEnabled(event.target.checked)} />
        <span>เปิดให้ AviCore Bot ค้นหาและให้ข้อมูลจาก IQSMS</span>
      </label>

      <p className="settings-note">เชื่อม LINE Official Account และกำหนดกลุ่มปลายทางบนเซิร์ฟเวอร์ โดยผู้ดูแลระบบ</p>
      <p className="settings-note">
        ผลการตรวจล่าสุด: {alertStatus?.checkedAt ? new Date(alertStatus.checkedAt).toLocaleString("th-TH") : "ยังไม่มีข้อมูล"}
        {alertStatus?.state && ` · ${alertStatus.state}`}
      </p>

      <div className="settings-actions">
        <button type="button" className="primary" disabled={busy || !ready} onClick={saveAlerts}>
          {busy ? "กำลังดำเนินการ..." : "บันทึกการแจ้งเตือน LINE"}
        </button>
        <button type="button" onClick={testLineMessage} disabled={busy || testing}>
          {testing ? "กำลังส่ง..." : "ทดสอบส่ง LINE"}
        </button>
        <button type="button" onClick={saveBotControl} disabled={busy || !ready}>บันทึกการควบคุมบอต</button>
      </div>

      <p className="settings-note">ทดสอบส่งข้อความทั่วไปเข้ากลุ่มนักบินที่ตั้งไว้ โดยไม่เปลี่ยนตารางแจ้งเตือนประจำวัน</p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
