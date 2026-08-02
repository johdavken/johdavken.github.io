begin;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.resins
  add constraint resins_resin_code_trimmed_check check (resin_code = btrim(resin_code));

alter table public.resins drop constraint if exists resins_density_g_cm3_check;
alter table public.resins
  add constraint resins_density_g_cm3_check
  check (density_g_cm3 is null or density_g_cm3 between 0.001 and 10);

alter table public.admin_users enable row level security;

create policy "Admins can verify their own access"
  on public.admin_users
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_resin_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_resin_admin() from public, anon;
grant execute on function public.is_resin_admin() to authenticated;

create policy "Resin admins can read all resins"
  on public.resins
  for select
  to authenticated
  using ((select public.is_resin_admin()));

create policy "Resin admins can insert resins"
  on public.resins
  for insert
  to authenticated
  with check ((select public.is_resin_admin()));

create policy "Resin admins can update resins"
  on public.resins
  for update
  to authenticated
  using ((select public.is_resin_admin()))
  with check ((select public.is_resin_admin()));

grant select on public.resins to anon, authenticated;
grant insert, update on public.resins to authenticated;
revoke delete on public.resins from anon, authenticated;
grant select on public.admin_users to authenticated;
revoke insert, update, delete on public.admin_users from anon, authenticated;

commit;
