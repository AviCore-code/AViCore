-- Fixes: "null value in column created_at ... violates not-null constraint"
-- on any UPSERT that inserts a NEW row.
--
-- created_at is NOT NULL on these tables but has no DEFAULT, so every writer
-- has to remember to send it. Miss it and the write fails - but only when the
-- row is new, which is why it stays hidden until the day someone adds a pilot
-- rather than edits one, or saves a setting that has never been saved before.
--
-- The app now sends created_at everywhere. This makes the database itself
-- forgiving, so the PC sync, the Android app, a future page, or a manual
-- insert in the SQL editor can't reintroduce it.
--
-- Run once in Supabase -> SQL Editor. Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings',
    'pilot_experience',
    'pilot_training',
    'pilot_roster',
    'pilot_weekly_plan',
    'pilot_duty_entries'
  ]
  loop
    -- Only touch tables that actually exist in this project, and only if the
    -- column is there.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_at'
    ) then
      execute format('alter table public.%I alter column created_at set default now()', t);
      -- Backfill anything already sitting NULL (possible if a row was
      -- inserted while the column was nullable at some point).
      execute format('update public.%I set created_at = coalesce(created_at, modified_at, now()) where created_at is null', t);
    end if;
  end loop;
end $$;

-- device_id has the same problem for the same reason: the tables were shaped
-- around the PC/Android sync, where every row records the device that wrote
-- it. A browser has no device, so the web build generates an id and stores it
-- - but any writer that forgets is rejected. app_settings in particular is a
-- fleet-wide setting, not a per-device one, so requiring it there buys
-- nothing. Made nullable where that's allowed, defaulted otherwise.
do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings',
    'pilot_experience',
    'pilot_training',
    'pilot_roster',
    'pilot_weekly_plan',
    'pilot_duty_entries'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'device_id'
    ) then
      execute format('alter table public.%I alter column device_id drop not null', t);
    end if;
  end loop;
end $$;

-- Check: every listed table should now show a default of now() for
-- created_at, and device_id should be nullable.
-- select table_name, column_name, column_default, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and column_name in ('created_at', 'device_id')
-- order by table_name, column_name;
