begin;

-- Adds a no-op guard to public.update_active_job: when a caller's payload is
-- byte-identical (JSONB-equal) to what is already stored, and the expected
-- revision still matches, the existing row is returned unchanged instead of
-- being rewritten. This protects against duplicate client saves (e.g. a
-- retry that generated a fresh operation_id after a no-op edit) from writing
-- a new revision for no reason, which would otherwise generate unnecessary
-- WAL and Realtime fan-out to every connected client for a change that never
-- actually happened. Additive: signature, return shape, SECURITY DEFINER
-- status, search_path, grants, and error codes are all unchanged from the
-- original definition in 202607310001_line_sync.sql.

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

  -- No-op guard: same workspace, same expected revision, byte-identical
  -- payload, just a different operation_id than the one already stored (a
  -- duplicate save, not a retry of the same attempt - that case is already
  -- handled above). Return the current row untouched: no revision bump, no
  -- updated_at/updated_by change, no last_operation_id change, no WAL or
  -- Realtime event.
  return query
  select a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by
  from public.active_jobs a
  where a.workspace_id = p_workspace_id
    and a.revision = p_expected_revision
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
