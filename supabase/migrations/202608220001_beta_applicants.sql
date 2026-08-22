begin;

-- Android beta access requests.
--
-- The Help guide's Google Play link is an *internal testing* URL: it only
-- works for a Google account already on the Play Console tester list, so
-- this table is a convenience gate, not a security boundary.  It exists so
-- an operator can ask for access from inside the app and so the
-- administrator has one place to see who is waiting.  Nothing here is worth
-- hardening beyond the obvious, and nothing here should be relied on to
-- keep the build private - Play does that.
--
-- Identity is the browser's anonymous RT Sync auth user.  Every visitor
-- already has one (cloud-sync.js signs in anonymously during initialize(),
-- gated only on Supabase being configured, never on joining a workspace),
-- so a device can read its own row and no email-lookup endpoint has to
-- exist.  That matters: an endpoint taking an email and returning whether
-- it is approved would be an enumeration oracle over operators' addresses.
--
-- This is the first table in the project holding personal data for
-- non-admin users.  See privacy/index.html, which had to gain a section
-- for it - the policy previously stated that signing in involved "no name,
-- no email address".

create table if not exists public.beta_applicants (
  id uuid primary key default extensions.gen_random_uuid(),
  -- The anonymous identity that submitted the request.  Server-derived from
  -- auth.uid() in the RPC below and never accepted from the client.
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  invited_at timestamptz,
  invited_by uuid references auth.users(id) on delete set null,
  constraint beta_applicants_user_id_key unique (user_id),
  constraint beta_applicants_email_key unique (email),
  constraint beta_applicants_status_check check (status in ('pending', 'invited')),
  -- Deliberately loose: the job of this check is to reject obvious junk and
  -- bound the column, not to adjudicate RFC 5322.  A wrong-but-plausible
  -- address is caught by the invitation never arriving, not by a regex.
  constraint beta_applicants_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint beta_applicants_email_length check (char_length(email) between 6 and 254),
  constraint beta_applicants_display_name_length check (char_length(display_name) between 1 and 80),
  -- status and invited_at move together, so a row can never claim to be
  -- invited without recording when.
  constraint beta_applicants_invited_at_check check (
    (status = 'invited' and invited_at is not null)
    or (status = 'pending' and invited_at is null)
  )
);

create index if not exists beta_applicants_status_created_idx
  on public.beta_applicants (status, created_at desc);

alter table public.beta_applicants enable row level security;

-- Read your own row, or everything if you are an admin.  There is
-- deliberately no insert/update/delete policy at all: every write goes
-- through the security-definer RPCs below, so the client can never set
-- user_id, status, invited_at or invited_by itself.
drop policy if exists beta_applicants_select_self_or_admin on public.beta_applicants;
create policy beta_applicants_select_self_or_admin
  on public.beta_applicants
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_resin_admin()));

revoke all on table public.beta_applicants from public, anon, authenticated;
grant select on table public.beta_applicants to authenticated;

-- Submit or update this browser's request.
--
-- Re-binding: if the address already has a row, the row is handed to the
-- caller's current identity rather than rejected as a duplicate.  Clearing
-- browser storage destroys the anonymous identity permanently (see
-- CLAUDE.md), so without this an approved tester who cleared their browser
-- would silently lose the link with no way back.  The trade is that
-- somebody who guesses an approved address can claim the row and see the
-- link - which buys them nothing, because Play still refuses the install to
-- any account not on the tester list.  Status is preserved across a
-- re-bind; nothing here can promote a request to 'invited'.
create or replace function public.submit_beta_application(
  p_email text,
  p_display_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_status text;
begin
  if v_email = '' or v_name = '' then
    raise exception using errcode = '22023', message = 'invalid_beta_application';
  end if;

  -- Collapse internal whitespace in the name the same way workspace
  -- configuration names are normalized, so the admin list does not show
  -- ragged spacing it cannot fix.
  v_name := regexp_replace(v_name, '\s+', ' ', 'g');

  if char_length(v_email) not between 6 and 254
     or char_length(v_name) not between 1 and 80
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception using errcode = '22023', message = 'invalid_beta_application';
  end if;

  if exists (select 1 from public.beta_applicants a where a.email = v_email) then
    -- This identity may already hold a different address; release it first
    -- so the unique constraint on user_id cannot collide below.
    delete from public.beta_applicants a
    where a.user_id = v_user_id and a.email <> v_email;

    update public.beta_applicants a
       set user_id = v_user_id,
           display_name = v_name,
           updated_at = now()
     where a.email = v_email
    returning a.status into v_status;
  else
    insert into public.beta_applicants as a (user_id, email, display_name)
    values (v_user_id, v_email, v_name)
    on conflict (user_id) do update
      set email = excluded.email,
          display_name = excluded.display_name,
          updated_at = now()
    returning a.status into v_status;
  end if;

  return v_status;
end;
$$;

revoke all on function public.submit_beta_application(text, text) from public, anon;
grant execute on function public.submit_beta_application(text, text) to authenticated;

-- The administrator's checkbox: "I have added this person to internal
-- testing on Play Console."  Reversible, because ticking the wrong row
-- should not require a database round trip to undo.
create or replace function public.admin_set_beta_applicant_invited(
  p_applicant_id uuid,
  p_invited boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := private.assert_admin();
begin
  if p_applicant_id is null or p_invited is null then
    raise exception using errcode = '22023', message = 'invalid_beta_application';
  end if;

  update public.beta_applicants a
     set status = case when p_invited then 'invited' else 'pending' end,
         invited_at = case when p_invited then now() else null end,
         invited_by = case when p_invited then v_admin_id else null end,
         updated_at = now()
   where a.id = p_applicant_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'beta_applicant_not_found';
  end if;

  return true;
end;
$$;

revoke all on function public.admin_set_beta_applicant_invited(uuid, boolean) from public, anon;
grant execute on function public.admin_set_beta_applicant_invited(uuid, boolean) to authenticated;

-- Withdrawing a request has to be possible: this is personal data, and the
-- app already publishes a delete-data page.  An applicant may remove their
-- own row; an admin may remove anyone's.
create or replace function public.delete_beta_application(p_applicant_id uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.assert_authenticated();
  v_is_admin boolean := public.is_resin_admin();
begin
  if p_applicant_id is null then
    delete from public.beta_applicants a where a.user_id = v_user_id;
    return true;
  end if;

  if not v_is_admin then
    raise exception using errcode = '42501', message = 'admin_access_required';
  end if;

  delete from public.beta_applicants a where a.id = p_applicant_id;
  return true;
end;
$$;

revoke all on function public.delete_beta_application(uuid) from public, anon;
grant execute on function public.delete_beta_application(uuid) to authenticated;

commit;
