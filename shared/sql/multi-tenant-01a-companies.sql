-- MULTI-TENANT, STEP 1a: the company tables only.
--
-- Split out of the original step 1, which tried to alter seven tables in one
-- transaction and hit Supabase's statement timeout - pilot_duty_entries alone
-- holds ~16,600 rows, and SET NOT NULL rescans the whole table.
--
-- Run 1a, then 1b, then 1c-... in order. Each is small enough to finish well
-- inside the timeout, and each is safe to re-run if you lose your place.
--
-- Nothing here touches existing data. It only creates two new tables.

-- ---------------------------------------------------------------------------
-- 1. The companies
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- The Crew web app signs in with the ANON key and has no user account, so it
  -- cannot be identified the way an admin is. It sends this slug instead, set
  -- once per deployment.
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  -- Subscription control. Null = no expiry. A past date blocks writes; reads
  -- keep working, so a customer whose invoice is late can still see their own
  -- duty records rather than being locked out of a compliance system.
  expires_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- 2. Who belongs to which company
-- ---------------------------------------------------------------------------
create table if not exists public.company_members (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        text not null default 'admin',
  created_at  timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- ---------------------------------------------------------------------------
-- 3. The existing customer
-- ---------------------------------------------------------------------------
-- Fixed id so the backfill in later steps is repeatable - running any of these
-- files twice cannot create a second company or re-assign anything.
insert into public.companies (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'United Offshore Aviation', 'uoa')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Link every existing admin to it
-- ---------------------------------------------------------------------------
-- Without this they would lose access the moment the RLS step is applied.
insert into public.company_members (user_id, company_id)
select id, '00000000-0000-0000-0000-000000000001'
from auth.users
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- CHECK
-- ---------------------------------------------------------------------------
-- Every admin who needs access must appear here with a company name:
select u.email, c.name as company
from auth.users u
left join public.company_members m on m.user_id = u.id
left join public.companies c on c.id = m.company_id
order by u.email;
