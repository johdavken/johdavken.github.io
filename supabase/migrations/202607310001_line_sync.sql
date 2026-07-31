begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'line_workspace_role') then
    create type public.line_workspace_role as enum ('owner', 'member');
  end if;
end
$$;

create table public.line_workspaces (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.line_workspace_members (
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  device_label text not null check (char_length(btrim(device_label)) between 1 and 80),
  role public.line_workspace_role not null default 'member',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  unique (workspace_id, device_id)
);

create unique index line_workspace_one_owner_uidx
  on public.line_workspace_members (workspace_id)
  where role = 'owner';

create index line_workspace_members_user_idx
  on public.line_workspace_members (user_id, workspace_id);

create table public.active_jobs (
  workspace_id uuid primary key references public.line_workspaces(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  last_operation_id uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object'),
  check (octet_length(payload::text) <= 131072)
);

create table public.saved_setups (
  id uuid primary key,
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  normalized_name text not null,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  last_operation_id uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (jsonb_typeof(payload) = 'object'),
  check (octet_length(payload::text) <= 262144)
);

create unique index saved_setups_active_name_uidx
  on public.saved_setups (workspace_id, normalized_name)
  where deleted_at is null;

create index saved_setups_workspace_updated_idx
  on public.saved_setups (workspace_id, updated_at);

create table private.line_sync_secrets (
  singleton boolean primary key default true check (singleton),
  link_code_pepper bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default now()
);

insert into private.line_sync_secrets(singleton)
values (true)
on conflict (singleton) do nothing;

create table private.workspace_link_codes (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  code_digest bytea not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index workspace_link_codes_expiry_idx on private.workspace_link_codes(expires_at);
create index workspace_link_codes_workspace_idx on private.workspace_link_codes(workspace_id);

create table private.link_attempt_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0)
);

create or replace function private.current_user_is_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.line_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.current_user_is_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.line_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'::public.line_workspace_role
  );
$$;

create or replace function private.normalize_setup_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function private.assert_authenticated()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  return v_user_id;
end;
$$;

create or replace function private.assert_active_job_payload(p_payload jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line_type integer;
  v_expected_layers integer;
  v_layer jsonb;
  v_hopper jsonb;
  v_layer_total numeric := 0;
  v_hopper_total numeric;
  v_layer_count integer;
  v_expected_names text[];
  v_actual_names text[];
  v_key text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'active_job_must_be_an_object';
  end if;
  if octet_length(p_payload::text) > 131072 then
    raise exception using errcode = '22023', message = 'active_job_too_large';
  end if;

  begin
    v_line_type := (p_payload->>'lineType')::integer;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid_line_type';
  end;
  if v_line_type not in (1, 3, 5) then
    raise exception using errcode = '22023', message = 'invalid_line_type';
  end if;
  v_expected_layers := v_line_type;
  v_expected_names := case v_line_type
    when 1 then array['A']
    when 3 then array['A','B','C']
    else array['A','B','C','D','E']
  end;

  if jsonb_typeof(p_payload->'layers') <> 'array'
     or jsonb_array_length(p_payload->'layers') <> v_expected_layers then
    raise exception using errcode = '22023', message = 'invalid_layers';
  end if;
  if jsonb_typeof(p_payload->'offsets') <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_offsets';
  end if;
  if coalesce(p_payload->>'hopperNamingLine9', 'standard') not in ('standard', 'main') then
    raise exception using errcode = '22023', message = 'invalid_hopper_naming';
  end if;
  if coalesce(p_payload->>'changeoverTime', '') <> ''
     and (p_payload->>'changeoverTime') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception using errcode = '22023', message = 'invalid_changeover_time';
  end if;

  foreach v_key in array array['lineRate', 'gauge', 'prodResinLb', 'scrapResinLb'] loop
    if not (p_payload ? v_key)
       or jsonb_typeof(p_payload->v_key) <> 'number'
       or (p_payload->>v_key)::numeric < 0 then
      raise exception using errcode = '22023', message = 'invalid_numeric_job_field';
    end if;
  end loop;

  foreach v_key in array v_expected_names loop
    if not ((p_payload->'offsets') ? v_key)
       or jsonb_typeof((p_payload->'offsets')->v_key) <> 'number'
       or ((p_payload->'offsets')->>v_key)::numeric < 0 then
      raise exception using errcode = '22023', message = 'invalid_offset';
    end if;
  end loop;

  for v_layer in select value from jsonb_array_elements(p_payload->'layers') loop
    if jsonb_typeof(v_layer) <> 'object'
       or coalesce(v_layer->>'name', '') !~ '^[A-E]$'
       or not (v_layer ? 'layerPct')
       or jsonb_typeof(v_layer->'layerPct') <> 'number'
       or (v_layer->>'layerPct')::numeric not between 0 and 100
       or jsonb_typeof(v_layer->'hoppers') <> 'array'
       or jsonb_array_length(v_layer->'hoppers') <> 6 then
      raise exception using errcode = '22023', message = 'invalid_layer';
    end if;

    v_layer_total := v_layer_total + (v_layer->>'layerPct')::numeric;
    v_hopper_total := 0;
    for v_hopper in select value from jsonb_array_elements(v_layer->'hoppers') loop
      if jsonb_typeof(v_hopper) <> 'object'
         or not (v_hopper ? 'pct')
         or jsonb_typeof(v_hopper->'pct') <> 'number'
         or (v_hopper->>'pct')::numeric not between 0 and 100
         or not (v_hopper ? 'weight')
         or jsonb_typeof(v_hopper->'weight') <> 'number'
         or (v_hopper->>'weight')::numeric < 0
         or (v_hopper ? 'resinName' and jsonb_typeof(v_hopper->'resinName') <> 'string')
         or char_length(coalesce(v_hopper->>'resinName', '')) > 100
         or (v_hopper ? 'track' and jsonb_typeof(v_hopper->'track') <> 'boolean')
         or (v_hopper ? 'pumpOff' and jsonb_typeof(v_hopper->'pumpOff') <> 'boolean') then
        raise exception using errcode = '22023', message = 'invalid_hopper';
      end if;
      v_hopper_total := v_hopper_total + (v_hopper->>'pct')::numeric;
    end loop;
    if v_hopper_total > 100.0001 then
      raise exception using errcode = '22023', message = 'hopper_percentages_cannot_exceed_100';
    end if;
  end loop;

  select count(distinct value->>'name'), array_agg(value->>'name' order by value->>'name')
  into v_layer_count, v_actual_names
  from jsonb_array_elements(p_payload->'layers');
  if v_layer_count <> v_expected_layers or v_actual_names <> v_expected_names
     or v_layer_total > 100.0001 then
    raise exception using errcode = '22023', message = 'invalid_layer_percentages';
  end if;
end;
$$;

create or replace function private.assert_saved_setup_payload(p_payload jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if octet_length(coalesce(p_payload, '{}'::jsonb)::text) > 262144 then
    raise exception using errcode = '22023', message = 'saved_setup_too_large';
  end if;
  perform private.assert_active_job_payload(p_payload);
end;
$$;

create or replace function private.generate_unambiguous_link_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_result text := '';
  v_value integer;
begin
  while char_length(v_result) < 4 loop
    v_value := get_byte(extensions.gen_random_bytes(1), 0);
    if v_value < 248 then
      v_result := v_result || substr(v_alphabet, (v_value % 31) + 1, 1);
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function private.link_code_digest(p_code text)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.hmac(
    convert_to(upper(btrim(p_code)), 'UTF8'),
    s.link_code_pepper,
    'sha256'
  )
  from private.line_sync_secrets s
  where s.singleton;
$$;

alter table public.line_workspaces enable row level security;
alter table public.line_workspaces force row level security;
alter table public.line_workspace_members enable row level security;
alter table public.line_workspace_members force row level security;
alter table public.active_jobs enable row level security;
alter table public.active_jobs force row level security;
alter table public.saved_setups enable row level security;
alter table public.saved_setups force row level security;

create policy line_workspaces_member_select
on public.line_workspaces for select to authenticated
using (private.current_user_is_member(id));

create policy line_workspace_members_select
on public.line_workspace_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.current_user_is_owner(workspace_id)
);

create policy active_jobs_member_select
on public.active_jobs for select to authenticated
using (private.current_user_is_member(workspace_id));

create policy saved_setups_member_select
on public.saved_setups for select to authenticated
using (private.current_user_is_member(workspace_id));

revoke all on public.line_workspaces from anon, authenticated;
revoke all on public.line_workspace_members from anon, authenticated;
revoke all on public.active_jobs from anon, authenticated;
revoke all on public.saved_setups from anon, authenticated;

grant select on public.line_workspaces to authenticated;
grant select on public.line_workspace_members to authenticated;
grant select on public.active_jobs to authenticated;
grant select on public.saved_setups to authenticated;

create or replace function public.create_workspace(
  p_name text,
  p_device_id uuid,
  p_device_label text,
  p_initial_active_job jsonb,
  p_operation_id uuid
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_revision bigint,
  active_job_revision bigint,
  is_owner boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_workspace public.line_workspaces;
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
     or char_length(btrim(coalesce(p_device_label, ''))) not between 1 and 80
     or p_device_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_input';
  end if;
  perform private.assert_active_job_payload(p_initial_active_job);

  insert into public.line_workspaces(name, created_by)
  values (regexp_replace(btrim(p_name), '\s+', ' ', 'g'), v_user_id)
  returning * into v_workspace;

  insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
  values (v_workspace.id, v_user_id, p_device_id,
          regexp_replace(btrim(p_device_label), '\s+', ' ', 'g'), 'owner');

  insert into public.active_jobs(workspace_id, payload, last_operation_id, updated_by)
  values (v_workspace.id, p_initial_active_job, p_operation_id, v_user_id);

  return query select v_workspace.id, v_workspace.name, v_workspace.revision, 1::bigint, true;
end;
$$;

create or replace function public.rename_workspace(
  p_workspace_id uuid,
  p_name text,
  p_expected_revision bigint
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_authenticated();
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_workspace_name';
  end if;

  return query
  update public.line_workspaces w
  set name = regexp_replace(btrim(p_name), '\s+', ' ', 'g'),
      revision = w.revision + 1,
      updated_at = now()
  where w.id = p_workspace_id and w.revision = p_expected_revision
  returning w.id, w.name, w.revision, w.updated_at;

  if not found then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;
end;
$$;

create or replace function public.generate_link_code(p_workspace_id uuid)
returns table (link_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_code text;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  delete from private.workspace_link_codes where expires_at <= now() or workspace_id = p_workspace_id;
  loop
    v_code := private.generate_unambiguous_link_code();
    begin
      insert into private.workspace_link_codes(workspace_id, code_digest, created_by, expires_at)
      values (p_workspace_id, private.link_code_digest(v_code), v_user_id, v_expires);
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;
  return query select v_code, v_expires;
end;
$$;

create or replace function public.join_workspace(
  p_link_code text,
  p_device_id uuid,
  p_device_label text
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_revision bigint,
  active_job_payload jsonb,
  active_job_revision bigint,
  is_owner boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_workspace_id uuid;
  v_attempt private.link_attempt_limits;
begin
  if p_device_id is null
     or char_length(btrim(coalesce(p_device_label, ''))) not between 1 and 80
     or upper(btrim(coalesce(p_link_code, ''))) !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$' then
    return;
  end if;

  insert into private.link_attempt_limits(user_id, window_started_at, failed_attempts)
  values (v_user_id, now(), 0)
  on conflict (user_id) do nothing;

  select * into v_attempt
  from private.link_attempt_limits
  where user_id = v_user_id
  for update;

  if v_attempt.window_started_at < now() - interval '15 minutes' then
    update private.link_attempt_limits
    set window_started_at = now(), failed_attempts = 0
    where user_id = v_user_id;
    v_attempt.failed_attempts := 0;
  end if;
  if v_attempt.failed_attempts >= 5 then
    return;
  end if;

  delete from private.workspace_link_codes c
  where c.code_digest = private.link_code_digest(p_link_code)
    and c.expires_at > now()
  returning c.workspace_id into v_workspace_id;

  if v_workspace_id is null then
    update private.link_attempt_limits
    set failed_attempts = failed_attempts + 1
    where user_id = v_user_id;
    return;
  end if;

  insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
  values (v_workspace_id, v_user_id, p_device_id,
          regexp_replace(btrim(p_device_label), '\s+', ' ', 'g'), 'member')
  on conflict (workspace_id, user_id) do update
  set device_id = excluded.device_id,
      device_label = excluded.device_label,
      last_seen_at = now();

  delete from private.link_attempt_limits where user_id = v_user_id;

  return query
  select w.id, w.name, w.revision, a.payload, a.revision,
         m.role = 'owner'::public.line_workspace_role
  from public.line_workspaces w
  join public.active_jobs a on a.workspace_id = w.id
  join public.line_workspace_members m on m.workspace_id = w.id and m.user_id = v_user_id
  where w.id = v_workspace_id;
end;
$$;

create or replace function public.update_active_job(
  p_workspace_id uuid,
  p_payload jsonb,
  p_expected_revision bigint,
  p_operation_id uuid
)
returns table (
  workspace_id uuid,
  payload jsonb,
  revision bigint,
  operation_id uuid,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  perform private.assert_active_job_payload(p_payload);

  return query
  select a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by
  from public.active_jobs a
  where a.workspace_id = p_workspace_id and a.last_operation_id = p_operation_id;
  if found then return; end if;

  return query
  update public.active_jobs a
  set payload = p_payload,
      revision = a.revision + 1,
      last_operation_id = p_operation_id,
      updated_at = now(),
      updated_by = v_user_id
  where a.workspace_id = p_workspace_id and a.revision = p_expected_revision
  returning a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by;

  if not found then
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;
end;
$$;

create or replace function public.create_saved_setup(
  p_workspace_id uuid,
  p_setup_id uuid,
  p_name text,
  p_payload jsonb,
  p_operation_id uuid
)
returns table (setup_id uuid, name text, payload jsonb, revision bigint, operation_id uuid, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if p_setup_id is null or p_operation_id is null or char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_saved_setup_input';
  end if;
  perform private.assert_saved_setup_payload(p_payload);

  return query select s.id, s.name, s.payload, s.revision, s.last_operation_id, s.updated_at
  from public.saved_setups s where s.id = p_setup_id and s.last_operation_id = p_operation_id;
  if found then return; end if;

  insert into public.saved_setups as s(id, workspace_id, name, normalized_name, payload, last_operation_id, updated_by)
  values (p_setup_id, p_workspace_id, regexp_replace(btrim(p_name), '\s+', ' ', 'g'),
          private.normalize_setup_name(p_name), p_payload, p_operation_id, v_user_id)
  returning s.id, s.name, s.payload, s.revision, s.last_operation_id, s.updated_at
  into setup_id, name, payload, revision, operation_id, updated_at;
  return next;
end;
$$;

create or replace function public.update_saved_setup(
  p_workspace_id uuid, p_setup_id uuid, p_payload jsonb,
  p_expected_revision bigint, p_operation_id uuid
)
returns table (setup_id uuid, name text, payload jsonb, revision bigint, operation_id uuid, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if not private.current_user_is_member(p_workspace_id) then raise exception using errcode='42501', message='workspace_access_denied'; end if;
  perform private.assert_saved_setup_payload(p_payload);
  return query select s.id, s.name, s.payload, s.revision, s.last_operation_id, s.updated_at
  from public.saved_setups s where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.last_operation_id=p_operation_id;
  if found then return; end if;
  return query update public.saved_setups s
  set payload=p_payload, revision=s.revision+1, last_operation_id=p_operation_id,
      updated_by=v_user_id, updated_at=now()
  where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.revision=p_expected_revision and s.deleted_at is null
  returning s.id,s.name,s.payload,s.revision,s.last_operation_id,s.updated_at;
  if not found then raise exception using errcode='40001', message='revision_conflict'; end if;
end;
$$;

create or replace function public.rename_saved_setup(
  p_workspace_id uuid, p_setup_id uuid, p_name text,
  p_expected_revision bigint, p_operation_id uuid
)
returns table (setup_id uuid, name text, payload jsonb, revision bigint, operation_id uuid, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if not private.current_user_is_member(p_workspace_id) then raise exception using errcode='42501', message='workspace_access_denied'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 1 and 100 then raise exception using errcode='22023', message='invalid_saved_setup_name'; end if;
  return query select s.id,s.name,s.payload,s.revision,s.last_operation_id,s.updated_at
  from public.saved_setups s where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.last_operation_id=p_operation_id;
  if found then return; end if;
  return query update public.saved_setups s
  set name=regexp_replace(btrim(p_name),'\s+',' ','g'), normalized_name=private.normalize_setup_name(p_name),
      revision=s.revision+1,last_operation_id=p_operation_id,updated_by=v_user_id,updated_at=now()
  where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.revision=p_expected_revision and s.deleted_at is null
  returning s.id,s.name,s.payload,s.revision,s.last_operation_id,s.updated_at;
  if not found then raise exception using errcode='40001', message='revision_conflict'; end if;
end;
$$;

create or replace function public.delete_saved_setup(
  p_workspace_id uuid, p_setup_id uuid, p_expected_revision bigint, p_operation_id uuid
)
returns table (setup_id uuid, revision bigint, operation_id uuid, deleted_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if not private.current_user_is_member(p_workspace_id) then raise exception using errcode='42501', message='workspace_access_denied'; end if;
  return query select s.id,s.revision,s.last_operation_id,s.deleted_at
  from public.saved_setups s where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.last_operation_id=p_operation_id;
  if found then return; end if;
  return query update public.saved_setups s
  set deleted_at=now(),revision=s.revision+1,last_operation_id=p_operation_id,updated_by=v_user_id,updated_at=now()
  where s.id=p_setup_id and s.workspace_id=p_workspace_id and s.revision=p_expected_revision and s.deleted_at is null
  returning s.id,s.revision,s.last_operation_id,s.deleted_at;
  if not found then raise exception using errcode='40001', message='revision_conflict'; end if;
end;
$$;

create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_authenticated();
  perform 1 from public.line_workspaces where id=p_workspace_id for update;
  if not private.current_user_is_owner(p_workspace_id) then raise exception using errcode='42501', message='owner_access_required'; end if;
  if not exists(select 1 from public.line_workspace_members where workspace_id=p_workspace_id and user_id=p_new_owner_user_id) then
    raise exception using errcode='22023', message='new_owner_must_be_a_member';
  end if;
  update public.line_workspace_members set role='member'
  where workspace_id=p_workspace_id and role='owner';
  update public.line_workspace_members set role='owner'
  where workspace_id=p_workspace_id and user_id=p_new_owner_user_id;
end;
$$;

create or replace function public.update_device_label(p_workspace_id uuid, p_device_label text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if char_length(btrim(coalesce(p_device_label, ''))) not between 1 and 80 then
    raise exception using errcode='22023', message='invalid_device_label';
  end if;
  update public.line_workspace_members
  set device_label=regexp_replace(btrim(p_device_label),'\s+',' ','g'), last_seen_at=now()
  where workspace_id=p_workspace_id and user_id=v_user_id;
  if not found then raise exception using errcode='42501', message='workspace_access_denied'; end if;
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid := private.assert_authenticated();
begin
  if private.current_user_is_owner(p_workspace_id) then raise exception using errcode='42501', message='transfer_ownership_before_leaving'; end if;
  delete from public.line_workspace_members where workspace_id=p_workspace_id and user_id=v_user_id;
end;
$$;

create or replace function public.remove_workspace_member(p_workspace_id uuid, p_member_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_authenticated();
  if not private.current_user_is_owner(p_workspace_id) then raise exception using errcode='42501', message='owner_access_required'; end if;
  if exists(select 1 from public.line_workspace_members where workspace_id=p_workspace_id and user_id=p_member_user_id and role='owner') then
    raise exception using errcode='42501', message='owner_cannot_be_removed';
  end if;
  delete from public.line_workspace_members where workspace_id=p_workspace_id and user_id=p_member_user_id;
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid, p_expected_revision bigint)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.assert_authenticated();
  if not private.current_user_is_owner(p_workspace_id) then raise exception using errcode='42501', message='owner_access_required'; end if;
  delete from public.line_workspaces where id=p_workspace_id and revision=p_expected_revision;
  if not found then raise exception using errcode='40001', message='revision_conflict'; end if;
end;
$$;

revoke all on function public.create_workspace(text,uuid,text,jsonb,uuid) from public, anon;
revoke all on function public.rename_workspace(uuid,text,bigint) from public, anon;
revoke all on function public.generate_link_code(uuid) from public, anon;
revoke all on function public.join_workspace(text,uuid,text) from public, anon;
revoke all on function public.update_active_job(uuid,jsonb,bigint,uuid) from public, anon;
revoke all on function public.create_saved_setup(uuid,uuid,text,jsonb,uuid) from public, anon;
revoke all on function public.update_saved_setup(uuid,uuid,jsonb,bigint,uuid) from public, anon;
revoke all on function public.rename_saved_setup(uuid,uuid,text,bigint,uuid) from public, anon;
revoke all on function public.delete_saved_setup(uuid,uuid,bigint,uuid) from public, anon;
revoke all on function public.transfer_workspace_ownership(uuid,uuid) from public, anon;
revoke all on function public.update_device_label(uuid,text) from public, anon;
revoke all on function public.leave_workspace(uuid) from public, anon;
revoke all on function public.remove_workspace_member(uuid,uuid) from public, anon;
revoke all on function public.delete_workspace(uuid,bigint) from public, anon;
grant execute on function public.create_workspace(text,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.rename_workspace(uuid,text,bigint) to authenticated;
grant execute on function public.generate_link_code(uuid) to authenticated;
grant execute on function public.join_workspace(text,uuid,text) to authenticated;
grant execute on function public.update_active_job(uuid,jsonb,bigint,uuid) to authenticated;
grant execute on function public.create_saved_setup(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.update_saved_setup(uuid,uuid,jsonb,bigint,uuid) to authenticated;
grant execute on function public.rename_saved_setup(uuid,uuid,text,bigint,uuid) to authenticated;
grant execute on function public.delete_saved_setup(uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.transfer_workspace_ownership(uuid,uuid) to authenticated;
grant execute on function public.update_device_label(uuid,text) to authenticated;
grant execute on function public.leave_workspace(uuid) to authenticated;
grant execute on function public.remove_workspace_member(uuid,uuid) to authenticated;
grant execute on function public.delete_workspace(uuid,bigint) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='line_workspaces') then
    alter publication supabase_realtime add table public.line_workspaces;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='line_workspace_members') then
    alter publication supabase_realtime add table public.line_workspace_members;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='active_jobs') then
    alter publication supabase_realtime add table public.active_jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='saved_setups') then
    alter publication supabase_realtime add table public.saved_setups;
  end if;
end
$$;

commit;
