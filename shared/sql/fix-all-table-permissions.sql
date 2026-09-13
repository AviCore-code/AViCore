-- ONE file that sets every table's permissions, and then shows you what is
-- actually in place.
--
-- Why this exists: the policies were spread across six SQL files written at
-- different times (mobile-rls-setup, web-admin-write-rls, web-experience-
-- readonly-rls, pilot-roster-setup, weekly-plan-setup, crew-login-events).
-- Nobody could tell from reading them which had actually been RUN, and a
-- missing policy does not announce itself - it surfaces weeks later as
-- "the delete button doesn't work". That is exactly how pilot_duty_entries
-- ended up able to accept new entries but not edit or delete them.
--
-- Safe to run as many times as you like: every policy is dropped and
-- recreated, so the end state is the same however many times it runs.
--
-- HOW ACCESS IS MEANT TO WORK
--
--   anon          = the public key baked into the Crew web app and Android
--                   app. Pilots. May read what they need, and may write ONLY
--                   their own duty entries.
--   authenticated = an admin who has signed in to the Enterprise web console.
--                   May write everything.
--   service_role  = the PC app's key. Bypasses RLS entirely; nothing here
--                   affects the desktop app.

-- ---------------------------------------------------------------------------
-- 1. RLS on everywhere. A table with RLS off is wide open to anyone with the
--    public key, which is worse than a table with the wrong policy.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'pilot_experience', 'pilot_duty_entries', 'pilot_training',
    'pilot_roster', 'pilot_weekly_plan', 'app_settings'
  ] loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. PILOTS (anon)
-- ---------------------------------------------------------------------------

-- Read what the pilot pages display.
drop policy if exists "anon read pilot_experience" on public.pilot_experience;
create policy "anon read pilot_experience" on public.pilot_experience
  for select to anon using (true);

drop policy if exists "anon read pilot_training" on public.pilot_training;
create policy "anon read pilot_training" on public.pilot_training
  for select to anon using (true);

drop policy if exists "anon read pilot_roster" on public.pilot_roster;
create policy "anon read pilot_roster" on public.pilot_roster
  for select to anon using (true);

drop policy if exists "anon read pilot_weekly_plan" on public.pilot_weekly_plan;
create policy "anon read pilot_weekly_plan" on public.pilot_weekly_plan
  for select to anon using (true);

drop policy if exists "anon read app_settings" on public.app_settings;
create policy "anon read app_settings" on public.app_settings
  for select to anon using (true);

-- Duty entries are the ONLY thing a pilot writes. Insert to log a duty,
-- update to correct one - and update is also how a delete happens, because
-- deleting sets deleted_at rather than removing the row. Both are needed or
-- the entry becomes permanent the moment it is saved.
drop policy if exists "anon read pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon read pilot_duty_entries" on public.pilot_duty_entries
  for select to anon using (true);

drop policy if exists "anon insert pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon insert pilot_duty_entries" on public.pilot_duty_entries
  for insert to anon with check (true);

drop policy if exists "anon update pilot_duty_entries" on public.pilot_duty_entries;
create policy "anon update pilot_duty_entries" on public.pilot_duty_entries
  for update to anon using (true) with check (true);

-- Deliberately NOT granted to anon: writing the roster, the weekly plan,
-- training records, experience records or settings. Those are shared
-- documents; a pilot's app has no reason to change them, and the public key
-- is in every pilot's browser.

-- ---------------------------------------------------------------------------
-- 3. ADMINS (authenticated) - full write on everything they edit
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'pilot_experience', 'pilot_duty_entries', 'pilot_training',
    'pilot_roster', 'pilot_weekly_plan', 'app_settings'
  ] loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('drop policy if exists "auth write %s" on public.%I', t, t);
      execute format(
        'create policy "auth write %s" on public.%I for all to authenticated using (true) with check (true)',
        t, t
      );
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. WHAT IS NOW IN PLACE - read this output.
-- ---------------------------------------------------------------------------

-- Every table should show: anon SELECT, and authenticated ALL.
-- pilot_duty_entries should ALSO show anon INSERT and anon UPDATE.
select
  tablename,
  cmd,
  array_agg(distinct r) filter (where r <> 'public') as roles,
  count(*) as policies
from pg_policies, unnest(roles) as r
where schemaname = 'public'
  and tablename in ('pilot_experience','pilot_duty_entries','pilot_training',
                    'pilot_roster','pilot_weekly_plan','app_settings')
group by tablename, cmd
order by tablename, cmd;

-- Per-table pass/fail. Compared against the tables that ACTUALLY EXIST, not
-- against a fixed count.
--
-- The first version of this check hard-coded "= 6" and reported a failure
-- simply because one of the six tables isn't in this project - while every
-- policy that could be created had been. A check that can cry wolf is worse
-- than no check: the next real failure gets waved away as "that thing always
-- says false".
select
  t.name as table_name,
  to_regclass('public.' || t.name) is not null as table_exists,
  exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.name
      and p.cmd = 'ALL' and 'authenticated' = any(p.roles)
  ) as admin_can_write,
  exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.name
      and p.cmd = 'SELECT' and 'anon' = any(p.roles)
  ) as pilot_can_read
from (values
  ('pilot_experience'), ('pilot_duty_entries'), ('pilot_training'),
  ('pilot_roster'), ('pilot_weekly_plan'), ('app_settings')
) as t(name)
order by t.name;

-- The one that actually broke: pilots must be able to edit AND delete their
-- own duty entries, and a delete is an UPDATE here (it sets deleted_at).
select
  'pilots can edit/delete their duty entries' as check,
  exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='pilot_duty_entries'
      and cmd='UPDATE' and 'anon' = any(roles)
  ) as ok;
