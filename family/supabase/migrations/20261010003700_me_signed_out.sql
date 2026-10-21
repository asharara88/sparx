-- me() runs as whoever calls it. A call with no session (a signed-out phone that
-- still hits an API route, a crawler on a fresh deployment, a health check) ran
-- as anon, fell through to the "not on the household list" branch, and since
-- migration 3500 that branch names the admins through private.admin_names(),
-- which anon may not use: "permission denied for schema private", a 401 instead
-- of a plain answer, and an ERROR line in the database log for every such call
-- (about 300 a day on the live project, none of them a family member).
--
-- Nobody signed in is not a household question. Say so first, before anything
-- that needs a member, a user or the private schema.

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
