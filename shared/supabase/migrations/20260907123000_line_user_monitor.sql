create table if not exists public.admin_line_user_events (
 id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete set null, line_user_id text not null, line_group_id text, event_type text not null, display_name text, picture_url text, device_type text, device_name text, user_agent text, occurred_at timestamptz not null default now(), raw_event jsonb, created_at timestamptz not null default now()
);
create index if not exists admin_line_user_events_user_idx on public.admin_line_user_events(company_id,line_user_id,occurred_at desc);
create index if not exists admin_line_user_events_group_idx on public.admin_line_user_events(company_id,line_group_id,occurred_at desc);
alter table public.admin_line_user_events enable row level security;
grant select on public.admin_line_user_events to authenticated;
do $ begin if not exists (select 1 from pg_policies where tablename='admin_line_user_events' and policyname='admin_line_user_events_select') then create policy admin_line_user_events_select on public.admin_line_user_events for select to authenticated using (true); end if; end $;


