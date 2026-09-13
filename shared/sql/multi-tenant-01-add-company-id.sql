-- ===========================================================================
-- SUPERSEDED - DO NOT RUN THIS FILE
-- ===========================================================================
--
-- This altered seven tables in ONE transaction and hit Supabase's statement
-- timeout: pilot_duty_entries holds ~16,600 rows, and SET NOT NULL plus an
-- index build rescans every one of them.
--
-- Use these instead, in order, one at a time:
--
--   multi-tenant-01a-companies.sql     the two new tables      (instant)
--   multi-tenant-01b-add-columns.sql   add the column          (instant)
--   multi-tenant-01c-backfill.sql      fill it in              (run per table)
--   multi-tenant-01d-constraints.sql   NOT NULL + indexes      (run per statement)
--
-- Kept only so the split files can be read against the original intent.
-- ===========================================================================

-- MULTI-TENANT, STEP 1 of 3: add the company column and fill it in.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
--
-- AviCore is being sold to other operators. Today every table is shared: the
-- write policies say `using (true)`, which means ANY authenticated admin can
-- read and write EVERY row. With one customer that is fine. With two, Company
-- B's chief pilot opens Pilot Roster and sees Company A's pilots - duty hours,
-- licence numbers, medical expiry dates.
--
-- This adds a company_id to every table and ties the RLS policies to it, so a
-- row is only ever visible to the company that owns it.
--
-- ===========================================================================
-- RUN THESE IN ORDER, ONE AT A TIME, CHECKING THE RESULT OF EACH
-- ===========================================================================
--
--   multi-tenant-01-add-company-id.sql   <- this file: add + backfill
--   multi-tenant-02-rls.sql              enforce it
--   multi-tenant-03-verify.sql           prove it works before trusting it
--
-- Step 1 is SAFE ON A LIVE SYSTEM: it only adds a column and fills it with the
-- existing company's id. Nothing is enforced yet, so the running app carries on
-- exactly as before. Step 2 is the one that changes behaviour.
--
-- ===========================================================================
-- WHAT COUNTS AS A COMPANY
-- ===========================================================================
--
-- One row in `companies`. Its id is what every other table carries.
--
-- An admin belongs to a company through `company_members`, keyed on their
-- Supabase auth user id - so the company is derived from who is signed in, not
-- from anything the browser sends. A client cannot ask for another company's
-- rows by changing a value in the request.

-- ---------------------------------------------------------------------------
-- 1. The companies themselves
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- The Crew web app signs in with the ANON key and has no user account, so it
  -- cannot be identified the way an admin is. It sends this slug instead, set
  -- once per deployment - see step 2 for exactly how far that is trusted.
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  -- Subscription control. Null = no expiry. A past date blocks writes; reads are
  -- deliberately left working so a customer whose invoice is late can still see
  -- their own duty records rather than being locked out of a compliance system.
  expires_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Who belongs to which company
-- ---------------------------------------------------------------------------
create table if not exists public.company_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        text not null default 'admin',
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- ---------------------------------------------------------------------------
-- 3. The existing customer
-- ---------------------------------------------------------------------------
-- Everything already in these tables belongs to the first customer. Created
-- here with a fixed id so the backfill below is repeatable - running this file
-- twice does not create a second company or re-assign anything.
insert into public.companies (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'United Offshore Aviation', 'uoa')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The column, on every table that holds customer data
-- ---------------------------------------------------------------------------
-- Added nullable and backfilled, THEN made NOT NULL. Adding it NOT NULL in one
-- step would fail on any table that already has rows.
do $$
declare
  t text;
  tables text[] := array[
    'app_settings', 'pilot_experience', 'pilot_training',
    'pilot_duty_entries', 'pilot_roster', 'pilot_weekly_plan',
    'crew_login_events'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column if not exists company_id uuid references public.companies(id)', t
    );
    execute format(
      'update public.%I set company_id = ''00000000-0000-0000-0000-000000000001'' where company_id is null', t
    );
    execute format(
      'alter table public.%I alter column company_id set not null', t
    );
    -- Every query filters on company_id from here on, so it wants an index.
    execute format(
      'create index if not exists %I on public.%I (company_id)', t || '_company_idx', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. app_settings is keyed per company, not globally
-- ---------------------------------------------------------------------------
-- Its `key` column is UNIQUE today, which is exactly wrong once there is more
-- than one customer: the second company to save its FTL limits would collide
-- with the first company's row instead of creating its own.
--
-- The constraint name varies by how the table was created, so this finds it
-- rather than assuming.
do $$
declare
  con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'public.app_settings'::regclass
    and contype in ('u','p')
    and pg_get_constraintdef(oid) ilike '%(key)%';

  if con is not null then
    execute format('alter table public.app_settings drop constraint %I', con);
  end if;
end $$;

create unique index if not exists app_settings_company_key_uidx
  on public.app_settings (company_id, key);

-- ---------------------------------------------------------------------------
-- 6. Link the existing admins to the existing company
-- ---------------------------------------------------------------------------
-- Everyone who can already sign in belongs to the first customer. Without this
-- they would lose access the moment step 2 is applied.
insert into public.company_members (user_id, company_id)
select id, '00000000-0000-0000-0000-000000000001'
from auth.users
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- CHECK BEFORE MOVING ON
-- ---------------------------------------------------------------------------
--   select 'app_settings' t, count(*) total, count(company_id) with_company from public.app_settings
--   union all select 'pilot_experience', count(*), count(company_id) from public.pilot_experience
--   union all select 'pilot_training', count(*), count(company_id) from public.pilot_training
--   union all select 'pilot_duty_entries', count(*), count(company_id) from public.pilot_duty_entries
--   union all select 'pilot_roster', count(*), count(company_id) from public.pilot_roster
--   union all select 'pilot_weekly_plan', count(*), count(company_id) from public.pilot_weekly_plan;
--
-- total and with_company must be equal on every row. If they are not, STOP -
-- step 2 would make the unassigned rows invisible to everyone.
--
--   select * from public.company_members;
--
-- must list every admin who needs access.
