begin;

-- Hoppers per layer. Most lines run six on every layer; several run four on
-- the core. One integer per layer, in recipe order (A, B, C...), always the
-- full length - never an empty array standing in for "the default" - so a
-- reader has one shape to read. Six is the ceiling: the running job, cloud
-- payloads and their validators are six-slot, so a layer can use fewer of
-- its slots but never more.
alter table public.line_configurations add column hopper_counts integer[] not null default '{}';
update public.line_configurations set hopper_counts = array_fill(6, array[layer_count]);
alter table public.line_configurations
  add constraint line_configurations_hopper_counts_check
  check (cardinality(hopper_counts) = layer_count and array_position(hopper_counts, null) is null and hopper_counts <@ array[1,2,3,4,5,6]);
alter table public.line_configurations alter column hopper_counts drop default;

-- The save procedure grows a trailing, optional argument. A client still
-- running the earlier script omits it and gets six per layer, as before.
drop function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb);

create or replace function public.admin_save_line_configuration(
  p_id uuid, p_line_number integer, p_display_name text, p_aliases text[], p_layer_count integer,
  p_layer_a_position text, p_hopper_geometry text, p_hopper_naming_mode text,
  p_is_active boolean, p_metadata jsonb, p_hopper_counts integer[] default null
)
returns setof public.line_configurations
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_hopper_counts integer[] := coalesce(p_hopper_counts, array_fill(6, array[p_layer_count]));
begin
  perform private.assert_admin();
  if p_id is null then
    insert into public.line_configurations(line_number,display_name,aliases,layer_count,layer_a_position,hopper_geometry,hopper_naming_mode,is_active,metadata,hopper_counts)
    values(p_line_number,btrim(p_display_name),coalesce(p_aliases,'{}'),p_layer_count,p_layer_a_position,p_hopper_geometry,p_hopper_naming_mode,p_is_active,coalesce(p_metadata,'{}'),v_hopper_counts)
    returning id into v_id;
  else
    update public.line_configurations set line_number=p_line_number,display_name=btrim(p_display_name),aliases=coalesce(p_aliases,'{}'),
      layer_count=p_layer_count,layer_a_position=p_layer_a_position,hopper_geometry=p_hopper_geometry,
      hopper_naming_mode=p_hopper_naming_mode,is_active=p_is_active,metadata=coalesce(p_metadata,'{}'),hopper_counts=v_hopper_counts where id=p_id returning id into v_id;
    if v_id is null then raise exception using errcode='P0002', message='line_configuration_not_found'; end if;
  end if;
  return query select * from public.line_configurations where id=v_id;
end;
$$;

revoke all on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb,integer[]) from public, anon;
grant execute on function public.admin_save_line_configuration(uuid,integer,text,text[],integer,text,text,text,boolean,jsonb,integer[]) to authenticated;

commit;
