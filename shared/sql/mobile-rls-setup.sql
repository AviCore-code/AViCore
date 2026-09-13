-- Run this once in Supabase Dashboard -> SQL Editor, before shipping the
-- Android app to any pilot's phone.
--
-- Why: the Android app embeds the Supabase "anon" key inside the installed
-- APK (this is normal and expected for Supabase - the anon key is meant to
-- be public). Anyone who extracts it from the APK can call your Supabase
-- project directly with it. Right now every table is "Unrestricted" (no Row
-- Level Security), so an extracted anon key would currently have full
-- read/write access to EVERY table - Pilot Experience, Training records,
-- FTL Limits, everything. This script locks that down to only what the
-- mobile app actually needs:
--   - pilot_experience : read-only  (My Experience / pilot picker)
--   - pilot_duty_entries: read + write (Daily Duty, My Status, My Logbook)
--   - app_settings      : read-only  (FTL Limits, shown on My Status)
--   - pilot_training     : NO access at all (Training stays PC/Admin-only)
--   - sync_meta         : not a Supabase table (local SQLite only) - nothing to do here
--
-- The PC app's service_role key ALWAYS bypasses Row Level Security
-- regardless of what's set up here, so none of this affects the desktop app
-- or its Admin/Training/Flight Crews pages in any way.
--
-- Note: there is no per-pilot login yet, so this does NOT stop one pilot's
-- phone from reading/writing another pilot's duty entries - it only stops
-- the anon key from touching anything OUTSIDE pilot_duty_entries/
-- pilot_experience/app_settings. Revisit with real per-pilot auth later if
-- that level of isolation becomes a requirement.

ALTER TABLE public.pilot_experience   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_duty_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_training     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       ENABLE ROW LEVEL SECURITY;

-- pilot_experience: read-only for the mobile app.
DROP POLICY IF EXISTS "anon read pilot_experience" ON public.pilot_experience;
CREATE POLICY "anon read pilot_experience" ON public.pilot_experience
  FOR SELECT TO anon USING (true);

-- pilot_duty_entries: read + write (Daily Duty entry happens on the phone).
DROP POLICY IF EXISTS "anon read pilot_duty_entries" ON public.pilot_duty_entries;
CREATE POLICY "anon read pilot_duty_entries" ON public.pilot_duty_entries
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon insert pilot_duty_entries" ON public.pilot_duty_entries;
CREATE POLICY "anon insert pilot_duty_entries" ON public.pilot_duty_entries
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "anon update pilot_duty_entries" ON public.pilot_duty_entries;
CREATE POLICY "anon update pilot_duty_entries" ON public.pilot_duty_entries
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- app_settings: read-only (FTL Limits). No write - Settings stays Admin-only.
DROP POLICY IF EXISTS "anon read app_settings" ON public.app_settings;
CREATE POLICY "anon read app_settings" ON public.app_settings
  FOR SELECT TO anon USING (true);

-- pilot_training: RLS enabled above with ZERO policies for the anon role on
-- purpose - this means the anon key (and therefore the Android app) cannot
-- read or write this table at all. Nothing else to add here.
--
-- UPDATE: sql/web-training-readonly-rls.sql later adds a read-only anon
-- policy to this same table for the web app's "My Training Status" tab -
-- run that script too if you want that feature. Still no write access from
-- anon either way.
