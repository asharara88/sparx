-- ============================================================================
-- Speed: the identity and permission checks run inside every row-level policy, so on a
-- log with thousands of entries they ran thousands of times per request (each parsing the
-- JWT claims and querying members). They now remember their answer for the rest of the
-- transaction (one PostgREST request). Results are only cached once a member is known, so
-- link_current_user() in me() still takes effect within the same call.
-- ============================================================================
create or replace function private.preview_member_id() returns uuid
language plpgsql stable as $$
declare v text := current_setting('fam.m.preview', true); j jsonb;
begin
  if v is not null and v <> '' then return nullif(v, 'none')::uuid; end if;
  j := auth.jwt();
  if coalesce(j->>'preview_member', '') <> '' and coalesce(j->>'preview_by', '') <> '' then
    perform set_config('fam.m.preview', j->>'preview_member', true);
    return (j->>'preview_member')::uuid;
  end if;
  perform set_config('fam.m.preview', 'none', true);
  return null;
end $$;

create or replace function public.current_member_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v text := current_setting('fam.m.member', true); v_id uuid; v_preview uuid;
begin
  if v is not null and v <> '' then return v::uuid; end if;
  v_preview := private.preview_member_id();
  if v_preview is not null then
    select id into v_id from public.members where id = v_preview and is_active;
  end if;
  if v_id is null then
    select id into v_id from public.members where user_id = auth.uid() and is_active limit 1;
  end if;
  if v_id is not null then perform set_config('fam.m.member', v_id::text, true); end if;
  return v_id;
end $$;

create or replace function public.has_permission(p_module text, p_action text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_key text := 'fam.p.' || coalesce(p_module, '') || '.' || coalesce(p_action, ''); v text := current_setting(v_key, true); v_me uuid; v_ok boolean;
begin
  if v is not null and v <> '' then return v = 't'; end if;
  v_me := public.current_member_id();
  if v_me is null then return false; end if;
  v_ok := (private.preview_member_id() is null or p_action = 'view' or coalesce(auth.jwt()->>'preview_mode', '') = 'full') and exists (
    select 1
    from public.members m
    join public.permissions p on p.role_id = m.role_id
    where m.id = v_me and m.is_active and p.module_id = p_module and p.action = p_action and p.allowed);
  perform set_config(v_key, case when v_ok then 't' else 'f' end, true);
  return v_ok;
end $$;
