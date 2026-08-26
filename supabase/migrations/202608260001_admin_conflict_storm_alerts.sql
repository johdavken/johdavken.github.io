begin;

-- Admin-visible surface for the conflict-storm circuit breaker
-- (202608250001_active_job_conflict_circuit_breaker.sql). That migration
-- added private.active_job_conflict_guards to stop a runaway client from
-- hammering update_active_job at hundreds of requests per second, but the
-- table itself is fully locked down - nothing, including an admin, could see
-- a storm happen without a live production investigation (see the incident
-- that motivated the breaker: 184,885 conflicts in 35 minutes from one
-- device on one workspace, found only by manual reproduction).
--
-- Only rows where the breaker has actually tripped (blocked_until is not
-- null) are surfaced. An ordinary occasional conflict between two devices
-- editing at once is expected traffic, not an incident, and ages out of the
-- guard table's own 10-second window on its own - it never sets
-- blocked_until and so never appears here.
--
-- Rows drop out of the result entirely once blocked_until is more than an
-- hour in the past; the client distinguishes "actively blocked right now"
-- from "resolved within the last hour" using is_active, matching the two
-- severities the admin UI already has for other conditions.

create or replace function public.admin_list_conflict_storms()
returns table (
  workspace_id uuid,
  workspace_name text,
  user_id uuid,
  device_label text,
  conflict_count integer,
  window_started_at timestamptz,
  blocked_until timestamptz,
  updated_at timestamptz,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();

  return query
  select
    g.workspace_id,
    w.name,
    g.user_id,
    m.device_label,
    g.conflict_count,
    g.window_started_at,
    g.blocked_until,
    g.updated_at,
    g.blocked_until > now()
  from private.active_job_conflict_guards g
  join public.line_workspaces w on w.id = g.workspace_id
  left join public.line_workspace_members m
    on m.workspace_id = g.workspace_id and m.user_id = g.user_id
  where g.blocked_until is not null
    and g.blocked_until > now() - interval '1 hour'
  order by g.blocked_until desc;
end;
$$;

revoke all on function public.admin_list_conflict_storms() from public, anon;
grant execute on function public.admin_list_conflict_storms() to authenticated;

commit;
