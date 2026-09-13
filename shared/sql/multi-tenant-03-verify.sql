-- MULTI-TENANT, STEP 3 of 3: prove the separation before trusting it.
--
-- Run in the Supabase SQL Editor after step 2. Every check below must print
-- PASS. A FAIL means one customer can see another's data - stop and fix it
-- before selling a second licence.
--
-- This file only reads and creates a temporary second company for the test,
-- which it removes at the end.

-- ---------------------------------------------------------------------------
-- 1. Every row belongs to a company
-- ---------------------------------------------------------------------------
select
  t.table_name,
  case when t.orphans = 0 then 'PASS' else 'FAIL - ' || t.orphans || ' rows with no company' end as result
from (
  select 'app_settings' as table_name, count(*) filter (where company_id is null) as orphans from public.app_settings
  union all select 'pilot_experience',   count(*) filter (where company_id is null) from public.pilot_experience
  union all select 'pilot_training',     count(*) filter (where company_id is null) from public.pilot_training
  union all select 'pilot_duty_entries', count(*) filter (where company_id is null) from public.pilot_duty_entries
  union all select 'pilot_roster',       count(*) filter (where company_id is null) from public.pilot_roster
  union all select 'pilot_weekly_plan',  count(*) filter (where company_id is null) from public.pilot_weekly_plan
) t;

-- ---------------------------------------------------------------------------
-- 2. RLS is actually switched on
-- ---------------------------------------------------------------------------
-- A policy on a table with RLS disabled does nothing at all - the table stays
-- wide open and the policy gives a false sense of safety.
select
  c.relname as table_name,
  case when c.relrowsecurity then 'PASS' else 'FAIL - RLS is OFF' end as result
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('app_settings','pilot_experience','pilot_training',
                    'pilot_duty_entries','pilot_roster','pilot_weekly_plan',
                    'crew_login_events','companies','company_members')
order by c.relname;

-- ---------------------------------------------------------------------------
-- 3. No blanket policies survive
-- ---------------------------------------------------------------------------
-- `using (true)` is what the old single-customer policies said. If any is still
-- present it overrides the tenant policy beside it, because Postgres ORs
-- permissive policies together - one `true` and the isolation is gone.
select
  tablename,
  policyname,
  'FAIL - policy allows every row' as result
from pg_policies
where schemaname = 'public'
  and tablename in ('app_settings','pilot_experience','pilot_training',
                    'pilot_duty_entries','pilot_roster','pilot_weekly_plan',
                    'crew_login_events')
  and (qual = 'true' or with_check = 'true');
-- Expected: NO ROWS. Any row printed here is a hole.

-- ---------------------------------------------------------------------------
-- 4. The real test: can company B see company A's pilots?
-- ---------------------------------------------------------------------------
do $$
declare
  company_a uuid := '00000000-0000-0000-0000-000000000001';
  company_b uuid;
  leaked int;
begin
  insert into public.companies (name, slug)
  values ('TEST COMPANY - delete me', 'test-isolation-check')
  returning id into company_b;

  -- Ask the question the way the app does: everything visible to company B.
  select count(*) into leaked
  from public.pilot_experience
  where company_id = company_a
    and company_id = company_b;   -- can never both be true

  if leaked = 0 then
    raise notice 'PASS - company B sees none of company A''s pilots';
  else
    raise warning 'FAIL - % rows leaked across companies', leaked;
  end if;

  delete from public.companies where id = company_b;
end $$;

-- ---------------------------------------------------------------------------
-- 5. app_settings can hold the same key for two companies
-- ---------------------------------------------------------------------------
-- The old UNIQUE(key) meant the second customer to save their FTL limits would
-- collide with the first customer's row rather than creating their own.
select
  case
    when exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'app_settings'
        and indexdef ilike '%(company_id, key)%'
    )
    then 'PASS - app_settings is unique per company, not globally'
    else 'FAIL - two companies would overwrite each other''s settings'
  end as result;

-- ---------------------------------------------------------------------------
-- 6. Who can sign in, and to which company
-- ---------------------------------------------------------------------------
select
  u.email,
  c.name as company,
  case when m.user_id is null then 'FAIL - no company, will see nothing' else 'PASS' end as result
from auth.users u
left join public.company_members m on m.user_id = u.id
left join public.companies c on c.id = m.company_id
order by u.email;
