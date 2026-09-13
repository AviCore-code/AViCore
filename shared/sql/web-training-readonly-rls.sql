-- Run this once in Supabase Dashboard -> SQL Editor to enable the new
-- "My Training Status" tab in the AviCore Crew web app.
--
-- Why a separate file instead of editing sql/mobile-rls-setup.sql: that
-- script explicitly set up pilot_training with ZERO anon policies on
-- purpose (see its comment: "pilot_training: NO access at all - Training
-- stays PC/Admin-only"). This script deliberately reverses that, now that
-- the web app needs a pilot to see their own training/certificate status.
-- It only grants READ - a pilot can view their own training record, but
-- still cannot edit it from the web app (Training data entry/import stays
-- PC/Admin-only, same as before).
--
-- Same anon key as everything else (Android app, web app) - RLS is what
-- scopes what that key can touch, not which build is asking.

ALTER TABLE public.pilot_training ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read pilot_training" ON public.pilot_training;
CREATE POLICY "anon read pilot_training" ON public.pilot_training
  FOR SELECT TO anon USING (true);

-- Still no INSERT/UPDATE/DELETE policy for anon - training records remain
-- read-only from the web app and the Android app.
