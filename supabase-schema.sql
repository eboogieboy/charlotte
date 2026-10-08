-- Charlotte's Film Diary: run in the SQL Editor of a SEPARATE Supabase project.
-- Each authenticated user can read/write ONLY their own diary.
create table if not exists public.charlotte_diaries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"version":1,"started":false,"queue":[],"currentId":null,"history":[]}'::jsonb,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  constraint diary_data_object check (jsonb_typeof(data) = 'object'),
  constraint diary_data_queue check (jsonb_typeof(data->'queue') = 'array'),
  constraint diary_data_history check (jsonb_typeof(data->'history') = 'array')
);

alter table public.charlotte_diaries enable row level security;

-- Existing policies: recreate safely if this script is re-run.
drop policy if exists "owner reads own diary" on public.charlotte_diaries;
drop policy if exists "owner inserts own diary" on public.charlotte_diaries;
drop policy if exists "owner updates own diary" on public.charlotte_diaries;
create policy "owner reads own diary" on public.charlotte_diaries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner inserts own diary" on public.charlotte_diaries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "owner updates own diary" on public.charlotte_diaries
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.charlotte_diaries from anon;
grant select, insert, update on table public.charlotte_diaries to authenticated;

-- No public policies; never use the service_role key in browser code.
-- Supabase Authentication > Providers: enable Email with Magic Link/OTP.
-- Configure Authentication > URL Configuration: set Site URL and Redirect URLs
-- to the published site including its GitHub Pages subpath (if applicable).