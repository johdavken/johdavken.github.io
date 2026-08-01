begin;

create or replace function public.generate_link_code(p_workspace_id uuid)
returns table (link_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_code text;
  v_expires timestamptz := now() + interval '30 minutes';
begin
  if not private.current_user_is_member(p_workspace_id) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  delete from private.workspace_link_codes c
  where c.expires_at <= now() or c.workspace_id = p_workspace_id;

  loop
    v_code := private.generate_unambiguous_link_code();
    begin
      insert into private.workspace_link_codes(workspace_id, code_digest, created_by, expires_at)
      values (p_workspace_id, private.link_code_digest(v_code), v_user_id, v_expires);
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  return query select v_code, v_expires;
end;
$$;

revoke all on function public.generate_link_code(uuid) from public, anon;
grant execute on function public.generate_link_code(uuid) to authenticated;

commit;
