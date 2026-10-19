-- Create Vault secrets avicore_line_function_url (full function URL) and
-- avicore_line_cron_secret (same value as LINE_ALERT_CRON_SECRET) in Dashboard first.
-- Never paste secret values into this source file.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('avicore-line-due-alerts')
where exists (select 1 from cron.job where jobname = 'avicore-line-due-alerts');
select cron.schedule('avicore-line-due-alerts', '0 22 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'avicore_line_function_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'avicore_line_cron_secret')),
    body := '{}'::jsonb
  );
$$);
