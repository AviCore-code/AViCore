-- ============================================================================
-- Web App - Pilot Experience Read Access (RLS)
-- ============================================================================
-- Run this ONCE in Supabase Dashboard -> SQL Editor to enable the web app
-- (both Crew and Enterprise Admin) to READ pilot_experience and pilot_duty_entries.
--
-- These tables are already enabled with RLS in mobile-rls-setup.sql.
-- This script adds the read-only anon policy needed for the web builds.
-- ============================================================================

-- Enable RLS on pilot_experience (if not already enabled)
ALTER TABLE public.pilot_experience ENABLE ROW LEVEL SECURITY;

-- Enable RLS on pilot_duty_entries (if not already enabled)
ALTER TABLE public.pilot_duty_entries ENABLE ROW LEVEL SECURITY;

-- pilot_experience: allow anon (web Crew + web Admin) to read all records
DROP POLICY IF EXISTS "anon read pilot_experience" ON public.pilot_experience;
CREATE POLICY "anon read pilot_experience" ON public.pilot_experience
  FOR SELECT TO anon USING (deleted_at IS NULL);

-- pilot_duty_entries: allow anon (web Crew + web Admin) to read all records
DROP POLICY IF EXISTS "anon read pilot_duty_entries" ON public.pilot_duty_entries;
CREATE POLICY "anon read pilot_duty_entries" ON public.pilot_duty_entries
  FOR SELECT TO anon USING (deleted_at IS NULL);

-- Optional: if you want to restrict Crew web to only see their own duty entries,
-- you would need per-pilot authentication (not yet implemented).
-- For now, anon can see all pilots' data (same as mobile/desktop reads).
-- The Crew web app components (MyExperience, MyLogbook, etc.) will filter
-- client-side to show only the paired pilot's data - see WebApp.jsx.
