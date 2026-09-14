import "./IdleWarning.css";

// "You will be signed out in N seconds."
//
// Shown for the last minute of the idle period. It exists so the sign-out is
// never a surprise: a pilot reading a long roster without touching the mouse
// gets a visible chance to stay, and one who has walked away loses nothing
// because their work is sent before the sign-out completes.
//
// Any click, key or mouse move cancels it - including on this panel - so the
// button is really just something obvious to aim at.
export default function IdleWarning({ secondsLeft, minutes }) {
  if (secondsLeft == null) return null;

  return (
    <div className="idlewarn" role="alertdialog" aria-live="assertive">
      <div className="idlewarn-box">
        <div className="idlewarn-count">{secondsLeft}</div>
        <div className="idlewarn-text">
          <b>กำลังจะออกจากระบบอัตโนมัติ</b>
          <span>
            ไม่มีการใช้งานนาน {minutes || 30} นาที · ข้อมูลที่กรอกไว้จะถูกบันทึกก่อนออกจากระบบ
          </span>
          <span className="idlewarn-en">
            Signing out due to inactivity. Your entries are saved first.
          </span>
        </div>
        <button className="idlewarn-stay" type="button" onClick={() => {}}>
          ใช้งานต่อ / Stay
        </button>
      </div>
    </div>
  );
}
