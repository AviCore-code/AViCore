// "Prepare for offline" - fetch everything a pilot could need, in one press,
// while there is still a connection.
//
// Why a button rather than telling people to visit each page: the roster and
// weekly plan are cached PER DATE RANGE. Opening this week's schedule caches
// this week and nothing else, so a pilot who checked the app in the crew room
// still finds next week missing once they are offshore. Getting full coverage
// by hand would mean stepping through every week and month one at a time,
// which nobody does - and the gap only shows up when the signal has gone.
//
// It reuses the ordinary read functions (which cache as a side effect), so
// there is no second code path that could cache something different from what
// the pages actually read.

import {
  listExperience, listDutyEntriesByPilot, listTraining, getMyTraining,
  listRoster, listRosterPilots, listWeeklyPlan, loadExperience, getSetting
} from "./webDatabase.js";

// How far to look. Deliberately asymmetric: a tour is 21 days on, so the
// pilot needs the weeks AHEAD, and only enough history for the rolling FTL
// windows (28-day duty, 90-day recency) to be meaningful on screen.
const WEEKS_AHEAD = 8;
const WEEKS_BACK = 4;
const MONTHS_AHEAD = 3;
const MONTHS_BACK = 2;

const SETTINGS = [
  "ftl_limits",
  "training_thresholds",
  "training_disabled_items",
  "training_durations",
  "customer_branding",
  "fleet_config"
];

const WEEK_START_DOW = 2; // Tuesday, matching the company's sheet

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(iso, n) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
function weekStartFor(iso) {
  const d = parseIso(iso);
  d.setDate(d.getDate() - ((d.getDay() - WEEK_START_DOW + 7) % 7));
  return toIso(d);
}
function monthRange(year, month) {
  return { from: toIso(new Date(year, month, 1)), to: toIso(new Date(year, month + 1, 0)) };
}

/**
 * Fetches and caches everything the app can serve offline.
 *
 * @param pilotCode  the signed-in pilot
 * @param onProgress ({ done, total, label }) => void
 * @returns { ok, done, total, failed: [{ label, error }] }
 */
export async function prefetchForOffline(pilotCode, onProgress) {
  const code = String(pilotCode || "").toUpperCase();
  const today = toIso(new Date());
  const thisWeek = weekStartFor(today);
  const now = new Date();

  // Every job is described up front so progress can be reported honestly -
  // "3 of 27" rather than a spinner that gives no idea how long is left.
  const jobs = [];

  jobs.push({ label: "Pilot list", run: () => listExperience() });
  jobs.push({ label: "Roster pilots", run: () => listRosterPilots() });
  jobs.push({ label: "Training records", run: () => listTraining() });
  if (code) jobs.push({ label: "My duty records", run: () => listDutyEntriesByPilot(code) });
  // The pilot's OWN training record, cached under its own key.
  //
  // "Training records" above is listTraining() - the whole-fleet read the ADMIN
  // build uses. The Crew app's Training Monitor calls getMyTraining(code),
  // which is a different cache entry, so warming the fleet list left that page
  // blank offline. It is the page a pilot checks before accepting a duty (has a
  // licence or medical expired), so it has to survive without a signal.
  if (code) jobs.push({ label: "My training record", run: () => getMyTraining(code) });

  for (const key of SETTINGS) {
    jobs.push({ label: `Setting: ${key}`, run: () => getSetting(key) });
  }

  // Weekly plan, week by week - each week is its own cache entry.
  for (let i = -WEEKS_BACK; i <= WEEKS_AHEAD; i++) {
    const from = addDays(thisWeek, i * 7);
    const to = addDays(from, 6);
    jobs.push({
      label: `Weekly schedule ${from}`,
      run: () => listWeeklyPlan({ from, to })
    });
  }

  // Roster, month by month - same reason.
  for (let i = -MONTHS_BACK; i <= MONTHS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const { from, to } = monthRange(d.getFullYear(), d.getMonth());
    jobs.push({ label: `Roster ${from.slice(0, 7)}`, run: () => listRoster({ from, to }) });
  }

  const failed = [];
  let done = 0;

  for (const job of jobs) {
    onProgress?.({ done, total: jobs.length, label: job.label });
    try {
      await job.run();
    } catch (err) {
      // One missing piece must not abandon the rest - a pilot about to fly
      // out would rather have most of it than none of it.
      failed.push({ label: job.label, error: err.message });
    }
    done += 1;
  }

  // The pilot's own full experience record, once their licence is known.
  try {
    const pilots = await listExperience();
    const mine = (pilots || []).find((p) => String(p.code).toUpperCase() === code);
    if (mine?.licence) await loadExperience(mine.licence);
  } catch (err) {
    failed.push({ label: "My experience record", error: err.message });
  }

  onProgress?.({ done: jobs.length, total: jobs.length, label: "Done" });
  return { ok: failed.length === 0, done: jobs.length, total: jobs.length, failed };
}

// What the button should say it will cover, for the UI to show without
// duplicating the numbers.
export const PREFETCH_COVERAGE = {
  weeksAhead: WEEKS_AHEAD,
  weeksBack: WEEKS_BACK,
  monthsAhead: MONTHS_AHEAD,
  monthsBack: MONTHS_BACK
};
