begin;

-- A stale revision is normally a real concurrent edit and must keep raising
-- revision_conflict.  The one exception is an upload whose complete active
-- job already equals the stored row: it is settled state, irrespective of
-- which revision the client started from.  Returning that row avoids a
-- needless conflict/retry cycle after a reconnect, reload, or duplicated
-- client notification.
--
-- This supersedes the narrower guard in 202608040001, which required the
-- expected revision to match before recognizing an identical payload.

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

  -- Retrying the exact same operation remains idempotent.
  return query
  select a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by
  from public.active_jobs a
  where a.workspace_id = p_workspace_id and a.last_operation_id = p_operation_id;
  if found then return; end if;

  -- An equal payload is a no-op even if this client learned its revision
  -- late.  Do not rewrite audit fields or last_operation_id: no change
  -- occurred and other clients must not receive a synthetic update.
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
    raise exception using errcode = '40001', message = 'revision_conflict';
  end if;
end;
$$;

commit;
