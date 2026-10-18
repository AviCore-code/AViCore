-- Merge UOA duty entries onto the ONE company every admin belongs to.
--
-- Why: companies holds three "United Offshore Aviation" rows. All 8 admin
-- accounts are members of 00000000-0000-0000-0000-000000000001, so Admin can
-- only soft-delete duty rows carrying that id. Rows stored under the other two
-- UOA ids (or NULL) stay live after "Remove" and keep counting towards FT/DT.
--
-- Scope: Admin_pilot_duty_entries only. XYZ Aviation is never touched.
-- Run in Supabase -> SQL Editor. Run PART A first and read the result.

-- =====================================================================
-- PART A - preview (read only)
-- =====================================================================

-- A1. Live duty rows per company_id. Expect: everything UOA under ...0001.
select coalesce(c.name, '(NULL company_id)') as company,
       d.company_id, count(*) as live_rows,
       count(distinct d.pilot_code) as pilots
from public."Admin_pilot_duty_entries" d
left join public.companies c on c.id = d.company_id
where d.deleted_at is null
group by 1, 2
order by 1, 2;

-- A2. Which company the Crew app resolves to (VITE_COMPANY_SLUG=uoa).
--     If this is NOT ...0001, every duty entry a pilot types in the Crew app
--     lands under a company Admin cannot edit or delete. See PART C.
select id, name, slug from public.companies where slug = 'uoa';

-- A3. Pilots that would move, with how many rows each.
select d.company_id, d.pilot_code,
       coalesce(d.entry_json->>'sourceFile', '(not from a file)') as source_file,
       count(*) as live_rows
from public."Admin_pilot_duty_entries" d
where d.deleted_at is null
  and (d.company_id is null or d.company_id in (
        '4a9ce95b-4d79-47a7-9098-77d0226d3ffa',
        'f1ae29e2-465e-4e98-85b8-ea57042c4c52'))
group by 1, 2, 3
order by 2, 3;

-- =====================================================================
-- PART B - merge (writes). One transaction: all or nothing.
-- Includes soft-deleted rows too, so history stays under one company.
-- =====================================================================

begin;

update public."Admin_pilot_duty_entries"
   set company_id = '00000000-0000-0000-0000-000000000001'
 where company_id is null
    or company_id in ('4a9ce95b-4d79-47a7-9098-77d0226d3ffa',
                      'f1ae29e2-465e-4e98-85b8-ea57042c4c52');

-- Must return zero rows before you commit.
select company_id, count(*)
from public."Admin_pilot_duty_entries"
where company_id is null
   or company_id in ('4a9ce95b-4d79-47a7-9098-77d0226d3ffa',
                     'f1ae29e2-465e-4e98-85b8-ea57042c4c52')
group by 1;

commit;   -- or: rollback;  if anything above looks wrong

-- After this: Admin -> FDT -> Import & Setup -> press Remove again on the
-- files that would not clear. Their pilots should then drop to 0.

-- =====================================================================
-- PART C - only if A2 showed slug 'uoa' on a company other than ...0001.
-- Points the Crew app at the same company as Admin. Do NOT run blindly:
-- check with Claude first, since other tables may hold rows under that id.
-- =====================================================================
-- begin;
-- update public.companies set slug = 'uoa-old-' || left(id::text, 8)
--  where slug = 'uoa' and id <> '00000000-0000-0000-0000-000000000001';
-- update public.companies set slug = 'uoa'
--  where id = '00000000-0000-0000-0000-000000000001';
-- commit;
