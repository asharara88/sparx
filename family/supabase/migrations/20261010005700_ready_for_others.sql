-- Ready for other families: three things a stranger's home must not inherit from ours.
--
--   1. A daily allowance for the helper's model calls. Every home's questions, briefs,
--      chat reads, milk photos and week plans run on one Anthropic key; nothing capped
--      them. The server books a slot (assistant_reserve) before each model call, under
--      one lock, so requests sent together cannot all slip past the last free slot: the
--      booking is the count. Limits come from household.settings (assistant_daily_home,
--      assistant_daily_member; 40 and 20 by default, none for the platform home), per
--      home in the home's own day and per member, plus a deployment-wide cap per UTC day
--      that the server passes in (ASSISTANT_DAILY_TOTAL). See lib/assistant/allowance.ts.
--   2. A member row is linked to an account by e-mail only once that e-mail is
--      confirmed. With Supabase's "Confirm email" off, every account is confirmed the
--      moment it is made, so this rule only bites once that switch is on; it is the
--      right rule either way. Invite links (migration 5300) are unchanged: the link
--      itself proves the invite.
--   3. The emergency number is the child's (profile.emergency_ambulance, as the
--      emergency card already reads it), not 998 everywhere: a new home gets it from
--      its time zone where the number is certain, and the shared skills say "the local
--      emergency number". The app shows the child's number, or none.

-- ---------------------------------------------------------------------------
-- 1. The allowance
-- ---------------------------------------------------------------------------
alter table public.household add column if not exists settings jsonb not null default '{}'::jsonb;

-- The limits are the platform's, not the home's: an admin may edit the home's row from
-- the client (household_edit), but not its settings. Only the database's own roles
-- (a migration, the SQL editor, the server's service role) change them.
create or replace function private.household_settings_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.settings is distinct from (case when tg_op = 'UPDATE' then old.settings else '{}'::jsonb end) then
    raise exception 'household settings are set by the platform' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function private.household_settings_guard() from public, anon;
drop trigger if exists household_settings_guard on public.household;
create trigger household_settings_guard before insert or update of settings on public.household
  for each row execute function private.household_settings_guard();

-- One row per model call, written before the call is made. Home-scoped like every other
-- table; nobody reads it from the client. No foreign keys on purpose: a deleted home or
-- member must not take the day's spent calls with it (delete a home, make a new one, and
-- the deployment-wide total would start again). A few bytes a call; nothing else reads it.
create table if not exists public.agent_calls (
  id bigint generated always as identity primary key,
  household_id uuid not null,
  member_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists agent_calls_home_at_idx on public.agent_calls (household_id, at desc);
create index if not exists agent_calls_at_idx on public.agent_calls (at);
alter table public.agent_calls enable row level security;
revoke all on public.agent_calls from anon, authenticated;
drop policy if exists agent_calls_app on public.agent_calls;
create policy agent_calls_app on public.agent_calls for all to app_rls using (true) with check (true);
drop policy if exists agent_calls_home on public.agent_calls;
create policy agent_calls_home on public.agent_calls as restrictive for all to authenticated, app_rls
  using (household_id = private.current_household_id()) with check (household_id = private.current_household_id());

-- Every home's model calls since midnight UTC: one number, nothing else. Sees across
-- homes, so it stays with postgres (on the suite's exception list).
create or replace function private.agent_calls_total_today() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.agent_calls
   where at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
$$;
revoke execute on function private.agent_calls_total_today() from public, anon;
grant execute on function private.agent_calls_total_today() to authenticated, service_role, app_rls;

-- Books one model call for the caller if the day's limits allow it, and says what the
-- counts were before booking. p_total is the deployment-wide cap (null: none); the
-- server passes it from its environment. One lock for every home makes check-and-book
-- one step, so the total holds too; it is held for a count and an insert, nothing more.
create or replace function public.assistant_reserve(p_total integer default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_tz text;
  v_settings jsonb;
  v_start timestamptz;
  v_platform boolean;
  v_home_n integer;
  v_me_n integer;
  v_total_n integer;
  v_home_limit integer;
  v_me_limit integer;
  v_ok boolean;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  perform pg_advisory_xact_lock(hashtext('assistant_reserve'));
  select coalesce(timezone, 'UTC'), coalesce(settings, '{}'::jsonb) into v_tz, v_settings from public.household where id = v_home;
  v_start := ((now() at time zone v_tz)::date)::timestamp at time zone v_tz;
  v_platform := v_home = private.platform_home();
  -- A set value wins (a number, or JSON null for no limit); otherwise 40 and 20, none for the platform home.
  v_home_limit := case when v_settings ? 'assistant_daily_home'
                       then case when v_settings->>'assistant_daily_home' ~ '^\d+$' then (v_settings->>'assistant_daily_home')::integer end
                       when v_platform then null else 40 end;
  v_me_limit := case when v_settings ? 'assistant_daily_member'
                     then case when v_settings->>'assistant_daily_member' ~ '^\d+$' then (v_settings->>'assistant_daily_member')::integer end
                     when v_platform then null else 20 end;
  select count(*) into v_home_n from public.agent_calls where household_id = v_home and at >= v_start;
  select count(*) into v_me_n from public.agent_calls where household_id = v_home and member_id = v_me and at >= v_start;
  v_total_n := private.agent_calls_total_today();
  v_ok := (p_total is null or p_total < 0 or v_total_n < p_total)
      and (v_home_limit is null or v_home_n < v_home_limit)
      and (v_me_limit is null or v_me_n < v_me_limit);
  if v_ok then
    insert into public.agent_calls (household_id, member_id) values (v_home, v_me);
  end if;
  return jsonb_build_object(
    'ok', true,
    'reserved', v_ok,
    'platform', v_platform,
    'home_calls', v_home_n,
    'member_calls', v_me_n,
    'home_limit', v_home_limit,
    'member_limit', v_me_limit,
    'total_calls', v_total_n);
end $$;
alter function public.assistant_reserve(integer) owner to app_rls;
revoke execute on function public.assistant_reserve(integer) from public, anon;
grant execute on function public.assistant_reserve(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Link by e-mail only once it is confirmed
-- ---------------------------------------------------------------------------
create or replace function private.handle_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Unconfirmed: wait. link_current_user() links at the first sign-in after confirming.
  if new.email_confirmed_at is null then return new; end if;
  update public.members
     set user_id = new.id
   where email = lower(new.email)
     and user_id is null;
  return new;
end $$;

create or replace function public.link_current_user() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_email text; v_n integer := 0;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is not null then
    update public.members m set user_id = auth.uid()
     where m.email = v_email and m.user_id is null and m.is_active
       and not exists (select 1 from public.members x where x.household_id = m.household_id and x.user_id = auth.uid());
    get diagnostics v_n = row_count;
  end if;
  if v_n > 0 then perform set_config('fam.m.member', '', true); end if;
  return public.current_member_id();
end $$;

create or replace function private.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) and email_confirmed_at is not null limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3. The emergency number is the child's
-- ---------------------------------------------------------------------------
-- Only where the number is certain for the whole time zone; anywhere else the family
-- types it on the emergency card, and the app says "your local emergency number".
create or replace function private.ambulance_for_timezone(p_tz text) returns text
language sql immutable set search_path = public as $$
  select case p_tz
    when 'Asia/Dubai' then '998'
    when 'Asia/Riyadh' then '997'
    when 'Africa/Cairo' then '123'
    when 'Europe/London' then '999'
    else null end
$$;
revoke execute on function private.ambulance_for_timezone(text) from public, anon;
grant execute on function private.ambulance_for_timezone(text) to authenticated, service_role, app_rls;

-- As in migration 4300, with the child's emergency number from the time zone.
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
          jsonb_strip_nulls(jsonb_build_object('sex', p_child_sex, 'names', '{}'::jsonb, 'emergency_ambulance', private.ambulance_for_timezone(v_tz))), 10)
  returning id into v_child;
  insert into private.account_home (user_id, member_id) values (v_uid, v_member)
  on conflict (user_id) do update set member_id = excluded.member_id, updated_at = now();
  perform set_config('fam.m.member', v_member::text, true);
  perform private.audit_write('members', 'add', true, 'household', v_home::text, jsonb_build_object('created', true));
  return jsonb_build_object('ok', true, 'household_id', v_home, 'member_id', v_member, 'subject_id', v_child);
end $$;

-- The shared skills name no country's number.
update public.assistant_skills
   set body = regexp_replace(body, '\m998\M', 'the local emergency number', 'g'),
       version = version + 1, updated_at = now()
 where body ~ '\m998\M';
