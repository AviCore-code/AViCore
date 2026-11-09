// jarvis-waypoints — read-only AW139 Flight Planner waypoints for Jarvis.
//
// Jarvis (web voice page + LINE) uses this to answer distance / route / ETE /
// platform-weather questions with the same coordinates as the AW139 Flight
// Planner (table public.aw139_waypoints). The table stays locked to planner
// users; this function only exposes navigation fields, read-only, to callers
// that present the JARVIS_WAYPOINTS_KEY secret.
//
// Deploy with --no-verify-jwt: Jarvis authenticates with x-jarvis-key instead
// of a Supabase user session.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const KEY = Deno.env.get("JARVIS_WAYPOINTS_KEY") || "";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function sha(text: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Constant-time comparison of the presented key.
async function keyMatches(presented: string) {
  if (!KEY || !presented) return false;
  const [a, b] = await Promise.all([sha(KEY), sha(presented)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (!(await keyMatches(req.headers.get("x-jarvis-key") || ""))) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    const { data, error } = await sb
      .from("aw139_waypoints")
      .select("id,name,latitude,longitude,elevation_ft,site_type,ndb_code,ldp_ft,active_status")
      .order("id");
    if (error) throw error;
    const waypoints = (data || [])
      .filter((w) => w.latitude !== null && w.longitude !== null)
      .filter((w) => !w.active_status || !/inactive|disabled|closed/i.test(String(w.active_status)))
      .map((w) => ({
        code: String(w.id).toUpperCase(),
        name: w.name || String(w.id),
        lat: Number(w.latitude),
        lon: Number(w.longitude),
        elevationFt: w.elevation_ft ?? null,
        site: w.site_type || null,
        ndb: w.ndb_code || null,
        ldpFt: w.ldp_ft ?? null,
      }))
      .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon));
    return json({ source: "aw139_waypoints", count: waypoints.length, waypoints });
  } catch {
    console.error("jarvis-waypoints query failed");
    return json({ error: "waypoints_unavailable" }, 503);
  }
});
