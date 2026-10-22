-- The home on screen binds the request; deleting a home queues its file cleanup.
--
-- Since 4300 an account can be in several homes and runs as its chosen one, kept
-- on the account. That let a switch on one phone move another phone's next write:
-- the other phone still showed the old home, and its request said nothing about
-- which home it meant. Now every request from the app names the home its screen
-- shows (an x-home header, from a cookie the app keeps per device), and the
-- database honours it only for a home the account is in. The account's choice is
-- what a device starts from; a device keeps the home it is showing until it
-- switches itself.
--
-- household_delete takes the rows at once; the home's files in the buckets are
-- the server's to remove afterwards, and that can fail. The deletion now queues a
-- cleanup row the app works off, so a failed removal is retried and reported,
-- not forgotten.

-- ---------------------------------------------------------------------------
-- 1. The home the screen names
-- ---------------------------------------------------------------------------
-- PostgREST exposes the request's headers as JSON in request.headers, names lowercased.
create or replace function private.header_home() returns uuid
language plpgsql stable as $$
declare v text;
begin
  v := nullif(current_setting('request.headers', true), '');
  if v is null then return null; end if;
  v := (v::json)->>'x-home';
  if v is null or v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return v::uuid;
exception when others then
  return null;
end $$;
grant execute on function private.header_home() to authenticated, service_role, app_rls;

-- Who am I: the preview member, else the row a job names, else the row in the home
-- the screen names, else the chosen row, else the oldest.
create or replace function public.current_member_id() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v text := current_setting('fam.m.member', true); v_id uuid; v_preview uuid; v_named text; v_home uuid;
begin
  if v is not null and v <> '' then return v::uuid; end if;
  v_preview := private.preview_member_id();
  if v_preview is not null then
    select id into v_id from public.members where id = v_preview and is_active;
  end if;
  v_named := auth.jwt()->>'member_id';
  if v_id is null and auth.uid() is not null and v_named ~ '^[0-9a-f-]{36}$' then
    select id into v_id from public.members where id = v_named::uuid and user_id = auth.uid() and is_active;
  end if;
  v_home := private.header_home();
  if v_id is null and auth.uid() is not null and v_home is not null then
    select id into v_id from public.members where household_id = v_home and user_id = auth.uid() and is_active;
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

-- ---------------------------------------------------------------------------
-- 2. The file cleanup a deletion leaves to the server
-- ---------------------------------------------------------------------------
create table if not exists public.home_cleanups (
  household_id uuid primary key,
  name         text,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  attempts     integer not null default 0,
  last_error   text,
  done_at      timestamptz
);
-- Only the server (service role) reads and writes it; nothing is granted to signed-in members.
alter table public.home_cleanups enable row level security;
revoke all on public.home_cleanups from public, anon, authenticated;
grant select, insert, update, delete on public.home_cleanups to service_role;

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
  -- The files in the buckets are the server's to remove; this row is its work order, retried until done.
  insert into public.home_cleanups (household_id, name, requested_by)
  values (p_household_id, v_home.name, auth.uid())
  on conflict (household_id) do update set requested_at = now(), done_at = null, attempts = 0, last_error = null;
  perform set_config('fam.m.member', '', true);
  return jsonb_build_object('ok', true, 'name', v_home.name, 'members', v_members, 'entries', v_entries);
end $$;
grant execute on function public.household_delete(uuid, text) to authenticated, service_role;
