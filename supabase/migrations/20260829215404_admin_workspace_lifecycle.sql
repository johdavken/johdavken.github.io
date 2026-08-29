begin;

-- Sudo owns the administrative workspace lifecycle. Creating a line assigns
-- the current, verified RT Sync desktop as its owner; it never creates a
-- synthetic admin "device" membership. The initial payload is validated by
-- the same private validator used by the original operator RPC.
create or replace function public.admin_create_line_workspace(
  p_name text,
  p_target_user_id uuid,
  p_device_id uuid,
  p_device_label text,
  p_initial_active_job jsonb
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_revision bigint,
  active_job_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
  v_workspace public.line_workspaces;
  v_name text;
  v_label text;
begin
  if p_target_user_id is null or p_device_id is null then
    raise exception using errcode = '22023', message = 'invalid_recovery_input';
  end if;
  if not private.is_anonymous_rt_sync_identity(p_target_user_id) then
    raise exception using errcode = '22023', message = 'invalid_target_identity';
  end if;

  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_label := regexp_replace(btrim(coalesce(p_device_label, '')), '\s+', ' ', 'g');
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_workspace_name';
  end if;
  if char_length(v_label) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_device_label';
  end if;
  perform private.assert_active_job_payload(p_initial_active_job);

  insert into public.line_workspaces(name, created_by, creation_operation_id)
  values (v_name, p_target_user_id, extensions.gen_random_uuid())
  returning * into v_workspace;

  insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
  values (v_workspace.id, p_target_user_id, p_device_id, v_label, 'owner');

  insert into public.active_jobs(workspace_id, payload, last_operation_id, updated_by)
  values (v_workspace.id, p_initial_active_job, extensions.gen_random_uuid(), p_target_user_id);

  return query select v_workspace.id, v_workspace.name, v_workspace.revision, 1::bigint;
end;
$$;

create or replace function public.admin_rename_line_workspace(
  p_workspace_id uuid,
  p_name text
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
declare
  v_admin_id uuid := private.assert_admin();
  v_name text;
begin
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_id';
  end if;
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  if char_length(v_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'invalid_workspace_name';
  end if;

  -- Serialize with every other workspace revision update. Admin rename does
  -- not weaken membership rules: only a verified Sudo administrator can call
  -- this function.
  perform 1 from public.line_workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  return query
  update public.line_workspaces w
  set name = v_name, revision = w.revision + 1, updated_at = now()
  where w.id = p_workspace_id
  returning w.id, w.name, w.revision, w.updated_at;
end;
$$;

revoke all on function public.admin_create_line_workspace(text,uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.admin_rename_line_workspace(uuid,text) from public, anon;
grant execute on function public.admin_create_line_workspace(text,uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.admin_rename_line_workspace(uuid,text) to authenticated;

commit;
