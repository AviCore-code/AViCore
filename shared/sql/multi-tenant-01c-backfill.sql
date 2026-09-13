-- MULTI-TENANT, STEP 1c: fill in the company on existing rows.
--
-- Run after 1b. RUN THESE ONE AT A TIME - select a single statement and press
-- Run, rather than running the whole file. Each UPDATE rewrites every row in its
-- table, and pilot_duty_entries is the one that timed out before.
--
-- Every statement is safe to re-run: the `where company_id is null` means a
-- second run touches nothing.

-- --- the small ones: run these together, they finish in a moment ------------
update public.app_settings      set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update public.pilot_experience  set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update public.pilot_training    set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update public.pilot_roster      set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update public.pilot_weekly_plan set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;
update public.crew_login_events set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;


-- --- the big one: run this ON ITS OWN ---------------------------------------
--
-- ~16,600 duty entries. If it still times out, use the batched version below
-- instead: run it repeatedly until it reports 0 rows updated.
update public.pilot_duty_entries set company_id = '00000000-0000-0000-0000-000000000001' where company_id is null;


-- --- batched fallback, only if the statement above times out -----------------
--
-- Updates 5,000 rows per run. Press Run again until it says "0 rows". Nothing
-- is lost by running it more times than needed.
--
-- update public.pilot_duty_entries
-- set company_id = '00000000-0000-0000-0000-000000000001'
-- where uuid in (
--   select uuid from public.pilot_duty_entries where company_id is null limit 5000
-- );


-- ---------------------------------------------------------------------------
-- CHECK - total and with_company MUST be equal on every row
-- ---------------------------------------------------------------------------
select 'app_settings' t, count(*) total, count(company_id) with_company from public.app_settings
union all select 'pilot_experience',   count(*), count(company_id) from public.pilot_experience
union all select 'pilot_training',     count(*), count(company_id) from public.pilot_training
union all select 'pilot_duty_entries', count(*), count(company_id) from public.pilot_duty_entries
union all select 'pilot_roster',       count(*), count(company_id) from public.pilot_roster
union all select 'pilot_weekly_plan',  count(*), count(company_id) from public.pilot_weekly_plan
union all select 'crew_login_events',  count(*), count(company_id) from public.crew_login_events;

-- If any row shows with_company lower than total, run that table's UPDATE again
-- before moving on. Step 2 would make the unassigned rows invisible to everyone.
