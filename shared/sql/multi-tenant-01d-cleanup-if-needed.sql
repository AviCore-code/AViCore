-- Only run this if step 1d was attempted with the CONCURRENTLY version and
-- failed part-way. Otherwise skip it.
--
-- A CREATE INDEX CONCURRENTLY that fails can leave an INVALID index behind -
-- it exists, it is maintained on every write, but the planner will not use it.
-- The 25001 error you saw is raised before the index is created, so there is
-- most likely nothing here; this is how to be sure.

-- 1. Look for invalid indexes.
select
  c.relname as index_name,
  t.relname as table_name,
  'INVALID - drop it' as note
from pg_class c
join pg_index i on i.indexrelid = c.oid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not i.indisvalid;

-- Expected: NO ROWS.
--
-- 2. If any row IS listed, drop each one by name, then re-run 1d:
--
--    drop index if exists public.<index_name>;
