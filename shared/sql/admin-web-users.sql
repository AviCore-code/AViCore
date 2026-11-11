-- Admin web access managed from Admin Setting -> Admin Users.
--
-- Until now the Admin web let in only the emails hard-coded in
-- src/config/adminAllowlist.js. This adds a per-person switch on the existing
-- membership row, so admins can be added, changed and removed from the app
-- (via the avicore-admin-users Edge Function) without a rebuild.
--
-- company_members.role is NOT reused: Edge Functions (line-test-message,
-- knowledge-search) already read it as "admin"/"owner", and changing it would
-- change who may use those features.
--
-- Run once in Supabase -> SQL Editor. Safe to run twice.

alter table public.company_members
  add column if not exists admin_web boolean not null default false;

-- Start with exactly the people who can sign in today. Everyone else stays a
-- member with Admin web access OFF until an admin turns it on.
update public.company_members m
   set admin_web = true
  from auth.users u
 where u.id = m.user_id
   and lower(u.email) in ('weera@uoathai.com', 'thitiwaree@uoathai.com');

-- Check: the two above should show admin_web = true, the rest false.
select u.email, m.role, m.admin_web
from public.company_members m
join auth.users u on u.id = m.user_id
order by m.admin_web desc, u.email;
