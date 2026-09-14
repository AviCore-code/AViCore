import { getCodeInfo } from "./rosterCodes.js";
import { OFF_DAYS_PER_CYCLE } from "./weeklyPlanRules.js";

// Not every rest day on the roster means the same thing, and the difference
// decides whether the weekly plan may touch it.
//
//   MOVABLE  - an RR or R sitting inside a working stretch. It is there to
//              keep the pilot inside the 168-hour duty cycle. If the plan
//              satisfies that cycle another way, the day may be re-planned as
//              duty; the projection in weeklyPlanHeadroom.js is what has to
//              agree.
//
//   LOCKED   - the RR days immediately before the OFF block. Those give the
//              pilot their rest BEFORE going off, and are not negotiable:
//              they can't be shuffled to somewhere more convenient, because
//              their whole purpose is to sit right there.
//
//   LEAVE    - VL / SL. Never touchable by a schedule at all.
//
// Confirmed with Capt. Weera: "RR R เพื่อป้องกันเกิน 168 hrs cycle, weekly
// สามารถปรับได้ แต่ RR ที่ก่อนวัน OFF 2 วัน ขยับไม่ได้".

// A run of this many consecutive non-duty days is taken to be the cycle's
// OFF block rather than a mid-rotation rest. The cycle gives 7 off; allowing
// a little slack means a block that has been trimmed by a day is still
// recognised for what it is.
const OFF_BLOCK_MIN_DAYS = Math.max(3, OFF_DAYS_PER_CYCLE - 2);

const REST_CATEGORIES = new Set(["rest"]);
const LEAVE_CATEGORIES = new Set(["leave"]);

function isoAddDays(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function categoryOn(rosterByPilotDate, code, iso) {
  const raw = rosterByPilotDate?.get(`${code}|${iso}`);
  if (!raw) return null;
  return getCodeInfo(raw)?.category ?? null;
}

// "off" here means any non-working day - a plain day off (X) or a rest day.
function isNonWorking(category) {
  return category != null && category !== "duty" && category !== "night";
}

// Classifies one rest day. Walks FORWARD from the day: if the unbroken run of
// non-working days that starts here reaches OFF_BLOCK_MIN_DAYS, this rest day
// is part of (or immediately leading into) the OFF block and is locked.
export function classifyRestDay(rosterByPilotDate, pilotCode, iso, lookahead = 14) {
  const category = categoryOn(rosterByPilotDate, pilotCode, iso);
  if (category == null) return { type: "unknown" };
  if (LEAVE_CATEGORIES.has(category)) return { type: "leave", locked: true, category };
  if (!REST_CATEGORIES.has(category)) return { type: "working", locked: false, category };

  let run = 0;
  for (let i = 0; i < lookahead; i++) {
    const next = categoryOn(rosterByPilotDate, pilotCode, isoAddDays(iso, i));
    if (next == null) break;          // roster not imported that far - stop
    if (!isNonWorking(next)) break;   // back on duty: the run ends here
    run += 1;
  }

  if (run >= OFF_BLOCK_MIN_DAYS) {
    return {
      type: "rest",
      locked: true,
      category,
      runLength: run,
      reason: `rest immediately before the ${run}-day OFF block — fixed, it is the rest taken before going off`
    };
  }

  return {
    type: "rest",
    locked: false,
    category,
    runLength: run,
    reason: "mid-rotation rest, held to keep the pilot inside the 168h duty cycle — the weekly plan may move it, provided the cycle still works out"
  };
}
