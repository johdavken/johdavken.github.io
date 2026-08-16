begin;

-- Temporary incident diagnostic. An INSERT audit row would be rolled back by
-- the revision_conflict exception, so emit the authenticated actor in a
-- PostgreSQL LOG record instead. Remove this definition after the offending
-- client has been identified.

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
  select a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by
  from public.active_jobs a
  where a.workspace_id = p_workspace_id
    and a.payload = p_payload;
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
    raise log 'active_job_revision_conflict user_id=% workspace_id=%', v_user_id, p_workspace_id;
    raise exception using
      errcode = '40001',
      message = 'revision_conflict',
      detail = format('user_id=%s workspace_id=%s', v_user_id, p_workspace_id);
  end if;
end;
$$;

commit;
