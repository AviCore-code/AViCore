-- MULTI-TENANT, STEP 2 of 3: enforce it.
--
-- Run ONLY after step 1 has been applied and its checks pass. This is the file
-- that changes behaviour: after it, a row is visible only to the company that
-- owns it.
--
-- ===========================================================================
-- THE TWO KINDS OF CALLER, AND WHY THEY ARE TREATED DIFFERENTLY
-- ===========================================================================
--
-- ADMIN (Enterprise web, PC)  signs in with a real Supabase account.
--   Their company comes from company_members, looked up from auth.uid() INSIDE
--   the database. The browser never sends it and cannot influence it. This is
--   real isolation: an admin cannot reach another company's rows even by
--   editing the request by hand.
--
-- CREW (pilot web app, Android)  uses the ANON key and has no account.
--   There is nothing to look up, so the app sends its company slug and the
--   policies below trust it. That is a WEAKER guarantee and it must be said
--   plainly: anyone who has the anon key and guesses a slug can read that
--   company's roster and training dates.
--
--   It is acceptable only because:
--     - each customer gets their own Crew deployment and their own anon key,
--       so the key is not shared between companies;
--     - crew access is READ-ONLY here - no policy below lets anon write;
--     - the pilot password gate still applies on top, in the app.
--
--   If a customer needs more than that, the answer is a separate Supabase
--   project for them, not a cleverer policy. Say so honestly when selling.

-- ---------------------------------------------------------------------------
-- Helper: which company is the signed-in admin in?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so it can read company_members regardless of that table's
-- own policies, and STABLE so Postgres calls it once per query rather than once
-- per row.
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.company_members
  where user_id = auth.uid()
  limit 1
$$;

-- Helper: the company a Crew app claims to be, from the request header.
-- Returns null when the header is absent or names a company that does not
-- exist - so a bad or missing header grants nothing rather than everything.
create or replace function public.header_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.companies c
  where c.slug = nullif(current_setting('request.headers', true)::json ->> 'x-avicore-company', '')
  limit 1
$$;

-- Is this company's subscription still current? Used for WRITES only.
-- Reads stay allowed past expiry: locking a customer out of their own duty
-- records because an invoice is late would be the wrong way to chase payment,
-- and this is a compliance system.
create or replace function public.company_active(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(expires_at is null or expires_at > now(), false)
  from public.companies where id = cid
$$;

-- ---------------------------------------------------------------------------
-- The policies
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'app_settings', 'pilot_experience', 'pilot_training',
    'pilot_duty_entries', 'pilot_roster', 'pilot_weekly_plan'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    -- Replace the old blanket policies. Named explicitly rather than dropped by
    -- pattern, so an unrelated policy someone added by hand is left alone.
    execute format('drop policy if exists "auth write %s" on public.%I', t, t);
    execute format('drop policy if exists "anon read %s" on public.%I', t, t);
    execute format('drop policy if exists "tenant admin %s" on public.%I', t, t);
    execute format('drop policy if exists "tenant crew read %s" on public.%I', t, t);

    -- ADMIN: full access, but only within their own company, and only while the
    -- subscription is current for anything that writes.
    execute format($f$
      create policy "tenant admin %s" on public.%I
        for all to authenticated
        using (company_id = public.current_company_id())
        with check (company_id = public.current_company_id()
                    and public.company_active(company_id))
    $f$, t, t);

    -- CREW: read-only, and only the company named in the request header.
    execute format($f$
      create policy "tenant crew read %s" on public.%I
        for select to anon
        using (company_id = public.header_company_id())
    $f$, t, t);
  end loop;
end $$;

-- crew_login_events is insert-only for anon (it is an audit trail the crew
-- cannot read back), so it gets its own pair rather than the loop's.
alter table public.crew_login_events enable row level security;
drop policy if exists "anon insert crew_login_events" on public.crew_login_events;
drop policy if exists "tenant crew insert login" on public.crew_login_events;
drop policy if exists "tenant admin read login" on public.crew_login_events;

create policy "tenant crew insert login" on public.crew_login_events
  for insert to anon
  with check (company_id = public.header_company_id());

create policy "tenant admin read login" on public.crew_login_events
  for select to authenticated
  using (company_id = public.current_company_id());

-- ---------------------------------------------------------------------------
-- The company tables themselves
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.company_members enable row level security;

drop policy if exists "read own company" on public.companies;
create policy "read own company" on public.companies
  for select to authenticated
  using (id = public.current_company_id());

-- Crew needs to resolve its own slug at sign-in, and nothing more.
drop policy if exists "anon read own company" on public.companies;
create policy "anon read own company" on public.companies
  for select to anon
  using (id = public.header_company_id());

drop policy if exists "read own membership" on public.company_members;
create policy "read own membership" on public.company_members
  for select to authenticated
  using (user_id = auth.uid());

-- Deliberately NO insert/update policy on either table. Adding a company or an
-- admin is done with the service-role key, by whoever runs AviCore - not from
-- inside the app, where a compromised admin account could otherwise add itself
-- to another company.
