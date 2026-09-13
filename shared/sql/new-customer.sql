-- ===========================================================================
-- NEW CUSTOMER — create a company and its first admin
-- ===========================================================================
--
-- Run this ONCE per customer in the Supabase SQL Editor.
--
-- Read NEW-CUSTOMER-CHECKLIST.md alongside this file. The SQL here only
-- creates the company row. It does NOT set the customer's FTL limits,
-- fatigue criteria or training due-date rules — those default to UOA's
-- values and MUST be reviewed in the app afterwards. See the checklist.
--
-- ---------------------------------------------------------------------------
-- STEP 1 — fill these in
-- ---------------------------------------------------------------------------
-- Find every line marked  <<<  below and replace the value.
-- The slug appears in FOUR places and they must all match.
--
--   slug        short, lowercase, no spaces. Baked into the Crew/Android build
--               as VITE_COMPANY_SLUG. Cannot be changed later without
--               rebuilding their apps, so choose carefully.
--   name        shown on the Licence card and on printed reports.
--   expires_at  subscription end date. See the warning below.
--
-- Tip: use your editor's Find & Replace to change  xyz-air  to the real slug
-- in one go, then check the four <<< lines by eye.

-- ---------------------------------------------------------------------------
-- STEP 2 — create the company
-- ---------------------------------------------------------------------------
--
-- !! expires_at IS DELIBERATELY NOT NULL-ABLE HERE !!
--
-- In the companies table, expires_at is nullable and null means "never
-- expires" (see company_active() in multi-tenant-02-rls.sql). That is correct
-- for UOA, the operator's own company. For a PAYING CUSTOMER, leaving it null
-- grants a perpetual licence by accident — the app will never warn, never
-- expire, and nothing will look wrong.
--
-- So this insert names expires_at explicitly and the check below refuses to
-- proceed if it was left empty.

insert into public.companies (slug, name, expires_at)
values (
  'xyz-air',                      -- <<< slug
  'XYZ Aviation Co., Ltd.',       -- <<< name
  '2027-08-07'::timestamptz       -- <<< expiry  (NOT null — see above)
)
on conflict (slug) do update
  set name       = excluded.name,
      expires_at = excluded.expires_at
returning id, slug, name, expires_at;

-- Guard: fail loudly rather than silently shipping a free perpetual licence.
do $$
declare v_exp timestamptz; v_slug text := 'xyz-air';   -- <<< same slug
begin
  select expires_at into v_exp from public.companies where slug = v_slug;
  if v_exp is null then
    raise exception
      'Company "%" has no expires_at. Null means NEVER EXPIRES. Set a real date.', v_slug;
  end if;
  if v_exp <= now() then
    raise exception
      'Company "%" expires at % which is not in the future — writes are already blocked.',
      v_slug, v_exp;
  end if;
  raise notice 'OK: company % expires %', v_slug, v_exp;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — link the customer's admin account
-- ---------------------------------------------------------------------------
--
-- The admin must sign up FIRST (they create the password themselves — never
-- set it for them). Once their account exists in auth.users, run this to put
-- them in the company.
--
-- Repeat the insert for each additional admin.

insert into public.company_members (user_id, company_id, role)
select u.id, c.id, 'admin'
from auth.users u
cross join public.companies c
where u.email = 'admin@xyz-air.com'   -- <<< their login email
  and c.slug  = 'xyz-air'             -- <<< same slug
on conflict (user_id, company_id) do nothing;

-- Verify the link worked. Should return exactly one row.
select u.email, c.name, c.slug, m.role, c.expires_at
from public.company_members m
join auth.users u       on u.id = m.user_id
join public.companies c on c.id = m.company_id
where c.slug = 'xyz-air';             -- <<< same slug

-- ---------------------------------------------------------------------------
-- STEP 4 — confirm isolation
-- ---------------------------------------------------------------------------
-- Every company should show its own row count, and no company should see
-- another's. Run multi-tenant-03-verify.sql for the full check.

select c.slug, c.name, c.expires_at,
       (select count(*) from public.company_members m where m.company_id = c.id) as admins,
       (select count(*) from public.app_settings s   where s.company_id = c.id) as settings_rows
from public.companies c
order by c.created_at;

-- ===========================================================================
-- AFTER THIS FILE
-- ===========================================================================
-- The company exists but has NO settings of its own yet. Until an admin saves
-- them from the app, this customer inherits the built-in defaults, which are
-- modelled on UOA's operation.
--
-- Go to NEW-CUSTOMER-CHECKLIST.md and work through Part B before letting the
-- customer produce any document for CAAT.
-- ===========================================================================
