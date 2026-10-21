-- ============================================================================
-- Finishing touches: work hours per member (the bottle countdown and the assistant read
-- them), a large-text preference, the handover bag checklist, entry-type settings for
-- admins. No top-level UPDATE or DELETE (the Supabase connector stalls on them).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Work hours and large text
-- ---------------------------------------------------------------------------
alter table public.members add column if not exists work_from time;
alter table public.members add column if not exists work_to time;
alter table public.members add column if not exists large_text boolean;

create or replace function public.work_days_set(p_member_id uuid, p_weekdays smallint[], p_work_from time, p_work_to time) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v jsonb;
begin
  v := public.work_days_set(p_member_id, p_weekdays);
  if (v->>'ok')::boolean then
    update public.members set work_from = p_work_from, work_to = p_work_to, updated_at = now() where id = p_member_id;
  end if;
  return v;
end $$;
grant execute on function public.work_days_set(uuid, smallint[], time, time) to authenticated, service_role;

create or replace function public.me_large_text_set(p_large_text boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.current_member_id();
begin
  if v_id is null then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  update public.members set large_text = p_large_text, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.me_large_text_set(boolean) to authenticated, service_role;

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
        'work_days', (select coalesce(jsonb_agg(weekday order by weekday), '[]'::jsonb) from public.work_schedules w where w.member_id = m.id),
        'work_from', m.work_from, 'work_to', m.work_to, 'breastfeeds', m.breastfeeds, 'photo_path', m.photo_path
      ) order by m.role_id, m.display_name)
      from public.members m where m.is_active), '[]'::jsonb)
  );
end $$;

-- Work hours per member are household data (Members → Work days, or setup-household.mjs).

-- ---------------------------------------------------------------------------
-- 2. The handover bag: a checklist that resets for the next outing
-- ---------------------------------------------------------------------------
create table if not exists public.bag_items (
  id         uuid primary key default gen_random_uuid(),
  label      text not null check (length(btrim(label)) between 1 and 80),
  checked    boolean not null default false,
  sort       integer not null default 100,
  is_active  boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.bag_items enable row level security;
create policy bag_read on public.bag_items for select to authenticated using (public.has_permission('lana', 'view'));
grant select on public.bag_items to authenticated;
grant all on public.bag_items to service_role;

create or replace function public.bag_toggle(p_id uuid, p_checked boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not private.authz('lana', 'add', 'bag_items', p_id::text) then return private.denied(); end if;
  update public.bag_items set checked = p_checked, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.bag_toggle(uuid, boolean) to authenticated, service_role;

create or replace function public.bag_reset() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not private.authz('lana', 'add', 'bag_items') then return private.denied(); end if;
  update public.bag_items set checked = false, updated_at = now() where checked;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.bag_reset() to authenticated, service_role;

create or replace function public.bag_save(p_id uuid, p_label text, p_sort integer default 100, p_is_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not private.authz('lana', 'edit', 'bag_items', p_id::text) then return private.denied(); end if;
  if p_id is null then
    insert into public.bag_items (label, sort, is_active) values (btrim(p_label), coalesce(p_sort, 100), coalesce(p_is_active, true)) returning id into v_id;
  else
    update public.bag_items set label = btrim(p_label), sort = coalesce(p_sort, sort), is_active = coalesce(p_is_active, true), updated_at = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.bag_save(uuid, text, integer, boolean) to authenticated, service_role;

insert into public.bag_items (id, label, sort) values
  ('00000000-0000-4000-8000-00000000d001', 'Diapers (6)', 10),
  ('00000000-0000-4000-8000-00000000d002', 'Wipes', 20),
  ('00000000-0000-4000-8000-00000000d003', 'Change of clothes', 30),
  ('00000000-0000-4000-8000-00000000d004', 'Bottle and milk', 40),
  ('00000000-0000-4000-8000-00000000d005', 'Muslin', 50),
  ('00000000-0000-4000-8000-00000000d006', 'Dummy', 60),
  ('00000000-0000-4000-8000-00000000d007', 'Sun hat', 70)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Entry types from the app (admins): add, rename, switch off, change fields
-- ---------------------------------------------------------------------------
create or replace function public.entry_type_save(
  p_id text, p_module_id text, p_key text, p_label text, p_icon text default null, p_color text default null, p_sort integer default 100,
  p_has_end boolean default false, p_due_after_min integer default null, p_fields jsonb default '[]'::jsonb, p_show_on_home boolean default false, p_is_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(p_id, p_module_id || '.' || p_key);
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'care_entry_types', v_id);
    return private.denied('Only an admin changes the entry types.');
  end if;
  if p_key !~ '^[a-z][a-z0-9_]*$' then return jsonb_build_object('ok', false, 'error', 'bad_key', 'message', 'The key is lowercase letters, digits and underscores.'); end if;
  if jsonb_typeof(p_fields) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_fields', 'message', 'Fields must be a JSON list.'); end if;
  if not exists (select 1 from public.modules where id = p_module_id) then return jsonb_build_object('ok', false, 'error', 'bad_module'); end if;
  insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active)
  values (v_id, p_module_id, p_key, btrim(p_label), nullif(btrim(p_icon), ''), nullif(btrim(p_color), ''), coalesce(p_sort, 100), coalesce(p_has_end, false), p_due_after_min, p_fields, coalesce(p_show_on_home, false), coalesce(p_is_active, true))
  on conflict (id) do update set label = excluded.label, icon = excluded.icon, color = excluded.color, sort = excluded.sort, has_end = excluded.has_end,
    due_after_min = excluded.due_after_min, fields = excluded.fields, show_on_home = excluded.show_on_home, is_active = excluded.is_active;
  perform private.audit_write('members', 'edit', true, 'care_entry_types', v_id, jsonb_build_object('active', p_is_active));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.entry_type_save(text, text, text, text, text, text, integer, boolean, integer, jsonb, boolean, boolean) to authenticated, service_role;
