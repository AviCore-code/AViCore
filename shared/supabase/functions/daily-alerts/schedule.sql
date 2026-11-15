-- Runs the daily-alerts Edge Function every 15 minutes.
--
-- Run this ONCE in the Supabase SQL Editor, after deploying the function.
--
-- WHY every 15 minutes: each recipient in Admin Settings has their own time
-- of day (Bangkok, in 15-minute steps). The function itself decides who is
-- due - their time has passed today and they have not had today's check yet -
-- and returns at once when nobody is, so the quarter-hourly calls are cheap.
-- Bangkok time is worked out inside the function (Asia/Bangkok), so the cron
-- expression does not need the UTC offset any more.
--
-- No key in this file: the function is deployed with --no-verify-jwt, and the
-- timed check only ever mails what is due. (A "Send test" from Admin Settings
-- is the only thing that sends on demand, and the function requires a
-- signed-in AviCore admin for that.)

-- Needed once per project. Both are safe to re-run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of this job before re-creating it, so running
-- this file twice does not leave two schedules sending two emails.
select cron.unschedule('avicore-daily-alerts')
where exists (select 1 from cron.job where jobname = 'avicore-daily-alerts');

select cron.schedule(
  'avicore-daily-alerts',
  '*/15 * * * *',                     -- every 15 minutes; the function picks who is due
  $$
  select net.http_post(
    url     := 'https://ofyboehfubpdicpapyop.supabase.co/functions/v1/daily-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json'),
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
-- To stop it:
--   select cron.unschedule('avicore-daily-alerts');
