// PIN gate for the temporary Enterprise Web admin build (dist-admin, see
// src/web/AdminWebApp.jsx). This is a lightweight gate for a READ-ONLY
// monitoring tool, NOT strong security: the value ships inside the public
// web bundle, so anyone determined can read it. Real protection comes from
// the fact that this build can only READ data (via the Supabase anon key +
// RLS) - it cannot edit pilots, settings, or anything else. Change this PIN
// per deployment, and rebuild (build:admin) to apply it.
export const ADMIN_WEB_PIN = "1705";
