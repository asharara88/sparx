-- Many homes in one deployment. See docs/MULTI_HOME.md.
--
-- The household table gets a real id and many rows. Every table a family writes
-- gets household_id, filled from the one home that exists, defaulting to the
-- caller's home from now on, and a restrictive row-security policy that keeps
-- each home to itself on top of the permission policies already there. The
-- helpers that definer functions trust answer only for the caller's home.
-- household_create lets a signed-in account with no home make one.

-- ---------------------------------------------------------------------------
-- 1. The household table: uuid id, many rows
-- ---------------------------------------------------------------------------
alter table public.household add column if not exists hid uuid not null default gen_random_uuid();
alter table public.household add column if not exists created_at timestamptz not null default now();
alter table public.household drop constraint if exists household_pkey;
alter table public.household drop column if exists id;
alter table public.household rename column hid to id;
alter table public.household add primary key (id);

-- ---------------------------------------------------------------------------
-- 2. Whose home is this request for
-- ---------------------------------------------------------------------------
-- members gets its column first: the helper below reads it and SQL functions are
-- checked when they are created.
alter table public.members add column if not exists household_id uuid references public.household (id) on delete cascade;

create or replace function private.current_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.members where id = public.current_member_id()
$$;

-- While a deployment has exactly one home, a row written with no member (a script
-- with the service role) lands there. With two or more, the writer must say which.
create or replace function private.only_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select case when (select count(*) from public.household) = 1 then (select id from public.household limit 1) end
$$;

create or replace function private.home_for_new_rows() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(private.current_household_id(), private.only_household_id())
$$;

-- Policies and column defaults run as the signed-in role, so these are callable by it.
grant execute on function private.current_household_id(), private.only_household_id(), private.home_for_new_rows() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. household_id on every home-scoped table, with its restrictive policy
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_home uuid := (select id from public.household order by created_at limit 1);
  v_tables text[] := array[
    'members', 'presence', 'work_schedules', 'attendance',
    'care_subjects', 'care_entries', 'care_custody', 'care_routines', 'medicines', 'vaccinations',
    'milk_bottles', 'bag_items', 'activity_done', 'coach_plans', 'coach_checkins',
    'calendar_events', 'notes', 'family_messages', 'attachments',
    'shopping_items', 'shopping_item_aliases', 'shopping_requests', 'shelf_items', 'purchases',
    'cart_runs', 'receipts', 'receipt_lines',
    'tickets', 'ticket_updates', 'ticket_costs', 'contractors', 'assets', 'hub_entities',
    'suggestions', 'notifications', 'push_subscriptions',
    'ask_chats', 'assistant_briefs', 'assistant_memories',
    'audit_log'
  ];
begin
  foreach t in array v_tables loop
    execute format('alter table public.%I add column if not exists household_id uuid references public.household (id) on delete cascade', t);
    if v_home is not null then
      execute format('update public.%I set household_id = $1 where household_id is null', t) using v_home;
    end if;
    -- audit_log keeps rows written by no member (a refused call from an account with no home)
    if t <> 'audit_log' then
      execute format('alter table public.%I alter column household_id set not null', t);
    end if;
    execute format('alter table public.%I alter column household_id set default private.home_for_new_rows()', t);
    execute format('create index if not exists %I on public.%I (household_id)', t || '_household_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_home', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (household_id = private.current_household_id()) with check (household_id = private.current_household_id())',
      t || '_home', t);
  end loop;
end $$;

-- The home row itself: only your own.
drop policy if exists household_read on public.household;
create policy household_read on public.household for select to authenticated using (id = private.current_household_id());
drop policy if exists household_home on public.household;
create policy household_home on public.household as restrictive for all to authenticated
  using (id = private.current_household_id()) with check (id = private.current_household_id());

-- A fresh deployment's seeded home has nobody in it yet. It stays: the first family
-- to set up (the setup script, or household_create below) takes it over, starter
-- rows and all, so there is still exactly one home and scripts need not name it.

-- ---------------------------------------------------------------------------
-- 4. The helpers definer functions trust answer only for the caller's home
-- ---------------------------------------------------------------------------
create or replace function private.subject_module(p_subject uuid) returns text
language sql stable security definer set search_path = public as $$
  select module_id from public.care_subjects
   where id = p_subject and is_active and household_id = private.current_household_id()
$$;

create or replace function private.default_subject(p_kind text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.care_subjects
   where kind = p_kind and is_active and household_id = private.current_household_id()
   order by sort, created_at limit 1
$$;

create or replace function private.entry_module(p_entry uuid) returns text
language sql stable security definer set search_path = public as $$
  select module_id from public.care_entries
   where id = p_entry and household_id = private.current_household_id()
$$;

create or replace function private.admin_names() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(display_name, ' or ' order by created_at), 'an admin')
    from public.members
   where role_id = 'admin' and is_active and household_id = private.current_household_id()
$$;

create or replace function private.subject_names() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'module_id', s.module_id, 'kind', s.kind, 'name', s.name,
           'birth_date', s.birth_date, 'names', coalesce(s.profile->'names', '{}'::jsonb),
           'sex', s.profile->>'sex') order by s.sort, s.name), '[]'::jsonb)
    from public.care_subjects s
   where s.is_active and s.household_id = private.current_household_id()
$$;

-- ---------------------------------------------------------------------------
-- 5. household_save by id, me() by id
-- ---------------------------------------------------------------------------
create or replace function public.household_save(p_name text, p_notes text, p_milk_target_ml integer) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_home uuid := private.current_household_id();
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'household', v_home::text);
    return private.denied('Only an admin can change the household.');
  end if;
  update public.household h
     set name = coalesce(nullif(btrim(p_name), ''), h.name),
         notes = nullif(btrim(p_notes), ''),
         milk_target_ml = coalesce(p_milk_target_ml, h.milk_target_ml),
         updated_at = now()
   where h.id = v_home;
  perform private.audit_write('members', 'edit', true, 'household', v_home::text, jsonb_build_object('milk_target_ml', p_milk_target_ml));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.household_save(p_name text, p_notes text, p_milk_target_ml integer, p_bottle_interval_min integer) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v jsonb;
begin
  v := public.household_save(p_name, p_notes, p_milk_target_ml);
  if (v->>'ok')::boolean and p_bottle_interval_min is not null then
    update public.household h set bottle_interval_min = p_bottle_interval_min where h.id = private.current_household_id();
  end if;
  return v;
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
    return jsonb_build_object('ok', false, 'error', 'no_member',
      'message', 'You are not in a home yet. Create your home, or ask the admin of your family''s home to add your e-mail.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'preview', v_preview,
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
-- 6. Create a home
-- ---------------------------------------------------------------------------
-- What every new home starts with: the shelf of usual items the home carer taps.
create or replace function private.seed_home(p_home uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.shelf_items (household_id, name, category, emoji, sort)
  select p_home, v.name, v.category, v.emoji, v.sort from (values
    ('Milk', 'groceries', '🥛', 10), ('Bread', 'groceries', '🍞', 11), ('Eggs', 'groceries', '🥚', 12), ('Water', 'groceries', '💧', 13),
    ('Nappies', 'baby', '👶', 20), ('Wipes', 'baby', '🧻', 21), ('Formula', 'baby', '🍼', 22),
    ('Dish soap', 'home', '🧽', 40), ('Laundry soap', 'home', '🧺', 41), ('Toilet paper', 'home', '🧻', 42), ('Bin bags', 'home', '🗑️', 43)
  ) as v(name, category, emoji, sort)
  where not exists (select 1 from public.shelf_items s where s.household_id = p_home);
end $$;

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
  -- An e-mail already on some home's list joins that home; it never makes a second one.
  perform public.link_current_user();
  if exists (select 1 from public.members where user_id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'error', 'already_member', 'message', 'You are already in a home.');
  end if;
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
  perform private.audit_write('members', 'add', true, 'household', v_home::text, jsonb_build_object('created', true));
  return jsonb_build_object('ok', true, 'household_id', v_home, 'member_id', v_member, 'subject_id', v_child);
end $$;
grant execute on function public.household_create(text, text, text, date, text, text) to authenticated, service_role;
