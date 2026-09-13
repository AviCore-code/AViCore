-- MULTI-TENANT, STEP 1b: add the column to every table.
--
-- Run after 1a. This is FAST regardless of table size: adding a nullable column
-- with no default is a catalogue change in Postgres - it does not rewrite the
-- table or scan a single row.
--
-- The slow parts (backfilling values, SET NOT NULL, building indexes) are split
-- into 1c and 1d, one table at a time, because those DO scan every row and are
-- what hit the statement timeout when everything ran together.

alter table public.app_settings       add column if not exists company_id uuid references public.companies(id);
alter table public.pilot_experience   add column if not exists company_id uuid references public.companies(id);
alter table public.pilot_training     add column if not exists company_id uuid references public.companies(id);
alter table public.pilot_duty_entries add column if not exists company_id uuid references public.companies(id);
alter table public.pilot_roster       add column if not exists company_id uuid references public.companies(id);
alter table public.pilot_weekly_plan  add column if not exists company_id uuid references public.companies(id);
alter table public.crew_login_events  add column if not exists company_id uuid references public.companies(id);

-- CHECK: every table should now list a company_id column.
select table_name
from information_schema.columns
where table_schema = 'public'
  and column_name = 'company_id'
order by table_name;
