-- ============================================================================
-- Family app — Step 2
--  * Lana: one-tap timers (sleep, breastfeed left/right for whoever
--    breastfeeds, night wake-up), milk source on bottle feeds.
--  * Shared calendar with per-event visibility (household / family-only),
--    recurring routines, "guest day blocks contractors".
--  * Shopping list, the shelf of usual items, Lilly's running-low requests
--    (photo + note), the admin review queue, stores as data.
--  * Private "photos" storage bucket.
-- No DELETE statements anywhere in this file on purpose: the Supabase
-- connector holds those for a manual approval. Removals are soft deletes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Lana log: entry-type options, timers, milk source
-- ---------------------------------------------------------------------------
alter table public.care_entry_types add column if not exists settings jsonb not null default '{}'::jsonb;
alter table public.members add column if not exists breastfeeds boolean not null default false;

update public.care_entry_types
   set has_end = true,
       settings = '{"timer": true, "timer_label": "Breastfeed", "end_if": {"method": "Breast"}, "timer_payload": {"method": "Breast"}, "timer_choice": {"key": "side", "options": ["Left", "Right"]}, "timer_flag": "breastfeeds"}'::jsonb,
       fields = '[
         {"key":"method","label":"How","type":"choice","options":["Bottle","Breast"],"required":true,"default":"Bottle","option_flags":{"Breast":"breastfeeds"}},
         {"key":"milk","label":"Which milk","type":"choice","options":["Morning pumped","Night pumped","Freezer","Formula"],"show_if":{"method":"Bottle"}},
         {"key":"amount_ml","label":"Amount (ml)","type":"number","quick":[60,90,120,150,180],"show_if":{"method":"Bottle"}},
         {"key":"side","label":"Side","type":"choice","options":["Left","Right","Both"],"show_if":{"method":"Breast"}}
       ]'::jsonb
 where id = 'lana.feed';

update public.care_entry_types
   set settings = '{"timer": true, "timer_label": "Sleep"}'::jsonb
 where id = 'lana.sleep';

insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active, settings) values
  ('lana.wake', 'lana', 'wake', 'Night wake-up', '🌙', '#4338ca', 35, true, null, '[]'::jsonb, false, true,
   '{"timer": true, "timer_label": "Awake at night"}'::jsonb)
on conflict (id) do nothing;

-- Which member breastfeeds is household data (setup-household.mjs, or the Members screen).

-- End an open entry (a running timer). Allowed for editors, or whoever started it.
create or replace function public.care_entry_end(p_id uuid, p_ended_at timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
  v_row public.care_entries;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into v_row from public.care_entries where id = p_id;
  if not (public.has_permission(v_module, 'edit') or (v_row.logged_by = public.current_member_id() and public.has_permission(v_module, 'add'))) then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text, '{"end": true}'::jsonb);
    return private.denied('You are not allowed to change this entry.');
  end if;
  if coalesce(p_ended_at, now()) < v_row.occurred_at then
    return jsonb_build_object('ok', false, 'error', 'bad_time', 'message', 'The end time is before the start time.');
  end if;
  update public.care_entries set ended_at = coalesce(p_ended_at, now()) where id = p_id and deleted_at is null;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"end": true}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
grant execute on function public.care_entry_end(uuid, timestamptz) to authenticated, service_role;

-- home_summary: same as before plus "ongoing" (open timers) and the member flags.
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
    'ongoing', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'type_id', e.type_id, 'occurred_at', e.occurred_at, 'payload', e.payload,
                  'by', m.display_name) order by e.occurred_at), '[]'::jsonb)
                from public.care_entries e
                join public.care_entry_types t on t.id = e.type_id
                left join public.members m on m.id = coalesce(e.attributed_to, e.logged_by)
                where e.subject_id = v_subject and e.deleted_at is null and t.has_end and e.ended_at is null),
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
-- 2. Permission modules added in this step (existing roles get rows here;
--    roles created later get them from role_save)
-- ---------------------------------------------------------------------------
insert into public.modules (id, label, description, sort) values
  ('calendar_family',   'Family-only calendar events', 'Events marked "family only" are hidden from staff.', 45),
  ('shopping_requests', 'Running-low requests',        'Flag an item as running low; an admin approves it onto the list.', 52)
on conflict (id) do nothing;

insert into public.permissions (role_id, module_id, action, allowed)
select r.id, m.id, a.action,
  case
    when r.id = 'admin' then true
    when r.id = 'family_carer' and m.id = 'calendar_family'   and a.action in ('view', 'add') then true
    when r.id = 'home_carer'   and m.id = 'shopping_requests' and a.action in ('view', 'add') then true
    else false
  end
from public.roles r
cross join public.modules m
cross join (values ('view'), ('add'), ('edit'), ('delete')) as a(action)
where m.id in ('calendar_family', 'shopping_requests')
on conflict (role_id, module_id, action) do nothing;

-- Staff flag items through the request queue, not straight onto the list.
update public.permissions set allowed = false
 where role_id = 'home_carer' and module_id = 'shopping' and action = 'add';

-- ---------------------------------------------------------------------------
-- 3. Calendar
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  kind          text not null default 'event'
                check (kind in ('event', 'plan', 'reminder', 'routine', 'guest', 'delivery', 'contractor', 'appointment')),
  starts_at     timestamptz not null,
  ends_at       timestamptz check (ends_at is null or ends_at >= starts_at),
  all_day       boolean not null default false,
  visibility    text not null default 'household' check (visibility in ('household', 'family')),
  assigned_to   uuid references public.members (id) on delete set null,
  note          text,
  repeat        text not null default 'none' check (repeat in ('none', 'daily', 'weekly')),
  repeat_until  date,
  created_by    uuid references public.members (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- things that affect staff are always visible to the whole household
  check (kind not in ('guest', 'delivery', 'contractor') or visibility = 'household')
);
create index calendar_events_starts_idx on public.calendar_events (starts_at) where deleted_at is null;
create trigger calendar_events_touch before update on public.calendar_events for each row execute function private.touch_updated_at();

alter table public.calendar_events enable row level security;
create policy calendar_read on public.calendar_events for select to authenticated using (
  deleted_at is null and (
    (visibility = 'household' and public.has_permission('calendar', 'view')) or
    (visibility = 'family'    and public.has_permission('calendar_family', 'view')) or
    assigned_to = public.current_member_id()));
create policy calendar_add on public.calendar_events for insert to authenticated with check (
  public.has_permission('calendar', 'add') and created_by = public.current_member_id() and
  (visibility = 'household' or public.has_permission('calendar_family', 'add')));
create policy calendar_edit on public.calendar_events for update to authenticated
  using (public.has_permission('calendar', 'edit') or created_by = public.current_member_id())
  with check (public.has_permission('calendar', 'edit') or created_by = public.current_member_id());
grant select, insert, update on public.calendar_events to authenticated, service_role;

-- Events in a date window, recurring ones expanded, plus who is in the house
-- and who works each day.
create or replace function public.calendar_list(p_from date, p_to date) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
begin
  if not private.authz('calendar', 'view', 'calendar_events') then
    return private.denied('You are not allowed to see the calendar.');
  end if;
  return jsonb_build_object(
    'ok', true, 'timezone', v_tz, 'from', p_from, 'to', p_to,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'title', x.title, 'kind', x.kind, 'all_day', x.all_day, 'visibility', x.visibility,
        'starts_at', x.occ_start, 'ends_at', x.occ_end, 'date', (x.occ_start at time zone v_tz)::date,
        'assigned_to', x.assigned_to, 'assigned_name', m.display_name, 'note', x.note,
        'repeat', x.repeat, 'repeat_until', x.repeat_until, 'created_by', x.created_by,
        'is_occurrence', x.occ_start <> x.starts_at) order by x.occ_start, x.title)
      from (
        select e.*,
               e.starts_at + (d.n * case e.repeat when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '0' end) as occ_start,
               e.ends_at   + (d.n * case e.repeat when 'daily' then interval '1 day' when 'weekly' then interval '7 days' else interval '0' end) as occ_end
        from public.calendar_events e
        cross join lateral generate_series(0, case e.repeat when 'none' then 0 else 400 end) as d(n)
        where e.deleted_at is null
      ) x
      left join public.members m on m.id = x.assigned_to
      where (x.occ_start at time zone v_tz)::date between p_from and p_to
        and (x.repeat = 'none' or x.repeat_until is null or (x.occ_start at time zone v_tz)::date <= x.repeat_until)
    ), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'in_house', (select coalesce(jsonb_agg(m.display_name order by m.display_name), '[]'::jsonb)
                     from public.members m
                     where m.is_active and exists (
                       select 1 from public.presence p join public.presence_states ps on ps.id = p.state_id
                       where p.member_id = m.id and ps.counts_as_in_house
                         and p.starts_on <= d.day and (p.ends_on is null or p.ends_on >= d.day)
                         and p.starts_on = (select max(p2.starts_on) from public.presence p2
                                             where p2.member_id = m.id and p2.starts_on <= d.day))),
        'working', (select coalesce(jsonb_agg(m.display_name order by m.display_name), '[]'::jsonb)
                    from public.members m join public.work_schedules w on w.member_id = m.id
                    where m.is_active and w.weekday = extract(dow from d.day)::int)
      ) order by d.day)
      from generate_series(p_from, least(p_to, p_from + 60), interval '1 day') as d(day)
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.calendar_save(
  p_id uuid, p_title text, p_kind text, p_starts_at timestamptz, p_ends_at timestamptz default null,
  p_all_day boolean default false, p_visibility text default 'household', p_assigned_to uuid default null,
  p_note text default null, p_repeat text default 'none', p_repeat_until date default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_action text := case when p_id is null then 'add' else 'edit' end;
  v_id uuid := p_id;
  v_vis text := case when p_kind in ('guest', 'delivery', 'contractor') then 'household' else coalesce(p_visibility, 'household') end;
  v_owner uuid;
begin
  if v_action = 'edit' then
    select created_by into v_owner from public.calendar_events where id = p_id and deleted_at is null;
    if v_owner is null and not exists (select 1 from public.calendar_events where id = p_id and deleted_at is null) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;
  if not (public.has_permission('calendar', v_action) or (v_action = 'edit' and v_owner = v_me and public.has_permission('calendar', 'add'))) then
    perform private.audit_write('calendar', v_action, false, 'calendar_events', p_id::text);
    return private.denied();
  end if;
  if v_vis = 'family' and not public.has_permission('calendar_family', 'add') then
    perform private.audit_write('calendar_family', 'add', false, 'calendar_events', p_id::text);
    return private.denied('You cannot make family-only events.');
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_title', 'message', 'Give the event a name.');
  end if;
  -- Visitor mode: a guest day blocks contractor visits.
  if p_kind = 'contractor' and exists (
      select 1 from public.calendar_events g
      where g.deleted_at is null and g.kind = 'guest' and g.id is distinct from p_id
        and (g.starts_at at time zone v_tz)::date = (p_starts_at at time zone v_tz)::date) then
    return jsonb_build_object('ok', false, 'error', 'guest_day',
      'message', 'There is a guest that day. Book the contractor for another day.');
  end if;
  if v_action = 'add' then
    insert into public.calendar_events (title, kind, starts_at, ends_at, all_day, visibility, assigned_to, note, repeat, repeat_until, created_by)
    values (btrim(p_title), coalesce(p_kind, 'event'), p_starts_at, p_ends_at, coalesce(p_all_day, false), v_vis,
            p_assigned_to, nullif(btrim(p_note), ''), coalesce(p_repeat, 'none'), p_repeat_until, v_me)
    returning id into v_id;
  else
    update public.calendar_events
       set title = btrim(p_title), kind = coalesce(p_kind, kind), starts_at = p_starts_at, ends_at = p_ends_at,
           all_day = coalesce(p_all_day, false), visibility = v_vis, assigned_to = p_assigned_to,
           note = nullif(btrim(p_note), ''), repeat = coalesce(p_repeat, 'none'), repeat_until = p_repeat_until
     where id = p_id and deleted_at is null;
  end if;
  perform private.audit_write('calendar', v_action, true, 'calendar_events', v_id::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.calendar_remove(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid;
begin
  select created_by into v_owner from public.calendar_events where id = p_id and deleted_at is null;
  if not (public.has_permission('calendar', 'delete') or (v_owner = public.current_member_id() and public.has_permission('calendar', 'add'))) then
    perform private.audit_write('calendar', 'delete', false, 'calendar_events', p_id::text);
    return private.denied();
  end if;
  update public.calendar_events set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('calendar', 'delete', true, 'calendar_events', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

grant execute on function public.calendar_list(date, date),
  public.calendar_save(uuid, text, text, timestamptz, timestamptz, boolean, text, uuid, text, text, date),
  public.calendar_remove(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Shopping: stores, items, the shelf, requests
-- ---------------------------------------------------------------------------
create table public.stores (
  id    text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  url   text,
  sort  integer not null default 100
);

create table public.shopping_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  category         text not null default 'groceries' check (category in ('groceries', 'baby', 'cat', 'home', 'adult')),
  owner_member     uuid references public.members (id) on delete set null,
  store_id         text references public.stores (id),
  product_url      text,
  quantity_on_hand text,
  size             text,
  size_changed_on  date,
  last_bought_on   date,
  last_price       numeric(10, 2),
  last_price_store text,
  reorder_days     integer check (reorder_days is null or reorder_days > 0),
  needed           boolean not null default true,
  note             text,
  photo_path       text,
  created_by       uuid references public.members (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index shopping_items_needed_idx on public.shopping_items (needed, category) where deleted_at is null;
create trigger shopping_items_touch before update on public.shopping_items for each row execute function private.touch_updated_at();

create table public.shelf_items (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  category  text not null default 'home' check (category in ('groceries', 'baby', 'cat', 'home', 'adult')),
  emoji     text,
  sort      integer not null default 100,
  is_active boolean not null default true
);

create table public.shopping_requests (
  id            uuid primary key default gen_random_uuid(),
  shelf_item_id uuid references public.shelf_items (id) on delete set null,
  item_name     text not null,
  note          text,
  photo_path    text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  item_id       uuid references public.shopping_items (id) on delete set null,
  created_by    uuid references public.members (id) on delete set null,
  reviewed_by   uuid references public.members (id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index shopping_requests_status_idx on public.shopping_requests (status, created_at desc);

alter table public.stores            enable row level security;
alter table public.shopping_items    enable row level security;
alter table public.shelf_items       enable row level security;
alter table public.shopping_requests enable row level security;

create policy stores_read   on public.stores for select to authenticated using (public.current_member_id() is not null);
create policy stores_write  on public.stores for all    to authenticated using (public.has_permission('shopping', 'edit')) with check (public.has_permission('shopping', 'edit'));

create policy items_read    on public.shopping_items for select to authenticated
  using (deleted_at is null and (public.has_permission('shopping', 'view') or owner_member = public.current_member_id()));
create policy items_add     on public.shopping_items for insert to authenticated
  with check (public.has_permission('shopping', 'add') and created_by = public.current_member_id());
create policy items_edit    on public.shopping_items for update to authenticated
  using (public.has_permission('shopping', 'edit') or owner_member = public.current_member_id())
  with check (public.has_permission('shopping', 'edit') or owner_member = public.current_member_id());

create policy shelf_read    on public.shelf_items for select to authenticated
  using (public.has_permission('shopping', 'view') or public.has_permission('shopping_requests', 'add'));
create policy shelf_write   on public.shelf_items for all to authenticated
  using (public.has_permission('shopping', 'edit')) with check (public.has_permission('shopping', 'edit'));

create policy requests_read on public.shopping_requests for select to authenticated
  using (public.has_permission('shopping_review', 'view') or created_by = public.current_member_id());
create policy requests_add  on public.shopping_requests for insert to authenticated
  with check (public.has_permission('shopping_requests', 'add') and created_by = public.current_member_id());
create policy requests_edit on public.shopping_requests for update to authenticated
  using (public.has_permission('shopping_review', 'edit')) with check (public.has_permission('shopping_review', 'edit'));

grant select, insert, update on public.stores, public.shopping_items, public.shelf_items, public.shopping_requests to authenticated, service_role;

create or replace function public.shopping_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not (public.has_permission('shopping', 'view') or public.has_permission('shopping_requests', 'add')) then
    perform private.audit_write('shopping', 'view', false, 'shopping_items');
    return private.denied('You are not allowed to see the shopping list.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category', i.category, 'needed', i.needed,
        'owner_member', i.owner_member, 'owner_name', m.display_name,
        'store_id', i.store_id, 'store_label', s.label, 'product_url', i.product_url,
        'quantity_on_hand', i.quantity_on_hand, 'size', i.size, 'size_changed_on', i.size_changed_on,
        'last_bought_on', i.last_bought_on, 'last_price', i.last_price, 'last_price_store', i.last_price_store,
        'reorder_days', i.reorder_days, 'note', i.note, 'photo_path', i.photo_path,
        'due', case when i.reorder_days is not null and i.last_bought_on is not null
                    then i.last_bought_on + i.reorder_days end
      ) order by i.needed desc, i.category, i.name)
      from public.shopping_items i
      left join public.members m on m.id = i.owner_member
      left join public.stores s on s.id = i.store_id
      where i.deleted_at is null), '[]'::jsonb),
    'shelf', coalesce((select jsonb_agg(to_jsonb(sh) order by sh.sort, sh.name) from public.shelf_items sh where sh.is_active), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(st) order by st.sort) from public.stores st), '[]'::jsonb),
    'pending_requests', (select count(*) from public.shopping_requests r where r.status = 'pending')
  );
end $$;

create or replace function public.shopping_item_save(
  p_id uuid, p_name text, p_category text default 'groceries', p_owner_member uuid default null,
  p_store_id text default null, p_product_url text default null, p_quantity_on_hand text default null,
  p_size text default null, p_last_bought_on date default null, p_last_price numeric default null,
  p_reorder_days integer default null, p_needed boolean default true, p_note text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_action text := case when p_id is null then 'add' else 'edit' end;
  v_id uuid := p_id;
  v_owner uuid;
  v_old_size text;
begin
  if v_action = 'edit' then
    select owner_member, size into v_owner, v_old_size from public.shopping_items where id = p_id and deleted_at is null;
  end if;
  if not (public.has_permission('shopping', v_action) or (v_action = 'edit' and v_owner = v_me)) then
    perform private.audit_write('shopping', v_action, false, 'shopping_items', p_id::text);
    return private.denied();
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_name', 'message', 'Give the item a name.');
  end if;
  if v_action = 'add' then
    insert into public.shopping_items (name, category, owner_member, store_id, product_url, quantity_on_hand, size, size_changed_on,
                                       last_bought_on, last_price, reorder_days, needed, note, created_by)
    values (btrim(p_name), coalesce(p_category, 'groceries'), p_owner_member, p_store_id, nullif(btrim(p_product_url), ''),
            nullif(btrim(p_quantity_on_hand), ''), nullif(btrim(p_size), ''), case when nullif(btrim(p_size), '') is not null then current_date end,
            p_last_bought_on, p_last_price, p_reorder_days, coalesce(p_needed, true), nullif(btrim(p_note), ''), v_me)
    returning id into v_id;
  else
    update public.shopping_items
       set name = btrim(p_name), category = coalesce(p_category, category), owner_member = p_owner_member,
           store_id = p_store_id, product_url = nullif(btrim(p_product_url), ''),
           quantity_on_hand = nullif(btrim(p_quantity_on_hand), ''),
           size = nullif(btrim(p_size), ''),
           size_changed_on = case when nullif(btrim(p_size), '') is distinct from v_old_size then current_date else size_changed_on end,
           last_bought_on = p_last_bought_on, last_price = p_last_price, reorder_days = p_reorder_days,
           needed = coalesce(p_needed, needed), note = nullif(btrim(p_note), '')
     where id = p_id and deleted_at is null;
  end if;
  perform private.audit_write('shopping', v_action, true, 'shopping_items', v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Tick an item off (bought today) or put it back on the list.
create or replace function public.shopping_item_needed(p_id uuid, p_needed boolean, p_price numeric default null, p_store text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_owner uuid;
begin
  select owner_member into v_owner from public.shopping_items where id = p_id and deleted_at is null;
  if not (public.has_permission('shopping', 'edit') or v_owner = public.current_member_id()) then
    perform private.audit_write('shopping', 'edit', false, 'shopping_items', p_id::text);
    return private.denied();
  end if;
  update public.shopping_items
     set needed = p_needed,
         last_bought_on = case when not p_needed then current_date else last_bought_on end,
         last_price = case when not p_needed and p_price is not null then p_price else last_price end,
         last_price_store = case when not p_needed and p_price is not null then coalesce(p_store, last_price_store) else last_price_store end
   where id = p_id and deleted_at is null;
  perform private.audit_write('shopping', 'edit', true, 'shopping_items', p_id::text, jsonb_build_object('needed', p_needed));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.shopping_item_remove(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'delete') then
    perform private.audit_write('shopping', 'delete', false, 'shopping_items', p_id::text);
    return private.denied();
  end if;
  update public.shopping_items set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('shopping', 'delete', true, 'shopping_items', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Lilly's screen: tap a shelf item, or send a photo with a note.
create or replace function public.shopping_request_create(
  p_shelf_item_id uuid default null, p_item_name text default null, p_note text default null, p_photo_path text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_name text := nullif(btrim(coalesce(p_item_name, '')), '');
  v_id uuid;
begin
  if not public.has_permission('shopping_requests', 'add') then
    perform private.audit_write('shopping_requests', 'add', false, 'shopping_requests');
    return private.denied();
  end if;
  if p_shelf_item_id is not null then
    select name into v_name from public.shelf_items where id = p_shelf_item_id;
  end if;
  if v_name is null then
    if p_photo_path is null then
      return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Add a photo or write what is running out.');
    end if;
    v_name := 'See photo';
  end if;
  insert into public.shopping_requests (shelf_item_id, item_name, note, photo_path, created_by)
  values (p_shelf_item_id, v_name, nullif(btrim(p_note), ''), p_photo_path, v_me)
  returning id into v_id;
  perform private.audit_write('shopping_requests', 'add', true, 'shopping_requests', v_id::text, jsonb_build_object('item', v_name));
  return jsonb_build_object('ok', true, 'id', v_id, 'item_name', v_name);
end $$;

create or replace function public.shopping_requests_list(p_status text default 'pending') returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not (public.has_permission('shopping_review', 'view') or public.has_permission('shopping_requests', 'view')) then
    perform private.audit_write('shopping_review', 'view', false, 'shopping_requests');
    return private.denied();
  end if;
  return jsonb_build_object('ok', true, 'requests', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'item_name', r.item_name, 'note', r.note, 'photo_path', r.photo_path, 'status', r.status,
      'shelf_item_id', r.shelf_item_id, 'category', sh.category, 'emoji', sh.emoji,
      'created_by', r.created_by, 'created_by_name', c.display_name, 'created_at', r.created_at,
      'reviewed_by_name', rv.display_name, 'reviewed_at', r.reviewed_at, 'item_id', r.item_id) order by r.created_at desc)
    from public.shopping_requests r
    left join public.shelf_items sh on sh.id = r.shelf_item_id
    left join public.members c on c.id = r.created_by
    left join public.members rv on rv.id = r.reviewed_by
    where p_status is null or r.status = p_status), '[]'::jsonb));
end $$;

-- Approve: the item joins the list (or an existing one is marked needed). Reject: nothing joins.
create or replace function public.shopping_request_review(p_id uuid, p_approve boolean, p_item_name text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_req public.shopping_requests;
  v_name text;
  v_category text;
  v_item uuid;
begin
  if not public.has_permission('shopping_review', 'edit') then
    perform private.audit_write('shopping_review', 'edit', false, 'shopping_requests', p_id::text);
    return private.denied();
  end if;
  select * into v_req from public.shopping_requests where id = p_id;
  if v_req.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'done', 'message', 'This request was already handled.');
  end if;
  if p_approve then
    v_name := coalesce(nullif(btrim(p_item_name), ''), v_req.item_name);
    select category into v_category from public.shelf_items where id = v_req.shelf_item_id;
    select id into v_item from public.shopping_items where deleted_at is null and lower(name) = lower(v_name) order by created_at limit 1;
    if v_item is null then
      insert into public.shopping_items (name, category, needed, photo_path, note, created_by)
      values (v_name, coalesce(v_category, 'home'), true, v_req.photo_path, v_req.note, v_me)
      returning id into v_item;
    else
      update public.shopping_items set needed = true where id = v_item;
    end if;
  end if;
  update public.shopping_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         item_id = v_item, reviewed_by = v_me, reviewed_at = now(),
         item_name = coalesce(v_name, item_name)
   where id = p_id;
  perform private.audit_write('shopping_review', 'edit', true, 'shopping_requests', p_id::text,
                              jsonb_build_object('approved', p_approve, 'item', v_item));
  return jsonb_build_object('ok', true, 'id', p_id, 'item_id', v_item);
end $$;

grant execute on function public.shopping_list(),
  public.shopping_item_save(uuid, text, text, uuid, text, text, text, text, date, numeric, integer, boolean, text),
  public.shopping_item_needed(uuid, boolean, numeric, text), public.shopping_item_remove(uuid),
  public.shopping_request_create(uuid, text, text, text), public.shopping_requests_list(text),
  public.shopping_request_review(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Photos bucket (private). Paths: requests/<uuid>.jpg, items/<uuid>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.has_permission('photos', 'view'));
create policy photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.has_permission('photos', 'add'));

-- ---------------------------------------------------------------------------
-- 6. Seed
-- ---------------------------------------------------------------------------
insert into public.stores (id, label, url, sort) values
  ('amazon_ae', 'Amazon.ae', 'https://www.amazon.ae', 10),
  ('noon',      'Noon',      'https://www.noon.com',   20),
  ('talabat',   'Talabat',   'https://www.talabat.com', 30),
  ('carrefour', 'Carrefour', 'https://www.carrefouruae.com', 40),
  ('other',     'Other shop', null, 90)
on conflict (id) do nothing;

insert into public.shelf_items (name, category, emoji, sort)
select v.name, v.category, v.emoji, v.sort from (values
  ('Milk', 'groceries', '🥛', 10), ('Bread', 'groceries', '🍞', 11), ('Eggs', 'groceries', '🥚', 12), ('Water', 'groceries', '💧', 13),
  ('Nappies', 'baby', '👶', 20), ('Wipes', 'baby', '🧻', 21), ('Formula', 'baby', '🍼', 22),
  ('Cat food', 'cat', '🐈', 30), ('Cat litter', 'cat', '🪣', 31),
  ('Dish soap', 'home', '🧽', 40), ('Laundry soap', 'home', '🧺', 41), ('Toilet paper', 'home', '🧻', 42), ('Bin bags', 'home', '🗑️', 43)
) as v(name, category, emoji, sort)
where not exists (select 1 from public.shelf_items s where lower(s.name) = lower(v.name));

-- The shopping list starts empty; the first household's items were seeded here until
-- migration 3500 (the test suite has its own in tests/01_test_household.sql).

-- The child's night window (drives "Woke up (night)" vs "Up for the day") lives in
-- care_subjects.settings (night_from, night_to); setup-household.mjs writes it, the
-- app falls back to 19:00 to 07:00.
