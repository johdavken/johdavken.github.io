begin;

-- Merge a duplicate line workspace into the established one.  Operational
-- state and memberships intentionally stay on the target; only the durable
-- saved recipes and receiver-weight profiles are copied from the source.

create or replace function public.admin_merge_line_workspaces(
  p_source_workspace_id uuid,
  p_target_workspace_id uuid
)
returns table (
  source_workspace_id uuid,
  target_workspace_id uuid,
  recipes_merged integer,
  receiver_weight_profiles_merged integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
  v_source_name text;
  v_configuration public.workspace_configurations;
  v_candidate_name text;
  v_suffix text;
  v_counter integer;
  v_recipes integer := 0;
  v_profiles integer := 0;
begin
  if p_source_workspace_id is null
     or p_target_workspace_id is null
     or p_source_workspace_id = p_target_workspace_id then
    raise exception using errcode = '22023', message = 'invalid_workspace_merge_input';
  end if;

  -- Lock in a stable order to prevent two opposing merge requests from
  -- interleaving.  The source is deleted only after every configuration copy
  -- succeeds, so the transaction is all-or-nothing.
  perform 1
  from public.line_workspaces w
  where w.id in (p_source_workspace_id, p_target_workspace_id)
  order by w.id
  for update;
  if (select count(*) from public.line_workspaces w where w.id in (p_source_workspace_id, p_target_workspace_id)) <> 2 then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  select w.name into v_source_name
  from public.line_workspaces w
  where w.id = p_source_workspace_id;

  for v_configuration in
    select c.*
    from public.workspace_configurations c
    where c.workspace_id = p_source_workspace_id
    order by c.created_at, c.id
  loop
    v_candidate_name := v_configuration.name;
    if exists (
      select 1 from public.workspace_configurations c
      where c.workspace_id = p_target_workspace_id
        and c.configuration_type = v_configuration.configuration_type
        and c.normalized_name = private.normalize_setup_name(v_candidate_name)
    ) then
      v_counter := 1;
      loop
        v_suffix := format(' (from %s%s)', v_source_name,
          case when v_counter = 1 then '' else ' ' || v_counter::text end);
        v_candidate_name := left(v_configuration.name, 100 - char_length(v_suffix)) || v_suffix;
        exit when not exists (
          select 1 from public.workspace_configurations c
          where c.workspace_id = p_target_workspace_id
            and c.configuration_type = v_configuration.configuration_type
            and c.normalized_name = private.normalize_setup_name(v_candidate_name)
        );
        v_counter := v_counter + 1;
      end loop;
    end if;

    insert into public.workspace_configurations(
      id, workspace_id, configuration_type, name, schema_version,
      payload, favorite, created_by, updated_by
    ) values (
      extensions.gen_random_uuid(), p_target_workspace_id,
      v_configuration.configuration_type, v_candidate_name,
      v_configuration.schema_version, v_configuration.payload,
      v_configuration.favorite, v_admin_id, v_admin_id
    );

    if v_configuration.configuration_type = 'recipe' then
      v_recipes := v_recipes + 1;
    else
      v_profiles := v_profiles + 1;
    end if;
  end loop;

  delete from public.line_workspaces where id = p_source_workspace_id;
  return query select p_source_workspace_id, p_target_workspace_id, v_recipes, v_profiles;
end;
$$;

revoke all on function public.admin_merge_line_workspaces(uuid,uuid) from public, anon;
grant execute on function public.admin_merge_line_workspaces(uuid,uuid) to authenticated;

commit;
