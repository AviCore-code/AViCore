-- Staff training contains employee names/IDs, certificate numbers and notes.
-- The Crew app uses the anon role to read ordinary Admin settings, so these
-- three keys need a restrictive policy in addition to the existing permissive
-- `anon read app_settings` policy. PostgreSQL combines restrictive policies
-- with every permissive policy using AND, which keeps this safe even if the
-- broad legacy read policy remains present.

begin;

alter table public."Admin_app_settings" enable row level security;

drop policy if exists "anon cannot read staff training PII"
  on public."Admin_app_settings";

create policy "anon cannot read staff training PII"
  on public."Admin_app_settings"
  as restrictive
  for select
  to anon
  using (
    key not in (
      'staff_training_courses_v1',
      'staff_training_personnel_v1',
      'staff_training_records_v1'
    )
  );

commit;
