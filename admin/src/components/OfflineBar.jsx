import { useEffect, useState } from "react";
import {
  subscribeOfflineState, flushQueue,
  pendingWrites, discardWrite
} from "../services/offlineQueue.js";
import { storageIsDurable } from "../services/offlineStore.js";
import "./OfflineBar.css";

// Tells the truth about the connection, and about work that has not reached
// the server yet.
//
// The important case is not "offline" - people understand a lost signal. It is
// the minutes AFTER coming back, when a pilot has typed duty entries that are
// still only in this browser. Closing the tab then loses them, and nothing on
// screen would have said so. Hence a count that is always visible while
// anything is pending, and a list showing exactly what.
//
// Bilingual, because the people who will actually see this bar are pilots on a
// rig, not the admin at a desk. Thai first: it is the working language of the
// crew, and this bar appears at exactly the moment someone needs to understand
// it immediately - not read it twice.

const TH = {
  offline: "ออฟไลน์ — ข้อมูลถูกบันทึกไว้ในเครื่องแล้ว จะส่งให้อัตโนมัติเมื่อเน็ตกลับมา",
  pending: (n) => `มี ${n} รายการรอส่ง`,
  notDurable: " เบราว์เซอร์นี้เก็บถาวรไม่ได้ อย่าเพิ่งปิดแท็บ",
  show: (n) => `ดูรายการ (${n})`,
  hide: "ซ่อน",
  sendNow: "ส่งเลย",
  sending: "กำลังส่ง…",
  empty: "ไม่มีรายการค้าง",
  discard: "ลบทิ้ง",
  close: "ปิดข้อความนี้",
  attempts: (n) => `ส่งไม่สำเร็จ ${n} ครั้ง`,
  confirmDiscard: (label) =>
    `ลบรายการนี้ถาวรใช่ไหม\n\n${label}\n\nรายการนี้ยังไม่ถูกส่งขึ้นเซิร์ฟเวอร์ ลบแล้วกู้คืนไม่ได้`
};

const EN = {
  offline: "Offline — saved on this device, will be sent when the connection returns",
  pending: (n) => `${n} change${n === 1 ? "" : "s"} waiting to be sent`,
  notDurable: " This browser can't store them permanently — do not close the tab.",
  show: (n) => `Show (${n})`,
  hide: "Hide",
  sendNow: "Send now",
  sending: "Sending…",
  empty: "Nothing pending.",
  discard: "Discard",
  close: "Dismiss this notice",
  attempts: (n) => `${n} failed attempt${n === 1 ? "" : "s"}`,
  confirmDiscard: (label) =>
    `Discard this change permanently?\n\n${label}\n\nIt has not reached the server and cannot be recovered.`
};

export default function OfflineBar() {
  const [state, setState] = useState({ pending: 0, flushing: false, online: true, lastError: null });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [durable, setDurable] = useState(true);
  // Closed by the user for this view only - see the note beside `canDismiss`.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // The queue itself is started once by the app (WebApp/AdminWebApp), not
    // here: this component only renders after login, and the queue has to run
    // on the login screen too.
    const unsubscribe = subscribeOfflineState(setState);
    storageIsDurable().then(setDurable);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!open) return;
    pendingWrites().then(setItems);
  }, [open, state.pending]);

  // Coming back online clears a previous dismissal, so the NEXT time the signal
  // drops the bar shows again. Without this, one tap early in a flight would
  // silence it for the rest of the session - including a later drop the pilot has
  // not been told about.
  useEffect(() => {
    if (state.online) setDismissed(false);
  }, [state.online]);

  const offline = !state.online;
  const pending = state.pending;
  if (!offline && !pending) return null;   // nothing worth saying

  // DISMISSAL RULES.
  //
  // The bar can be closed, but not permanently and not for pending work.
  //
  // `dismissed` is component state, so it lasts for this view only and comes back
  // on the next page change or reload. That is deliberate: the reason this bar
  // exists is that unsent duty entries are otherwise invisible and get lost when
  // the tab closes (see the note at the top of this file). A close button that
  // silenced it for good would recreate exactly the problem it was built to
  // prevent.
  //
  // So: closeable when it is only reporting a lost signal - a pilot who knows
  // they are offline does not need telling for the next hour. Not closeable while
  // changes are still queued, where the count is the warning. The condition is
  // re-checked on every render, so if writes queue up after the bar was closed it
  // reappears on its own.
  const canDismiss = offline && pending === 0;
  if (dismissed && canDismiss) return null;

  function handleDiscard(op) {
    const label = op.label || op.kind;
    if (!confirm(`${TH.confirmDiscard(label)}\n\n— — —\n\n${EN.confirmDiscard(label)}`)) return;
    discardWrite(op.id).then(() => pendingWrites().then(setItems));
  }

  return (
    // One fixed wrapper pinned to the bottom, list first so it opens upward.
    <div className="offbar-wrap">
      {open && (
        <div className="offbar-list">
          {items.length === 0 && <div className="offbar-item">{TH.empty}</div>}
          {items.map((op) => (
            <div key={op.id} className="offbar-item">
              <div>
                <b>{op.label || op.kind}</b>
                <small>
                  {new Date(op.queuedAt).toLocaleString("th-TH")}
                  {op.owner ? ` · ${op.owner}` : ""}
                  {op.attempts ? ` · ${TH.attempts(op.attempts)}` : ""}
                </small>
                {op.lastError && <small className="offbar-err">{op.lastError}</small>}
              </div>
              <button onClick={() => handleDiscard(op)}>{TH.discard}</button>
            </div>
          ))}
        </div>
      )}

      <div className={`offbar${offline ? " off" : " pending"}`}>
        <span className="offbar-dot" />
        <span className="offbar-text">
          <b className="offbar-th">
            {offline ? TH.offline : TH.pending(pending)}
            {!durable && TH.notDurable}
          </b>
          <span className="offbar-en">
            {offline ? EN.offline : EN.pending(pending)}
            {!durable && EN.notDurable}
          </span>
        </span>
        {pending > 0 && (
          <button className="offbar-link" onClick={() => setOpen((v) => !v)}>
            {open ? TH.hide : TH.show(pending)}
          </button>
        )}
        {!offline && pending > 0 && (
          <button className="offbar-link" onClick={() => flushQueue()} disabled={state.flushing}>
            {state.flushing ? TH.sending : TH.sendNow}
          </button>
        )}
        {/* Only offered when there is nothing queued - see `canDismiss`. While
            writes are pending the count IS the warning, so there is no button to
            hide it. */}
        {canDismiss && (
          <button
            className="offbar-close"
            onClick={() => setDismissed(true)}
            title={`${TH.close} / ${EN.close}`}
            aria-label={EN.close}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
