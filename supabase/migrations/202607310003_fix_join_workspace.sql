begin;

create or replace function public.join_workspace(
  p_link_code text,
  p_device_id uuid,
  p_device_label text
)
returns table (
  workspace_id uuid,
  workspace_name text,
  workspace_revision bigint,
  active_job_payload jsonb,
  active_job_revision bigint,
  is_owner boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_workspace_id uuid;
  v_attempt private.link_attempt_limits;
begin
  if p_device_id is null
     or char_length(btrim(coalesce(p_device_label, ''))) not between 1 and 80
     or upper(btrim(coalesce(p_link_code, ''))) !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$' then
    return;
  end if;

  insert into private.link_attempt_limits(user_id, window_started_at, failed_attempts)
  values (v_user_id, now(), 0)
  on conflict (user_id) do nothing;

  select l.* into v_attempt
  from private.link_attempt_limits l
  where l.user_id = v_user_id
  for update;

  if v_attempt.window_started_at < now() - interval '15 minutes' then
    update private.link_attempt_limits l
    set window_started_at = now(), failed_attempts = 0
    where l.user_id = v_user_id;
    v_attempt.failed_attempts := 0;
  end if;
  if v_attempt.failed_attempts >= 5 then
    return;
  end if;

  delete from private.workspace_link_codes c
  where c.code_digest = private.link_code_digest(p_link_code)
    and c.expires_at > now()
  returning c.workspace_id into v_workspace_id;

  if v_workspace_id is null then
    update private.link_attempt_limits l
    set failed_attempts = l.failed_attempts + 1
    where l.user_id = v_user_id;
    return;
  end if;

  insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
  values (v_workspace_id, v_user_id, p_device_id,
          regexp_replace(btrim(p_device_label), '\s+', ' ', 'g'), 'member')
  on conflict on constraint line_workspace_members_pkey do update
  set device_id = excluded.device_id,
      device_label = excluded.device_label,
      last_seen_at = now();

  delete from private.link_attempt_limits l where l.user_id = v_user_id;

  return query
  select w.id, w.name, w.revision, a.payload, a.revision,
         m.role = 'owner'::public.line_workspace_role
  from public.line_workspaces w
  join public.active_jobs a on a.workspace_id = w.id
  join public.line_workspace_members m
    on m.workspace_id = w.id
   and m.user_id = v_user_id
  where w.id = v_workspace_id;
end;
$$;

revoke all on function public.join_workspace(text,uuid,text) from public, anon;
grant execute on function public.join_workspace(text,uuid,text) to authenticated;

commit;
