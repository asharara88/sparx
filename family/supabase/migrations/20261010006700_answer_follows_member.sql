-- Two older holes, found on 21 November 2026 while migration 6600 was attacked on a local database.
-- Neither is reached by the app's own requests, which are one call each.
--
--   1. The answer follows the member. has_permission keeps its answer for the transaction (migration
--      1600: policies ask once per row, thousands of times in a request). It kept it under the
--      question, 'fam.p.<module>.<action>', not under who asked, and five places change who the
--      member is inside a transaction: link_current_user and household_delete clear it, home_switch,
--      household_create and member_invite_accept set another. So several calls in ONE transaction
--      could make a home (its admin), ask "may I edit members" (yes, kept), switch back, and be
--      answered yes at home, then make themselves an admin there. The kept value is now
--      '<member uuid>:t' or ':f' and counts only while 'fam.m.member' is that member; otherwise the
--      answer is worked out again, as before. The fast path is still two settings read and two
--      string operations: no query, no function call.
--      What this does not do: a caller who could run raw SQL as the signed-in role could set these
--      settings by hand, as before (no such path exists for a member: the API exposes the app's own
--      schema only, and set_config is not in it). A role or a permission changed in mid-transaction
--      takes effect for the same member from the next request, as before. The once-a-transaction
--      audit marker of private.authz is still per question, which can lose an audit row for an
--      allowed read, never a decision.
--   2. A home with no member rows is nobody's to move into. household_create took the oldest such
--      home for the caller, with its child and its whole log. That was written for a fresh
--      deployment's seeded home (migration 3900); an admin who deleted every member row of a home
--      by hand left it for the next person who made one. It now happens only when there are no
--      member rows anywhere. Everything else in the function is as in migration 5700.
-- Both functions keep their owner (postgres: they read the token) and their grants.

-- ---------------------------------------------------------------------------
-- 1. has_permission: an answer counts for the member it was worked out for
-- ---------------------------------------------------------------------------
create or replace function public.has_permission(p_module text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_key text := 'fam.p.' || coalesce(p_module, '') || '.' || coalesce(p_action, '');
  v text := current_setting(v_key, true);
  v_m text := current_setting('fam.m.member', true);
  v_me uuid; v_ok boolean;
begin
  if v is not null and v <> '' and v_m is not null and v_m <> '' and left(v, 36) = v_m then return right(v, 1) = 't'; end if;
  v_me := public.current_member_id();
  if v_me is null then return false; end if;
  v_ok := (private.preview_member_id() is null or p_action = 'view' or coalesce(auth.jwt()->>'preview_mode', '') = 'full') and exists (
    select 1
    from public.members m
    join public.permissions p on p.role_id = m.role_id
    where m.id = v_me and m.is_active and p.module_id = p_module and p.action = p_action and p.allowed);
  perform set_config(v_key, v_me::text || case when v_ok then ':t' else ':f' end, true);
  return v_ok;
end $$;

-- ---------------------------------------------------------------------------
-- 2. household_create: the seeded home goes to the first family only
-- ---------------------------------------------------------------------------
create or replace function public.household_create(
  p_name text, p_timezone text, p_child_name text, p_child_birth_date date default null,
  p_child_sex text default null, p_display_name text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_tz text := coalesce(nullif(btrim(p_timezone), ''), 'Asia/Dubai');
  v_home uuid;
  v_member uuid;
  v_child uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.'); end if;
  if private.preview_member_id() is not null then
    return jsonb_build_object('ok', false, 'error', 'preview', 'message', 'Not while viewing the app as someone else.');
  end if;
  perform pg_advisory_xact_lock(hashtext('household_create'));
  perform public.link_current_user();
  if nullif(btrim(p_name), '') is null then return jsonb_build_object('ok', false, 'error', 'bad_input', 'message', 'Give the home a name.'); end if;
  if nullif(btrim(p_child_name), '') is null then return jsonb_build_object('ok', false, 'error', 'bad_input', 'message', 'What is the baby called?'); end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    return jsonb_build_object('ok', false, 'error', 'bad_input', 'message', 'That timezone is not one I know.');
  end if;
  if p_child_sex is not null and p_child_sex not in ('Girl', 'Boy') then
    return jsonb_build_object('ok', false, 'error', 'bad_input', 'message', 'Girl or Boy, or leave it out.');
  end if;
  select lower(email) into v_email from auth.users where id = v_uid;

  -- Only a deployment with nobody in it yet hands over its seeded home (migration 6700).
  select h.id into v_home from public.household h
   where not exists (select 1 from public.members)
   order by h.created_at limit 1;
  if v_home is not null then
    update public.household set name = btrim(p_name), timezone = v_tz, updated_at = now() where id = v_home;
  else
    insert into public.household (name, timezone) values (btrim(p_name), v_tz) returning id into v_home;
  end if;
  perform private.seed_home(v_home);
  insert into public.members (household_id, user_id, email, display_name, role_id, relationship)
  values (v_home, v_uid, v_email, coalesce(nullif(btrim(p_display_name), ''), initcap(split_part(coalesce(v_email, 'me'), '@', 1))), 'admin', 'Parent')
  returning id into v_member;
  insert into public.presence (household_id, member_id, state_id, starts_on) values (v_home, v_member, 'lives_here', current_date);
  insert into public.care_subjects (household_id, module_id, kind, name, birth_date, profile, sort)
  values (v_home, 'lana', 'child', btrim(p_child_name), p_child_birth_date,
          jsonb_strip_nulls(jsonb_build_object('sex', p_child_sex, 'names', '{}'::jsonb, 'emergency_ambulance', private.ambulance_for_timezone(v_tz))), 10)
  returning id into v_child;
  insert into private.account_home (user_id, member_id) values (v_uid, v_member)
  on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
  perform set_config('fam.m.member', v_member::text, true);
  perform private.audit_write('members', 'add', true, 'household', v_home::text, jsonb_build_object('created', true));
  return jsonb_build_object('ok', true, 'household_id', v_home, 'member_id', v_member, 'subject_id', v_child);
end $$;
