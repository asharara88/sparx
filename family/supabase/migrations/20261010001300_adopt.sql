-- ============================================================================
-- Adopted from the family's "Little Sleepy Hub" prototype, rebuilt on this schema:
--   members: photo, language, simple mode        notes board (with private notes)
--   attendance (Lilly's check-in / check-out)     milk stash (fridge / freezer / warmed)
--   care routines ("every N days" tiles)          saved Ask chats
-- No top-level UPDATE or DELETE (the Supabase connector stalls on them).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Members: photo, language, simple mode. Each member sets their own.
-- ---------------------------------------------------------------------------
alter table public.members add column if not exists photo_path text;
alter table public.members add column if not exists lang text not null default 'en' check (lang in ('en', 'ar', 'ru'));
alter table public.members add column if not exists simple_mode boolean not null default false;
alter table public.household add column if not exists bottle_interval_min integer not null default 120 check (bottle_interval_min between 30 and 600);

create or replace function public.me_prefs_save(p_lang text default null, p_simple_mode boolean default null, p_photo_path text default null, p_clear_photo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.current_member_id();
begin
  if v_id is null then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if p_lang is not null and p_lang not in ('en', 'ar', 'ru') then return jsonb_build_object('ok', false, 'error', 'bad_lang'); end if;
  update public.members m
     set lang = coalesce(p_lang, m.lang),
         simple_mode = coalesce(p_simple_mode, m.simple_mode),
         photo_path = case when p_clear_photo then null else coalesce(p_photo_path, m.photo_path) end,
         updated_at = now()
   where m.id = v_id;
  perform private.audit_write('members', 'edit', true, 'members', v_id::text, jsonb_build_object('prefs', true));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.me_prefs_save(text, boolean, text, boolean) to authenticated, service_role;

create or replace function public.member_photo_save(p_member_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_member_id <> public.current_member_id() and not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'members', p_member_id::text);
    return private.denied();
  end if;
  update public.members set photo_path = nullif(btrim(p_path), ''), updated_at = now() where id = p_member_id;
  perform private.audit_write('members', 'edit', true, 'members', p_member_id::text, jsonb_build_object('photo', p_path is not null));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.member_photo_save(uuid, text) to authenticated, service_role;

create or replace function public.household_save(p_name text, p_notes text, p_milk_target_ml integer, p_bottle_interval_min integer) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v jsonb;
begin
  v := public.household_save(p_name, p_notes, p_milk_target_ml);
  if (v->>'ok')::boolean and p_bottle_interval_min is not null then
    update public.household h set bottle_interval_min = p_bottle_interval_min where h.id = true;
  end if;
  return v;
end $$;
grant execute on function public.household_save(text, text, integer, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Notes board. Everyone can read and write; a private note is only its author's.
-- ---------------------------------------------------------------------------
insert into public.modules (id, label, description, sort) values
  ('notes', 'Notes board', 'Short notes for the household; a note can be just for yourself.', 48)
on conflict (id) do nothing;
insert into public.permissions (role_id, module_id, action, allowed)
select r.id, 'notes', a.action,
  case when r.id = 'admin' then true
       when a.action in ('view', 'add', 'edit') then true
       else false end
from public.roles r cross join (values ('view'), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role_id, module_id, action) do nothing;

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  body       text not null check (length(btrim(body)) between 1 and 2000),
  author     uuid references public.members (id) on delete set null,
  is_private boolean not null default false,
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists notes_live_idx on public.notes (pinned desc, created_at desc) where deleted_at is null;
alter table public.notes enable row level security;
create policy notes_read on public.notes for select to authenticated
  using (deleted_at is null and public.has_permission('notes', 'view') and (not is_private or author = public.current_member_id()));
grant select on public.notes to authenticated;
grant all on public.notes to service_role;

create or replace function public.note_save(p_id uuid, p_body text, p_is_private boolean default false, p_pinned boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid := p_id; v_author uuid;
begin
  if p_id is null then
    if not private.authz('notes', 'add', 'notes') then return private.denied(); end if;
    insert into public.notes (body, author, is_private, pinned)
    values (btrim(p_body), v_me, coalesce(p_is_private, false), coalesce(p_pinned, false) and public.has_permission('notes', 'edit'))
    returning id into v_id;
  else
    select author into v_author from public.notes where id = p_id and deleted_at is null;
    if v_author is null and not exists (select 1 from public.notes where id = p_id and deleted_at is null) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if v_author is distinct from v_me and not public.has_permission('members', 'edit') then
      perform private.audit_write('notes', 'edit', false, 'notes', p_id::text);
      return private.denied('Only the person who wrote it, or an admin, can change a note.');
    end if;
    update public.notes set body = btrim(p_body), is_private = coalesce(p_is_private, is_private), pinned = coalesce(p_pinned, pinned), updated_at = now() where id = p_id;
    perform private.audit_write('notes', 'edit', true, 'notes', p_id::text);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.note_save(uuid, text, boolean, boolean) to authenticated, service_role;

create or replace function public.note_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select author into v_author from public.notes where id = p_id and deleted_at is null;
  if v_author is distinct from public.current_member_id() and not public.has_permission('notes', 'delete') then
    perform private.audit_write('notes', 'delete', false, 'notes', p_id::text);
    return private.denied();
  end if;
  update public.notes set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('notes', 'delete', true, 'notes', p_id::text);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.note_remove(uuid) to authenticated, service_role;

create or replace function public.notes_list(p_limit integer default 50) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('notes', 'view', 'notes') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'notes', coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'author', n.author, 'author_name', m.display_name,
             'is_private', n.is_private, 'pinned', n.pinned, 'created_at', n.created_at, 'updated_at', n.updated_at,
             'mine', n.author = public.current_member_id()) order by n.pinned desc, n.created_at desc)
      from (select * from public.notes where deleted_at is null order by pinned desc, created_at desc limit greatest(1, least(p_limit, 200))) n
      left join public.members m on m.id = n.author), '[]'::jsonb));
end $$;
grant execute on function public.notes_list(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Attendance: one tap when Lilly arrives, one when she leaves. Anyone can
--    toggle their own; an admin can toggle for someone else. Everyone can see it.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  in_at      timestamptz not null default now(),
  out_at     timestamptz check (out_at is null or out_at >= in_at),
  logged_by  uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_member_idx on public.attendance (member_id, in_at desc);
alter table public.attendance enable row level security;
create policy attendance_read on public.attendance for select to authenticated using (public.current_member_id() is not null);
grant select on public.attendance to authenticated;
grant all on public.attendance to service_role;

create or replace function public.attendance_toggle(p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_target uuid := coalesce(p_member_id, public.current_member_id()); v_open uuid;
begin
  if v_me is null then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
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
grant execute on function public.attendance_toggle(uuid) to authenticated, service_role;

-- Who is checked in now, and today's visits.
create or replace function public.attendance_today() returns jsonb
language sql stable security invoker set search_path = public as $$
  with tz as (select coalesce((select timezone from public.household limit 1), 'UTC') as tz)
  select jsonb_build_object('ok', true,
    'open', coalesce((select jsonb_agg(jsonb_build_object('member_id', a.member_id, 'name', m.display_name, 'in_at', a.in_at) order by a.in_at)
                      from public.attendance a join public.members m on m.id = a.member_id where a.out_at is null), '[]'::jsonb),
    'today', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'member_id', a.member_id, 'name', m.display_name, 'in_at', a.in_at, 'out_at', a.out_at) order by a.in_at)
                       from public.attendance a join public.members m on m.id = a.member_id, tz
                       where (a.in_at at time zone tz.tz)::date = (now() at time zone tz.tz)::date), '[]'::jsonb))
$$;
grant execute on function public.attendance_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Milk stash: every bottle in the fridge or freezer, oldest first.
--    Fridge 4 days, freezer 6 months, thawed 24 hours, warmed 2 hours.
-- ---------------------------------------------------------------------------
create table if not exists public.milk_bottles (
  id         uuid primary key default gen_random_uuid(),
  amount_ml  integer not null check (amount_ml between 5 and 1000),
  pumped_at  timestamptz not null default now(),
  location   text not null default 'fridge' check (location in ('fridge', 'freezer')),
  thawed_at  timestamptz,
  warmed_at  timestamptz,
  used_at    timestamptz,
  note       text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists milk_open_idx on public.milk_bottles (pumped_at) where used_at is null and deleted_at is null;
alter table public.milk_bottles enable row level security;
create policy milk_read on public.milk_bottles for select to authenticated using (public.has_permission('lana', 'view'));
grant select on public.milk_bottles to authenticated;
grant all on public.milk_bottles to service_role;

create or replace function private.milk_expires_at(b public.milk_bottles) returns timestamptz
language sql immutable as $$
  select case
    when b.warmed_at is not null then b.warmed_at + interval '2 hours'
    when b.location = 'freezer' then b.pumped_at + interval '6 months'
    when b.thawed_at is not null then b.thawed_at + interval '24 hours'
    else b.pumped_at + interval '4 days' end
$$;

create or replace function public.milk_add(p_amount_ml integer, p_location text default 'fridge', p_pumped_at timestamptz default now(), p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not private.authz('lana', 'add', 'milk_bottles') then return private.denied(); end if;
  if p_location not in ('fridge', 'freezer') then return jsonb_build_object('ok', false, 'error', 'bad_location'); end if;
  insert into public.milk_bottles (amount_ml, pumped_at, location, note, created_by)
  values (p_amount_ml, coalesce(p_pumped_at, now()), p_location, nullif(btrim(p_note), ''), public.current_member_id())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.milk_add(integer, text, timestamptz, text) to authenticated, service_role;

-- p_action: fridge (thaw / move), freezer, warmed, used, binned
create or replace function public.milk_move(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.milk_bottles;
begin
  if not private.authz('lana', 'add', 'milk_bottles', p_id::text) then return private.denied(); end if;
  select * into b from public.milk_bottles where id = p_id and deleted_at is null and used_at is null;
  if b.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action = 'fridge' then
    update public.milk_bottles set location = 'fridge', thawed_at = case when b.location = 'freezer' then now() else thawed_at end where id = p_id;
  elsif p_action = 'freezer' then
    if b.thawed_at is not null or b.warmed_at is not null then return jsonb_build_object('ok', false, 'error', 'no_refreeze', 'message', 'Thawed or warmed milk must not go back in the freezer.'); end if;
    update public.milk_bottles set location = 'freezer' where id = p_id;
  elsif p_action = 'warmed' then
    update public.milk_bottles set warmed_at = now(), location = 'fridge', thawed_at = coalesce(thawed_at, case when b.location = 'freezer' then now() end) where id = p_id;
  elsif p_action = 'used' then
    update public.milk_bottles set used_at = now() where id = p_id;
  elsif p_action = 'binned' then
    update public.milk_bottles set deleted_at = now() where id = p_id;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.milk_move(uuid, text) to authenticated, service_role;

create or replace function public.milk_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('lana', 'view', 'milk_bottles') then return private.denied(); end if;
  return (with open as (
      select b.*, private.milk_expires_at(b) as expires_at from public.milk_bottles b where b.used_at is null and b.deleted_at is null)
    select jsonb_build_object('ok', true,
      'bottles', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'amount_ml', o.amount_ml, 'pumped_at', o.pumped_at, 'location', o.location,
                            'thawed_at', o.thawed_at, 'warmed_at', o.warmed_at, 'expires_at', o.expires_at, 'expired', o.expires_at < now(), 'note', o.note)
                            order by o.expires_at) from open o), '[]'::jsonb),
      'fridge_ml', coalesce((select sum(amount_ml) from open where location = 'fridge' and expires_at >= now()), 0),
      'freezer_ml', coalesce((select sum(amount_ml) from open where location = 'freezer' and expires_at >= now()), 0),
      'fridge_count', (select count(*) from open where location = 'fridge' and expires_at >= now()),
      'freezer_count', (select count(*) from open where location = 'freezer' and expires_at >= now()),
      'target_ml', (select milk_target_ml from public.household limit 1),
      'bottle_interval_min', (select bottle_interval_min from public.household limit 1)));
end $$;
grant execute on function public.milk_list() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Care routines: "every N days" tiles for Fanta (and anyone else later).
--    Marking one done can also log an entry of the linked type.
-- ---------------------------------------------------------------------------
create table if not exists public.care_routines (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.care_subjects (id) on delete cascade,
  label       text not null check (length(btrim(label)) between 1 and 80),
  every_days  integer not null check (every_days between 1 and 400),
  type_id     text references public.care_entry_types (id),
  payload     jsonb not null default '{}'::jsonb,
  last_done   date,
  sort        integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.care_routines enable row level security;
create policy routines_read on public.care_routines for select to authenticated
  using (exists (select 1 from public.care_subjects s where s.id = subject_id and public.has_permission(s.module_id, 'view')));
grant select on public.care_routines to authenticated;
grant all on public.care_routines to service_role;

create or replace function public.routine_save(p_id uuid, p_subject_id uuid, p_label text, p_every_days integer, p_type_id text default null, p_payload jsonb default '{}'::jsonb, p_last_done date default null, p_sort integer default 100, p_is_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_module text; v_id uuid := p_id;
begin
  select module_id into v_module from public.care_subjects where id = p_subject_id;
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission('members', 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_routines', p_id::text);
    return private.denied('Only an admin changes the routines.');
  end if;
  if p_type_id is not null and not exists (select 1 from public.care_entry_types where id = p_type_id and module_id = v_module) then return jsonb_build_object('ok', false, 'error', 'bad_type'); end if;
  if p_id is null then
    insert into public.care_routines (subject_id, label, every_days, type_id, payload, last_done, sort, is_active)
    values (p_subject_id, btrim(p_label), p_every_days, p_type_id, coalesce(p_payload, '{}'::jsonb), p_last_done, coalesce(p_sort, 100), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.care_routines set label = btrim(p_label), every_days = p_every_days, type_id = p_type_id, payload = coalesce(p_payload, '{}'::jsonb),
      last_done = p_last_done, sort = coalesce(p_sort, 100), is_active = coalesce(p_is_active, true), updated_at = now()
    where id = p_id and subject_id = p_subject_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.routine_save(uuid, uuid, text, integer, text, jsonb, date, integer, boolean) to authenticated, service_role;

create or replace function public.routine_done(p_id uuid, p_on date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.care_routines; v_module text; v_tz text := coalesce((select timezone from public.household limit 1), 'UTC'); v_day date; v_log jsonb;
begin
  select * into r from public.care_routines where id = p_id and is_active;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select module_id into v_module from public.care_subjects where id = r.subject_id;
  if not private.authz(v_module, 'add', 'care_routines', p_id::text) then return private.denied(); end if;
  v_day := coalesce(p_on, (now() at time zone v_tz)::date);
  if r.type_id is not null then
    v_log := public.care_entry_log(r.subject_id, r.type_id, case when v_day = (now() at time zone v_tz)::date then now() else (v_day::timestamp + interval '12 hours') at time zone v_tz end, null, r.payload, r.label, null);
    if not (v_log->>'ok')::boolean then return v_log; end if;
  end if;
  update public.care_routines set last_done = v_day, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'last_done', v_day, 'next_due', v_day + r.every_days, 'entry', v_log->'entry');
end $$;
grant execute on function public.routine_done(uuid, date) to authenticated, service_role;

create or replace function public.routines_list(p_subject_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_module text; v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
begin
  select module_id into v_module from public.care_subjects where id = p_subject_id;
  if v_module is null or not private.authz(v_module, 'view', 'care_routines') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'today', v_today, 'routines', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'label', r.label, 'every_days', r.every_days, 'type_id', r.type_id, 'payload', r.payload,
             'last_done', r.last_done, 'due_on', r.last_done + r.every_days,
             'days_left', case when r.last_done is null then null else (r.last_done + r.every_days) - v_today end,
             'sort', r.sort, 'is_active', r.is_active)
           order by case when r.last_done is null then 0 else (r.last_done + r.every_days) - v_today end, r.sort)
      from public.care_routines r where r.subject_id = p_subject_id and r.is_active), '[]'::jsonb));
end $$;
grant execute on function public.routines_list(uuid) to authenticated, service_role;

-- Fanta's starting routines (edit on her page).
insert into public.care_routines (id, subject_id, label, every_days, type_id, payload, sort) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a002', 'Litter full change', 7,  'fanta.litter',    '{"kind":"Full change"}', 10),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000a002', 'Brush',              3,  null,              '{}',                     20),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000a002', 'Flea and tick',      30, 'fanta.treatment', '{"kind":"Flea & tick"}', 30),
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000a002', 'Deworming',          90, 'fanta.treatment', '{"kind":"Deworming"}',   40),
  ('00000000-0000-4000-8000-00000000c005', '00000000-0000-4000-8000-00000000a002', 'Weigh her',          14, null,              '{}',                     50)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Saved Ask chats: a member's own threads, messages kept as JSON on the row.
-- ---------------------------------------------------------------------------
create table if not exists public.ask_chats (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  title      text not null default 'Chat',
  messages   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ask_chats_member_idx on public.ask_chats (member_id, updated_at desc) where deleted_at is null;
alter table public.ask_chats enable row level security;
create policy ask_chats_own on public.ask_chats for select to authenticated using (member_id = public.current_member_id() and deleted_at is null);
grant select on public.ask_chats to authenticated;
grant all on public.ask_chats to service_role;

create or replace function public.ask_chat_save(p_id uuid, p_title text, p_messages jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid := p_id;
begin
  if v_me is null or not public.has_permission('assistant', 'view') then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if jsonb_typeof(p_messages) <> 'array' or pg_column_size(p_messages) > 400000 then return jsonb_build_object('ok', false, 'error', 'bad_messages'); end if;
  if p_id is null then
    insert into public.ask_chats (member_id, title, messages) values (v_me, coalesce(nullif(left(btrim(p_title), 80), ''), 'Chat'), p_messages) returning id into v_id;
  else
    update public.ask_chats set title = coalesce(nullif(left(btrim(p_title), 80), ''), title), messages = p_messages, updated_at = now()
     where id = p_id and member_id = v_me and deleted_at is null;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.ask_chat_save(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.ask_chat_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.ask_chats set deleted_at = now() where id = p_id and member_id = public.current_member_id() and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.ask_chat_remove(uuid) to authenticated, service_role;
