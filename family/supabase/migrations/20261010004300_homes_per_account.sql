-- One account in several homes. See docs/MULTI_HOME.md, phase 5.
--
-- A member row is one person in one home. An account may now hold one in each
-- home it was listed in: a grandmother in two children's homes, a parent who
-- made a second home. Which row a request runs as is the account's chosen home
-- (private.account_home), else its oldest row. home_switch chooses, my_homes
-- lists, household_create no longer turns away an account that has a home, and
-- an admin can delete a home by typing its name, taking every row it owns with
-- it. The first home on the deployment stays: it holds what every home shares.
--
-- The four functions that must see across homes stay with postgres, like
-- current_member_id and household_create before them (migration 4000).

-- ---------------------------------------------------------------------------
-- 1. One row per person per home: uniqueness moves from the account to (home, account), and the same for the e-mail
-- ---------------------------------------------------------------------------
alter table public.members drop constraint if exists members_user_id_key;
drop index if exists public.members_email_key;
create unique index if not exists members_home_user_key on public.members (household_id, user_id) where user_id is not null;
create unique index if not exists members_home_email_key on public.members (household_id, email) where email is not null;

-- ---------------------------------------------------------------------------
-- 2. The chosen home per account
-- ---------------------------------------------------------------------------
create table if not exists private.account_home (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  updated_at timestamptz not null default now()
);
revoke all on private.account_home from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who am I: the preview member, else the row a job names, else the chosen row, else the oldest
-- ---------------------------------------------------------------------------
create or replace function public.current_member_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v text := current_setting('fam.m.member', true); v_id uuid; v_preview uuid; v_named text;
begin
  if v is not null and v <> '' then return v::uuid; end if;
  v_preview := private.preview_member_id();
  if v_preview is not null then
    select id into v_id from public.members where id = v_preview and is_active;
  end if;
  -- A scheduled job's client names the member row it runs for (lib/server/member.ts), since
  -- an account in two homes has two rows and the job must not run both as the chosen home.
  -- Only a row of this very account counts.
  v_named := auth.jwt()->>'member_id';
  if v_id is null and auth.uid() is not null and v_named ~ '^[0-9a-f-]{36}$' then
    select id into v_id from public.members where id = v_named::uuid and user_id = auth.uid() and is_active;
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

-- Linking by e-mail now reaches every home that listed it, not only the first.
create or replace function public.link_current_user() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text; v_n integer := 0;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is not null then
    update public.members m set user_id = auth.uid()
     where m.email = v_email and m.user_id is null and m.is_active
       and not exists (select 1 from public.members x where x.household_id = m.household_id and x.user_id = auth.uid());
    get diagnostics v_n = row_count;
  end if;
  if v_n > 0 then perform set_config('fam.m.member', '', true); end if;
  return public.current_member_id();
end $$;

-- ---------------------------------------------------------------------------
-- 4. The homes I am in, and choosing one
-- ---------------------------------------------------------------------------
create or replace function public.my_homes() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'household_id', h.id, 'name', h.name, 'timezone', h.timezone,
           'member_id', m.id, 'display_name', m.display_name,
           'role_id', m.role_id, 'role_label', r.label,
           'current', m.id = public.current_member_id(),
           'platform', h.id = private.platform_home())
         order by (m.id = public.current_member_id()) desc, h.name, h.created_at), '[]'::jsonb)
    from public.members m
    join public.household h on h.id = m.household_id
    join public.roles r on r.id = m.role_id
   where m.user_id = auth.uid() and m.is_active
$$;
grant execute on function public.my_homes() to authenticated, service_role;

create or replace function public.home_switch(p_household_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_member uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.'); end if;
  if private.preview_member_id() is not null then
    return jsonb_build_object('ok', false, 'error', 'preview', 'message', 'Not while viewing the app as someone else.');
  end if;
  select id into v_member from public.members where household_id = p_household_id and user_id = auth.uid() and is_active;
  if v_member is null then return jsonb_build_object('ok', false, 'error', 'not_member', 'message', 'You are not in that home.'); end if;
  insert into private.account_home (user_id, member_id) values (auth.uid(), v_member)
  on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
  perform set_config('fam.m.member', v_member::text, true);
  return jsonb_build_object('ok', true, 'household_id', p_household_id, 'member_id', v_member);
end $$;
grant execute on function public.home_switch(uuid) to authenticated, service_role;

-- me() says how many homes the account is in, so the app shows the switcher only when it matters.
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

-- ---------------------------------------------------------------------------
-- 5. Creating a home no longer needs an account with none; the new home becomes the chosen one
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
  -- One home is made at a time: two first sign-ups in the same second would otherwise
  -- both find the seeded empty home free and move into it together.
  perform pg_advisory_xact_lock(hashtext('household_create'));
  -- An e-mail already on some home's list joins that home first; it may still make one of its own.
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

  -- A home nobody is in yet (the one a fresh deployment is seeded with) is taken over,
  -- starter rows and all; otherwise a new one is made and given its starters.
  select h.id into v_home from public.household h
   where not exists (select 1 from public.members m where m.household_id = h.id)
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
          jsonb_strip_nulls(jsonb_build_object('sex', p_child_sex, 'names', '{}'::jsonb)), 10)
  returning id into v_child;
  -- From now on the account runs as the home it just made.
  insert into private.account_home (user_id, member_id) values (v_uid, v_member)
  on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
  perform set_config('fam.m.member', v_member::text, true);
  perform private.audit_write('members', 'add', true, 'household', v_home::text, jsonb_build_object('created', true));
  return jsonb_build_object('ok', true, 'household_id', v_home, 'member_id', v_member, 'subject_id', v_child);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Deleting a home: its admin, by its exact name, never the first home
-- ---------------------------------------------------------------------------
-- Every table that belongs to a home references it with "on delete cascade", so
-- the one delete takes the members, the child, the log, the chat, the photos'
-- rows and the backups' rows with it. The files in the buckets are the app's
-- to remove afterwards (app/api/home/delete). The audit row is written without
-- a home, so it outlives the one it describes.
create or replace function public.household_delete(p_household_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_home public.household; v_me uuid; v_members integer; v_entries integer;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not_signed_in', 'message', 'Sign in first.'); end if;
  if private.preview_member_id() is not null then
    return jsonb_build_object('ok', false, 'error', 'preview', 'message', 'Not while viewing the app as someone else.');
  end if;
  select * into v_home from public.household where id = p_household_id;
  if v_home.id is null then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'No such home.'); end if;
  select id into v_me from public.members
   where household_id = p_household_id and user_id = auth.uid() and is_active and role_id = 'admin';
  if v_me is null then
    perform private.audit_write('members', 'delete', false, 'household', p_household_id::text, jsonb_build_object('delete_home', true));
    return private.denied('Only an admin of that home can delete it.');
  end if;
  if lower(btrim(coalesce(p_name, ''))) <> lower(btrim(v_home.name)) then
    return jsonb_build_object('ok', false, 'error', 'bad_name', 'message', 'Type the home''s name exactly as it is to delete it.');
  end if;
  if p_household_id = private.platform_home() then
    return jsonb_build_object('ok', false, 'error', 'platform',
      'message', 'This is the first home on elnunu; it holds what every home shares and cannot be deleted from the app.');
  end if;
  select count(*) into v_members from public.members where household_id = p_household_id;
  select count(*) into v_entries from public.care_entries where household_id = p_household_id;
  delete from public.household where id = p_household_id;
  insert into public.audit_log (actor_user_id, actor_member, actor_role, module_id, action, allowed, target_table, target_id, detail)
  values (auth.uid(), v_me, 'admin', 'members', 'delete', true, 'household', p_household_id::text,
          jsonb_build_object('name', v_home.name, 'members', v_members, 'entries', v_entries));
  perform set_config('fam.m.member', '', true);
  return jsonb_build_object('ok', true, 'name', v_home.name, 'members', v_members, 'entries', v_entries);
end $$;
grant execute on function public.household_delete(uuid, text) to authenticated, service_role;
