-- ============================================================================
-- Family app — Step 1 foundation
-- Members, roles, permission matrix (role × module × action), presence,
-- staff work schedules, audit log, and the helpers RLS policies are built on.
--
-- Design rules (see BRIEF.md / PLAN.md):
--  * RLS policies are DERIVED from the permissions table via has_permission();
--    no table has a hand-written per-role rule.
--  * Everything named in the brief is data (roles, modules, presence states,
--    members, Lilly's working days) and is edited from the UI, never by
--    migration.
--  * The app talks to the database only through the RPC functions in
--    20261010000200_care_log.sql; those log every allowed write and every
--    denied read/write to audit_log.
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Household-wide settings (single row)
-- ---------------------------------------------------------------------------
create table public.household (
  id          boolean primary key default true check (id),  -- exactly one row
  name        text not null default 'Our home',
  timezone    text not null default 'Asia/Dubai',
  currency    text not null default 'AED',
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Roles, modules, permission matrix
-- ---------------------------------------------------------------------------
create table public.roles (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  description text,
  sort        integer not null default 100,
  created_at  timestamptz not null default now()
);

create table public.modules (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  label       text not null,
  description text,
  sort        integer not null default 100
);

create table public.permissions (
  role_id    text not null references public.roles (id) on delete cascade,
  module_id  text not null references public.modules (id) on delete cascade,
  action     text not null check (action in ('view', 'add', 'edit', 'delete')),
  allowed    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role_id, module_id, action)
);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
create table public.members (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete set null,
  email         text check (email is null or email = lower(email)),
  display_name  text not null,
  role_id       text not null references public.roles (id),
  birth_date    date,
  relationship  text,                 -- e.g. "Mido's mother", "Household staff"
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index members_email_key on public.members (email) where email is not null;

-- ---------------------------------------------------------------------------
-- Presence: "lives here", "staying with us", "visiting today", "away" ...
-- ---------------------------------------------------------------------------
create table public.presence_states (
  id                 text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  label              text not null,
  counts_as_in_house boolean not null default true,
  sort               integer not null default 100
);

create table public.presence (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  state_id   text not null references public.presence_states (id),
  starts_on  date not null default current_date,
  ends_on    date check (ends_on is null or ends_on >= starts_on),
  note       text,
  set_by     uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index presence_member_idx on public.presence (member_id, starts_on desc);

-- ---------------------------------------------------------------------------
-- Work schedules: one row per weekday a staff member works (0 = Sunday)
-- ---------------------------------------------------------------------------
create table public.work_schedules (
  member_id uuid not null references public.members (id) on delete cascade,
  weekday   smallint not null check (weekday between 0 and 6),
  primary key (member_id, weekday)
);

-- ---------------------------------------------------------------------------
-- Audit log — append only; written only by private.audit_write()
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor_user_id uuid,
  actor_member  uuid,
  actor_role    text,
  module_id     text,
  action        text,
  allowed       boolean not null,
  source        text not null default 'rpc',   -- rpc | agent | system
  target_table  text,
  target_id     text,
  detail        jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor_member, at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger members_touch     before update on public.members     for each row execute function private.touch_updated_at();
create trigger permissions_touch before update on public.permissions for each row execute function private.touch_updated_at();
create trigger household_touch   before update on public.household   for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------

-- The member row for the signed-in user (null when none).
create or replace function public.current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where user_id = auth.uid() and is_active limit 1
$$;

-- Permission check straight from the matrix. This is the only thing RLS
-- policies call, so changing a row in permissions changes access everywhere.
create or replace function public.has_permission(p_module text, p_action text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.members m
    join public.permissions p on p.role_id = m.role_id
    where m.user_id = auth.uid()
      and m.is_active
      and p.module_id = p_module
      and p.action = p_action
      and p.allowed
  )
$$;

-- Role id of the caller (for audit rows).
create or replace function private.current_role_id() returns text
language sql stable security definer set search_path = public as $$
  select role_id from public.members where user_id = auth.uid() and is_active limit 1
$$;

-- Append an audit row. Only callable from SQL inside our own functions:
-- schema "private" is not exposed over the API.
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
     p_module, p_action, p_allowed, p_source, p_target_table, p_target_id, p_detail);
end $$;

-- Check + audit. Returns the decision. Denials are always logged; allowed
-- reads are logged once per transaction so list screens don't flood the log.
create or replace function private.authz(
  p_module text, p_action text,
  p_target_table text default null, p_target_id text default null, p_detail jsonb default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_allowed boolean := public.has_permission(p_module, p_action);
  v_key text := 'fam.audited.' || p_module || '.' || p_action;
begin
  if not v_allowed or p_action <> 'view' or coalesce(current_setting(v_key, true), '') <> '1' then
    perform private.audit_write(p_module, p_action, v_allowed, p_target_table, p_target_id, p_detail, 'rpc');
    perform set_config(v_key, '1', true);
  end if;
  return v_allowed;
end $$;

-- Current presence row for a member (today).
create or replace function public.current_presence(p_member uuid) returns public.presence
language sql stable security definer set search_path = public as $$
  select p.* from public.presence p
  where p.member_id = p_member
    and p.starts_on <= (now() at time zone (select timezone from public.household limit 1))::date
    and (p.ends_on is null or p.ends_on >= (now() at time zone (select timezone from public.household limit 1))::date)
  order by p.starts_on desc, p.created_at desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Link auth users to member rows by e-mail (invite flow)
-- ---------------------------------------------------------------------------
create or replace function private.handle_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.members
     set user_id = new.id
   where email = lower(new.email)
     and user_id is null;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user_created();

-- Fallback used by the app after sign-in: link by e-mail if the trigger
-- didn't (e.g. the member's e-mail was typed in after they signed up).
create or replace function public.link_current_user() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_id uuid;
begin
  if auth.uid() is null then return null; end if;
  select id into v_id from public.members where user_id = auth.uid() and is_active;
  if v_id is not null then return v_id; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  update public.members set user_id = auth.uid()
   where email = v_email and user_id is null and is_active
   returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — every policy is has_permission(module, action) or
-- "it is my own row". Nothing is hard-coded per role.
-- ---------------------------------------------------------------------------
alter table public.household        enable row level security;
alter table public.roles            enable row level security;
alter table public.modules          enable row level security;
alter table public.permissions      enable row level security;
alter table public.members          enable row level security;
alter table public.presence_states  enable row level security;
alter table public.presence         enable row level security;
alter table public.work_schedules   enable row level security;
alter table public.audit_log        enable row level security;

-- Lookup tables: any signed-in member can read; only "members" editors change them.
create policy household_read   on public.household       for select to authenticated using (public.current_member_id() is not null);
create policy household_edit   on public.household       for update to authenticated using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));

create policy roles_read       on public.roles           for select to authenticated using (public.current_member_id() is not null);
create policy roles_add        on public.roles           for insert to authenticated with check (public.has_permission('members','edit'));
create policy roles_edit       on public.roles           for update to authenticated using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));
create policy roles_delete     on public.roles           for delete to authenticated using (public.has_permission('members','delete'));

create policy modules_read     on public.modules         for select to authenticated using (public.current_member_id() is not null);

create policy permissions_read on public.permissions     for select to authenticated using (public.current_member_id() is not null);
create policy permissions_add  on public.permissions     for insert to authenticated with check (public.has_permission('members','edit'));
create policy permissions_edit on public.permissions     for update to authenticated using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));
create policy permissions_del  on public.permissions     for delete to authenticated using (public.has_permission('members','delete'));

create policy presence_states_read on public.presence_states for select to authenticated using (public.current_member_id() is not null);
create policy presence_states_edit on public.presence_states for all    to authenticated using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));

-- Members: see the directory if your role may, always see yourself.
create policy members_read     on public.members for select to authenticated
  using (public.has_permission('members','view') or user_id = auth.uid());
create policy members_add      on public.members for insert to authenticated with check (public.has_permission('members','add'));
create policy members_edit     on public.members for update to authenticated
  using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));
create policy members_delete   on public.members for delete to authenticated using (public.has_permission('members','delete'));

-- Presence: visible with the directory; set by an admin or the member themself.
create policy presence_read    on public.presence for select to authenticated
  using (public.has_permission('members','view') or member_id = public.current_member_id());
create policy presence_add     on public.presence for insert to authenticated
  with check (public.has_permission('members','edit') or member_id = public.current_member_id());
create policy presence_edit    on public.presence for update to authenticated
  using (public.has_permission('members','edit') or member_id = public.current_member_id())
  with check (public.has_permission('members','edit') or member_id = public.current_member_id());
create policy presence_delete  on public.presence for delete to authenticated
  using (public.has_permission('members','delete') or member_id = public.current_member_id());

-- Work schedules: everyone can see who works when (calendar); editors change them.
create policy work_read        on public.work_schedules for select to authenticated using (public.current_member_id() is not null);
create policy work_edit        on public.work_schedules for all to authenticated
  using (public.has_permission('members','edit')) with check (public.has_permission('members','edit'));

-- Audit log: read by "audit" viewers only; no client writes at all.
create policy audit_read       on public.audit_log for select to authenticated using (public.has_permission('audit','view'));

-- ---------------------------------------------------------------------------
-- Grants (Supabase default privileges normally cover these; explicit is safer
-- when the project is shared with other schemas/tables).
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant select, insert, update, delete on
  public.household, public.roles, public.modules, public.permissions, public.members,
  public.presence_states, public.presence, public.work_schedules
  to authenticated, service_role;
grant select on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
grant execute on function public.current_member_id(), public.has_permission(text, text),
  public.current_presence(uuid), public.link_current_user() to authenticated, service_role;
grant execute on function private.audit_write(text, text, boolean, text, text, jsonb, text),
  private.authz(text, text, text, text, jsonb), private.current_role_id() to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
