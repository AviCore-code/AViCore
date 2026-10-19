-- Runs the daily-alerts Edge Function at 05:00 Asia/Bangkok, every day.
--
-- Run this ONCE in the Supabase SQL Editor, after deploying the function.
-- Replace <PROJECT_REF> and <SERVICE_ROLE_KEY> before running.
--
-- WHY 22:00 UTC: pg_cron schedules in UTC, and Thailand is UTC+7 with no
-- daylight saving, so 05:00 Bangkok is always 22:00 UTC the PREVIOUS day. The
-- date shift is expected - a job listed as running at 22:00 on the 4th fires at
-- 05:00 on the 5th, Bangkok time. Because Thailand never changes its offset,
-- this stays correct all year; the same trick would drift in a country that
-- observes DST.

-- Needed once per project. Both are safe to re-run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of this job before re-creating it, so running
-- this file twice does not leave two schedules sending two emails.
select cron.unschedule('avicore-daily-alerts')
where exists (select 1 from cron.job where jobname = 'avicore-daily-alerts');

select cron.schedule(
  'avicore-daily-alerts',
  '0 22 * * *',                       -- 22:00 UTC daily = 05:00 Asia/Bangkok
  $$
  select net.http_post(
    url     := 'https://ofyboehfubpdicpapyop.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9meWJvZWhmdWJwZGljcGFweW9wIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzU5MTI3NSwiZXhwIjoyMDk5MTY3Mjc1fQ.iZgHVjGeXCiRM7UH9QbgVTcRerk_aBgamz3CfBEQuD0'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Check it is registered:
--   select jobname, schedule, active from cron.job where jobname = 'avicore-daily-alerts';
--
-- See the last runs (useful when an email did not arrive):
--   select start_time, status, return_message
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'avicore-daily-alerts')
--   order by start_time desc limit 10;
--
-- To stop it (e.g. while switching back to the PC checker):
--   select cron.unschedule('avicore-daily-alerts');
