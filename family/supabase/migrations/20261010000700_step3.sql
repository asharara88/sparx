-- ============================================================================
-- Family app — Step 3: Fanta and the home
--  1. Fanta's entry types, profile, and what is due (vaccination, deworming,
--     flea treatment, next meal, litter).
--  2. Photo attachments on any entry, ticket or asset, with the text read off
--     the photo kept for search.
--  3. Home maintenance: tickets (Lilly opens them with a photo), assets (every
--     appliance label photographed once), contractors. Costs live in their own
--     table under the `maintenance_costs` module so staff never see them.
-- No DELETE statements (the connector stalls on them); removals are soft.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Fanta
-- ---------------------------------------------------------------------------
insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('fanta.food', 'fanta', 'food', 'Fed', '🍗', '#ea580c', 10, false, 720,
   '[{"key":"food","label":"What","type":"choice","options":["Royal Canin","Wet food","Other"],"required":true,"default":"Royal Canin"},
     {"key":"amount_g","label":"Amount (g)","type":"number","quick":[20,30,40,50]}]'::jsonb, true, true),
  ('fanta.treat', 'fanta', 'treat', 'Treat', '🐟', '#f59e0b', 20, false, null,
   '[{"key":"what","label":"What","type":"text"}]'::jsonb, false, true),
  ('fanta.litter', 'fanta', 'litter', 'Litter', '🧹', '#65a30d', 30, false, 1440,
   '[{"key":"kind","label":"What","type":"choice","options":["Scooped","Full change"],"required":true,"default":"Scooped"}]'::jsonb, true, true),
  ('fanta.weight', 'fanta', 'weight', 'Weight', '⚖️', '#0891b2', 40, false, null,
   '[{"key":"weight_kg","label":"Weight (kg)","type":"number","step":0.05,"required":true}]'::jsonb, false, true),
  ('fanta.vet', 'fanta', 'vet', 'Vet visit', '🏥', '#0d9488', 50, false, null,
   '[{"key":"clinic","label":"Clinic","type":"text"},{"key":"reason","label":"Reason","type":"text","required":true},{"key":"outcome","label":"Outcome","type":"text"}]'::jsonb, false, true),
  ('fanta.treatment', 'fanta', 'treatment', 'Treatment', '💉', '#dc2626', 60, false, null,
   '[{"key":"kind","label":"What","type":"choice","options":["Vaccination","Deworming","Flea & tick","Other"],"required":true},
     {"key":"product","label":"Product","type":"text"},
     {"key":"next_due","label":"Next due","type":"date","required":true}]'::jsonb, false, true),
  ('fanta.note', 'fanta', 'note', 'Note', '📝', '#525252', 70, false, null, '[]'::jsonb, false, true)
on conflict (id) do nothing;

update public.care_subjects
   set profile = profile || '{"sex": "Female", "colour": "Ginger", "spayed": true, "indoor": true, "food": "Royal Canin", "age_note": "About 3 years old"}'::jsonb
 where id = '00000000-0000-4000-8000-00000000a002' and not (profile ? 'spayed');

-- Profile card edit (clinic, microchip, insurance…): module edit permission.
create or replace function public.subject_profile_save(p_subject_id uuid, p_profile jsonb, p_birth_date date default null, p_name text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_subjects', p_subject_id::text);
    return private.denied('You are not allowed to change this profile.');
  end if;
  update public.care_subjects
     set profile = coalesce(p_profile, '{}'::jsonb),
         birth_date = coalesce(p_birth_date, birth_date),
         name = coalesce(nullif(btrim(p_name), ''), name),
         updated_at = now()
   where id = p_subject_id;
  perform private.audit_write(v_module, 'edit', true, 'care_subjects', p_subject_id::text, jsonb_build_object('keys', (select jsonb_agg(k) from jsonb_object_keys(coalesce(p_profile, '{}'::jsonb)) k)));
  return jsonb_build_object('ok', true);
end $$;

-- What is due, for every subject the caller may see: treatments with a next_due
-- date (latest per kind), and entry types with a due_after interval.
create or replace function public.care_due_list(p_days_ahead integer default 30) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
begin
  return jsonb_build_object('ok', true, 'items', coalesce((
    with subjects as (
      select s.id, s.name, s.module_id from public.care_subjects s
       where s.is_active and public.has_permission(s.module_id, 'view')
    ),
    treatments as (
      select distinct on (e.subject_id, e.payload->>'kind')
             e.subject_id, e.payload->>'kind' as kind, e.payload->>'product' as product,
             (e.payload->>'next_due')::date as due_on, e.occurred_at, e.id
        from public.care_entries e
       where e.type_id like '%.treatment' and e.deleted_at is null and (e.payload->>'next_due') ~ '^\d{4}-\d{2}-\d{2}$'
       order by e.subject_id, e.payload->>'kind', e.occurred_at desc
    ),
    intervals as (
      select s.id as subject_id, t.id as type_id, t.label, t.icon, t.due_after_min,
             (select max(e.occurred_at) from public.care_entries e where e.subject_id = s.id and e.type_id = t.id and e.deleted_at is null) as last_at
        from subjects s join public.care_entry_types t on t.module_id = s.module_id and t.is_active and t.due_after_min is not null
    )
    select jsonb_agg(x order by (x->>'due_at')) from (
      select jsonb_build_object(
        'subject_id', s.id, 'subject', s.name, 'module_id', s.module_id,
        'kind', 'treatment', 'label', tr.kind || coalesce(' · ' || tr.product, ''), 'icon', '💉',
        'due_on', tr.due_on, 'due_at', (tr.due_on::timestamp at time zone v_tz),
        'overdue', tr.due_on < (now() at time zone v_tz)::date, 'entry_id', tr.id) as x
        from treatments tr join subjects s on s.id = tr.subject_id
       where tr.due_on <= (now() at time zone v_tz)::date + p_days_ahead
      union all
      select jsonb_build_object(
        'subject_id', s.id, 'subject', s.name, 'module_id', s.module_id,
        'kind', 'interval', 'label', i.label, 'icon', i.icon, 'type_id', i.type_id,
        'due_at', i.last_at + make_interval(mins => i.due_after_min), 'last_at', i.last_at,
        'overdue', i.last_at + make_interval(mins => i.due_after_min) < now())
        from intervals i join subjects s on s.id = i.subject_id
       where i.last_at is not null and i.last_at + make_interval(mins => i.due_after_min) < now() + interval '1 day'
    ) q), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 2. Attachments: a photo on anything, with the text read off it
-- ---------------------------------------------------------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  module_id    text not null references public.modules (id),
  entity_table text not null check (entity_table in ('care_entries', 'tickets', 'assets', 'care_subjects', 'ticket_updates')),
  entity_id    uuid not null,
  path         text not null,                       -- storage path in the photos bucket
  caption      text,
  ocr_text     text,                                -- read on the phone, kept for search
  created_by   uuid references public.members (id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index attachments_entity_idx on public.attachments (entity_table, entity_id) where deleted_at is null;
create index attachments_ocr_idx on public.attachments using gin (to_tsvector('simple', coalesce(ocr_text, '') || ' ' || coalesce(caption, '')));
alter table public.attachments enable row level security;
create policy attachments_read on public.attachments for select to authenticated
  using (public.has_permission('photos', 'view') and public.has_permission(module_id, 'view'));
create policy attachments_add on public.attachments for insert to authenticated
  with check (public.has_permission('photos', 'add') and public.has_permission(module_id, 'add') and created_by = public.current_member_id());
create policy attachments_edit on public.attachments for update to authenticated
  using (public.has_permission(module_id, 'edit') or created_by = public.current_member_id());
grant select, insert, update on public.attachments to authenticated, service_role;

create or replace function public.attachment_add(p_module text, p_table text, p_entity_id uuid, p_path text, p_caption text default null, p_ocr_text text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not (public.has_permission('photos', 'add') and public.has_permission(p_module, 'add')) then
    perform private.audit_write(p_module, 'add', false, 'attachments', p_entity_id::text);
    return private.denied('You are not allowed to add photos here.');
  end if;
  insert into public.attachments (module_id, entity_table, entity_id, path, caption, ocr_text, created_by)
  values (p_module, p_table, p_entity_id, p_path, nullif(btrim(p_caption), ''), nullif(btrim(p_ocr_text), ''), public.current_member_id())
  returning id into v_id;
  perform private.audit_write(p_module, 'add', true, 'attachments', v_id::text, jsonb_build_object('on', p_table, 'id', p_entity_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.attachments_list(p_table text, p_entity_id uuid) returns jsonb
language sql security invoker set search_path = public as $$
  select jsonb_build_object('ok', true, 'attachments', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path, 'caption', a.caption, 'ocr_text', a.ocr_text,
                                        'created_at', a.created_at, 'created_by_name', m.display_name) order by a.created_at)
      from public.attachments a left join public.members m on m.id = a.created_by
     where a.entity_table = p_table and a.entity_id = p_entity_id and a.deleted_at is null), '[]'::jsonb))
$$;

create or replace function public.attachment_remove(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_module text; v_by uuid;
begin
  select module_id, created_by into v_module, v_by from public.attachments where id = p_id;
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (public.has_permission(v_module, 'edit') or v_by = public.current_member_id()) then
    perform private.audit_write(v_module, 'edit', false, 'attachments', p_id::text);
    return private.denied();
  end if;
  update public.attachments set deleted_at = now() where id = p_id;
  perform private.audit_write(v_module, 'edit', true, 'attachments', p_id::text, '{"removed": true}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- Search the text read off photos (labels, receipts, notes).
create or replace function public.attachments_search(p_q text) returns jsonb
language sql security invoker set search_path = public as $$
  select jsonb_build_object('ok', true, 'hits', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'entity_table', a.entity_table, 'entity_id', a.entity_id, 'module_id', a.module_id,
                                        'path', a.path, 'caption', a.caption, 'snippet', left(a.ocr_text, 160), 'created_at', a.created_at)
                     order by a.created_at desc)
      from public.attachments a
     where a.deleted_at is null
       and to_tsvector('simple', coalesce(a.ocr_text, '') || ' ' || coalesce(a.caption, '')) @@ plainto_tsquery('simple', p_q)), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 3. Home maintenance
-- ---------------------------------------------------------------------------
create table public.contractors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  trade      text,                                  -- AC, plumbing, electrical, handyman…
  phone      text,
  whatsapp   text,
  company    text,
  notes      text,
  rating     smallint check (rating is null or rating between 1 and 5),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger contractors_touch before update on public.contractors for each row execute function private.touch_updated_at();

create table public.assets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,                     -- "Bedroom AC", "Dishwasher"
  category       text not null default 'appliance'
                 check (category in ('appliance', 'ac', 'plumbing', 'electrical', 'furniture', 'electronics', 'vehicle', 'other')),
  location       text,                              -- room
  brand          text,
  model          text,
  serial         text,
  purchased_on   date,
  warranty_until date,
  supplier       text,
  notes          text,
  label_path     text,                              -- the photographed label
  is_active      boolean not null default true,
  created_by     uuid references public.members (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger assets_touch before update on public.assets for each row execute function private.touch_updated_at();

create table public.tickets (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  location      text,
  asset_id      uuid references public.assets (id) on delete set null,
  status        text not null default 'open' check (status in ('open', 'in_progress', 'waiting', 'done')),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'urgent')),
  contractor_id uuid references public.contractors (id) on delete set null,
  opened_by     uuid references public.members (id) on delete set null,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tickets_status_idx on public.tickets (status, created_at desc);
create trigger tickets_touch before update on public.tickets for each row execute function private.touch_updated_at();

create table public.ticket_updates (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  note       text,
  status     text check (status is null or status in ('open', 'in_progress', 'waiting', 'done')),
  photo_path text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index ticket_updates_ticket_idx on public.ticket_updates (ticket_id, created_at);

-- Costs are a separate table: staff with `maintenance` never see them.
create table public.ticket_costs (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  amount     numeric(12,2) not null check (amount >= 0),
  currency   text not null default 'AED',
  paid_on    date,
  paid_by    uuid references public.members (id) on delete set null,
  note       text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index ticket_costs_ticket_idx on public.ticket_costs (ticket_id) where deleted_at is null;

alter table public.contractors    enable row level security;
alter table public.assets         enable row level security;
alter table public.tickets        enable row level security;
alter table public.ticket_updates enable row level security;
alter table public.ticket_costs   enable row level security;

create policy contractors_read on public.contractors for select to authenticated using (public.has_permission('maintenance', 'view'));
create policy contractors_write on public.contractors for all to authenticated using (public.has_permission('maintenance', 'edit')) with check (public.has_permission('maintenance', 'edit'));
create policy assets_read on public.assets for select to authenticated using (public.has_permission('maintenance', 'view'));
create policy assets_add on public.assets for insert to authenticated with check (public.has_permission('maintenance', 'add'));
create policy assets_edit on public.assets for update to authenticated using (public.has_permission('maintenance', 'edit'));
create policy tickets_read on public.tickets for select to authenticated using (public.has_permission('maintenance', 'view'));
create policy tickets_add on public.tickets for insert to authenticated with check (public.has_permission('maintenance', 'add'));
create policy tickets_edit on public.tickets for update to authenticated using (public.has_permission('maintenance', 'edit'));
create policy ticket_updates_read on public.ticket_updates for select to authenticated using (public.has_permission('maintenance', 'view'));
create policy ticket_updates_add on public.ticket_updates for insert to authenticated with check (public.has_permission('maintenance', 'add'));
create policy ticket_costs_read on public.ticket_costs for select to authenticated using (public.has_permission('maintenance_costs', 'view'));
create policy ticket_costs_add on public.ticket_costs for insert to authenticated with check (public.has_permission('maintenance_costs', 'add'));
create policy ticket_costs_edit on public.ticket_costs for update to authenticated using (public.has_permission('maintenance_costs', 'edit'));
grant select, insert, update on public.contractors, public.assets, public.tickets, public.ticket_updates, public.ticket_costs to authenticated, service_role;

-- RPCs ----------------------------------------------------------------------
create or replace function public.maintenance_overview() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('maintenance', 'view', 'tickets') then return private.denied('You are not allowed to see home maintenance.'); end if;
  return jsonb_build_object('ok', true,
    'open', (select count(*) from public.tickets where status <> 'done'),
    'urgent', (select count(*) from public.tickets where status <> 'done' and priority = 'urgent'),
    'assets', (select count(*) from public.assets where is_active),
    'contractors', (select count(*) from public.contractors where is_active),
    'costs_visible', public.has_permission('maintenance_costs', 'view'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'location', t.location, 'created_at', t.created_at) order by t.created_at desc)
                        from (select * from public.tickets where status <> 'done' order by created_at desc limit 5) t), '[]'::jsonb));
end $$;

create or replace function public.tickets_list(p_status text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_costs boolean := public.has_permission('maintenance_costs', 'view');
begin
  if not private.authz('maintenance', 'view', 'tickets', null, jsonb_build_object('status', p_status)) then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'costs_visible', v_costs, 'tickets', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'description', t.description, 'location', t.location, 'status', t.status, 'priority', t.priority,
      'asset_id', t.asset_id, 'asset_name', a.name, 'contractor_id', t.contractor_id, 'contractor_name', c.name,
      'opened_by', t.opened_by, 'opened_by_name', m.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at, 'closed_at', t.closed_at,
      'photo_path', (select u.photo_path from public.ticket_updates u where u.ticket_id = t.id and u.photo_path is not null order by u.created_at limit 1),
      'updates', (select count(*) from public.ticket_updates u where u.ticket_id = t.id),
      'cost_total', case when v_costs then (select coalesce(sum(amount), 0) from public.ticket_costs k where k.ticket_id = t.id and k.deleted_at is null) else null end
    ) order by case t.status when 'done' then 1 else 0 end, case t.priority when 'urgent' then 0 when 'normal' then 1 else 2 end, t.created_at desc)
      from public.tickets t
      left join public.assets a on a.id = t.asset_id
      left join public.contractors c on c.id = t.contractor_id
      left join public.members m on m.id = t.opened_by
     where p_status is null or (p_status = 'open' and t.status <> 'done') or t.status = p_status), '[]'::jsonb));
end $$;

create or replace function public.ticket_get(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_costs boolean := public.has_permission('maintenance_costs', 'view');
begin
  if not private.authz('maintenance', 'view', 'tickets', p_id::text) then return private.denied(); end if;
  return (select jsonb_build_object('ok', true, 'costs_visible', v_costs,
    'ticket', jsonb_build_object(
      'id', t.id, 'title', t.title, 'description', t.description, 'location', t.location, 'status', t.status, 'priority', t.priority,
      'asset_id', t.asset_id, 'asset_name', a.name, 'contractor_id', t.contractor_id, 'contractor_name', c.name, 'contractor_phone', c.phone,
      'opened_by', t.opened_by, 'opened_by_name', m.display_name, 'created_at', t.created_at, 'updated_at', t.updated_at, 'closed_at', t.closed_at),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'note', u.note, 'status', u.status, 'photo_path', u.photo_path,
                                                          'created_at', u.created_at, 'by_name', um.display_name) order by u.created_at)
                         from public.ticket_updates u left join public.members um on um.id = u.created_by where u.ticket_id = t.id), '[]'::jsonb),
    'costs', case when v_costs then coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'amount', k.amount, 'currency', k.currency, 'paid_on', k.paid_on, 'note', k.note, 'paid_by_name', pm.display_name) order by k.created_at)
                                             from public.ticket_costs k left join public.members pm on pm.id = k.paid_by where k.ticket_id = t.id and k.deleted_at is null), '[]'::jsonb) else null end)
    from public.tickets t
    left join public.assets a on a.id = t.asset_id
    left join public.contractors c on c.id = t.contractor_id
    left join public.members m on m.id = t.opened_by
   where t.id = p_id);
end $$;

create or replace function public.ticket_create(
  p_title text, p_description text default null, p_location text default null, p_asset_id uuid default null,
  p_priority text default 'normal', p_photo_path text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid; v_title text := nullif(btrim(coalesce(p_title, '')), '');
begin
  if not public.has_permission('maintenance', 'add') then
    perform private.audit_write('maintenance', 'add', false, 'tickets');
    return private.denied('You are not allowed to open tickets.');
  end if;
  if v_title is null then
    if p_photo_path is null then return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Say what is wrong, or add a photo.'); end if;
    v_title := 'See photo';
  end if;
  insert into public.tickets (title, description, location, asset_id, priority, opened_by)
  values (v_title, nullif(btrim(p_description), ''), nullif(btrim(p_location), ''), p_asset_id, coalesce(p_priority, 'normal'), v_me)
  returning id into v_id;
  insert into public.ticket_updates (ticket_id, note, status, photo_path, created_by) values (v_id, 'Opened', 'open', p_photo_path, v_me);
  if p_photo_path is not null then
    insert into public.attachments (module_id, entity_table, entity_id, path, created_by) values ('maintenance', 'tickets', v_id, p_photo_path, v_me);
  end if;
  perform private.audit_write('maintenance', 'add', true, 'tickets', v_id::text, jsonb_build_object('title', v_title));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Progress a ticket: a note, a photo, a new status, a contractor, an asset. Anyone with
-- maintenance.add may add a note or photo; changing status/contractor/asset/priority needs edit.
create or replace function public.ticket_update(
  p_id uuid, p_note text default null, p_status text default null, p_photo_path text default null,
  p_contractor_id uuid default null, p_asset_id uuid default null, p_priority text default null, p_location text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_edit boolean := public.has_permission('maintenance', 'edit');
begin
  if not public.has_permission('maintenance', 'add') then
    perform private.audit_write('maintenance', 'edit', false, 'tickets', p_id::text);
    return private.denied();
  end if;
  if not exists (select 1 from public.tickets where id = p_id) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if (p_status is not null or p_contractor_id is not null or p_asset_id is not null or p_priority is not null or p_location is not null) and not v_edit then
    perform private.audit_write('maintenance', 'edit', false, 'tickets', p_id::text);
    return private.denied('You can add a note or a photo, but not change the ticket.');
  end if;
  if v_edit then
    update public.tickets
       set status = coalesce(p_status, status),
           contractor_id = coalesce(p_contractor_id, contractor_id),
           asset_id = coalesce(p_asset_id, asset_id),
           priority = coalesce(p_priority, priority),
           location = coalesce(nullif(btrim(p_location), ''), location),
           closed_at = case when p_status = 'done' then now() when p_status is not null then null else closed_at end
     where id = p_id;
  end if;
  if p_note is not null or p_status is not null or p_photo_path is not null then
    insert into public.ticket_updates (ticket_id, note, status, photo_path, created_by) values (p_id, nullif(btrim(p_note), ''), p_status, p_photo_path, v_me);
  end if;
  if p_photo_path is not null then
    insert into public.attachments (module_id, entity_table, entity_id, path, created_by) values ('maintenance', 'tickets', p_id, p_photo_path, v_me);
  end if;
  perform private.audit_write('maintenance', 'edit', true, 'tickets', p_id::text, jsonb_strip_nulls(jsonb_build_object('status', p_status, 'note', p_note is not null, 'photo', p_photo_path is not null)));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ticket_cost_add(p_ticket_id uuid, p_amount numeric, p_note text default null, p_paid_on date default null, p_paid_by uuid default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('maintenance_costs', 'add') then
    perform private.audit_write('maintenance_costs', 'add', false, 'ticket_costs', p_ticket_id::text);
    return private.denied('You are not allowed to see or add costs.');
  end if;
  insert into public.ticket_costs (ticket_id, amount, currency, paid_on, paid_by, note, created_by)
  values (p_ticket_id, p_amount, coalesce((select currency from public.household limit 1), 'AED'), p_paid_on, p_paid_by, nullif(btrim(p_note), ''), public.current_member_id())
  returning id into v_id;
  perform private.audit_write('maintenance_costs', 'add', true, 'ticket_costs', v_id::text, jsonb_build_object('amount', p_amount));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.assets_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('maintenance', 'view', 'assets') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'assets', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'category', a.category, 'location', a.location, 'brand', a.brand, 'model', a.model,
                                        'serial', a.serial, 'purchased_on', a.purchased_on, 'warranty_until', a.warranty_until, 'supplier', a.supplier,
                                        'notes', a.notes, 'label_path', a.label_path, 'is_active', a.is_active,
                                        'open_tickets', (select count(*) from public.tickets t where t.asset_id = a.id and t.status <> 'done'))
                     order by a.location nulls last, a.name)
      from public.assets a where a.is_active), '[]'::jsonb));
end $$;

create or replace function public.asset_save(
  p_id uuid, p_name text, p_category text default 'appliance', p_location text default null, p_brand text default null, p_model text default null,
  p_serial text default null, p_purchased_on date default null, p_warranty_until date default null, p_supplier text default null,
  p_notes text default null, p_label_path text default null, p_label_text text default null, p_is_active boolean default true
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid := p_id; v_action text := case when p_id is null then 'add' else 'edit' end; v_me uuid := public.current_member_id();
begin
  if not public.has_permission('maintenance', v_action) then
    perform private.audit_write('maintenance', v_action, false, 'assets', p_id::text);
    return private.denied();
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Give it a name.'); end if;
  if v_id is null then
    insert into public.assets (name, category, location, brand, model, serial, purchased_on, warranty_until, supplier, notes, label_path, created_by)
    values (btrim(p_name), coalesce(p_category, 'appliance'), nullif(btrim(p_location), ''), nullif(btrim(p_brand), ''), nullif(btrim(p_model), ''), nullif(btrim(p_serial), ''),
            p_purchased_on, p_warranty_until, nullif(btrim(p_supplier), ''), nullif(btrim(p_notes), ''), p_label_path, v_me)
    returning id into v_id;
  else
    update public.assets
       set name = btrim(p_name), category = coalesce(p_category, category), location = nullif(btrim(p_location), ''), brand = nullif(btrim(p_brand), ''),
           model = nullif(btrim(p_model), ''), serial = nullif(btrim(p_serial), ''), purchased_on = p_purchased_on, warranty_until = p_warranty_until,
           supplier = nullif(btrim(p_supplier), ''), notes = nullif(btrim(p_notes), ''), label_path = coalesce(p_label_path, label_path), is_active = coalesce(p_is_active, is_active)
     where id = v_id;
  end if;
  if p_label_path is not null then
    insert into public.attachments (module_id, entity_table, entity_id, path, caption, ocr_text, created_by)
    values ('maintenance', 'assets', v_id, p_label_path, 'Label', nullif(btrim(p_label_text), ''), v_me);
  end if;
  perform private.audit_write('maintenance', v_action, true, 'assets', v_id::text, jsonb_build_object('name', p_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.contractors_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('maintenance', 'view', 'contractors') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'contractors', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'trade', c.trade, 'phone', c.phone, 'whatsapp', c.whatsapp, 'company', c.company,
                                        'notes', c.notes, 'rating', c.rating, 'is_active', c.is_active,
                                        'jobs', (select count(*) from public.tickets t where t.contractor_id = c.id),
                                        'last_job', (select max(t.created_at) from public.tickets t where t.contractor_id = c.id))
                     order by c.trade nulls last, c.name)
      from public.contractors c where c.is_active), '[]'::jsonb));
end $$;

create or replace function public.contractor_save(
  p_id uuid, p_name text, p_trade text default null, p_phone text default null, p_whatsapp text default null,
  p_company text default null, p_notes text default null, p_rating smallint default null, p_is_active boolean default true
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not public.has_permission('maintenance', 'edit') then
    perform private.audit_write('maintenance', 'edit', false, 'contractors', p_id::text);
    return private.denied();
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Give them a name.'); end if;
  if v_id is null then
    insert into public.contractors (name, trade, phone, whatsapp, company, notes, rating)
    values (btrim(p_name), nullif(btrim(p_trade), ''), nullif(btrim(p_phone), ''), nullif(btrim(p_whatsapp), ''), nullif(btrim(p_company), ''), nullif(btrim(p_notes), ''), p_rating)
    returning id into v_id;
  else
    update public.contractors
       set name = btrim(p_name), trade = nullif(btrim(p_trade), ''), phone = nullif(btrim(p_phone), ''), whatsapp = nullif(btrim(p_whatsapp), ''),
           company = nullif(btrim(p_company), ''), notes = nullif(btrim(p_notes), ''), rating = p_rating, is_active = coalesce(p_is_active, is_active)
     where id = v_id;
  end if;
  perform private.audit_write('maintenance', 'edit', true, 'contractors', v_id::text, jsonb_build_object('name', p_name));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function
  public.subject_profile_save(uuid, jsonb, date, text), public.care_due_list(integer),
  public.attachment_add(text, text, uuid, text, text, text), public.attachments_list(text, uuid), public.attachment_remove(uuid), public.attachments_search(text),
  public.maintenance_overview(), public.tickets_list(text), public.ticket_get(uuid),
  public.ticket_create(text, text, text, uuid, text, text), public.ticket_update(uuid, text, text, text, uuid, uuid, text, text),
  public.ticket_cost_add(uuid, numeric, text, date, uuid),
  public.assets_list(), public.asset_save(uuid, text, text, text, text, text, text, date, date, text, text, text, text, boolean),
  public.contractors_list(), public.contractor_save(uuid, text, text, text, text, text, text, smallint, boolean)
  to authenticated, service_role;
