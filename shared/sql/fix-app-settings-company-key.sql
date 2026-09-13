-- ===========================================================================
-- Settings cannot be saved — fix the app_settings unique index
-- ===========================================================================
--
-- SYMPTOM
--   "Could not save: save setting(...): app_settings is missing its unique
--    index on (company_id, key)"
--
-- CAUSE
--   Every setting is written as an UPSERT. Postgres can only do that against a
--   real unique index. The multi-tenant migration replaced the old global
--   unique constraint on `key` with one on (company_id, key) - correctly, see
--   below - and this index is what the app now upserts against. If it is
--   missing, nothing saves.
--
-- ---------------------------------------------------------------------------
-- !! DO NOT RUN sql/fix-app-settings-key-unique.sql TO FIX THIS !!
-- ---------------------------------------------------------------------------
--
-- That file is from BEFORE this system supported more than one company. It
-- adds  unique (key)  — globally, across every customer. With it in place the
-- second company to save its FTL limits would overwrite the FIRST company's
-- row rather than creating its own, because from Postgres's point of view they
-- are the same setting.
--
-- It is kept only for old single-company installs. On this database it would
-- silently merge customers' settings together. Run this file instead.
--
-- Safe to re-run.


-- ---------------------------------------------------------------------------
-- 1. Look before changing anything
-- ---------------------------------------------------------------------------
-- Run this on its own first. It tells you which state the table is in.

select
  (select count(*) from pg_indexes
     where schemaname = 'public' and tablename = 'app_settings'
       and indexdef ilike '%UNIQUE%' and indexdef ilike '%company_id%'
       and indexdef ilike '%key%')                        as correct_index,
  (select count(*) from pg_constraint
     where conrelid = 'public.app_settings'::regclass
       and contype in ('u','p')
       and pg_get_constraintdef(oid) ilike '%(key)%')      as bad_global_constraint,
  (select count(*) from public.app_settings
     where company_id is null)                            as rows_without_company;

-- correct_index          should be 1  -> the app can save
-- bad_global_constraint  should be 0  -> anything else breaks multi-company
-- rows_without_company   should be 0  -> otherwise step 2 cannot run


-- ---------------------------------------------------------------------------
-- 2. Fix
-- ---------------------------------------------------------------------------

-- 2a. Every row needs a company before a (company_id, key) index can exist.
--     Assigns orphans to the single existing company; if there is more than
--     one company it stops rather than guessing which one they belong to.
do $$
declare
  n_orphans int;
  n_companies int;
  the_company uuid;
begin
  select count(*) into n_orphans from public.app_settings where company_id is null;
  if n_orphans = 0 then
    raise notice 'no rows without a company';
    return;
  end if;

  select count(*), min(id) into n_companies, the_company from public.companies;
  if n_companies <> 1 then
    raise exception
      '% settings rows have no company_id and there are % companies - assign them by hand, guessing would put one customer''s settings on another',
      n_orphans, n_companies;
  end if;

  update public.app_settings set company_id = the_company where company_id is null;
  raise notice 'assigned % orphaned settings rows to the only company', n_orphans;
end $$;

-- 2b. Remove duplicates, keeping the most recently modified of each
--     (company_id, key). Duplicates are possible while no index existed.
delete from public.app_settings a
using public.app_settings b
where a.company_id = b.company_id
  and a.key = b.key
  and (
    coalesce(a.modified_at, '-infinity'::timestamptz) < coalesce(b.modified_at, '-infinity'::timestamptz)
    or (
      coalesce(a.modified_at, '-infinity'::timestamptz) = coalesce(b.modified_at, '-infinity'::timestamptz)
      and a.ctid < b.ctid
    )
  );

-- 2c. Drop any global unique constraint on `key` alone. This is the one that
--     breaks separation between companies.
do $$
declare con text;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'public.app_settings'::regclass
    and contype in ('u','p')
    and pg_get_constraintdef(oid) ilike '%(key)%';

  if con is not null then
    execute format('alter table public.app_settings drop constraint %I', con);
    raise notice 'dropped global unique constraint % on key', con;
  else
    raise notice 'no global constraint on key - good';
  end if;
end $$;

-- 2d. The index the app actually upserts against.
create unique index if not exists app_settings_company_key_uidx
  on public.app_settings (company_id, key);


-- ---------------------------------------------------------------------------
-- 3. Confirm
-- ---------------------------------------------------------------------------
-- Re-run the query in step 1. Expect: correct_index = 1,
-- bad_global_constraint = 0, rows_without_company = 0.
--
-- Then save any setting in the app - it should succeed.
