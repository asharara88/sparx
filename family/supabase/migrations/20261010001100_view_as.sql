-- ============================================================================
-- "View as": an admin looks at the app exactly as another member sees it.
--
-- The server mints a JWT with the project's secret carrying two extra claims:
--   preview_member = the member being viewed, preview_by = the admin's auth uid.
-- Supabase-issued tokens never carry these claims, so only our server can start a
-- preview. While previewing, identity is the previewed member and every action but
-- 'view' is denied, so nothing can be written in someone else's name. Audit rows
-- written during a preview carry preview_by.
-- No DROP statements (the Supabase connector stalls on them); the policy is altered.
-- ============================================================================
create or replace function private.preview_member_id() returns uuid
language sql stable as $$
  select case when coalesce(auth.jwt()->>'preview_member', '') <> '' and coalesce(auth.jwt()->>'preview_by', '') <> ''
              then (auth.jwt()->>'preview_member')::uuid end
$$;

create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.members where id = private.preview_member_id() and is_active),
    (select id from public.members where user_id = auth.uid() and is_active limit 1))
$$;

create or replace function public.has_permission(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select (private.preview_member_id() is null or p_action = 'view') and exists (
    select 1
    from public.members m
    join public.permissions p on p.role_id = m.role_id
    where m.id = public.current_member_id()
      and m.is_active
      and p.module_id = p_module
      and p.action = p_action
      and p.allowed
  )
$$;

create or replace function private.current_role_id() returns text
language sql stable security definer set search_path = public as $$
  select role_id from public.members where id = public.current_member_id()
$$;

create or replace function private.audit_write(
  p_module text, p_action text, p_allowed boolean,
  p_target_table text default null, p_target_id text default null,
  p_detail jsonb default null, p_source text default 'rpc'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log
    (actor_user_id, actor_member, actor_role, module_id, action, allowed, source, target_table, target_id, detail)
  values
    (auth.uid(), public.current_member_id(), private.current_role_id(),
     p_module, p_action, p_allowed, p_source, p_target_table, p_target_id,
     case when private.preview_member_id() is not null
          then coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('preview_by', auth.jwt()->>'preview_by')
          else p_detail end);
end $$;

-- Always see yourself, also while being previewed.
alter policy members_read on public.members
  using (public.has_permission('members', 'view') or id = public.current_member_id());

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
      'message', 'Your e-mail is not on the household list yet. Ask Mido or Dana to add you.');
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
    'household', (select to_jsonb(h) from public.household h limit 1)
  );
end $$;
