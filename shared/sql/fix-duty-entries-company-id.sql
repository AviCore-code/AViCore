-- FDT file was "Removed" in Admin, but some pilots still show FT/DT hours.
--
-- Soft-delete is an UPDATE (set deleted_at). When row-level security does not
-- let this admin UPDATE a row, PostgREST does not raise an error - the row is
-- simply not matched. The read policy can still show it, so it keeps counting
-- towards FT/DT with nothing on screen to explain why.
--
-- Run in Supabase -> SQL Editor. Steps 1-3 only READ. Step 4 changes data and
-- is commented out on purpose: run it only after steps 1-3 show the cause.

-- 1. The policies currently on the table (compare UPDATE vs SELECT).
select policyname, cmd, roles, qual as using_expr, with_check
from pg_policies
where tablename = 'Admin_pilot_duty_entries';

-- 2. Rows still live, per pilot / source file / company_id.
--    Rows under a company_id that is NULL or differs from the others are the
--    ones the delete could not reach.
select pilot_code,
       coalesce(entry_json->>'sourceFile', '(not from a file)') as source_file,
       company_id,
       count(*)            as live_rows,
       min(date)           as first_date,
       max(date)           as last_date,
       max(modified_at)    as last_modified
from public."Admin_pilot_duty_entries"
where deleted_at is null
group by 1, 2, 3
order by 1, 2, 3;

-- 3. The company ids that exist (pick the right one for step 4), with how
--    many live duty rows and admin accounts each one holds. A signed-in admin
--    writes and deletes under its company_members row; Crew uses the slug.
select c.id, c.name, c.slug,
       (select count(*) from public."Admin_pilot_duty_entries" d
         where d.company_id = c.id and d.deleted_at is null) as live_duty_rows,
       (select count(*) from public.company_members m
         where m.company_id = c.id)                         as members
from public.companies c
order by c.name, c.id;

-- 3b. Which company each admin account belongs to.
select u.email, m.company_id
from public.company_members m
join auth.users u on u.id = m.user_id
order by u.email;

-- 4. (Optional) Give orphaned rows the right company_id, then press Remove
--    again in Admin -> Import & Setup. Replace <COMPANY_ID> first.
-- update public."Admin_pilot_duty_entries"
--    set company_id = '<COMPANY_ID>'
--  where deleted_at is null
--    and (company_id is null or company_id <> '<COMPANY_ID>');
