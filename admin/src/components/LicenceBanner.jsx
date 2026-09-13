import { useEffect, useState } from "react";
import { licenceStatus, formatExpiry, WARN_WITHIN_DAYS } from "../services/webLicense.js";
import "./LicenceBanner.css";

// "Your licence expires in N days."
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
//
// The expiry is already enforced in the database: past the date, writes are
// refused by RLS. What was missing was any warning beforehand, and any
// explanation afterwards - on the expiry date a chief pilot's Save simply
// started failing with a row-level-security error, which tells them nothing
// about what happened or who to call.
//
// Two states, deliberately different in tone:
//
//   approaching   amber, dismissable. A month's notice to raise a purchase
//                 order. It must not nag: dismissing it hides it for the day.
//
//   expired       red, NOT dismissable. Writes are already failing at this
//                 point, so hiding the reason would leave someone chasing a
//                 bug that is really an invoice. It also says plainly that the
//                 records are still readable, because the first fear on seeing
//                 an expiry notice is that the data is gone.
export default function LicenceBanner() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    licenceStatus().then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Nothing to say: no licence information, no expiry set, or plenty of time
  // left. Rendering nothing is the common case and the right default - a banner
  // that is always present stops being read.
  if (!status?.known || status.perpetual) return null;
  if (!status.expired && !status.warning) return null;
  if (status.expired === false && dismissed) return null;

  if (status.expired) {
    return (
      <div className="licbanner expired" role="alert">
        <span className="licbanner-icon" aria-hidden="true">!</span>
        <span className="licbanner-text">
          <b>ใบอนุญาตหมดอายุแล้ว — AviCore licence expired {formatExpiry(status.expiresAt)}</b>
          <span>
            บันทึกข้อมูลใหม่ไม่ได้ แต่ข้อมูลเดิมยังอ่านและพิมพ์ได้ตามปกติ — ติดต่อผู้จำหน่ายเพื่อต่ออายุ
            {" · "}
            New entries cannot be saved. Your existing records are unaffected and can still be read and printed.
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="licbanner warning" role="status">
      <span className="licbanner-icon" aria-hidden="true">i</span>
      <span className="licbanner-text">
        <b>
          ใบอนุญาตเหลืออีก {status.daysLeft} วัน — licence expires in {status.daysLeft} day{status.daysLeft === 1 ? "" : "s"}
        </b>
        <span>{formatExpiry(status.expiresAt)} · ติดต่อผู้จำหน่ายเพื่อต่ออายุ</span>
      </span>
      <button
        className="licbanner-close" onClick={() => setDismissed(true)}
        title="ปิดข้อความนี้ / Dismiss" aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export { WARN_WITHIN_DAYS };
