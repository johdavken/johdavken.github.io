begin;

-- Administrative incident controls.  These are intentionally separate from
-- normal workspace ownership: an owner can manage members, but only a resin
-- admin may forcibly disconnect an owner or delete a shared workspace.

create or replace function public.admin_remove_workspace_member(
  p_workspace_id uuid,
  p_member_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
begin
  if p_workspace_id is null or p_member_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_recovery_input';
  end if;

  if not exists (
    select 1
    from public.line_workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_member_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'membership_not_found';
  end if;

  -- This deliberately includes the owner.  It is an emergency disconnect,
  -- not the ordinary owner-managed removal path.
  delete from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = p_member_user_id;

  insert into private.workspace_recovery_audit(workspace_id, admin_user_id, target_user_id, device_id, action)
  values (p_workspace_id, v_admin_id, p_member_user_id, null, 'remove_member');

  return true;
end;
$$;

create or replace function public.admin_delete_line_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_id';
  end if;

  -- Lock the workspace before deleting it so an active update cannot race the
  -- cleanup.  All workspace-owned data uses ON DELETE CASCADE.
  perform 1 from public.line_workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  delete from public.line_workspaces where id = p_workspace_id;
  return true;
end;
$$;

-- Hide is not a permission boundary: old clients must also be unable to
-- delete a workspace after this migration is applied.
revoke execute on function public.delete_workspace(uuid,bigint) from authenticated;
revoke all on function public.admin_remove_workspace_member(uuid,uuid) from public, anon;
revoke all on function public.admin_delete_line_workspace(uuid) from public, anon;
grant execute on function public.admin_remove_workspace_member(uuid,uuid) to authenticated;
grant execute on function public.admin_delete_line_workspace(uuid) to authenticated;

commit;
