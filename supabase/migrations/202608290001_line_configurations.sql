begin;

create table public.line_configurations (
  id uuid primary key default extensions.gen_random_uuid(),
  line_number integer not null unique check (line_number between 1 and 999),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 80),
  aliases text[] not null default '{}',
  layer_count integer not null check (layer_count between 1 and 9),
  layer_a_position text check (layer_a_position in ('inside', 'outside')),
  hopper_geometry text not null check (hopper_geometry in ('cylindrical', 'volume')),
  hopper_naming_mode text not null default 'standard' check (hopper_naming_mode in ('standard', 'main-plus-five')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((layer_count = 1 and layer_a_position is null) or (layer_count > 1 and layer_a_position is not null)),
  check (cardinality(aliases) <= 25)
);

create unique index line_configurations_display_name_uidx on public.line_configurations (lower(display_name)) where is_active;

create or replace function private.validate_line_configuration_names()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
begin
  new.aliases := coalesce(array(select distinct btrim(value) from unnest(new.aliases) value where btrim(value) <> ''), '{}');
  if exists (select 1 from unnest(new.aliases) value where char_length(value) > 80) then
    raise exception using errcode = '22023', message = 'invalid_line_configuration_alias';
  end if;
  if not new.is_active then return new; end if;
  foreach v_name in array array_prepend(new.display_name, new.aliases) loop
    if exists (
      select 1 from public.line_configurations c
      where c.is_active and c.id <> new.id
        and (lower(c.display_name) = lower(v_name) or exists (select 1 from unnest(c.aliases) a where lower(a) = lower(v_name)))
    ) then raise exception using errcode = '23505', message = 'line_configuration_name_conflict'; end if;
  end loop;
  return new;
end;
$$;

create trigger line_configurations_validate_names before insert or update on public.line_configurations
for each row execute function private.validate_line_configuration_names();

create or replace function private.set_line_configuration_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end; $$;
create trigger line_configurations_set_updated_at before update on public.line_configurations
for each row execute function private.set_line_configuration_updated_at();

insert into public.line_configurations (line_number, display_name, layer_count, layer_a_position, hopper_geometry, hopper_naming_mode)
values
  (1,'Line 1',1,null,'volume','standard'), (2,'Line 2',1,null,'volume','standard'),
  (3,'Line 3',1,null,'volume','standard'), (4,'Line 4',1,null,'volume','standard'),
  (5,'Line 5',3,'inside','cylindrical','standard'), (6,'Line 6',3,'inside','cylindrical','standard'),
  (7,'Line 7',3,'inside','volume','standard'), (8,'Line 8',3,'inside','volume','standard'),
  (9,'Line 9',3,'outside','cylindrical','main-plus-five'),
  (10,'Line 10',5,'outside','cylindrical','standard'), (11,'Line 11',5,'outside','cylindrical','standard'),
  (12,'Line 12',3,'outside','cylindrical','standard'), (13,'Line 13',3,'outside','cylindrical','standard'),
  (14,'Line 14',3,'outside','cylindrical','standard'), (15,'Line 15',5,'outside','cylindrical','standard');

alter table public.line_configurations enable row level security;
create policy line_configurations_read on public.line_configurations for select to anon, authenticated using (true);
grant select on public.line_configurations to anon, authenticated;
revoke insert, update, delete on public.line_configurations from anon, authenticated;

create or replace function public.admin_list_line_configurations()
returns setof public.line_configurations
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return query select * from public.line_configurations order by line_number;
end;
$$;

create or replace function public.admin_save_line_configuration(
  p_id uuid, p_line_number integer, p_display_name text, p_aliases text[], p_layer_count integer,
  p_layer_a_position text, p_hopper_geometry text, p_hopper_naming_mode text,
  p_is_active boolean, p_metadata jsonb
)
returns setof public.line_configurations
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.assert_admin();
  if p_id is null then
    insert into public.line_configurations(line_number,display_name,aliases,layer_count,layer_a_position,hopper_geometry,hopper_naming_mode,is_active,metadata)
    values(p_line_number,btrim(p_display_name),coalesce(p_aliases,'{}'),p_layer_count,p_layer_a_position,p_hopper_geometry,p_hopper_naming_mode,p_is_active,coalesce(p_metadata,'{}'))
    returning id into v_id;
  else
    update public.line_configurations set line_number=p_line_number,display_name=btrim(p_display_name),aliases=coalesce(p_aliases,'{}'),
      layer_count=p_layer_count,layer_a_position=p_layer_a_position,hopper_geometry=p_hopper_geometry,
      hopper_naming_mode=p_hopper_naming_mode,is_active=p_is_active,metadata=coalesce(p_metadata,'{}') where id=p_id returning id into v_id;
    if v_id is null then raise exception using errcode='P0002', message='line_configuration_not_found'; end if;
  end if;
  return query select * from public.line_configurations where id=v_id;
end;
$$;

revoke all on function public.admin_list_line_configurations() from public, anon;
grant execute on function public.admin_list_line_configurations() to authenticated;
revoke all on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb) from public, anon;
grant execute on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb) to authenticated;
revoke all on function private.validate_line_configuration_names() from public, anon, authenticated;
revoke all on function private.set_line_configuration_updated_at() from public, anon, authenticated;

commit;
