-- Running a deployment with many homes. See docs/MULTI_HOME.md, phase 4.
--
-- Shared definitions (roles, the permission matrix, entry types, the helper's
-- skills) are one set for every home, so only the first home's admins change
-- them: platform_home() names that home, me() says whether you are in it, and
-- the four editors refuse everyone else with a plain message. Backups are per
-- home now, so the backups table carries household_id and an admin lists only
-- their own.

create or replace function private.platform_home() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.household order by created_at, id limit 1
$$;
grant execute on function private.platform_home() to authenticated, service_role, app_rls;

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

-- The four editors of shared definitions: the first home's admins only.
create or replace function private.shared_locked() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when private.current_household_id() is distinct from private.platform_home()
    then jsonb_build_object('ok', false, 'error', 'shared', 'message', 'This is shared by every home on elnunu; only the first home''s admins change it.')
  end
$$;
grant execute on function private.shared_locked() to authenticated, service_role, app_rls;

create or replace function public.role_save(p_id text, p_label text, p_description text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'roles', p_id);
    return private.denied();
  end if;
  if private.shared_locked() is not null then return private.shared_locked(); end if;
  insert into public.roles (id, label, description) values (p_id, btrim(p_label), nullif(btrim(p_description), ''))
  on conflict (id) do update set label = excluded.label, description = excluded.description;
  insert into public.permissions (role_id, module_id, action)
  select p_id, m.id, a from public.modules m cross join unnest(array['view','add','edit','delete']) a
  on conflict do nothing;
  perform private.audit_write('members', 'edit', true, 'roles', p_id);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.permission_set(p_role_id text, p_module_id text, p_action text, p_allowed boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'permissions', p_role_id || '/' || p_module_id || '/' || p_action);
    return private.denied();
  end if;
  if private.shared_locked() is not null then return private.shared_locked(); end if;
  if not p_allowed and p_module_id = 'members' and p_action in ('view', 'edit')
     and p_role_id = private.current_role_id() then
    return jsonb_build_object('ok', false, 'error', 'lockout', 'message', 'Your own role must keep access to Members.');
  end if;
  insert into public.permissions (role_id, module_id, action, allowed)
  values (p_role_id, p_module_id, p_action, p_allowed)
  on conflict (role_id, module_id, action) do update set allowed = excluded.allowed;
  perform private.audit_write('members', 'edit', true, 'permissions', p_role_id || '/' || p_module_id || '/' || p_action,
                              jsonb_build_object('allowed', p_allowed));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.entry_type_save(p_id text, p_module_id text, p_key text, p_label text, p_icon text default null, p_color text default null, p_sort integer default 100, p_has_end boolean default false, p_due_after_min integer default null, p_fields jsonb default '[]'::jsonb, p_show_on_home boolean default false, p_is_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(p_id, p_module_id || '.' || p_key);
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'care_entry_types', v_id);
    return private.denied('Only an admin changes the entry types.');
  end if;
  if private.shared_locked() is not null then return private.shared_locked(); end if;
  if p_key !~ '^[a-z][a-z0-9_]*$' then return jsonb_build_object('ok', false, 'error', 'bad_key', 'message', 'The key is lowercase letters, digits and underscores.'); end if;
  if jsonb_typeof(p_fields) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_fields', 'message', 'Fields must be a JSON list.'); end if;
  if not exists (select 1 from public.modules where id = p_module_id) then return jsonb_build_object('ok', false, 'error', 'bad_module'); end if;
  insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active)
  values (v_id, p_module_id, p_key, btrim(p_label), nullif(btrim(p_icon), ''), nullif(btrim(p_color), ''), coalesce(p_sort, 100), coalesce(p_has_end, false), p_due_after_min, p_fields, coalesce(p_show_on_home, false), coalesce(p_is_active, true))
  on conflict (id) do update set label = excluded.label,
    icon = coalesce(excluded.icon, public.care_entry_types.icon),
    color = coalesce(excluded.color, public.care_entry_types.color),
    sort = excluded.sort, has_end = excluded.has_end,
    due_after_min = excluded.due_after_min, fields = excluded.fields, show_on_home = excluded.show_on_home, is_active = excluded.is_active;
  perform private.audit_write('members', 'edit', true, 'care_entry_types', v_id, jsonb_build_object('active', p_is_active));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
alter function public.entry_type_save(text, text, text, text, text, text, integer, boolean, integer, jsonb, boolean, boolean) owner to app_rls;

create or replace function public.skill_save(p_id text, p_title text, p_when text, p_triggers text[], p_body text, p_sources text default '', p_always_on boolean default false, p_age_from_days integer default null, p_age_to_days integer default null, p_sort integer default 100, p_is_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := lower(btrim(coalesce(p_id, '')));
begin
  if not private.authz('assistant', 'edit', 'assistant_skills', v_id) then return private.denied(); end if;
  if private.shared_locked() is not null then return private.shared_locked(); end if;
  if v_id !~ '^[a-z][a-z0-9_]{1,40}$' then return jsonb_build_object('ok', false, 'error', 'bad_id', 'message', 'Id: letters, digits and _ only.'); end if;
  if length(btrim(coalesce(p_title, ''))) < 2 or length(btrim(coalesce(p_body, ''))) < 20 then return jsonb_build_object('ok', false, 'error', 'bad_skill', 'message', 'A title and a body of at least 20 characters.'); end if;
  if length(p_body) > 6000 then return jsonb_build_object('ok', false, 'error', 'too_long', 'message', 'Keep a skill under 6000 characters; split it.'); end if;
  insert into public.assistant_skills (id, title, "when", triggers, body, sources, always_on, age_from_days, age_to_days, sort, is_active, updated_by)
  values (v_id, btrim(p_title), btrim(coalesce(p_when, '')), coalesce(p_triggers, '{}'), btrim(p_body), btrim(coalesce(p_sources, '')), coalesce(p_always_on, false), p_age_from_days, p_age_to_days, coalesce(p_sort, 100), coalesce(p_is_active, true), public.current_member_id())
  on conflict (id) do update set
    title = excluded.title, "when" = excluded."when", triggers = excluded.triggers, body = excluded.body, sources = excluded.sources,
    always_on = excluded.always_on, age_from_days = excluded.age_from_days, age_to_days = excluded.age_to_days, sort = excluded.sort,
    is_active = excluded.is_active, version = public.assistant_skills.version + 1, updated_at = now(), updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
alter function public.skill_save(text, text, text, text[], text, text, boolean, integer, integer, integer, boolean) owner to app_rls;

-- Backups per home: an admin lists their own; rows from before (no home) stay with the first home.
alter table public.backups add column if not exists household_id uuid references public.household (id) on delete cascade;
update public.backups set household_id = private.platform_home() where household_id is null;
create index if not exists backups_household_idx on public.backups (household_id);
drop policy if exists backups_read on public.backups;
create policy backups_read on public.backups for select to authenticated
  using (public.has_permission('audit', 'view') and household_id = private.current_household_id());

-- Photos per home. The bucket policies checked only the photos permission, so a
-- member of one home could sign a URL for any other home's photo by path. New
-- uploads go under home-<id>/…; what was uploaded before many homes (no home
-- folder) is the first home's.
create or replace function private.photo_in_my_home(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_name like 'home-%/%'
    then split_part(p_name, '/', 1) = 'home-' || private.current_household_id()::text
    else private.current_household_id() = private.platform_home() end
$$;
grant execute on function private.photo_in_my_home(text) to authenticated, service_role, app_rls;
drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.has_permission('photos', 'view') and private.photo_in_my_home(name));
drop policy if exists photos_add on storage.objects;
create policy photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.has_permission('photos', 'add') and private.photo_in_my_home(name));
