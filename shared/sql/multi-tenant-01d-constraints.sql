-- MULTI-TENANT, STEP 1d: lock it in and index it.
--
-- Run after 1c, and only once its check shows total = with_company on every
-- table. SET NOT NULL fails outright if a single row is still unassigned, which
-- is the behaviour you want - it refuses rather than half-applying.
--
-- RUN ONE SECTION AT A TIME. Select the lines of a section, press Run, check the
-- result, then move on. Each statement scans its whole table.
--
-- ---------------------------------------------------------------------------
-- NOTE ON `CONCURRENTLY`
-- ---------------------------------------------------------------------------
-- An earlier version of this file used CREATE INDEX CONCURRENTLY, which keeps a
-- table readable and writable while its index builds. It cannot be used here:
-- Supabase's SQL Editor wraps every request in a transaction, and CONCURRENTLY
-- is not allowed inside one - it fails with
--     ERROR 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
-- no matter how few statements are selected.
--
-- Plain CREATE INDEX is used instead. It takes a brief write lock on the table,
-- which is fine at this size (the largest is ~16,600 rows and indexes in a
-- second or two) - but it is why this should be run when nobody is entering
-- duty records.

-- ===========================================================================
-- SECTION 1 - NOT NULL on the small tables. Run these together.
-- ===========================================================================
alter table public.app_settings       alter column company_id set not null;
alter table public.pilot_experience   alter column company_id set not null;
alter table public.pilot_training     alter column company_id set not null;
alter table public.pilot_roster       alter column company_id set not null;
alter table public.pilot_weekly_plan  alter column company_id set not null;
alter table public.crew_login_events  alter column company_id set not null;


-- ===========================================================================
-- SECTION 2 - NOT NULL on the big one. Run this line ON ITS OWN.
-- ===========================================================================
alter table public.pilot_duty_entries alter column company_id set not null;


-- ===========================================================================
-- SECTION 3 - indexes. Run these together; they are quick at this size.
-- ===========================================================================
create index if not exists app_settings_company_idx       on public.app_settings (company_id);
create index if not exists pilot_experience_company_idx   on public.pilot_experience (company_id);
create index if not exists pilot_training_company_idx     on public.pilot_training (company_id);
create index if not exists pilot_roster_company_idx       on public.pilot_roster (company_id);
create index if not exists pilot_weekly_plan_company_idx  on public.pilot_weekly_plan (company_id);
create index if not exists crew_login_events_company_idx  on public.crew_login_events (company_id);


-- ===========================================================================
-- SECTION 4 - the big index. Run this line ON ITS OWN.
-- ===========================================================================
create index if not exists pilot_duty_entries_company_idx on public.pilot_duty_entries (company_id);


-- ===========================================================================
-- SECTION 5 - app_settings: unique PER COMPANY, not globally.
-- ===========================================================================
-- Its `key` column is UNIQUE today, which is exactly wrong once there is more
-- than one customer: the second company to save its FTL limits would collide
-- with the first company's row instead of creating its own.
--
-- The constraint name varies by how the table was created, so this finds it
-- rather than assuming. Run this whole block at once.
do $$
declare
  con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'public.app_settings'::regclass
    and contype in ('u','p')
    and pg_get_constraintdef(oid) ilike '%(key)%'
    and pg_get_constraintdef(oid) not ilike '%company_id%';

  if con is not null then
    execute format('alter table public.app_settings drop constraint %I', con);
    raise notice 'dropped global unique constraint %', con;
  else
    raise notice 'no global unique constraint on key - nothing to drop';
  end if;
end $$;


-- ===========================================================================
-- SECTION 6 - the replacement unique index. Run this on its own.
-- ===========================================================================
create unique index if not exists app_settings_company_key_uidx
  on public.app_settings (company_id, key);


-- ===========================================================================
-- CHECK
-- ===========================================================================
-- Every table must show is_nullable = NO:
select table_name, is_nullable
from information_schema.columns
where table_schema = 'public' and column_name = 'company_id'
order by table_name;

-- And app_settings must carry app_settings_company_key_uidx:
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'app_settings'
order by indexname;
