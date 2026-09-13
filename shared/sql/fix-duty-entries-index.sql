-- Fixes: "canceling statement due to statement timeout" when reading one
-- pilot's duty entries (FDT, My Status, Dashboard, All Status).
--
-- Every one of those pages runs, per pilot:
--
--   select * from pilot_duty_entries
--   where pilot_code = ? and deleted_at is null
--   order by date desc
--
-- With no index on pilot_code, Postgres reads the WHOLE table for each pilot
-- and sorts it. That is survivable at a few hundred rows and fatal at tens of
-- thousands - and All Status runs it once per pilot, so the cost multiplies by
-- the size of the fleet. Past the timeout the read simply fails, which the app
-- used to show as "no duty records" - identical on screen to a pilot who has
-- never flown.
--
-- Run once in Supabase -> SQL Editor. Safe to re-run. Takes a few seconds.

-- The exact shape of the query above: filter by pilot, skip deleted, newest
-- first. A partial index (WHERE deleted_at IS NULL) also keeps it small,
-- since soft-deleted rows are never read.
create index if not exists pilot_duty_entries_pilot_date_idx
  on public.pilot_duty_entries (pilot_code, date desc)
  where deleted_at is null;

-- Imports and the "remove by source file" tool filter on this JSON key.
create index if not exists pilot_duty_entries_source_file_idx
  on public.pilot_duty_entries ((entry_json->>'sourceFile'))
  where deleted_at is null;

-- The other tables read the same way: by pilot/date, skipping deleted rows.
create index if not exists pilot_roster_pilot_date_idx
  on public.pilot_roster (pilot_code, date)
  where deleted_at is null;

create index if not exists pilot_weekly_plan_date_idx
  on public.pilot_weekly_plan (date)
  where deleted_at is null;

-- Let the planner use them immediately rather than after autovacuum.
analyze public.pilot_duty_entries;
analyze public.pilot_roster;
analyze public.pilot_weekly_plan;

-- Check: this should come back in milliseconds and say "Index Scan", not
-- "Seq Scan". Replace WJU with any real code.
-- explain analyze
-- select * from public.pilot_duty_entries
-- where pilot_code = 'WJU' and deleted_at is null
-- order by date desc;
