-- PostgreSQL stored function to find pilots with birthdays today
-- Matches month-day regardless of year (so birthdate 1985-10-19 matches on Oct 19 every year)

CREATE OR REPLACE FUNCTION public.get_birthday_pilots(target_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (code TEXT, name TEXT, age INT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.pilot_code AS code,
    r.pilot_name AS name,
    EXTRACT(YEAR FROM age(r.birth_date::timestamp))::int AS age
  FROM public."Admin_pilot_roster" r
  WHERE
    r.birth_date IS NOT NULL
    AND r.deleted_at IS NULL
    AND EXTRACT(MONTH FROM r.birth_date) = EXTRACT(MONTH FROM target_date)
    AND EXTRACT(DAY FROM r.birth_date) = EXTRACT(DAY FROM target_date)
  ORDER BY r.pilot_code;
$$;

-- Cron job to send birthday greetings at 07:00 Asia/Bangkok (00:00 UTC)
-- Run this SQL in Supabase SQL Editor after deploying line-birthday-greetings

-- SELECT cron.unschedule('avicore-birthday-greetings')
-- WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'avicore-birthday-greetings');
-- 
-- SELECT cron.schedule(
--   'avicore-birthday-greetings',
--   '0 0 * * *',
--   $$ SELECT net.http_post(
--     url := 'https://ofyboehfubpdicpapyop.supabase.co/functions/v1/line-birthday-greetings',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.line_birthday_secret', true)),
--     body := '{}'::jsonb
--   )
--   $$
-- );

COMMENT ON FUNCTION public.get_birthday_pilots(DATE) IS 'Find pilots with birthdays on a given date (month-day match, any year)';
