-- Calendar day headers were timestamps (generate_series over dates returns timestamps), so the
-- app showed "undefined NaN/NaN". Days now carry a plain date. Also drops the seeded presence
-- remarks ("Lives in Dubai…"); the family writes its own notes or none.
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
        'date', d.day::date,
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

do $$ begin
  update public.presence set note = null
   where note in ('About a 3-month visit from Egypt. Set the end date when known.', 'Lives in Dubai. Stays over when needed.', 'Staff. See work days.');
end $$;

-- Fanta eats Royal Canin Sterilised: half a wet pouch per meal, then dry food. The quick buttons say that.
insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('fanta.food', 'fanta', 'food', 'Fed', '🍗', '#ea580c', 10, false, 720,
   '[{"key":"food","label":"What","type":"choice","options":["½ wet pouch","Whole wet pouch","Dry food","Other"],"required":true,"default":"½ wet pouch"},
     {"key":"amount_g","label":"Amount (g), if weighed","type":"number"}]'::jsonb, true, true)
on conflict (id) do update set fields = excluded.fields;

insert into public.care_subjects (id, module_id, kind, name, birth_date, profile, settings, sort) values
  ('00000000-0000-4000-8000-00000000a002', 'fanta', 'pet', 'Fanta', null, '{}'::jsonb, '{}'::jsonb, 20)
on conflict (id) do update set profile = public.care_subjects.profile || '{"food": "Royal Canin Sterilised: half a wet pouch per meal, then dry food"}'::jsonb;
