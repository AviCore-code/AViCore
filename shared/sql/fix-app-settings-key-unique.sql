-- ===========================================================================
-- !! OBSOLETE - DO NOT RUN ON A MULTI-COMPANY DATABASE !!
-- ===========================================================================
--
-- This file is from before AviCore supported more than one company. It adds
--     unique (key)
-- across the WHOLE table, ignoring company_id. On a database that has been
-- through the multi-tenant migration that is actively harmful: two customers
-- cannot then hold the same setting key, so the second one to save its FTL
-- limits, training rules or fatigue criteria OVERWRITES the first customer's
-- row instead of creating its own. Nothing errors; the settings just merge.
--
-- The multi-tenant migration deliberately DROPPED this constraint and replaced
-- it with a unique index on (company_id, key).
--
--   -> If settings will not save, run  sql/fix-app-settings-company-key.sql
--
-- Kept only for reference, and for an old single-company install that never
-- ran the multi-tenant migration.
-- ===========================================================================
--
-- Fixes: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" when the app saves a setting.
--
-- Every setting is written as an UPSERT on `key` (saveSetting -> upsert with
-- onConflict: "key"). Postgres can only do that if `key` actually carries a
-- UNIQUE constraint; without one it rejects the whole statement, so NOTHING
-- gets saved - FTL limits, training thresholds, course times, the weekly-plan
-- rules, the AI settings, all of them silently fail with a 400.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

-- 1. If duplicate keys already exist (possible while the constraint was
--    missing), keep the most recently modified row for each key and remove
--    the rest, otherwise the unique index can't be created.
delete from public.app_settings a
using public.app_settings b
where a.key = b.key
  and (
    coalesce(a.modified_at, '-infinity'::timestamptz) < coalesce(b.modified_at, '-infinity'::timestamptz)
    or (
      coalesce(a.modified_at, '-infinity'::timestamptz) = coalesce(b.modified_at, '-infinity'::timestamptz)
      and a.ctid < b.ctid
    )
  );

-- 2. The constraint itself.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_settings'::regclass
      and contype in ('p', 'u')
      and conkey = array[
        (select attnum from pg_attribute
          where attrelid = 'public.app_settings'::regclass and attname = 'key')
      ]
  ) then
    alter table public.app_settings
      add constraint app_settings_key_unique unique (key);
  end if;
end $$;

-- 3. Check: should return one row per key, and no error.
-- select key, count(*) from public.app_settings group by key having count(*) > 1;
