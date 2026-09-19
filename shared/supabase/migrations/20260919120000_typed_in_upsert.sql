-- AviCore: prevent typed-in duplicate duty entries.
--
-- Before this migration, rawAddDutyEntry used INSERT for every manual
-- (typed-in) duty entry. If someone typed in a duty day that was also
-- present in an FDT xlsx import, two rows existed for the same
-- pilot_code + date + duty_type → duty hours were counted twice and
-- a "TYPED IN / DUPLICATE" warning appeared in All Status.
--
-- Fix: rawAddDutyEntry now uses UPSERT with onConflict=pilot_code,date,duty_type.
-- This constraint is what makes the upsert work. Without it, Supabase/Postgres
-- cannot know which existing row to overwrite.
--
-- Run once in Supabase → SQL Editor.
-- Safe to re-run (CREATE UNIQUE INDEX IF NOT EXISTS).

CREATE UNIQUE INDEX IF NOT EXISTS Admin_pilot_duty_entries_pilot_date_type_key
  ON public."Admin_pilot_duty_entries" (pilot_code, date, duty_type)
  WHERE deleted_at IS NULL;

-- Verification: should show one row per pilot_code+date+duty_type combination
-- (all counts = 1) if there are no active duplicates remaining.
-- SELECT pilot_code, date, duty_type, count(*) AS active_rows
-- FROM public."Admin_pilot_duty_entries"
-- WHERE deleted_at IS NULL
-- GROUP BY pilot_code, date, duty_type
-- HAVING count(*) > 1
-- ORDER BY pilot_code, date;
