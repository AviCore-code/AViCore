-- Fixes: "new row violates row-level security policy for table
-- pilot_duty_entries" when a pilot deletes (or edits) a duty entry on the web.
--
-- The wording is misleading. Deleting in AviCore is a SOFT delete - an UPDATE
-- that sets deleted_at - so the operation being refused is an UPDATE, and
-- "new row" means "the row as it would be after the update". The table has an
-- INSERT policy (so adding works) but the UPDATE policy is missing or was
-- never applied, so editing and deleting are both blocked while adding looks
-- fine. That is exactly the symptom: entries can be created and never removed.
--
-- Run once in Supabase -> SQL Editor. Safe to re-run.

-- 1. RLS on, and the three policies the pilot app needs.
alter table public.pilot_duty_entries enable row level security;

drop policy if exists "anon read pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon read pilot_duty_entries" on public.pilot_duty_entries
  for select to anon using (true);

drop policy if exists "anon insert pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon insert pilot_duty_entries" on public.pilot_duty_entries
  for insert to anon with check (true);

-- THE ONE THAT WAS MISSING. Covers both editing an entry and soft-deleting it.
drop policy if exists "anon update pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon update pilot_duty_entries" on public.pilot_duty_entries
  for update to anon using (true) with check (true);

-- The signed-in admin needs the same, through the authenticated role rather
-- than anon - the admin console edits duty entries too.
drop policy if exists "auth write pilot_duty_entries" on public.pilot_duty_entries;
create policy "auth write pilot_duty_entries" on public.pilot_duty_entries
  for all to authenticated using (true) with check (true);

-- 2. Check what is actually in place now. Expect one row per policy above,
--    and cmd = SELECT / INSERT / UPDATE / ALL.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'pilot_duty_entries'
order by cmd, policyname;

-- Note on what these policies do and don't do:
--
-- They allow ANY holder of the public anon key to read and write ANY pilot's
-- duty entries. That is the same level of access the Android app has had since
-- it shipped, and the app itself locks a session to one pilot - but it is
-- enforced in the app, not in the database. Real per-pilot isolation needs
-- Supabase Auth accounts per pilot, with policies matching auth.uid() to the
-- pilot code. Worth doing before this is opened up beyond company crew.
