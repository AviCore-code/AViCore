// Pilot codes that log into AviCore Crew as a DEMO (view-only) account.
// A demo user can browse the app, pick ANY pilot from the dropdown to view,
// and type into forms to see live calculations - but Save, Delete, Print and
// Export are all blocked (nothing is persisted or produced).
//
// To enable one: add a pilot with the code below in the admin (Flight Crews),
// then set its Crew password in Crew Access, so it appears on the Crew login
// screen. Anyone who logs in with that code lands in demo mode automatically.
export const DEMO_PILOT_CODES = ["DEMO"];

// A DEMO account is a login, not a real crew member, so it must never be
// counted or listed as one - it would inflate "Captain/Co-pilot on duty"
// headcounts and show up as a pilot in roster/summary tables.
const DEMO_SET = new Set(DEMO_PILOT_CODES.map((c) => String(c).toUpperCase()));

export function isDemoPilotCode(code) {
  return DEMO_SET.has(String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
}
