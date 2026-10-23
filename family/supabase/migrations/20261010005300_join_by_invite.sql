-- ---------------------------------------------------------------------------
-- Joining a home by invite link. Until now a person joined a home only when the
-- e-mail an admin typed matched the e-mail they signed in with. A mother who
-- signed in with her Gmail while her row carried a placeholder address landed on
-- "Create your home" and made one of her own, next to the family's. Now an admin
-- sends a link from the Members screen (member_invite_create); whoever opens it
-- sees the home and the name waiting for them (member_invite_peek, signed in or
-- not), signs in however they like, and the link makes their account that member
-- (member_invite_accept), replacing an account that never signed in. The link is
-- good for seven days and for one account. members_accounts tells the Members
-- screen who has signed in and who still waits for a link.
--
-- The four functions read auth.users and link across homes, so they stay with
-- postgres like home_switch and household_create (migrations 4000, 4300, 4900).
-- ---------------------------------------------------------------------------
create table if not exists private.member_invites (
  token        uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members (id) on delete cascade,
  household_id uuid not null references public.household (id) on delete cascade,
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  used_at      timestamptz,
  used_by      uuid
);
create index if not exists member_invites_member_idx on private.member_invites (member_id);
revoke all on private.member_invites from public, anon, authenticated;

-- Whether the account behind a member row has ever signed in: a placeholder made by
-- the setup script has not, and an invite may replace it.
create or replace function private.user_signed_in(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select last_sign_in_at is not null from auth.users where id = p_user), false)
$$;

-- ---------------------------------------------------------------------------
-- 1. An admin makes (or reuses) the link for a member of their home
-- ---------------------------------------------------------------------------
create or replace function public.member_invite_create(p_member_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_member public.members; v_token uuid; v_expires timestamptz;
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'members', p_member_id::text, jsonb_build_object('invite', true));
    return private.denied();
  end if;
  select * into v_member from public.members where id = p_member_id and household_id = private.current_household_id();
  if v_member.id is null then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'No such member in this home.'); end if;
  if not v_member.is_active then return jsonb_build_object('ok', false, 'error', 'inactive', 'message', 'Make them active first.'); end if;
  -- One open link per member: the same link sent twice is the same link.
  select token, expires_at into v_token, v_expires from private.member_invites
   where member_id = p_member_id and used_at is null and expires_at > now() + interval '1 day'
   order by created_at desc limit 1;
  if v_token is null then
    insert into private.member_invites (member_id, household_id, created_by)
    values (p_member_id, v_member.household_id, public.current_member_id())
    returning token, expires_at into v_token, v_expires;
  end if;
  perform private.audit_write('members', 'edit', true, 'members', p_member_id::text, jsonb_build_object('invite', true));
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires, 'display_name', v_member.display_name,
                            'signed_in', v_member.user_id is not null and private.user_signed_in(v_member.user_id));
end $$;
revoke execute on function public.member_invite_create(uuid) from public, anon;
grant execute on function public.member_invite_create(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. What a link opens on, before any sign-in: the home, the name, who sent it
-- ---------------------------------------------------------------------------
-- state: open, used (by another account), expired, gone (the member or home is no more),
-- or joined (the account looking is already that member).
create or replace function public.member_invite_peek(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_inv private.member_invites; v_member public.members; v_state text;
begin
  select * into v_inv from private.member_invites where token = p_token;
  if v_inv.token is null then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That link is not one we sent.'); end if;
  select * into v_member from public.members where id = v_inv.member_id;
  v_state := case
    when v_member.id is null or not v_member.is_active then 'gone'
    when auth.uid() is not null and v_member.user_id = auth.uid() then 'joined'
    when v_inv.used_at is not null and v_inv.used_by is distinct from auth.uid() then 'used'
    when v_inv.expires_at < now() then 'expired'
    else 'open' end;
  return jsonb_build_object(
    'ok', true, 'state', v_state,
    'household_id', v_inv.household_id,
    'home', (select name from public.household where id = v_inv.household_id),
    'display_name', v_member.display_name,
    'role', (select label from public.roles where id = v_member.role_id),
    'invited_by', (select display_name from public.members where id = v_inv.created_by),
    'expires_at', v_inv.expires_at);
end $$;
grant execute on function public.member_invite_peek(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The signed-in account becomes that member, and runs as that home from now on
-- ---------------------------------------------------------------------------
create or replace function public.member_invite_accept(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_inv private.member_invites;
  v_member public.members;
  v_email text;
  v_old uuid;
  v_other uuid;
  v_other_active boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.'); end if;
  if private.preview_member_id() is not null then
    return jsonb_build_object('ok', false, 'error', 'preview', 'message', 'Not while viewing the app as someone else.');
  end if;
  select * into v_inv from private.member_invites where token = p_token for update;
  if v_inv.token is null then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That link is not one we sent.'); end if;
  select * into v_member from public.members where id = v_inv.member_id for update;
  if v_member.id is null or not v_member.is_active then
    return jsonb_build_object('ok', false, 'error', 'gone', 'message', 'That place in the home is no longer there. Ask for a new link.');
  end if;
  -- Already that member (the link tapped twice): nothing to link, just land there.
  if v_member.user_id = v_uid then
    insert into private.account_home (user_id, member_id) values (v_uid, v_member.id)
    on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
    perform set_config('fam.m.member', v_member.id::text, true);
    return jsonb_build_object('ok', true, 'already', true, 'household_id', v_inv.household_id, 'member_id', v_member.id, 'display_name', v_member.display_name);
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'used', 'message', 'That link has been used by someone else. Ask for a new one.');
  end if;
  if v_inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired', 'message', 'That link is older than a week. Ask for a new one.');
  end if;
  -- The row belongs to an account that has signed in: the link cannot take it over.
  if v_member.user_id is not null and private.user_signed_in(v_member.user_id) then
    return jsonb_build_object('ok', false, 'error', 'taken', 'message', 'Someone has already signed in as ' || v_member.display_name || '. Ask the admin to add you as yourself.');
  end if;
  -- One row per person per home: an account already in that home as someone else stays that
  -- someone, and one taken out of it (an inactive row) comes back only by being made active.
  select id, is_active into v_other, v_other_active from public.members where household_id = v_inv.household_id and user_id = v_uid;
  if v_other is not null and v_other_active then
    return jsonb_build_object('ok', false, 'error', 'already_member', 'message', 'You are already in this home.', 'household_id', v_inv.household_id, 'member_id', v_other);
  elsif v_other is not null then
    return jsonb_build_object('ok', false, 'error', 'inactive_member', 'message', 'You were in this home before. Ask the admin to make you active again instead.');
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  v_old := v_member.user_id;
  update public.members
     set user_id = v_uid,
         -- The row shows the e-mail they really sign in with, unless another row of the home has it.
         email = case when v_email is not null
                        and not exists (select 1 from public.members x where x.household_id = v_inv.household_id and x.email = v_email and x.id <> v_member.id)
                      then v_email else email end,
         updated_at = now()
   where id = v_member.id;
  -- A placeholder account that never signed in is of no use to anyone now.
  if v_old is not null and not private.user_signed_in(v_old) then
    delete from auth.users where id = v_old and last_sign_in_at is null;
  end if;
  update private.member_invites set used_at = now(), used_by = v_uid where token = p_token;
  insert into private.account_home (user_id, member_id) values (v_uid, v_member.id)
  on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
  perform set_config('fam.m.member', v_member.id::text, true);
  insert into public.audit_log (household_id, actor_user_id, actor_member, actor_role, module_id, action, allowed, target_table, target_id, detail)
  values (v_inv.household_id, v_uid, v_member.id, v_member.role_id, 'members', 'edit', true, 'members', v_member.id::text,
          jsonb_build_object('invite_accepted', true, 'replaced_account', v_old is not null));
  return jsonb_build_object('ok', true, 'household_id', v_inv.household_id, 'member_id', v_member.id, 'display_name', v_member.display_name);
end $$;
revoke execute on function public.member_invite_accept(uuid) from public, anon;
grant execute on function public.member_invite_accept(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Who in my home has signed in (for the Members screen)
-- ---------------------------------------------------------------------------
-- state per member: signed_in, never (an account exists that has not signed in), none.
create or replace function public.members_accounts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'members', (
    select coalesce(jsonb_object_agg(m.id, case
             when m.user_id is null then 'none'
             when private.user_signed_in(m.user_id) then 'signed_in'
             else 'never' end), '{}'::jsonb)
      from public.members m
     where m.household_id = private.current_household_id() and m.is_active));
end $$;
revoke execute on function public.members_accounts() from public, anon;
grant execute on function public.members_accounts() to authenticated, service_role;
