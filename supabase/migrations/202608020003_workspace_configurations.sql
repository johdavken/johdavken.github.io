begin;

create table public.workspace_configurations (
  id uuid primary key,
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  configuration_type text not null check (configuration_type in ('receiver_weight_profile', 'recipe')),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 100),
  normalized_name text not null check (char_length(normalized_name) between 1 and 100),
  schema_version integer not null check (schema_version = 1),
  payload jsonb not null,
  favorite boolean not null default false,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_configurations_workspace_type_name_key unique (workspace_id, configuration_type, normalized_name),
  check (jsonb_typeof(payload) = 'object'),
  check (octet_length(payload::text) <= 131072),
  check (configuration_type = 'recipe' or favorite = false)
);

create index workspace_configurations_workspace_type_updated_idx
  on public.workspace_configurations (workspace_id, configuration_type, updated_at desc);
create index workspace_configurations_workspace_type_favorite_name_idx
  on public.workspace_configurations (workspace_id, configuration_type, favorite, name);

create or replace function private.workspace_configuration_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.normalized_name := private.normalize_setup_name(new.name);
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger workspace_configurations_before_write
before insert or update on public.workspace_configurations
for each row execute function private.workspace_configuration_before_write();

create or replace function private.assert_workspace_configuration_payload(
  p_configuration_type text,
  p_schema_version integer,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line_type integer;
  v_expected_names text[];
  v_expected_layers integer;
  v_layer jsonb;
  v_hopper jsonb;
  v_index integer;
  v_hopper_index integer;
  v_layer_total numeric := 0;
  v_hopper_total numeric;
  v_secondary_total numeric;
begin
  if p_configuration_type not in ('receiver_weight_profile', 'recipe') then
    raise exception using errcode = '22023', message = 'invalid_configuration_type';
  end if;
  if p_schema_version <> 1 then
    raise exception using errcode = '22023', message = 'unsupported_workspace_configuration_schema_version';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'workspace_configuration_payload_must_be_an_object';
  end if;
  if octet_length(p_payload::text) > 131072 then
    raise exception using errcode = '22023', message = 'workspace_configuration_payload_too_large';
  end if;
  if jsonb_typeof(p_payload->'schema_version') <> 'number'
     or p_payload->>'schema_version' <> '1' then
    raise exception using errcode = '22023', message = 'unsupported_workspace_configuration_payload_schema_version';
  end if;
  if jsonb_typeof(p_payload->'line_type') <> 'number'
     or p_payload->>'line_type' not in ('1', '3', '5') then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_line_type';
  end if;
  if jsonb_typeof(p_payload->'hopper_naming_mode') <> 'string'
     or p_payload->>'hopper_naming_mode' not in ('standard', 'main') then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_hopper_naming_mode';
  end if;

  v_line_type := (p_payload->>'line_type')::integer;
  v_expected_names := case v_line_type
    when 1 then array['A']
    when 3 then array['A','B','C']
    when 5 then array['A','B','C','D','E']
  end;
  v_expected_layers := array_length(v_expected_names, 1);
  if jsonb_typeof(p_payload->'layers') <> 'array'
     or jsonb_array_length(p_payload->'layers') <> v_expected_layers then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_layers';
  end if;

  for v_index in 0..v_expected_layers - 1 loop
    v_layer := p_payload->'layers'->v_index;
    if jsonb_typeof(v_layer) <> 'object'
       or v_layer->>'name' <> v_expected_names[v_index + 1] then
      raise exception using errcode = '22023', message = 'invalid_workspace_configuration_layer_name';
    end if;

    if p_configuration_type = 'receiver_weight_profile' then
      if p_payload ? 'layer_pct' or p_payload ? 'hoppers'
         or v_layer ? 'layer_pct' or v_layer ? 'hoppers'
         or jsonb_typeof(p_payload->'hoppers_per_layer') <> 'number'
         or p_payload->>'hoppers_per_layer' <> '6'
         or jsonb_typeof(v_layer->'receiver_weights_lb') <> 'array'
         or jsonb_array_length(v_layer->'receiver_weights_lb') <> 6 then
        raise exception using errcode = '22023', message = 'invalid_receiver_weight_profile_payload';
      end if;
      for v_hopper_index in 0..5 loop
        if jsonb_typeof(v_layer->'receiver_weights_lb'->v_hopper_index) <> 'number'
           or (v_layer->'receiver_weights_lb'->>v_hopper_index)::numeric < 0 then
          raise exception using errcode = '22023', message = 'invalid_receiver_weight';
        end if;
      end loop;
    else
      if p_payload ? 'hoppers_per_layer'
         or v_layer ? 'receiver_weights_lb'
         or jsonb_typeof(v_layer->'layer_pct') <> 'number'
         or (v_layer->>'layer_pct')::numeric not between 0 and 100
         or jsonb_typeof(v_layer->'hoppers') <> 'array'
         or jsonb_array_length(v_layer->'hoppers') <> 6 then
        raise exception using errcode = '22023', message = 'invalid_recipe_layer';
      end if;
      v_layer_total := v_layer_total + (v_layer->>'layer_pct')::numeric;
      v_hopper_total := 0;
      v_secondary_total := 0;
      for v_hopper_index in 0..5 loop
        v_hopper := v_layer->'hoppers'->v_hopper_index;
        if jsonb_typeof(v_hopper) <> 'object'
           or not (v_hopper ? 'resin_name')
           or jsonb_typeof(v_hopper->'resin_name') not in ('null', 'string')
           or (jsonb_typeof(v_hopper->'resin_name') = 'string' and char_length(v_hopper->>'resin_name') > 100)
           or jsonb_typeof(v_hopper->'pct') <> 'number'
           or (v_hopper->>'pct')::numeric not between 0 and 100 then
          raise exception using errcode = '22023', message = 'invalid_recipe_hopper';
        end if;
        v_hopper_total := v_hopper_total + (v_hopper->>'pct')::numeric;
        if v_hopper_index > 0 then
          v_secondary_total := v_secondary_total + (v_hopper->>'pct')::numeric;
        end if;
      end loop;
      if v_secondary_total > 100.0001
         or abs(v_hopper_total - 100) > 0.0001
         or abs((v_layer->'hoppers'->0->>'pct')::numeric - (100 - v_secondary_total)) > 0.0001 then
        raise exception using errcode = '22023', message = 'invalid_recipe_hopper_percentages';
      end if;
    end if;
  end loop;

  if p_configuration_type = 'recipe' and abs(v_layer_total - 100) > 0.0001 then
    raise exception using errcode = '22023', message = 'invalid_recipe_layer_percentages';
  end if;
end;
$$;

alter table public.workspace_configurations enable row level security;
alter table public.workspace_configurations force row level security;

create policy workspace_configurations_member_select
on public.workspace_configurations for select to authenticated
using (private.current_user_is_member(workspace_id));

revoke all on public.workspace_configurations from anon, authenticated;
grant select on public.workspace_configurations to authenticated;

create or replace function public.create_workspace_configuration(
  p_workspace_id uuid,
  p_configuration_id uuid,
  p_configuration_type text,
  p_name text,
  p_schema_version integer,
  p_payload jsonb,
  p_favorite boolean default false
)
returns public.workspace_configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_configuration public.workspace_configurations;
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if p_configuration_id is null
     or char_length(btrim(coalesce(p_name, ''))) not between 1 and 100
     or p_favorite is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_input';
  end if;
  perform private.assert_workspace_configuration_payload(p_configuration_type, p_schema_version, p_payload);
  if p_configuration_type = 'receiver_weight_profile' and p_favorite then
    raise exception using errcode = '22023', message = 'receiver_weight_profiles_cannot_be_favorites';
  end if;

  begin
    insert into public.workspace_configurations(
      id, workspace_id, configuration_type, name, schema_version,
      payload, favorite, created_by, updated_by
    ) values (
      p_configuration_id, p_workspace_id, p_configuration_type,
      regexp_replace(btrim(p_name), '\s+', ' ', 'g'), p_schema_version,
      p_payload, p_favorite, v_user_id, v_user_id
    ) returning * into v_configuration;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'duplicate_workspace_configuration_name';
  end;
  return v_configuration;
end;
$$;

create or replace function public.update_workspace_configuration(
  p_workspace_id uuid,
  p_configuration_id uuid,
  p_schema_version integer,
  p_payload jsonb
)
returns public.workspace_configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_type text;
  v_configuration public.workspace_configurations;
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  select c.configuration_type into v_type
  from public.workspace_configurations c
  where c.id = p_configuration_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_configuration_not_found';
  end if;
  perform private.assert_workspace_configuration_payload(v_type, p_schema_version, p_payload);
  update public.workspace_configurations c
  set schema_version = p_schema_version, payload = p_payload, updated_by = v_user_id
  where c.id = p_configuration_id and c.workspace_id = p_workspace_id
  returning * into v_configuration;
  return v_configuration;
end;
$$;

create or replace function public.rename_workspace_configuration(
  p_workspace_id uuid,
  p_configuration_id uuid,
  p_name text
)
returns public.workspace_configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_configuration public.workspace_configurations;
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_name';
  end if;
  begin
    update public.workspace_configurations c
    set name = regexp_replace(btrim(p_name), '\s+', ' ', 'g'),
        updated_by = v_user_id
    where c.id = p_configuration_id and c.workspace_id = p_workspace_id
    returning * into v_configuration;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'duplicate_workspace_configuration_name';
  end;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_configuration_not_found';
  end if;
  return v_configuration;
end;
$$;

create or replace function public.duplicate_workspace_configuration(
  p_workspace_id uuid,
  p_source_configuration_id uuid,
  p_name text
)
returns public.workspace_configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_source public.workspace_configurations;
  v_configuration public.workspace_configurations;
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_name';
  end if;
  select * into v_source
  from public.workspace_configurations c
  where c.id = p_source_configuration_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_configuration_not_found';
  end if;
  begin
    insert into public.workspace_configurations(
      id, workspace_id, configuration_type, name, schema_version,
      payload, favorite, created_by, updated_by
    ) values (
      extensions.gen_random_uuid(), p_workspace_id, v_source.configuration_type,
      regexp_replace(btrim(p_name), '\s+', ' ', 'g'), v_source.schema_version,
      v_source.payload, v_source.favorite, v_user_id, v_user_id
    ) returning * into v_configuration;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'duplicate_workspace_configuration_name';
  end;
  return v_configuration;
end;
$$;

create or replace function public.delete_workspace_configuration(
  p_workspace_id uuid,
  p_configuration_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_authenticated();
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  delete from public.workspace_configurations c
  where c.id = p_configuration_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_configuration_not_found';
  end if;
  return true;
end;
$$;

create or replace function public.set_workspace_configuration_favorite(
  p_workspace_id uuid,
  p_configuration_id uuid,
  p_favorite boolean
)
returns public.workspace_configurations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_configuration public.workspace_configurations;
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;
  if p_favorite is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_configuration_favorite';
  end if;
  select * into v_configuration
  from public.workspace_configurations c
  where c.id = p_configuration_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_configuration_not_found';
  end if;
  if v_configuration.configuration_type <> 'recipe' and p_favorite then
    raise exception using errcode = '22023', message = 'receiver_weight_profiles_cannot_be_favorites';
  end if;
  update public.workspace_configurations c
  set favorite = p_favorite, updated_by = v_user_id
  where c.id = p_configuration_id and c.workspace_id = p_workspace_id
  returning * into v_configuration;
  return v_configuration;
end;
$$;

revoke all on function public.create_workspace_configuration(uuid,uuid,text,text,integer,jsonb,boolean) from public, anon;
revoke all on function public.update_workspace_configuration(uuid,uuid,integer,jsonb) from public, anon;
revoke all on function public.rename_workspace_configuration(uuid,uuid,text) from public, anon;
revoke all on function public.duplicate_workspace_configuration(uuid,uuid,text) from public, anon;
revoke all on function public.delete_workspace_configuration(uuid,uuid) from public, anon;
revoke all on function public.set_workspace_configuration_favorite(uuid,uuid,boolean) from public, anon;
grant execute on function public.create_workspace_configuration(uuid,uuid,text,text,integer,jsonb,boolean) to authenticated;
grant execute on function public.update_workspace_configuration(uuid,uuid,integer,jsonb) to authenticated;
grant execute on function public.rename_workspace_configuration(uuid,uuid,text) to authenticated;
grant execute on function public.duplicate_workspace_configuration(uuid,uuid,text) to authenticated;
grant execute on function public.delete_workspace_configuration(uuid,uuid) to authenticated;
grant execute on function public.set_workspace_configuration_favorite(uuid,uuid,boolean) to authenticated;

commit;
