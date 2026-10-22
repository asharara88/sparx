-- A request that names a home gets that home or nothing.
--
-- Since 4500 a request names the home its screen shows (the x-home header) and
-- runs as the account's row there. When the account had no row in that home the
-- request fell through to the account's chosen home, so a phone still showing a
-- home the account was removed from, or a home since deleted, wrote its next
-- entry into another home. Now a named home the account is not in is a refusal:
-- current_member_id() is null, every policy and RPC says no, and me() says
-- not_in_home with the homes the account is in, so the screen can offer them.
-- Only a request that names no home starts from the account's choice.

create or replace function public.current_member_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v text := current_setting('fam.m.member', true); v_id uuid; v_preview uuid; v_named text; v_home uuid;
begin
  if v is not null and v <> '' then return v::uuid; end if;
  v_preview := private.preview_member_id();
  if v_preview is not null then
    select id into v_id from public.members where id = v_preview and is_active;
  end if;
  v_named := auth.jwt()->>'member_id';
  if v_id is null and auth.uid() is not null and v_named ~ '^[0-9a-f-]{36}$' then
    select id into v_id from public.members where id = v_named::uuid and user_id = auth.uid() and is_active;
  end if;
  v_home := private.header_home();
  if v_id is null and auth.uid() is not null and v_home is not null then
    select id into v_id from public.members where household_id = v_home and user_id = auth.uid() and is_active;
    -- The request named a home the account is not in: nobody, not another home.
    if v_id is null then return null; end if;
  end if;
  if v_id is null and auth.uid() is not null then
    select m.id into v_id
      from private.account_home a join public.members m on m.id = a.member_id
     where a.user_id = auth.uid() and m.user_id = auth.uid() and m.is_active;
  end if;
  if v_id is null and auth.uid() is not null then
    select id into v_id from public.members where user_id = auth.uid() and is_active order by created_at, id limit 1;
  end if;
  if v_id is not null then perform set_config('fam.m.member', v_id::text, true); end if;
  return v_id;
end $$;

create or replace function public.me() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_member public.members;
  v_preview boolean := coalesce(auth.jwt()->>'preview_member', '') <> '';
begin
  if auth.uid() is null and not v_preview then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.');
  end if;
  if not v_preview then perform public.link_current_user(); end if;
  select * into v_member from public.members where id = public.current_member_id() and is_active;
  if v_member.id is null then
    -- The device named a home this account is not in (removed from it, or it was deleted) while it is in others.
    if not v_preview and private.header_home() is not null and jsonb_array_length(public.my_homes()) > 0 then
      return jsonb_build_object('ok', false, 'error', 'not_in_home',
        'message', 'This device was showing a home you are no longer in. Pick one of your homes to carry on.',
        'homes', public.my_homes());
    end if;
    return jsonb_build_object('ok', false, 'error', 'no_member',
      'message', 'You are not in a home yet. Create your home, or ask the admin of your family''s home to add your e-mail.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'preview', v_preview,
    'platform', v_member.household_id = private.platform_home(),
    'homes', jsonb_array_length(public.my_homes()),
    'member', to_jsonb(v_member),
    'role', (select to_jsonb(r) from public.roles r where r.id = v_member.role_id),
    'permissions', (
      select coalesce(jsonb_object_agg(s.module_id, s.acts), '{}'::jsonb)
      from (select module_id, jsonb_object_agg(action, allowed) as acts
            from public.permissions where role_id = v_member.role_id group by module_id) s),
    'presence', (select to_jsonb(p) from public.current_presence(v_member.id) p where p.id is not null),
    'work_days', (select coalesce(jsonb_agg(weekday order by weekday), '[]'::jsonb) from public.work_schedules where member_id = v_member.id),
    'household', (select to_jsonb(h) from public.household h where h.id = v_member.household_id),
    'subjects', private.subject_names()
  );
end $$;
