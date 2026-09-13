-- AviCore V11 one-time repair for FDT rows already duplicated on Supabase.
-- Run in Supabase SQL Editor AFTER installing V11 on all PCs.
-- It keeps the newest copy of an identical imported row and sends tombstones
-- to every device, so old local duplicates disappear on the next Sync Now.

with ranked as (
  select
    uuid,
    row_number() over (
      partition by
        pilot_code,
        coalesce(entry_json->>'sourceFile',''),
        md5(entry_json::text)
      order by modified_at desc nulls last, created_at desc nulls last, uuid desc
    ) as rn
  from public.pilot_duty_entries
  where deleted_at is null
    and coalesce(entry_json->>'sourceFile','') <> ''
), duplicates as (
  select uuid from ranked where rn > 1
)
update public.pilot_duty_entries p
set deleted_at = now(),
    modified_at = now()
from duplicates d
where p.uuid = d.uuid;

-- Verification
select pilot_code, entry_json->>'sourceFile' as source_file, count(*) as active_rows
from public.pilot_duty_entries
where deleted_at is null and coalesce(entry_json->>'sourceFile','') <> ''
group by pilot_code, entry_json->>'sourceFile'
order by pilot_code, source_file;
