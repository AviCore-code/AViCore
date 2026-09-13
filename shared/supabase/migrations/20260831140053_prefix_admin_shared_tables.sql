-- Prefix the seven Supabase relations owned by AviCore Admin. PostgreSQL
-- relation renames preserve the tables' data, indexes, constraints, RLS
-- policies, triggers and foreign-key references because those objects track
-- the relation by OID rather than by its text name.
--
-- The capital A is intentional and therefore quoted. PostgREST/Supabase JS
-- callers must use these exact relation names.

alter table public.app_settings rename to "Admin_app_settings";
alter table public.pilot_experience rename to "Admin_pilot_experience";
alter table public.pilot_training rename to "Admin_pilot_training";
alter table public.pilot_duty_entries rename to "Admin_pilot_duty_entries";
alter table public.pilot_roster rename to "Admin_pilot_roster";
alter table public.pilot_weekly_plan rename to "Admin_pilot_weekly_plan";
alter table public.crew_login_events rename to "Admin_crew_login_events";
