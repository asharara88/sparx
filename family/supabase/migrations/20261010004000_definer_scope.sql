-- Definer functions see one home too. See docs/MULTI_HOME.md, phase 3.
--
-- Migration 3900 scoped every table with a restrictive row-security policy,
-- but a function marked security definer runs as its owner, and the owner was
-- postgres, which bypasses row security on Supabase. So bag_reset() unchecked
-- every home's bag and memory_list() listed every home's memories, policy or no
-- policy. Rather than edit 49 functions one by one, they now belong to app_rls,
-- a role row security applies to: inside them the home policy filters every
-- read and write, and a permissive policy for app_rls gives them, within that
-- home, all the power they had. The few that must see across homes (who am I,
-- what may I do, link my account, create a home) stay with postgres.

-- ---------------------------------------------------------------------------
-- 1. The role
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_rls') then create role app_rls nologin; end if;
end $$;
grant app_rls to postgres;
grant usage on schema public, private, auth to app_rls;
-- Giving a function to app_rls needs the new owner to hold CREATE on the function's schema
-- (a rule a superuser never meets; hosted Supabase's postgres is not one).
grant create on schema public, private to app_rls;
grant select on auth.users to app_rls;
grant all on all tables in schema public to app_rls;
grant usage, select on all sequences in schema public to app_rls;
grant execute on all functions in schema public to app_rls;
grant execute on all functions in schema private to app_rls;
alter default privileges for role postgres in schema public grant all on tables to app_rls;
alter default privileges for role postgres in schema public grant usage, select on sequences to app_rls;
alter default privileges for role postgres in schema public grant execute on functions to app_rls;
alter default privileges for role postgres in schema private grant execute on functions to app_rls;

-- ---------------------------------------------------------------------------
-- 2. Policies: everything within the home for app_rls; the home policy applies to it too
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_home_scoped text[] := array[
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
  v_shared text[] := array[
    'roles', 'modules', 'permissions', 'care_entry_types', 'presence_states', 'vaccine_schedule',
    'activities', 'stores', 'assistant_skills', 'backups'
  ];
begin
  foreach t in array v_home_scoped loop
    execute format('drop policy if exists %I on public.%I', t || '_app', t);
    execute format('create policy %I on public.%I for all to app_rls using (true) with check (true)', t || '_app', t);
    execute format('drop policy if exists %I on public.%I', t || '_home', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated, app_rls using (household_id = private.current_household_id()) with check (household_id = private.current_household_id())',
      t || '_home', t);
  end loop;
  foreach t in array v_shared loop
    execute format('drop policy if exists %I on public.%I', t || '_app', t);
    execute format('create policy %I on public.%I for all to app_rls using (true) with check (true)', t || '_app', t);
  end loop;
end $$;

-- audit_log: a refused call from an account with no home writes a row with no home;
-- app_rls (audit_write stays with postgres, but definer functions read audit rows too)
drop policy if exists audit_log_home on public.audit_log;
create policy audit_log_home on public.audit_log as restrictive for all to authenticated, app_rls
  using (household_id = private.current_household_id()) with check (household_id is null or household_id = private.current_household_id());

drop policy if exists household_app on public.household;
create policy household_app on public.household for all to app_rls using (true) with check (true);
drop policy if exists household_home on public.household;
create policy household_home on public.household as restrictive for all to authenticated, app_rls
  using (id = private.current_household_id()) with check (id = private.current_household_id());

-- ---------------------------------------------------------------------------
-- 3. Ownership: every definer function in public and private, except the ones that must see across homes
-- ---------------------------------------------------------------------------
-- In private, the helpers that read a home's data (subject_module, match_item, learn_reorder,
-- suggest, admin_names…) go to app_rls as well. What stays with postgres there: the home
-- helpers the policies themselves use, the audit writer (a refused call from an account in
-- no home writes a row with no home), the auth trigger and the module-filling triggers, and
-- seed_home, which household_create fills a brand-new home with.
do $$
declare
  f record;
  v_keep text[] := array['current_member_id', 'has_permission', 'link_current_user', 'household_create', 'me'];
  v_keep_private text[] := array['current_household_id', 'only_household_id', 'home_for_new_rows', 'audit_write',
    'auth_user_id_by_email', 'handle_auth_user_created', 'care_custody_fill_module', 'care_entries_fill_module', 'seed_home'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef and ((n.nspname = 'public' and not (p.proname = any (v_keep)))
                         or (n.nspname = 'private' and not (p.proname = any (v_keep_private))))
  loop
    execute format('alter function %s owner to app_rls', f.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Three functions that answered "ok" for a row they could not see
-- ---------------------------------------------------------------------------
-- Under the home policy a foreign id is simply not found. These three updated or
-- inserted blind and reported success; they look first now. attendance_toggle
-- even clocked in a member of another home, into the caller's home.
create or replace function public.note_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  select author into v_author from public.notes where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_author is distinct from public.current_member_id() and not public.has_permission('notes', 'delete') then
    perform private.audit_write('notes', 'delete', false, 'notes', p_id::text);
    return private.denied();
  end if;
  update public.notes set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('notes', 'delete', true, 'notes', p_id::text);
  return jsonb_build_object('ok', true);
end $$;
alter function public.note_remove(uuid) owner to app_rls;

create or replace function public.member_photo_save(p_member_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not exists (select 1 from public.members where id = p_member_id) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_member_id <> public.current_member_id() and not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'members', p_member_id::text);
    return private.denied();
  end if;
  update public.members set photo_path = nullif(btrim(p_path), ''), updated_at = now() where id = p_member_id;
  perform private.audit_write('members', 'edit', true, 'members', p_member_id::text, jsonb_build_object('photo', p_path is not null));
  return jsonb_build_object('ok', true);
end $$;
alter function public.member_photo_save(uuid, text) owner to app_rls;

create or replace function public.attendance_toggle(p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_target uuid := coalesce(p_member_id, public.current_member_id()); v_open uuid;
begin
  if v_me is null then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if not exists (select 1 from public.members where id = v_target and is_active) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_target <> v_me and not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'attendance', v_target::text);
    return private.denied();
  end if;
  select id into v_open from public.attendance where member_id = v_target and out_at is null order by in_at desc limit 1;
  if v_open is not null then
    update public.attendance set out_at = now() where id = v_open;
    perform private.audit_write('members', 'view', true, 'attendance', v_open::text, jsonb_build_object('out', true, 'member', v_target));
    return jsonb_build_object('ok', true, 'state', 'out', 'id', v_open);
  end if;
  insert into public.attendance (member_id, logged_by) values (v_target, v_me) returning id into v_open;
  perform private.audit_write('members', 'view', true, 'attendance', v_open::text, jsonb_build_object('in', true, 'member', v_target));
  return jsonb_build_object('ok', true, 'state', 'in', 'id', v_open);
end $$;
alter function public.attendance_toggle(uuid) owner to app_rls;

-- ---------------------------------------------------------------------------
-- 5. A row cannot point at a member or a child of another home, whoever writes it
-- ---------------------------------------------------------------------------
create unique index if not exists members_home_id_key on public.members (household_id, id);
create unique index if not exists care_subjects_home_id_key on public.care_subjects (household_id, id);
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('presence', 'member_id', 'members'), ('work_schedules', 'member_id', 'members'), ('attendance', 'member_id', 'members'),
      ('suggestions', 'member_id', 'members'), ('notifications', 'member_id', 'members'), ('push_subscriptions', 'member_id', 'members'),
      ('ask_chats', 'member_id', 'members'), ('assistant_briefs', 'member_id', 'members'),
      ('care_custody', 'member_id', 'members'), ('coach_plans', 'member_id', 'members'),
      ('care_entries', 'subject_id', 'care_subjects'), ('care_custody', 'subject_id', 'care_subjects'),
      ('care_routines', 'subject_id', 'care_subjects'), ('medicines', 'subject_id', 'care_subjects'),
      ('vaccinations', 'subject_id', 'care_subjects'), ('activity_done', 'subject_id', 'care_subjects'),
      ('coach_plans', 'subject_id', 'care_subjects')
    ) as v(tbl, col, ref)
  loop
    if not exists (select 1 from pg_constraint where conname = r.tbl || '_' || r.col || '_home_fkey') then
      execute format('alter table public.%I add constraint %I foreign key (household_id, %I) references public.%I (household_id, id)',
        r.tbl, r.tbl || '_' || r.col || '_home_fkey', r.col, r.ref);
    end if;
  end loop;
end $$;
