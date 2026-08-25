begin;

-- A revision mismatch used to raise an exception.  That is correct for an
-- optimistic-concurrency API, but an old or cached client can retry that
-- exception indefinitely and turn one stale edit into a database log storm.
--
-- Keep the active job authoritative: on a stale, different payload, return
-- the row that actually won instead.  Current clients recognize that returned
-- row as a conflict and show the existing resolution flow; older clients see
-- a settled response and stop retrying the stale operation.
--
-- The guard is deliberately durable.  PostgreSQL rolls back writes made
-- before a raised exception, so an in-function counter paired with an error
-- can never act as a real breaker.  Persisting it on the non-error path also
-- gives callers that ignore the returned row a small, serialized backoff.
create table if not exists private.active_job_conflict_guards (
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

revoke all on table private.active_job_conflict_guards from anon, authenticated;

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
  v_blocked_until timestamptz;
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
  if found then return; end if;

  insert into private.active_job_conflict_guards as guard (
    workspace_id, user_id, window_started_at, conflict_count, blocked_until, updated_at
  )
  values (p_workspace_id, v_user_id, now(), 1, null, now())
  on conflict (workspace_id, user_id) do update
  set window_started_at = case
        when guard.window_started_at <= now() - interval '10 seconds' then now()
        else guard.window_started_at
      end,
      conflict_count = case
        when guard.window_started_at <= now() - interval '10 seconds' then 1
        else guard.conflict_count + 1
      end,
      blocked_until = case
        when guard.window_started_at <= now() - interval '10 seconds' then null
        when guard.conflict_count + 1 >= 12 then greatest(coalesce(guard.blocked_until, now()), now() + interval '60 seconds')
        else guard.blocked_until
      end,
      updated_at = now()
  returning blocked_until into v_blocked_until;

  -- A caller that ignores the authoritative response cannot consume a whole
  -- database connection at hundreds of requests per second after tripping
  -- the guard.  Current clients resolve on the first returned conflict, so
  -- they never reach this path.
  if v_blocked_until > now() then
    perform pg_sleep(0.25);
  end if;

  return query
  select a.workspace_id, a.payload, a.revision, a.last_operation_id, a.updated_at, a.updated_by
  from public.active_jobs a
  where a.workspace_id = p_workspace_id;
end;
$$;

grant execute on function public.update_active_job(uuid,jsonb,bigint,uuid) to authenticated;

commit;
