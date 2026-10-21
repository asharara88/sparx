-- Any household. The schema stops knowing the family: who lives here, the child and
-- the pet come from scripts/setup-household.mjs and a config file, not from a
-- migration. For the app to say the child's name instead of a fixed one, me() now
-- carries the care subjects (id, kind, name, birth date, the name in other languages,
-- sex), readable by every member of the household whatever their role, and the
-- "not on the list" message names the household's admins.

-- Names of the active admins, for messages that say who to ask.
create or replace function private.admin_names() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(display_name, ' or ' order by created_at), 'an admin')
    from public.members where role_id = 'admin' and is_active
$$;

-- The active care subjects by name only (no profile, no medical data), for every member.
create or replace function private.subject_names() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'module_id', s.module_id, 'kind', s.kind, 'name', s.name,
           'birth_date', s.birth_date, 'names', coalesce(s.profile->'names', '{}'::jsonb),
           'sex', s.profile->>'sex') order by s.sort, s.name), '[]'::jsonb)
    from public.care_subjects s
   where s.is_active
$$;

create or replace function public.me() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_member public.members;
  v_preview boolean := coalesce(auth.jwt()->>'preview_member', '') <> '';
begin
  if not v_preview then perform public.link_current_user(); end if;
  select * into v_member from public.members where id = public.current_member_id() and is_active;
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_member',
      'message', 'Your e-mail is not on the household list yet. Ask ' || private.admin_names() || ' to add you.');
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
    'household', (select to_jsonb(h) from public.household h limit 1),
    'subjects', private.subject_names()
  );
end $$;
