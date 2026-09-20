begin;

-- Who made the line's hopper system. Every line runs Plast-Control today;
-- the lines that run a TSM gravimetric blender are set here, and Station
-- draws the machine that stands there from this alone. One word per line,
-- never empty - a reader has one shape to read - and a row an older client
-- saves without the word keeps the floor's default.
alter table public.line_configurations
  add column hopper_manufacturer text not null default 'plast-control'
  constraint line_configurations_hopper_manufacturer_check check (hopper_manufacturer in ('plast-control', 'tsm'));

-- The save procedure grows a trailing, optional argument. A client still
-- running the earlier script omits it and gets Plast-Control, as before.
drop function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb,integer[]);

create or replace function public.admin_save_line_configuration(
  p_id uuid, p_line_number integer, p_display_name text, p_aliases text[], p_layer_count integer,
  p_layer_a_position text, p_hopper_geometry text, p_hopper_naming_mode text,
  p_is_active boolean, p_metadata jsonb, p_hopper_counts integer[] default null,
  p_hopper_manufacturer text default null
)
returns setof public.line_configurations
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hopper_counts integer[] := coalesce(p_hopper_counts, array_fill(6, array[p_layer_count]));
  v_hopper_manufacturer text := coalesce(p_hopper_manufacturer, 'plast-control');
begin
  perform private.assert_admin();
  if p_id is null then
    insert into public.line_configurations(line_number,display_name,aliases,layer_count,layer_a_position,hopper_geometry,hopper_naming_mode,is_active,metadata,hopper_counts,hopper_manufacturer)
    values(p_line_number,btrim(p_display_name),coalesce(p_aliases,'{}'),p_layer_count,p_layer_a_position,p_hopper_geometry,p_hopper_naming_mode,p_is_active,coalesce(p_metadata,'{}'),v_hopper_counts,v_hopper_manufacturer)
    returning id into v_id;
  else
    update public.line_configurations set line_number=p_line_number,display_name=btrim(p_display_name),aliases=coalesce(p_aliases,'{}'),
      layer_count=p_layer_count,layer_a_position=p_layer_a_position,hopper_geometry=p_hopper_geometry,
      hopper_naming_mode=p_hopper_naming_mode,is_active=p_is_active,metadata=coalesce(p_metadata,'{}'),hopper_counts=v_hopper_counts,
      hopper_manufacturer=v_hopper_manufacturer where id=p_id returning id into v_id;
    if v_id is null then raise exception using errcode='P0002', message='line_configuration_not_found'; end if;
  end if;
  return query select * from public.line_configurations where id=v_id;
end;
$$;

revoke all on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb,integer[],text) from public, anon;
grant execute on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb,integer[],text) to authenticated;

commit;
