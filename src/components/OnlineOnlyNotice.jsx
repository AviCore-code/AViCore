import "./OnlineOnlyNotice.css";

// Shown at the top of an admin screen whose Save is disabled because there is
// no connection. See useOnlineOnly.js for why these screens do not queue.
//
// Says three things, in this order, because that is the order the reader needs
// them:
//   1. you cannot save right now
//   2. you can still read and print what is on screen
//   3. it will come back by itself
//
// Point 2 matters most. The first fear on seeing a greyed-out Save is that the
// screen is broken or the data is gone. Neither is true - everything already
// loaded stays readable and printable.
//
// Thai first: same reasoning as OfflineBar. This appears exactly when someone
// needs to understand it immediately.
export default function OnlineOnlyNotice({ what }) {
  return (
    <div className="oonotice" role="status">
      <span className="oonotice-icon" aria-hidden="true">!</span>
      <span className="oonotice-text">
        <b>ออฟไลน์ — หน้านี้บันทึกไม่ได้ชั่วคราว</b>
        <span>
          {what ? `${what} ` : ""}ต้องมีอินเทอร์เน็ตจึงจะบันทึกได้
          {" · "}
          ข้อมูลที่แสดงอยู่ยังดูและพิมพ์ได้ตามปกติ
          {" · "}
          เมื่อเน็ตกลับมา ปุ่มบันทึกจะใช้ได้เอง
        </span>
        <span className="oonotice-en">
          Offline — this screen can't save right now. What's on screen stays
          readable and printable; saving re-enables itself when the connection
          returns.
        </span>
      </span>
    </div>
  );
}
