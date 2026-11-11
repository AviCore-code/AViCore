// Admin Setting -> Admin Users: list / create / update / delete the accounts
// that may sign in to the AviCore Admin web app.
//
// Creating an account and setting a password need the service-role key, which
// must never reach the browser - so the browser calls this function with the
// signed-in admin's JWT and the function does the privileged part.
//
// Who may call it: a member of the company whose company_members.admin_web is
// true (sql/admin-web-users.sql). Every change is limited to that company.
//
// Delete removes the AviCore membership only. The Supabase Auth user pool is
// shared with another app on this project, so the login itself is kept.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";
import { checkAccessChange, checkCreate, checkUpdate, normalizeEmail } from "./rules.js";

// x-avicore-company is sent on every request by the web client (webDatabase.js
// global header); leaving it out of the allow-list makes the browser's CORS
// preflight fail, which surfaces as "Failed to send a request to the Edge Function".
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-avicore-company", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function findAuthUserByEmail(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u: any) => normalizeEmail(u.email) === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function membersOf(companyId: string) {
  const { data, error } = await sb.from("company_members").select("user_id, role, admin_web, created_at").eq("company_id", companyId);
  if (error) throw error;
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!jwt) return json({ error: "กรุณาลงชื่อเข้าใช้ Admin" }, 401);
  try {
    const { data: auth, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !auth.user) return json({ error: "กรุณาลงชื่อเข้าใช้ Admin ใหม่" }, 401);
    const callerId = auth.user.id;

    const { data: caller, error: callerError } = await sb.from("company_members").select("company_id")
      .eq("user_id", callerId).eq("admin_web", true).limit(1).maybeSingle();
    if (callerError) throw callerError;
    if (!caller) return json({ error: "ต้องเป็น Admin จึงจะจัดการผู้ใช้ได้" }, 403);
    const companyId = caller.company_id;

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const members = await membersOf(companyId);

    if (action === "list") {
      const users = [];
      for (const m of members) {
        const { data } = await sb.auth.admin.getUserById(m.user_id);
        const u: any = data?.user;
        users.push({
          userId: m.user_id,
          email: u?.email || "",
          name: u?.user_metadata?.full_name || "",
          adminWeb: !!m.admin_web,
          role: m.role,
          lastSignInAt: u?.last_sign_in_at || null,
          createdAt: m.created_at,
          isYou: m.user_id === callerId,
        });
      }
      users.sort((a, b) => Number(b.adminWeb) - Number(a.adminWeb) || a.email.localeCompare(b.email));
      return json({ ok: true, users });
    }

    if (action === "create") {
      const input = body.user || {};
      const problem = checkCreate(input);
      if (problem) return json({ error: problem }, 400);
      const email = normalizeEmail(input.email);
      const name = String(input.name || "").trim();

      // The auth pool is shared with another app: an existing login is linked
      // rather than duplicated, and its password is set to the one entered.
      let user: any = await findAuthUserByEmail(email);
      const linkedExisting = !!user;
      if (user && members.some((m: any) => m.user_id === user.id)) return json({ error: "อีเมลนี้เป็นผู้ใช้อยู่แล้ว" }, 409);
      if (user) {
        const { error } = await sb.auth.admin.updateUserById(user.id, {
          password: String(input.password),
          ...(name ? { user_metadata: { ...(user.user_metadata || {}), full_name: name } } : {}),
        });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.admin.createUser({
          email, password: String(input.password), email_confirm: true,
          user_metadata: { full_name: name },
        });
        if (error) throw error;
        user = data.user;
      }
      const { error: insertError } = await sb.from("company_members").insert({
        user_id: user.id, company_id: companyId, role: "admin", admin_web: input.adminWeb !== false,
      });
      if (insertError) throw insertError;
      return json({ ok: true, userId: user.id, linkedExisting });
    }

    if (action === "update") {
      const input = body.user || {};
      const problem = checkUpdate(input);
      if (problem) return json({ error: problem }, 400);
      if (!members.some((m: any) => m.user_id === input.userId)) return json({ error: "ไม่พบผู้ใช้นี้ในบริษัท" }, 404);
      const accessProblem = checkAccessChange({ callerId, targetId: input.userId, members, nextAdminWeb: input.adminWeb, removing: false });
      if (accessProblem) return json({ error: accessProblem }, 400);

      const { data: current } = await sb.auth.admin.getUserById(input.userId);
      const attrs: Record<string, unknown> = {};
      if (input.email != null && normalizeEmail(input.email) !== normalizeEmail(current?.user?.email)) {
        attrs.email = normalizeEmail(input.email);
        attrs.email_confirm = true;
      }
      if (input.password) attrs.password = String(input.password);
      if (input.name != null) attrs.user_metadata = { ...(current?.user?.user_metadata || {}), full_name: String(input.name).trim() };
      if (Object.keys(attrs).length) {
        const { error } = await sb.auth.admin.updateUserById(input.userId, attrs);
        if (error) throw error;
      }
      if (typeof input.adminWeb === "boolean") {
        const { error } = await sb.from("company_members").update({ admin_web: input.adminWeb })
          .eq("company_id", companyId).eq("user_id", input.userId);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    if (action === "delete") {
      const targetId = body.userId;
      if (!members.some((m: any) => m.user_id === targetId)) return json({ error: "ไม่พบผู้ใช้นี้ในบริษัท" }, 404);
      const accessProblem = checkAccessChange({ callerId, targetId, members, removing: true });
      if (accessProblem) return json({ error: accessProblem }, 400);
      const { error } = await sb.from("company_members").delete().eq("company_id", companyId).eq("user_id", targetId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    console.error(error);
    // Database errors from supabase-js are plain objects, not Error instances;
    // String() on them gave the admin "[object Object]" instead of the reason.
    const e: any = error;
    const message = e?.message || e?.error_description || e?.msg || (typeof e === "string" ? e : JSON.stringify(e));
    return json({ error: [message, e?.details, e?.hint].filter(Boolean).join(" - ") }, 400);
  }
});
