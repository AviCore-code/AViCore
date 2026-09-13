-- Weekly Schedule (SKL Weekly Plan) - run this ONCE in the Supabase
-- Dashboard -> SQL Editor before using the Weekly Schedule tab under Pilot
-- Roster (src/modules/pilotRoster/WeeklySchedule.jsx).
--
-- WHAT THIS STORES
-- One row per assignment: "on this DATE, in this SECTION, in this SLOT,
-- this pilot is planned". That shape mirrors the source spreadsheet
-- ("SKL WeeklySchedulePlan 2026 (V3).xlsm", sheet "SKL Weekly Plan"),
-- which is a grid of one column per day and a fixed set of labelled row
-- groups down the side:
--
--   section            slots  meaning
--   ------------------ -----  --------------------------------------------
--   crew1..crew5         2    a 2-pilot line crew (Captain + Co-pilot),
--                             reporting 06:30 / 07:00 / 07:30 / 08:00 / 08:30
--   nightStandby1        2    Night Standby 17:30-05:30
--   nightStandby2        2    Night Standby Crew 2, 18:00-06:00
--   nightTraining        3    NIGHT TRAINING
--   training             2    Training
--   off                  8    OFF CREW (just a list, order is not meaningful)
--
-- slot is the 0-based position WITHIN that section on that day, so
-- (date, section, slot) is unique - which is exactly what uuid encodes, so
-- re-importing the same spreadsheet updates rows in place instead of
-- duplicating them (same trick as pilot_roster).
--
-- This is a PLAN. It is deliberately separate from:
--   * pilot_roster        - the published duty-code calendar (O/X/RR/N/...)
--   * pilot_duty_entries  - what a pilot actually flew/worked (drives FTL)
-- The Weekly Schedule page reads those two to warn about conflicts, but it
-- never writes to them.

create table if not exists public.pilot_weekly_plan (
  uuid text primary key,
  device_id text,
  date text not null,
  section text not null,
  slot integer not null default 0,
  pilot_code text,
  -- Experience level shown in the spreadsheet as the "(3)" in "WJU(3)".
  -- Kept as imported so the page can reproduce the sheet exactly; the
  -- authoritative level still lives on each pilot's Experience profile.
  level integer,
  note text,
  created_at text,
  modified_at text,
  deleted_at text
);

create unique index if not exists idx_pilot_weekly_plan_cell
  on public.pilot_weekly_plan (date, section, slot);
create index if not exists idx_pilot_weekly_plan_date on public.pilot_weekly_plan (date);
create index if not exists idx_pilot_weekly_plan_pilot on public.pilot_weekly_plan (pilot_code, date);
create index if not exists idx_pilot_weekly_plan_modified on public.pilot_weekly_plan (modified_at);

-- RLS: same rule as the other tables the web admin edits (see
-- sql/web-admin-write-rls.sql) - anyone may READ (the Crew app shows a
-- pilot their own plan), only a signed-in admin account may WRITE.
alter table public.pilot_weekly_plan enable row level security;

drop policy if exists weekly_plan_read on public.pilot_weekly_plan;
create policy weekly_plan_read on public.pilot_weekly_plan
  for select using (true);

drop policy if exists weekly_plan_write on public.pilot_weekly_plan;
create policy weekly_plan_write on public.pilot_weekly_plan
  for all to authenticated using (true) with check (true);

-- PostgREST caches the schema; without this the first call fails with
-- "Could not find the table 'public.pilot_weekly_plan' in the schema cache".
notify pgrst, 'reload schema';
