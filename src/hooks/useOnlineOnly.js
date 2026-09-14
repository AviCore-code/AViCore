import { useEffect, useState } from "react";
import { subscribeOfflineState, isOnline } from "../services/offlineQueue.js";

// "This screen needs a connection to save."
//
// ---------------------------------------------------------------------------
// WHY ONLY SOME SCREENS
// ---------------------------------------------------------------------------
//
// Duty entries, roster imports and weekly plans already work offline: they go
// through queueableWrite(), which stores them on the device and sends them when
// the signal returns. A pilot on a rig can log the flight he just made. That is
// one person recording his own facts, so there is no version of them anyone
// else could be editing at the same time.
//
// Training records, Settings, FTL limits and Pilot Experience are deliberately
// NOT queued - see the long comment at the end of webDatabase.js. They are
// shared documents. Queuing them would mean a change landing hours later on top
// of decisions other people had already taken from the version they could see.
//
// So those screens are online-only by design. What was missing was telling the
// admin BEFORE they type. Until now the Save button looked normal, and the
// failure arrived only after a form had been filled in - the worst moment to
// discover it, and the work is gone.
//
// Usage:
//   const online = useOnlineOnly();
//   <button disabled={!online} onClick={save}>Save</button>
//   {!online && <OnlineOnlyNotice />}
//
// @returns {boolean} true when a save can be attempted
export default function useOnlineOnly() {
  const [online, setOnline] = useState(() => isOnline());

  useEffect(() => {
    // One subscription shared with OfflineBar, so the bar and every disabled
    // button always agree. A screen doing its own navigator.onLine check would
    // drift out of step with the bar the moment the two disagreed.
    setOnline(isOnline());
    return subscribeOfflineState((s) => setOnline(s.online !== false));
  }, []);

  return online;
}
