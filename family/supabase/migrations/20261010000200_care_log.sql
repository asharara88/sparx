-- ============================================================================
-- Family app — care log (Lana now; Fanta reuses the same tables in Step 3)
--
--  * care_subjects     who is being cared for (Lana, Fanta). Each subject
--                      belongs to a permission module ('lana', 'fanta').
--  * care_entry_types  DATA, not code: feed / diaper / sleep / medication /
--                      note today; solids, teething, growth later — add a row.
--                      `fields` is a small JSON form definition the app renders.
--  * care_entries      one row per timestamped event; payload follows `fields`.
--  * care_custody      "who has Lana" — newest row wins; entries attribute to it.
--
-- RLS: has_permission(<subject's module>, <action>) — nothing per role.
-- The app uses the RPC functions below; every one logs to audit_log.
-- ============================================================================

create table public.care_subjects (
  id          uuid primary key default gen_random_uuid(),
  module_id   text not null references public.modules (id),
  kind        text not null check (kind in ('child', 'pet')),
  name        text not null,
  birth_date  date,
  profile     jsonb not null default '{}'::jsonb,   -- clinic, microchip, notes…
  settings    jsonb not null default '{}'::jsonb,
  sort        integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger care_subjects_touch before update on public.care_subjects for each row execute function private.touch_updated_at();

create table public.care_entry_types (
  id             text primary key,                 -- '<module>.<key>', e.g. 'lana.feed'
  module_id      text not null references public.modules (id),
  key            text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label          text not null,
  icon           text,
  color          text,
  sort           integer not null default 100,
  has_end        boolean not null default false,   -- sleep: start and end
  due_after_min  integer check (due_after_min is null or due_after_min > 0),
  fields         jsonb not null default '[]'::jsonb,
  show_on_home   boolean not null default true,
  is_active      boolean not null default true,
  unique (module_id, key),
  check (id = module_id || '.' || key)
);

create table public.care_entries (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid unique,                      -- offline queue idempotency
  subject_id     uuid not null references public.care_subjects (id) on delete cascade,
  module_id      text not null references public.modules (id),
  type_id        text not null references public.care_entry_types (id),
  occurred_at    timestamptz not null default now(),
  ended_at       timestamptz check (ended_at is null or ended_at >= occurred_at),
  payload        jsonb not null default '{}'::jsonb,
  note           text,
  logged_by      uuid references public.members (id) on delete set null,
  attributed_to  uuid references public.members (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index care_entries_subject_time_idx on public.care_entries (subject_id, occurred_at desc) where deleted_at is null;
create trigger care_entries_touch before update on public.care_entries for each row execute function private.touch_updated_at();

create table public.care_custody (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.care_subjects (id) on delete cascade,
  module_id   text not null references public.modules (id),
  member_id   uuid not null references public.members (id) on delete cascade,
  since       timestamptz not null default now(),
  set_by      uuid references public.members (id) on delete set null,
  note        text
);
create index care_custody_subject_idx on public.care_custody (subject_id, since desc);

-- Keep module_id in sync with the subject and make sure the type matches.
create or replace function private.care_entries_fill_module() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_module text;
begin
  select module_id into v_module from public.care_subjects where id = new.subject_id;
  if v_module is null then raise exception 'unknown care subject %', new.subject_id; end if;
  new.module_id := v_module;
  if not exists (select 1 from public.care_entry_types t where t.id = new.type_id and t.module_id = v_module) then
    raise exception 'entry type % does not belong to module %', new.type_id, v_module;
  end if;
  return new;
end $$;
create trigger care_entries_fill_module before insert or update of subject_id, type_id on public.care_entries
  for each row execute function private.care_entries_fill_module();

create or replace function private.care_custody_fill_module() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_module text;
begin
  select module_id into v_module from public.care_subjects where id = new.subject_id;
  if v_module is null then raise exception 'unknown care subject %', new.subject_id; end if;
  new.module_id := v_module;
  return new;
end $$;
create trigger care_custody_fill_module before insert or update of subject_id on public.care_custody
  for each row execute function private.care_custody_fill_module();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.care_subjects    enable row level security;
alter table public.care_entry_types enable row level security;
alter table public.care_entries     enable row level security;
alter table public.care_custody     enable row level security;

create policy care_subjects_read  on public.care_subjects for select to authenticated using (public.has_permission(module_id, 'view'));
create policy care_subjects_write on public.care_subjects for all    to authenticated using (public.has_permission(module_id, 'edit')) with check (public.has_permission(module_id, 'edit'));

create policy care_types_read     on public.care_entry_types for select to authenticated using (public.has_permission(module_id, 'view'));
create policy care_types_write    on public.care_entry_types for all    to authenticated using (public.has_permission(module_id, 'edit')) with check (public.has_permission(module_id, 'edit'));

create policy care_entries_read   on public.care_entries for select to authenticated using (public.has_permission(module_id, 'view'));
create policy care_entries_add    on public.care_entries for insert to authenticated
  with check (public.has_permission(module_id, 'add') and logged_by = public.current_member_id());
create policy care_entries_edit   on public.care_entries for update to authenticated
  using (public.has_permission(module_id, 'edit') or public.has_permission(module_id, 'delete'))
  with check (public.has_permission(module_id, 'edit') or public.has_permission(module_id, 'delete'));
create policy care_entries_delete on public.care_entries for delete to authenticated using (public.has_permission(module_id, 'delete'));

create policy care_custody_read   on public.care_custody for select to authenticated using (public.has_permission(module_id, 'view'));
create policy care_custody_add    on public.care_custody for insert to authenticated with check (public.has_permission(module_id, 'add'));

grant select, insert, update, delete on public.care_subjects, public.care_entry_types, public.care_entries, public.care_custody to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private lookups (security definer so a denied caller can still be audited
-- against the right module).
-- ---------------------------------------------------------------------------
create or replace function private.subject_module(p_subject uuid) returns text
language sql stable security definer set search_path = public as $$
  select module_id from public.care_subjects where id = p_subject and is_active
$$;

create or replace function private.default_subject(p_kind text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.care_subjects where kind = p_kind and is_active order by sort, created_at limit 1
$$;

create or replace function private.entry_module(p_entry uuid) returns text
language sql stable security definer set search_path = public as $$
  select module_id from public.care_entries where id = p_entry
$$;

create or replace function private.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;

create or replace function private.denied(p_message text default 'You are not allowed to do this.') returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', 'not_allowed', 'message', p_message)
$$;

-- ---------------------------------------------------------------------------
-- RPC: who am I
-- ---------------------------------------------------------------------------
create or replace function public.me() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_member public.members;
begin
  perform public.link_current_user();
  select * into v_member from public.members where user_id = auth.uid() and is_active;
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_member',
      'message', 'Your e-mail is not on the household list yet. Ask an admin to add you.');
  end if;
  return jsonb_build_object(
    'ok', true,
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

-- ---------------------------------------------------------------------------
-- RPC: household today — who is in the house, who is working
-- (RLS on members decides what the caller sees; staff see only themselves)
-- ---------------------------------------------------------------------------
create or replace function public.household_today() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := (select timezone from public.household limit 1);
  v_today date := (now() at time zone coalesce(v_tz, 'UTC'))::date;
begin
  return jsonb_build_object(
    'ok', true, 'today', v_today, 'timezone', v_tz,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.display_name, 'role_id', m.role_id, 'relationship', m.relationship,
        'presence', (select jsonb_build_object('state_id', p.state_id, 'label', ps.label,
                      'in_house', ps.counts_as_in_house, 'starts_on', p.starts_on, 'ends_on', p.ends_on, 'note', p.note)
                     from public.current_presence(m.id) p join public.presence_states ps on ps.id = p.state_id where p.id is not null),
        'works_today', exists (select 1 from public.work_schedules w where w.member_id = m.id and w.weekday = extract(dow from v_today)::int),
        'work_days', (select coalesce(jsonb_agg(weekday order by weekday), '[]'::jsonb) from public.work_schedules w where w.member_id = m.id)
      ) order by m.role_id, m.display_name)
      from public.members m where m.is_active), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- RPC: home summary for a subject (default: the first child)
-- ---------------------------------------------------------------------------
create or replace function public.home_summary(p_subject_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
begin
  if v_module is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Nobody to show yet.');
  end if;
  if not private.authz(v_module, 'view', 'care_entries', v_subject::text) then
    return private.denied('You are not allowed to see this log.');
  end if;
  return jsonb_build_object(
    'ok', true, 'today', v_today, 'timezone', v_tz,
    'subject', (select to_jsonb(s) from public.care_subjects s where s.id = v_subject),
    'custody', (select jsonb_build_object('member_id', c.member_id, 'name', m.display_name, 'since', c.since)
                from public.care_custody c left join public.members m on m.id = c.member_id
                where c.subject_id = v_subject order by c.since desc limit 1),
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]'::jsonb)
              from public.care_entry_types t where t.module_id = v_module and t.is_active),
    'last', (select coalesce(jsonb_object_agg(l.type_id, l.row), '{}'::jsonb) from (
               select distinct on (e.type_id) e.type_id,
                 jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'ended_at', e.ended_at,
                   'payload', e.payload, 'note', e.note, 'by', m.display_name,
                   'next_due', case when t.due_after_min is not null
                                    then coalesce(e.ended_at, e.occurred_at) + make_interval(mins => t.due_after_min) end) as row
               from public.care_entries e
               join public.care_entry_types t on t.id = e.type_id
               left join public.members m on m.id = coalesce(e.attributed_to, e.logged_by)
               where e.subject_id = v_subject and e.deleted_at is null
               order by e.type_id, e.occurred_at desc) l),
    'today_counts', (select coalesce(jsonb_object_agg(c.type_id, c.n), '{}'::jsonb) from (
                       select type_id, count(*) as n from public.care_entries
                       where subject_id = v_subject and deleted_at is null
                         and (occurred_at at time zone v_tz)::date = v_today
                       group by type_id) c),
    'today_entries', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', e.id, 'type_id', e.type_id, 'type_label', t.label, 'icon', t.icon,
                        'occurred_at', e.occurred_at, 'ended_at', e.ended_at, 'payload', e.payload, 'note', e.note,
                        'by', coalesce(ab.display_name, lb.display_name)) order by e.occurred_at desc), '[]'::jsonb)
                      from public.care_entries e
                      join public.care_entry_types t on t.id = e.type_id
                      left join public.members lb on lb.id = e.logged_by
                      left join public.members ab on ab.id = e.attributed_to
                      where e.subject_id = v_subject and e.deleted_at is null
                        and (e.occurred_at at time zone v_tz)::date = v_today)
  );
end $$;

-- ---------------------------------------------------------------------------
-- RPC: list entries in a window
-- ---------------------------------------------------------------------------
create or replace function public.care_entries_list(p_subject_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'view', 'care_entries', p_subject_id::text,
                       jsonb_build_object('from', p_from, 'to', p_to)) then
    return private.denied('You are not allowed to see this log.');
  end if;
  return jsonb_build_object('ok', true, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'type_id', e.type_id, 'type_label', t.label, 'icon', t.icon,
      'occurred_at', e.occurred_at, 'ended_at', e.ended_at, 'payload', e.payload, 'note', e.note,
      'logged_by', e.logged_by, 'logged_by_name', lb.display_name,
      'attributed_to', e.attributed_to, 'attributed_name', ab.display_name) order by e.occurred_at desc)
    from public.care_entries e
    join public.care_entry_types t on t.id = e.type_id
    left join public.members lb on lb.id = e.logged_by
    left join public.members ab on ab.id = e.attributed_to
    where e.subject_id = p_subject_id and e.deleted_at is null
      and e.occurred_at >= p_from and e.occurred_at < p_to), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- RPC: log an entry (idempotent on client_id for the offline queue)
-- ---------------------------------------------------------------------------
create or replace function public.care_entry_log(
  p_subject_id uuid, p_type_id text,
  p_occurred_at timestamptz default now(), p_ended_at timestamptz default null,
  p_payload jsonb default '{}'::jsonb, p_note text default null, p_client_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_me     uuid := public.current_member_id();
  v_holder uuid;
  v_id     uuid;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'add') then
    perform private.audit_write(v_module, 'add', false, 'care_entries', null, jsonb_build_object('type', p_type_id));
    return private.denied('You are not allowed to add to this log.');
  end if;
  if p_client_id is not null then
    select id into v_id from public.care_entries where client_id = p_client_id;
    if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  end if;
  if not exists (select 1 from public.care_entry_types where id = p_type_id and module_id = v_module and is_active) then
    return jsonb_build_object('ok', false, 'error', 'bad_type', 'message', 'That kind of entry does not exist.');
  end if;
  select member_id into v_holder from public.care_custody where subject_id = p_subject_id order by since desc limit 1;
  insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, ended_at, payload, note, logged_by, attributed_to)
  values (p_client_id, p_subject_id, v_module, p_type_id, coalesce(p_occurred_at, now()), p_ended_at,
          coalesce(p_payload, '{}'::jsonb), nullif(btrim(p_note), ''), v_me, coalesce(v_holder, v_me))
  returning id into v_id;
  perform private.audit_write(v_module, 'add', true, 'care_entries', v_id::text, jsonb_build_object('type', p_type_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.care_entry_update(
  p_id uuid, p_occurred_at timestamptz, p_ended_at timestamptz, p_payload jsonb, p_note text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text);
    return private.denied('You are not allowed to change this entry.');
  end if;
  update public.care_entries
     set occurred_at = coalesce(p_occurred_at, occurred_at),
         ended_at    = p_ended_at,
         payload     = coalesce(p_payload, payload),
         note        = nullif(btrim(p_note), '')
   where id = p_id and deleted_at is null;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.care_entry_delete(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'delete') then
    perform private.audit_write(v_module, 'delete', false, 'care_entries', p_id::text);
    return private.denied('You are not allowed to delete this entry.');
  end if;
  update public.care_entries set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write(v_module, 'delete', true, 'care_entries', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- RPC: who has Lana
-- ---------------------------------------------------------------------------
create or replace function public.custody_set(p_subject_id uuid, p_member_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_id uuid;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'add') then
    perform private.audit_write(v_module, 'add', false, 'care_custody', null, jsonb_build_object('member', p_member_id));
    return private.denied();
  end if;
  insert into public.care_custody (subject_id, module_id, member_id, set_by)
  values (p_subject_id, v_module, p_member_id, public.current_member_id()) returning id into v_id;
  perform private.audit_write(v_module, 'add', true, 'care_custody', v_id::text, jsonb_build_object('member', p_member_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- RPC: presence, work days, members, roles, permissions (admin screens)
-- ---------------------------------------------------------------------------
create or replace function public.presence_set(
  p_member_id uuid, p_state_id text, p_starts_on date default null, p_ends_on date default null, p_note text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_id uuid;
begin
  if not (public.has_permission('members', 'edit') or p_member_id = v_me) then
    perform private.audit_write('members', 'edit', false, 'presence', p_member_id::text);
    return private.denied('You can only change your own presence.');
  end if;
  insert into public.presence (member_id, state_id, starts_on, ends_on, note, set_by)
  values (p_member_id, p_state_id, coalesce(p_starts_on, current_date), p_ends_on, nullif(btrim(p_note), ''), v_me)
  returning id into v_id;
  perform private.audit_write('members', 'edit', true, 'presence', v_id::text, jsonb_build_object('member', p_member_id, 'state', p_state_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.work_days_set(p_member_id uuid, p_weekdays smallint[]) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'work_schedules', p_member_id::text);
    return private.denied();
  end if;
  delete from public.work_schedules where member_id = p_member_id;
  insert into public.work_schedules (member_id, weekday)
  select p_member_id, d from unnest(coalesce(p_weekdays, '{}'::smallint[])) as d;
  perform private.audit_write('members', 'edit', true, 'work_schedules', p_member_id::text, jsonb_build_object('weekdays', p_weekdays));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.member_save(
  p_id uuid, p_display_name text, p_email text, p_role_id text,
  p_birth_date date default null, p_relationship text default null, p_is_active boolean default true
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_action text := case when p_id is null then 'add' else 'edit' end;
  v_email  text := nullif(lower(btrim(p_email)), '');
  v_id     uuid := p_id;
begin
  if not public.has_permission('members', v_action) then
    perform private.audit_write('members', v_action, false, 'members', p_id::text);
    return private.denied();
  end if;
  if v_action = 'edit' and p_id = public.current_member_id() and not p_is_active then
    return jsonb_build_object('ok', false, 'error', 'self_deactivate', 'message', 'You cannot deactivate yourself.');
  end if;
  if v_action = 'add' then
    insert into public.members (display_name, email, role_id, birth_date, relationship, is_active)
    values (btrim(p_display_name), v_email, p_role_id, p_birth_date, nullif(btrim(p_relationship), ''), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.members
       set display_name = btrim(p_display_name), email = v_email, role_id = p_role_id,
           birth_date = p_birth_date, relationship = nullif(btrim(p_relationship), ''), is_active = coalesce(p_is_active, true)
     where id = p_id;
  end if;
  -- link to an existing auth user with that e-mail, if any
  if v_email is not null then
    update public.members set user_id = private.auth_user_id_by_email(v_email)
     where id = v_id and user_id is null and private.auth_user_id_by_email(v_email) is not null;
  end if;
  perform private.audit_write('members', v_action, true, 'members', v_id::text, jsonb_build_object('role', p_role_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.role_save(p_id text, p_label text, p_description text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'roles', p_id);
    return private.denied();
  end if;
  insert into public.roles (id, label, description) values (p_id, btrim(p_label), nullif(btrim(p_description), ''))
  on conflict (id) do update set label = excluded.label, description = excluded.description;
  -- every role gets a full matrix row set (all false until an admin ticks them)
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
  -- never let an admin lock their own role out of member management
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

create or replace function public.audit_recent(p_limit integer default 200) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('audit', 'view') then
    perform private.audit_write('audit', 'view', false, 'audit_log');
    return private.denied();
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'at', a.at, 'actor', m.display_name, 'actor_role', a.actor_role,
      'module_id', a.module_id, 'action', a.action, 'allowed', a.allowed, 'source', a.source,
      'target_table', a.target_table, 'target_id', a.target_id, 'detail', a.detail) order by a.at desc)
    from (select * from public.audit_log order by at desc limit least(coalesce(p_limit, 200), 1000)) a
    left join public.members m on m.id = a.actor_member), '[]'::jsonb));
end $$;

grant execute on function
  public.me(), public.household_today(), public.home_summary(uuid),
  public.care_entries_list(uuid, timestamptz, timestamptz),
  public.care_entry_log(uuid, text, timestamptz, timestamptz, jsonb, text, uuid),
  public.care_entry_update(uuid, timestamptz, timestamptz, jsonb, text),
  public.care_entry_delete(uuid), public.custody_set(uuid, uuid),
  public.presence_set(uuid, text, date, date, text), public.work_days_set(uuid, smallint[]),
  public.member_save(uuid, text, text, text, date, text, boolean), public.role_save(text, text, text),
  public.permission_set(text, text, text, boolean), public.audit_recent(integer)
  to authenticated, service_role;
grant execute on function
  private.subject_module(uuid), private.default_subject(text), private.entry_module(uuid),
  private.auth_user_id_by_email(text), private.denied(text)
  to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
