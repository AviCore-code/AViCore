-- Applied remotely as migration line_alert_cron_auth.
-- Dedicated scheduler credential remains in Vault; this returns only a boolean.
create or replace function public.avicore_verify_line_cron(candidate text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from vault.decrypted_secrets
    where name = 'avicore_line_cron_secret' and decrypted_secret = candidate
      and length(candidate) >= 32);
$$;
revoke all on function public.avicore_verify_line_cron(text) from public, anon, authenticated;
grant execute on function public.avicore_verify_line_cron(text) to service_role;
