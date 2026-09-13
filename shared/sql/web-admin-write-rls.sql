-- ============================================================================
-- Enterprise Web admin - authenticated write access (RLS)
-- ----------------------------------------------------------------------------
-- Run this ONCE in Supabase Dashboard -> SQL Editor to let the Enterprise Web
-- admin build (dist-admin, signed in with a real Supabase Auth user) EDIT
-- data. The Crew web build / Android app stay anonymous (anon) and are
-- unaffected: they keep only the read (and pilot-duty write) access their
-- existing policies already grant. These new policies grant write access to
-- the "authenticated" role ONLY - i.e. someone who has signed in.
--
-- PREREQUISITES (do these first, in the Supabase Dashboard):
--   1. Authentication -> Providers -> Email: ENABLE it.
--      (Turn OFF "Confirm email" if you want to create admins without the
--       email-verification step, or leave it on and verify each admin.)
--   2. Authentication -> Users -> Add user: create your admin account(s)
--      with an email + password. Those are the credentials the admin web
--      login uses. Only people you create here can ever sign in and edit.
--   3. Run this script.
--
-- SECURITY NOTE: this grants write to ANY authenticated user. Since the only
-- way to become authenticated is an account you create by hand in step 2,
-- that is effectively an admin allowlist. If you later want finer control
-- (e.g. an is_admin flag), tighten the USING/WITH CHECK clauses below.
-- ============================================================================

-- app_settings: authenticated may insert/update (FTL limits, branding, fleet, ...)
drop policy if exists "auth write app_settings"  on public.app_settings;
create policy "auth write app_settings" on public.app_settings
  for all to authenticated using (true) with check (true);

-- pilot_experience: authenticated may add/edit/soft-delete pilots
drop policy if exists "auth write pilot_experience" on public.pilot_experience;
create policy "auth write pilot_experience" on public.pilot_experience
  for all to authenticated using (true) with check (true);

-- pilot_training: authenticated may add/edit/import training records
drop policy if exists "auth write pilot_training" on public.pilot_training;
create policy "auth write pilot_training" on public.pilot_training
  for all to authenticated using (true) with check (true);

-- pilot_duty_entries: authenticated may add/edit/soft-delete duty entries
drop policy if exists "auth write pilot_duty_entries" on public.pilot_duty_entries;
create policy "auth write pilot_duty_entries" on public.pilot_duty_entries
  for all to authenticated using (true) with check (true);

-- pilot_roster: authenticated may import/edit/soft-delete roster
drop policy if exists "auth write pilot_roster" on public.pilot_roster;
create policy "auth write pilot_roster" on public.pilot_roster
  for all to authenticated using (true) with check (true);

-- (RLS itself is already enabled on these tables by the existing setup
--  scripts - mobile-rls-setup.sql / pilot-roster-setup.sql / web-training-
--  readonly-rls.sql. If any table below reports RLS is disabled, run:
--    alter table public.<table> enable row level security;)
