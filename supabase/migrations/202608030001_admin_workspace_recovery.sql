begin;

-- Admin Workspace Recovery
--
-- A line computer that loses browser storage also loses its anonymous RT Sync
-- Auth identity (a fresh anon user is minted on next load). The workspace and
-- its saved data are untouched server-side; only the browser<->workspace link
-- is gone, because the old line_workspace_members row now points at an
-- orphaned identity nobody can sign back into. This migration lets a verified
-- admin (public.admin_users, existing resin-admin authorization) attach the
-- browser's *current* anonymous identity to an existing workspace as an
-- ordinary member. It never restores the old identity, never touches role
-- beyond 'member', and never mutates active_jobs/saved_setups/workspace_configurations.
--
-- device_id is generated and persisted client-side (PolynSyncStorage, its own
-- localStorage key) separately from the RT Sync Auth session, so it commonly
-- survives whatever reset invalidated the anonymous identity. That makes "the
-- new identity's device_id collides with this workspace's own previous,
-- orphaned membership row" the *normal* recovery case, not an edge case -
-- admin_add_device_to_workspace below handles it by reclaiming the device_id
-- from that stale row rather than failing.

create or replace function private.assert_admin()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
begin
  if not public.is_resin_admin() then
    raise exception using errcode = '42501', message = 'admin_access_required';
  end if;
  return v_user_id;
end;
$$;

-- Recovery may only attach a *current* anonymous RT Sync identity, never an
-- admin's own persistent email/password identity or an arbitrary Auth user.
create or replace function private.is_anonymous_rt_sync_identity(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.is_anonymous from auth.users u where u.id = p_user_id),
    false
  );
$$;

create table private.workspace_recovery_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.line_workspaces(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id),
  device_id uuid,
  action text not null check (action in ('add_device', 'remove_member', 'transfer_ownership')),
  created_at timestamptz not null default now()
);

create index workspace_recovery_audit_workspace_idx
  on private.workspace_recovery_audit (workspace_id, created_at);

create or replace function public.admin_list_line_workspaces(
  p_current_rt_sync_user_id uuid default null
)
returns table (
  workspace_id uuid,
  workspace_name text,
  created_at timestamptz,
  last_activity_at timestamptz,
  member_count bigint,
  recipe_count bigint,
  receiver_weight_profile_count bigint,
  is_current_device_member boolean
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
    w.id,
    w.name,
    w.created_at,
    greatest(
      w.updated_at,
      coalesce(aj.updated_at, w.updated_at),
      coalesce(ms.max_last_seen_at, w.updated_at)
    ) as last_activity_at,
    coalesce(ms.member_count, 0::bigint),
    coalesce(cc.recipe_count, 0::bigint),
    coalesce(cc.profile_count, 0::bigint),
    p_current_rt_sync_user_id is not null and exists (
      select 1
      from public.line_workspace_members m2
      where m2.workspace_id = w.id and m2.user_id = p_current_rt_sync_user_id
    )
  from public.line_workspaces w
  left join public.active_jobs aj on aj.workspace_id = w.id
  left join (
    select m.workspace_id, count(*) as member_count, max(m.last_seen_at) as max_last_seen_at
    from public.line_workspace_members m
    group by m.workspace_id
  ) ms on ms.workspace_id = w.id
  left join (
    select c.workspace_id,
      count(*) filter (where c.configuration_type = 'recipe') as recipe_count,
      count(*) filter (where c.configuration_type = 'receiver_weight_profile') as profile_count
    from public.workspace_configurations c
    group by c.workspace_id
  ) cc on cc.workspace_id = w.id
  order by w.name;
end;
$$;

create or replace function public.admin_get_workspace_details(p_workspace_id uuid)
returns table (
  workspace_id uuid,
  workspace_name text,
  created_at timestamptz,
  member_user_id uuid,
  member_device_id uuid,
  member_device_label text,
  member_role public.line_workspace_role,
  member_joined_at timestamptz,
  member_last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  if p_workspace_id is null then
    raise exception using errcode = '22023', message = 'invalid_workspace_id';
  end if;
  if not exists (select 1 from public.line_workspaces w where w.id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  return query
  select w.id, w.name, w.created_at,
         m.user_id, m.device_id, m.device_label, m.role, m.joined_at, m.last_seen_at
  from public.line_workspaces w
  left join public.line_workspace_members m on m.workspace_id = w.id
  where w.id = p_workspace_id
  order by m.joined_at nulls last;
end;
$$;

create or replace function public.admin_add_device_to_workspace(
  p_workspace_id uuid,
  p_target_user_id uuid,
  p_device_id uuid,
  p_device_label text default null
)
returns table (
  workspace_id uuid,
  member_user_id uuid,
  member_role public.line_workspace_role,
  already_member boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
  v_label text;
  v_was_member boolean := false;
  v_role public.line_workspace_role;
  v_reclaimed_count integer;
begin
  if p_workspace_id is null or p_target_user_id is null or p_device_id is null then
    raise exception using errcode = '22023', message = 'invalid_recovery_input';
  end if;
  if not exists (select 1 from public.line_workspaces w where w.id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;
  if not private.is_anonymous_rt_sync_identity(p_target_user_id) then
    raise exception using errcode = '22023', message = 'invalid_target_identity';
  end if;

  v_label := regexp_replace(btrim(coalesce(p_device_label, '')), '\s+', ' ', 'g');
  if v_label = '' then
    v_label := 'Recovered Device';
  end if;
  if char_length(v_label) > 80 then
    raise exception using errcode = '22023', message = 'invalid_device_label';
  end if;

  select true into v_was_member
  from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;

  begin
    insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
    values (p_workspace_id, p_target_user_id, p_device_id, v_label, 'member')
    on conflict on constraint line_workspace_members_pkey do update
    set device_id = excluded.device_id,
        device_label = excluded.device_label,
        last_seen_at = now();
  exception
    when unique_violation then
      -- device_id is stored client-side separately from the RT Sync Auth
      -- session, so it commonly survives whatever reset invalidated the
      -- anonymous identity. The normal recovery case is therefore: this
      -- exact device_id is still held by this same workspace's *previous*
      -- (now orphaned) membership row under a different, unreachable
      -- user_id. Retire that stale row's device claim - regenerating its
      -- device_id, not deleting the row or changing its role/history - so
      -- the real device_id is free for the recovered identity, then retry.
      --
      -- Exactly one row is expected: unique(workspace_id, device_id) means
      -- at most one row anywhere can hold this (workspace_id, device_id)
      -- pair, and reaching this handler at all means some row already does
      -- (that's what raised unique_violation); it cannot be p_target_user_id
      -- itself, since that case is handled by the ON CONFLICT upsert above
      -- without ever raising. Treat any other count as a data integrity
      -- problem, not something to silently paper over.
      update public.line_workspace_members m
      set device_id = extensions.gen_random_uuid()
      where m.workspace_id = p_workspace_id
        and m.device_id = p_device_id
        and m.user_id <> p_target_user_id;
      get diagnostics v_reclaimed_count = row_count;
      if v_reclaimed_count <> 1 then
        raise exception using errcode = '55000', message = 'device_id_reclaim_failed';
      end if;

      begin
        insert into public.line_workspace_members(workspace_id, user_id, device_id, device_label, role)
        values (p_workspace_id, p_target_user_id, p_device_id, v_label, 'member')
        on conflict on constraint line_workspace_members_pkey do update
        set device_id = excluded.device_id,
            device_label = excluded.device_label,
            last_seen_at = now();
      exception
        when unique_violation then
          raise exception using errcode = '23505', message = 'device_already_in_use';
        when foreign_key_violation then
          raise exception using errcode = '22023', message = 'invalid_target_identity';
      end;
    when foreign_key_violation then
      raise exception using errcode = '22023', message = 'invalid_target_identity';
  end;

  insert into private.workspace_recovery_audit(workspace_id, admin_user_id, target_user_id, device_id, action)
  values (p_workspace_id, v_admin_id, p_target_user_id, p_device_id, 'add_device');

  select m.role into v_role
  from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = p_target_user_id;

  return query select p_workspace_id, p_target_user_id, v_role, coalesce(v_was_member, false);
end;
$$;

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
  v_role public.line_workspace_role;
begin
  if p_workspace_id is null or p_member_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_recovery_input';
  end if;

  select m.role into v_role
  from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = p_member_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'membership_not_found';
  end if;
  if v_role = 'owner'::public.line_workspace_role then
    raise exception using errcode = '42501', message = 'owner_cannot_be_removed';
  end if;

  delete from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = p_member_user_id;

  insert into private.workspace_recovery_audit(workspace_id, admin_user_id, target_user_id, device_id, action)
  values (p_workspace_id, v_admin_id, p_member_user_id, null, 'remove_member');

  return true;
end;
$$;

-- Deliberately separate from admin_add_device_to_workspace: recovery never
-- transfers ownership implicitly. This is only for the case where the
-- original owner's identity is itself unreachable (its device was reset) and
-- an admin explicitly chooses to reassign ownership to the recovered device.
-- The database cannot verify the old owner is actually gone rather than just
-- offline, so this is a deliberate human decision, not an automatic one.
create or replace function public.admin_transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_user_id uuid
)
returns table (
  workspace_id uuid,
  previous_owner_user_id uuid,
  new_owner_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
  v_previous_owner uuid;
begin
  if p_workspace_id is null or p_new_owner_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_recovery_input';
  end if;
  if not exists (select 1 from public.line_workspaces w where w.id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'workspace_not_found';
  end if;

  -- Serialize ownership changes for this workspace so two concurrent
  -- transfers (or a transfer racing the member-gated transfer_workspace_ownership)
  -- cannot interleave and leave an inconsistent owner/member split. Locks
  -- every membership row for this workspace, since the subsequent reads and
  -- writes below can touch any of them (whichever currently holds 'owner',
  -- plus the target row).
  perform 1
  from public.line_workspace_members m
  where m.workspace_id = p_workspace_id
  for update;

  if not exists (
    select 1 from public.line_workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = p_new_owner_user_id
  ) then
    raise exception using errcode = '22023', message = 'new_owner_must_be_a_member';
  end if;

  select m.user_id into v_previous_owner
  from public.line_workspace_members m
  where m.workspace_id = p_workspace_id and m.role = 'owner'::public.line_workspace_role;

  if v_previous_owner is distinct from p_new_owner_user_id then
    update public.line_workspace_members m
    set role = 'member'::public.line_workspace_role
    where m.workspace_id = p_workspace_id and m.role = 'owner'::public.line_workspace_role;

    update public.line_workspace_members m
    set role = 'owner'::public.line_workspace_role
    where m.workspace_id = p_workspace_id and m.user_id = p_new_owner_user_id;

    insert into private.workspace_recovery_audit(workspace_id, admin_user_id, target_user_id, device_id, action)
    values (p_workspace_id, v_admin_id, p_new_owner_user_id, null, 'transfer_ownership');
  end if;

  return query select p_workspace_id, v_previous_owner, p_new_owner_user_id;
end;
$$;

revoke all on function public.admin_list_line_workspaces(uuid) from public, anon;
revoke all on function public.admin_get_workspace_details(uuid) from public, anon;
revoke all on function public.admin_add_device_to_workspace(uuid,uuid,uuid,text) from public, anon;
revoke all on function public.admin_remove_workspace_member(uuid,uuid) from public, anon;
revoke all on function public.admin_transfer_workspace_ownership(uuid,uuid) from public, anon;
grant execute on function public.admin_list_line_workspaces(uuid) to authenticated;
grant execute on function public.admin_get_workspace_details(uuid) to authenticated;
grant execute on function public.admin_add_device_to_workspace(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.admin_remove_workspace_member(uuid,uuid) to authenticated;
grant execute on function public.admin_transfer_workspace_ownership(uuid,uuid) to authenticated;

commit;
