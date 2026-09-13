-- Run this once in Supabase Dashboard -> SQL Editor before using the new
-- "Duty Schedule" import (Pilot Roster tab) on more than one PC.
--
-- Why: electron/sync.cjs pushes the new local "pilot_roster" table to
-- Supabase the same way it already pushes pilot_experience/pilot_training/
-- pilot_duty_entries - but it can only push to a table that already exists
-- remotely. Without this script, the first import will fail with the same
-- error pilot_training hit before: "Could not find the table
-- 'public.pilot_roster' in the schema cache".
--
-- This table stores the imported duty-roster calendar (one row per pilot per
-- date - see src/services/rosterImport.js), separate from pilot_duty_entries
-- (what a pilot actually logs as flown/worked, used for FTL & experience
-- totals). Left "Unrestricted" (no RLS) like the other PC-only admin tables -
-- the desktop app's service_role key already bypasses RLS regardless, and
-- this table is not touched by the Android Crew app / anon key at all.

create table if not exists public.pilot_roster (
  uuid text primary key,
  device_id text,
  pilot_code text,
  pilot_name text,
  base text,
  date text,
  code text,
  created_at text,
  modified_at text,
  deleted_at text
);

create index if not exists idx_pilot_roster_pilot_date on public.pilot_roster (pilot_code, date);
create index if not exists idx_pilot_roster_modified_at on public.pilot_roster (modified_at);
