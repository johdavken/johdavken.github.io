begin;

create table public.resins (
  id uuid primary key default extensions.gen_random_uuid(),
  resin_code text not null check (char_length(btrim(resin_code)) between 1 and 100),
  display_description text check (
    display_description is null
    or char_length(btrim(display_description)) between 1 and 500
  ),
  density_g_cm3 numeric(6,3) check (density_g_cm3 is null or density_g_cm3 > 0),
  information_description text check (
    information_description is null
    or char_length(btrim(information_description)) between 1 and 10000
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Resin codes are the application’s current resin-name identifier. Normalize
-- case and leading/trailing whitespace so alternate capitalization cannot
-- create a duplicate catalog record.
create unique index resins_resin_code_normalized_uidx
  on public.resins (lower(btrim(resin_code)));

create index resins_active_resin_code_idx
  on public.resins (resin_code)
  where is_active;

create or replace function public.set_resins_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger resins_set_updated_at
before update on public.resins
for each row execute function public.set_resins_updated_at();

alter table public.resins enable row level security;

create policy "Active resins are readable by app users"
  on public.resins
  for select
  to anon, authenticated
  using (is_active);

-- No insert, update, or delete policy is intentionally created. With RLS
-- enabled, anonymous and authenticated client roles cannot mutate this table.

revoke all on function public.set_resins_updated_at() from public, anon, authenticated;

commit;
