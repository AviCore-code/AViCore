// Single on/off switch for the Admin PIN lock feature (protects the Admin
// menu group - Dashboard, All Status, Tools, Pilot Roster, Logbook, Reports,
// Settings/FTL Limits - from anyone who just has the app open).
//
// Temporarily set to false at Capt. Weera's request. All the PIN gate code
// (AdminGate.jsx, the gating logic in App.jsx, the Admin Access card in
// Settings.jsx, and the admin:* IPC handlers in electron/main.cjs) is still
// in place and untouched - flipping this back to true re-enables enforcement
// immediately, with no other code changes needed.
export const ADMIN_LOCK_ENABLED = false;
