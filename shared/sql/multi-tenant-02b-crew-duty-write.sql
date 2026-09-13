-- MULTI-TENANT, STEP 2b: give Crew back its duty-entry write access.
--
-- Run after multi-tenant-02-rls.sql. Small and quick.
--
-- ===========================================================================
-- WHY THIS IS NEEDED
-- ===========================================================================
--
-- Step 2 granted anon SELECT on every table and stopped there. That was wrong:
-- the policies it replaced (sql/fix-duty-entry-write-rls.sql) also gave anon
-- INSERT and UPDATE on pilot_duty_entries, because THAT IS THE WHOLE POINT of
-- the Crew app - a pilot records their own duty on their phone.
--
-- The symptom was a pilot pressing Save and being told their account was not
-- linked to a company. It was never about the account; the write was refused
-- and the app reported the wrong reason.
--
-- Everything else stays read-only for anon. Roster, training, experience and
-- settings are still admin-only, exactly as before.

-- ---------------------------------------------------------------------------
-- Crew may add and edit duty entries, but only within its own company
-- ---------------------------------------------------------------------------
-- `header_company_id()` reads the x-avicore-company header the app sends (see
-- step 2). A row can only be written into the company that header names, so a
-- Crew build cannot file duty against another operator even if the request is
-- altered by hand.
drop policy if exists "tenant crew insert duty" on public.pilot_duty_entries;
create policy "tenant crew insert duty" on public.pilot_duty_entries
  for insert to anon
  with check (company_id = public.header_company_id());

-- UPDATE covers two things the app does routinely: editing an entry, and the
-- soft-delete that sets deleted_at. Both need `using` (which rows may be
-- touched) and `with check` (what they may become) - without the second, a row
-- could be updated INTO another company.
drop policy if exists "tenant crew update duty" on public.pilot_duty_entries;
create policy "tenant crew update duty" on public.pilot_duty_entries
  for update to anon
  using (company_id = public.header_company_id())
  with check (company_id = public.header_company_id());

-- ---------------------------------------------------------------------------
-- CHECK
-- ---------------------------------------------------------------------------
-- pilot_duty_entries should now list, for anon: select, insert, update.
select policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename = 'pilot_duty_entries'
order by policyname;

-- And no other table should give anon anything but SELECT:
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and 'anon' = any(roles)
  and cmd <> 'SELECT'
order by tablename, policyname;
-- Expected: only pilot_duty_entries (INSERT, UPDATE) and crew_login_events
-- (INSERT). Anything else listed here is a write a pilot should not have.
