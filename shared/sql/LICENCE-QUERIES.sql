-- ===========================================================================
-- AviCore — Licence queries
-- ===========================================================================
--
-- Open Supabase -> SQL Editor -> New query, paste the ONE query you want, Run.
--
-- Save the ones you use often with Supabase's "Save query" button; they then
-- sit in the left sidebar and run with a single click.
--
-- Only run one block at a time. Everything below the line you highlight will
-- also run if you select more than one.
--
-- CONTENTS
--   1. See every customer and when they expire      (safe, read-only)
--   2. Renew a licence by 1 year
--   3. Renew to a specific date
--   4. Add a new customer
--   5. Remove an expiry (make perpetual) - read the warning first
--   6. Who are the admins of each company           (safe, read-only)
--
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. SEE EVERY CUSTOMER  (read-only, run this any time)
-- ---------------------------------------------------------------------------
-- Sorted so the most urgent is at the top: already expired first, then the
-- soonest to expire. Perpetual licences sort last - they need no attention.

select
  name                                     as "Company",
  slug                                     as "Slug",
  to_char(expires_at, 'DD Mon YYYY')       as "Expires",
  case
    when expires_at is null      then 'ไม่มีวันหมดอายุ / perpetual'
    when expires_at <= now()     then 'หมดอายุแล้ว / EXPIRED ' ||
                                      (current_date - expires_at::date) || ' วัน'
    when expires_at <= now() + interval '30 days'
                                 then 'ใกล้หมด / expiring in ' ||
                                      (expires_at::date - current_date) || ' วัน'
    else                              (expires_at::date - current_date) || ' วัน'
  end                                      as "Status",
  (select count(*) from public.company_members m where m.company_id = c.id)
                                           as "Admins"
from public.companies c
order by
  (expires_at is null),        -- perpetual last
  expires_at;                  -- then soonest first


-- ---------------------------------------------------------------------------
-- 2. RENEW BY 1 YEAR
-- ---------------------------------------------------------------------------
-- Change the slug, then run.
--
-- greatest(expires_at, now()) is the important part: renewing EARLY extends
-- from the existing expiry, so time already paid for is not thrown away. A
-- licence that already lapsed restarts from today instead.
--
-- coalesce(...) handles a perpetual licence: without it, expires_at = null
-- would stay null and the renewal would silently do nothing.

update public.companies
set expires_at = greatest(coalesce(expires_at, now()), now()) + interval '1 year'
where slug = 'uoa'                       -- <<< change me
returning name, slug, to_char(expires_at, 'DD Mon YYYY') as new_expiry;


-- ---------------------------------------------------------------------------
-- 3. RENEW TO A SPECIFIC DATE
-- ---------------------------------------------------------------------------
-- 23:59:59 so the customer keeps the whole of their last day.

update public.companies
set expires_at = '2027-08-07 23:59:59+07'::timestamptz   -- <<< change me
where slug = 'uoa'                                       -- <<< change me
returning name, slug, to_char(expires_at, 'DD Mon YYYY') as new_expiry;


-- ---------------------------------------------------------------------------
-- 4. ADD A NEW CUSTOMER
-- ---------------------------------------------------------------------------
-- The slug gets baked into their Crew/Android build as VITE_COMPANY_SLUG and
-- cannot be changed later without rebuilding their apps. Lowercase, no spaces.
--
-- ALWAYS set expires_at. Leaving it null means "never expires" - a free
-- perpetual licence, with nothing anywhere that looks wrong.
--
-- After this, work through NEW-CUSTOMER-CHECKLIST.md: the company exists but
-- still has UOA's FTL limits, training rules and fatigue criteria until their
-- admin sets their own.

insert into public.companies (name, slug, expires_at)
values (
  'XYZ Aviation Co., Ltd.',                    -- <<< company name
  'xyz-air',                                   -- <<< slug
  '2027-08-07 23:59:59+07'::timestamptz        -- <<< expiry, NOT null
)
returning id, name, slug, to_char(expires_at, 'DD Mon YYYY') as expires;


-- ---------------------------------------------------------------------------
-- 5. REMOVE THE EXPIRY (make it perpetual)
-- ---------------------------------------------------------------------------
-- !! Only for your OWN company (UOA). !!
--
-- A null expiry means the licence never expires and the app never warns. For a
-- paying customer this is a free licence for life. This is how UOA is set up
-- today, which is correct - UOA does not invoice itself.

update public.companies
set expires_at = null
where slug = 'uoa'                       -- <<< change me
returning name, slug, expires_at;


-- ---------------------------------------------------------------------------
-- 6. WHO ARE THE ADMINS  (read-only)
-- ---------------------------------------------------------------------------
-- Useful when a customer says "nobody can log in" - if a company has 0 admins,
-- their account was never linked after signing up.

select
  c.name                             as "Company",
  c.slug                             as "Slug",
  u.email                            as "Admin email",
  m.role                             as "Role",
  to_char(m.created_at, 'DD Mon YYYY') as "Added"
from public.companies c
left join public.company_members m on m.company_id = c.id
left join auth.users u             on u.id = m.user_id
order by c.name, u.email;
