-- Parity with the Lovable prototype: medicines with a safe gap between doses,
-- a memory the assistant keeps for the family, a babysitter role, and a table
-- that records the nightly backups. Milestones already exist as an entry type;
-- this switches them on.

-- ---------------------------------------------------------------------------
-- 1. Medicines: name, minimum hours between doses, the usual dose. "Given"
--    writes an ordinary medication entry in the log, so the day strip, the
--    handover and the doctor summary see it like any other entry.
-- ---------------------------------------------------------------------------
create table if not exists public.medicines (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.care_subjects (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  dose          text check (dose is null or length(dose) <= 80),
  min_gap_hours numeric(5,1) not null check (min_gap_hours > 0 and min_gap_hours <= 168),
  note          text check (note is null or length(note) <= 300),
  is_active     boolean not null default true,
  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists medicines_subject_idx on public.medicines (subject_id) where is_active;
alter table public.medicines enable row level security;
grant all on public.medicines to service_role;
-- No direct reads or writes from the app: everything goes through the RPCs below.

create or replace function public.medicines_list(p_subject_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_type   text;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied('You are not allowed to see this log.'); end if;
  v_type := v_module || '.medication';
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.name, 'dose', m.dose, 'min_gap_hours', m.min_gap_hours, 'note', m.note,
      'last_at', l.occurred_at, 'last_dose', l.payload->>'dose', 'last_by', l.by_name,
      'next_at', case when l.occurred_at is null then null else l.occurred_at + make_interval(mins => (m.min_gap_hours * 60)::int) end,
      'too_soon', l.occurred_at is not null and l.occurred_at + make_interval(mins => (m.min_gap_hours * 60)::int) > now()
    ) order by m.name)
    from public.medicines m
    left join lateral (
      select e.occurred_at, e.payload, coalesce(ab.display_name, lb.display_name) as by_name
        from public.care_entries e
        left join public.members lb on lb.id = e.logged_by
        left join public.members ab on ab.id = e.attributed_to
       where e.subject_id = m.subject_id and e.deleted_at is null and e.type_id = v_type
         and (e.payload->>'medicine_id' = m.id::text or lower(btrim(e.payload->>'name')) = lower(btrim(m.name)))
         and e.occurred_at > now() - interval '14 days'
       order by e.occurred_at desc limit 1) l on true
    where m.subject_id = p_subject_id and m.is_active), '[]'::jsonb));
end $$;
grant execute on function public.medicines_list(uuid) to authenticated, service_role;

create or replace function public.medicine_save(p_id uuid, p_subject_id uuid, p_name text, p_min_gap_hours numeric, p_dose text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_id uuid := p_id;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'medicines', p_id::text) then return private.denied(); end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'bad_name', 'message', 'Give the medicine a name.'); end if;
  if p_min_gap_hours is null or p_min_gap_hours <= 0 or p_min_gap_hours > 168 then return jsonb_build_object('ok', false, 'error', 'bad_gap', 'message', 'Hours between doses must be between 0.5 and 168.'); end if;
  if p_id is null then
    insert into public.medicines (subject_id, name, dose, min_gap_hours, note, created_by)
    values (p_subject_id, btrim(p_name), nullif(btrim(coalesce(p_dose, '')), ''), p_min_gap_hours, nullif(btrim(coalesce(p_note, '')), ''), public.current_member_id())
    returning id into v_id;
  else
    update public.medicines
       set name = btrim(p_name), dose = nullif(btrim(coalesce(p_dose, '')), ''), min_gap_hours = p_min_gap_hours, note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_id and subject_id = p_subject_id and is_active;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  perform private.audit_write(v_module, 'add', true, 'medicines', v_id::text, jsonb_build_object('name', btrim(p_name), 'gap_h', p_min_gap_hours));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.medicine_save(uuid, uuid, text, numeric, text, text) to authenticated, service_role;

create or replace function public.medicine_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := (select private.subject_module(subject_id) from public.medicines where id = p_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'edit', 'medicines', p_id::text) then return private.denied(); end if;
  update public.medicines set is_active = false where id = p_id and is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.medicine_remove(uuid) to authenticated, service_role;

-- "Given": refuses when the gap has not passed unless p_force is true (the
-- doctor said so). The entry goes through care_entry_log, so custody,
-- attribution and the audit trail work as for any entry.
create or replace function public.medicine_give(p_id uuid, p_dose text default null, p_occurred_at timestamptz default now(), p_note text default null, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m        public.medicines;
  v_module text;
  v_type   text;
  v_last   timestamptz;
  v_next   timestamptz;
  v_res    jsonb;
begin
  select * into m from public.medicines where id = p_id and is_active;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_module := private.subject_module(m.subject_id);
  if not public.has_permission(v_module, 'add') then
    perform private.audit_write(v_module, 'add', false, 'medicines', p_id::text);
    return private.denied();
  end if;
  v_type := v_module || '.medication';
  select e.occurred_at into v_last from public.care_entries e
   where e.subject_id = m.subject_id and e.deleted_at is null and e.type_id = v_type
     and (e.payload->>'medicine_id' = m.id::text or lower(btrim(e.payload->>'name')) = lower(btrim(m.name)))
     and e.occurred_at <= coalesce(p_occurred_at, now())
   order by e.occurred_at desc limit 1;
  if v_last is not null then
    v_next := v_last + make_interval(mins => (m.min_gap_hours * 60)::int);
    if v_next > coalesce(p_occurred_at, now()) and not coalesce(p_force, false) then
      return jsonb_build_object('ok', false, 'error', 'too_soon', 'last_at', v_last, 'next_at', v_next,
        'message', format('%s was given at %s. The next dose is allowed from %s.', m.name,
          to_char(v_last at time zone coalesce((select timezone from public.household limit 1), 'UTC'), 'HH24:MI'),
          to_char(v_next at time zone coalesce((select timezone from public.household limit 1), 'UTC'), 'HH24:MI')));
    end if;
  end if;
  v_res := public.care_entry_log(m.subject_id, v_type, coalesce(p_occurred_at, now()), null,
    jsonb_build_object('name', m.name, 'dose', coalesce(nullif(btrim(coalesce(p_dose, '')), ''), m.dose, ''), 'medicine_id', m.id::text)
      || case when coalesce(p_force, false) and v_next is not null and v_next > coalesce(p_occurred_at, now()) then '{"early":true}'::jsonb else '{}'::jsonb end,
    p_note, null);
  return v_res || jsonb_build_object('medicine', m.name, 'next_at', coalesce(p_occurred_at, now()) + make_interval(mins => (m.min_gap_hours * 60)::int));
end $$;
grant execute on function public.medicine_give(uuid, text, timestamptz, text, boolean) to authenticated, service_role;

-- A child's usual medicines (vitamin D drops, infant paracetamol) are written by
-- setup-household.mjs when the list is empty, so the screen is not empty on day one.

-- ---------------------------------------------------------------------------
-- 2. What the assistant remembers: short facts the family told it ("Lana
--    takes a bottle better when it is warm", "Wafa prefers Arabic"). Read into
--    every prompt; saved only after the member taps Confirm.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_memories (
  id         uuid primary key default gen_random_uuid(),
  body       text not null check (length(btrim(body)) between 2 and 300),
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists assistant_memories_live_idx on public.assistant_memories (created_at) where deleted_at is null;
alter table public.assistant_memories enable row level security;
grant all on public.assistant_memories to service_role;

create or replace function public.memory_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('assistant', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at, 'by', m.display_name, 'mine', a.created_by = public.current_member_id()) order by a.created_at desc)
    from public.assistant_memories a left join public.members m on m.id = a.created_by
    where a.deleted_at is null), '[]'::jsonb));
end $$;
grant execute on function public.memory_list() to authenticated, service_role;

create or replace function public.memory_add(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.authz('assistant', 'view', 'assistant_memories') then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if length(v_body) < 2 or length(v_body) > 300 then return jsonb_build_object('ok', false, 'error', 'bad_body', 'message', 'Keep a memory between 2 and 300 characters.'); end if;
  if (select count(*) from public.assistant_memories where deleted_at is null) >= 200 then return jsonb_build_object('ok', false, 'error', 'full', 'message', 'The helper already remembers 200 things. Remove some first.'); end if;
  select id into v_id from public.assistant_memories where deleted_at is null and lower(body) = lower(v_body);
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  insert into public.assistant_memories (body, created_by) values (v_body, public.current_member_id()) returning id into v_id;
  perform private.audit_write('assistant', 'add', true, 'assistant_memories', v_id::text, jsonb_build_object('body', left(v_body, 80)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.memory_add(text) to authenticated, service_role;

create or replace function public.memory_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('assistant', 'view') then return private.denied(); end if;
  update public.assistant_memories set deleted_at = now()
   where id = p_id and deleted_at is null and (created_by = public.current_member_id() or public.has_permission('members', 'edit'));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Only whoever added a memory, or an admin, can remove it.'); end if;
  perform private.audit_write('assistant', 'edit', true, 'assistant_memories', p_id::text);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.memory_remove(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A babysitter role: Lana's log, the chat, the assistant and photos. No
--    calendar, shopping, house, Fanta or members. Assign it from Members.
-- ---------------------------------------------------------------------------
insert into public.roles (id, label, description, sort) values
  ('sitter', 'Babysitter', 'Logs and views the child only, can chat and ask the helper. Nothing else in the house.', 25)
on conflict (id) do nothing;
insert into public.permissions (role_id, module_id, action, allowed)
select 'sitter', m.id, a.action,
  (m.id = 'lana'      and a.action in ('view', 'add')) or
  (m.id = 'chat'      and a.action in ('view', 'add')) or
  (m.id = 'photos'    and a.action in ('view', 'add')) or
  (m.id = 'assistant' and a.action = 'view')
from public.modules m
cross join (values ('view'), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role_id, module_id, action) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backups: the nightly job writes every table as gzipped JSON to a private
--    bucket and records it here. Admins (audit viewers) see the list; only the
--    service role writes.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
create table if not exists public.backups (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,
  size_bytes bigint not null default 0,
  rows       integer not null default 0,
  tables     jsonb not null default '{}'::jsonb,
  photos     integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.backups enable row level security;
create policy backups_read on public.backups for select to authenticated using (public.has_permission('audit', 'view'));
grant select on public.backups to authenticated;
grant all on public.backups to service_role;

-- ---------------------------------------------------------------------------
-- 5. Milestones: switch the entry type on and give it a date-friendly label.
-- ---------------------------------------------------------------------------
update public.care_entry_types set is_active = true where id = 'lana.milestone';
