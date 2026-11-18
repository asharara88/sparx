-- After the first birthday: say nothing false to a toddler's family (step 1 of the plan by age).
--
--   1. private.is_toddler(birth date): a child is a baby while under 12 months of 30.4375 days
--      and a toddler from then on (day 365 is a baby, day 366 a toddler), counted on the home's
--      calendar with the same edge as private.feed_every_min (migration 6100). No birth date:
--      not a toddler, so such a home keeps what it has today.
--   2. Milk, diapers and sleep have no clock for a toddler: a child that age eats meals and may
--      drink from a cup, so a time "due again" after the last bottle, diaper or sleep is not
--      true. home_summary gives their last entry no next_due (the key stays, with null) and
--      care_due_list lists no "due again" row for them. Any other kind given a gap keeps it.
--   3. Vaccines from before a family joined. Joining is the day the child's row was made, on
--      the home's calendar. For a dose with no record and a known birth date: a window that
--      closed before that day is "earlier" (never due or overdue, not in the due list, so not on
--      Home, the calendar, a push or the helper's due list); a dose whose date was before that
--      day, its window still open, is "due" and never turns overdue. Everything else as before.
--      The same test is written in vaccines_list and care_due_list; care_due_list leaves out
--      earlier doses before it groups them by visit, so a visit's count, label and overdue flag
--      cover only the doses left. Per dose: recording one dose of an old visit changes no other.
--   4. vaccine_record names the child when the date is before the birth, not "she".
--   5. The mood question's stored label reads "Mood" instead of "How is she", where it still does.
--   6. The safe sleep skill (back to sleep, no pillow, no blanket) stops at 12 months.
--
-- home_summary is as in migration 5800, vaccines_list, care_due_list and vaccine_record as in
-- migration 1800, each with only the changes above. Owners and grants are kept; vaccine_record
-- stays with app_rls (migration 4000).

-- ---------------------------------------------------------------------------
-- 1. A toddler, from the day after 12 months
-- ---------------------------------------------------------------------------
create or replace function private.is_toddler(p_birth date) returns boolean
language sql stable security invoker set search_path = public as $$
  with home as (
    select (now() at time zone coalesce(
              (select h.timezone from public.household h where h.id = private.current_household_id()), 'UTC'))::date as today)
  select case
    when p_birth is null then false
    else (home.today - p_birth) >= 12 * 30.4375 end
    from home
$$;
revoke execute on function private.is_toddler(date) from public, anon;
grant execute on function private.is_toddler(date) to authenticated, service_role, app_rls;

-- ---------------------------------------------------------------------------
-- 2. home_summary: as in migration 5800, with no next_due for a toddler's milk, diapers and sleep
-- ---------------------------------------------------------------------------
create or replace function public.home_summary(p_subject_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  v_usual   numeric;
  v_feed_every integer;
  v_toddler boolean;
begin
  if v_module is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Nobody to show yet.');
  end if;
  if not private.authz(v_module, 'view', 'care_entries', v_subject::text) then
    return private.denied('You are not allowed to see this log.');
  end if;
  -- A timer past its limit (a feed an hour, a sleep a day) is closed now, by whoever may
  -- log for the child, so Home never shows it as running (migration 5500).
  if not private.read_only_preview() and private.authz(v_module, 'add', 'care_entries', v_subject::text) then
    perform private.timers_close_overdue(v_subject);
  end if;
  v_usual := private.usual_bottle_ml(v_subject);
  v_feed_every := private.feed_every_min((select birth_date from public.care_subjects where id = v_subject));
  v_toddler := private.is_toddler((select birth_date from public.care_subjects where id = v_subject));
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
                where e.subject_id = v_subject and e.deleted_at is null and t.has_end and e.ended_at is null
                  -- a timer past its kind's limit was left on; it is not "running" (migration 5500)
                  and e.occurred_at > now() - private.timer_limit(t.key)
                  and (t.settings->'end_if' is null
                       or not exists (select 1 from jsonb_each_text(t.settings->'end_if') k where e.payload->>k.key is distinct from k.value))),
    'last', (select coalesce(jsonb_object_agg(l.type_id, l.row), '{}'::jsonb) from (
               select distinct on (e.type_id) e.type_id,
                 jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'ended_at', e.ended_at,
                   'payload', e.payload, 'note', e.note, 'by', m.display_name,
                   'fullness', case when t.key = 'feed' then private.feed_fullness(e.payload, e.occurred_at, e.ended_at, v_usual) end,
                   -- a toddler's milk, diapers and sleep have no clock (migration 6500)
                   'next_due', case when t.due_after_min is not null and not (v_toddler and t.id in ('lana.feed', 'lana.diaper', 'lana.sleep'))
                                    then coalesce(e.ended_at, e.occurred_at)
                                         + make_interval(mins => case when t.key = 'feed'
                                             then greatest(60, round(greatest(t.due_after_min, v_feed_every) * (0.5 + 0.5 * private.feed_fullness(e.payload, e.occurred_at, e.ended_at, v_usual))))::int
                                             else t.due_after_min end) end) as row
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
-- 3. Vaccines from before a family joined
-- ---------------------------------------------------------------------------
-- Every schedule line for one child with its due date, status and record.
--   status: given | unknown (no birth date) | earlier (window closed before the family joined)
--   | overdue (window closed) | due (window open, or its date was before the family joined)
--   | upcoming
create or replace function public.vaccines_list(p_subject_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
  v_birth date;
  v_kind text;
  v_joined date;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied(); end if;
  select birth_date, kind, (created_at at time zone v_tz)::date into v_birth, v_kind, v_joined from public.care_subjects where id = p_subject_id;
  return jsonb_build_object('ok', true, 'today', v_today, 'birth_date', v_birth, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'visit', s.visit, 'vaccine', s.vaccine, 'dose', s.dose, 'note', s.note,
             'due_age_days', s.due_age_days, 'window_days', s.window_days,
             'due_on', v_birth + s.due_age_days,
             'status', case
               when v.id is not null then 'given'
               when v_birth is null then 'unknown'
               -- from before the family joined (migration 6500): a window that closed before the child's
               -- row was made is earlier; a date before it with the window still open stays due, never overdue
               when v_joined > v_birth + s.due_age_days + s.window_days then 'earlier'
               when v_today > v_birth + s.due_age_days + s.window_days and not (v_joined > v_birth + s.due_age_days) then 'overdue'
               when v_today >= v_birth + s.due_age_days - 14 then 'due'
               else 'upcoming' end,
             'given', case when v.id is null then null else jsonb_build_object(
               'id', v.id, 'given_on', v.given_on, 'place', v.place, 'batch', v.batch, 'note', v.note,
               'recorded_by', m.display_name) end
           ) order by s.sort)
      from public.vaccine_schedule s
      left join public.vaccinations v on v.subject_id = p_subject_id and v.schedule_id = s.id and v.deleted_at is null
      left join public.members m on m.id = v.recorded_by
     where s.is_active and s.kind = coalesce(v_kind, 'child')), '[]'::jsonb));
end $$;

-- The due list: as in migration 1800, with no interval rows for a toddler's milk, diapers and
-- sleep, and no dose from before the family joined.
create or replace function public.care_due_list(p_days_ahead integer default 30) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
begin
  return jsonb_build_object('ok', true, 'items', coalesce((
    with subjects as (
      select s.id, s.name, s.module_id, s.birth_date, s.kind, s.created_at from public.care_subjects s
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
       -- a toddler's milk, diapers and sleep have no clock (migration 6500)
       where not (private.is_toddler(s.birth_date) and t.id in ('lana.feed', 'lana.diaper', 'lana.sleep'))
    ),
    vaccines as (
      select s.id as subject_id, sc.visit, s.birth_date + sc.due_age_days as due_on,
             bool_or(v_today > s.birth_date + sc.due_age_days + sc.window_days
                     and not ((s.created_at at time zone v_tz)::date > s.birth_date + sc.due_age_days)) as overdue,
             string_agg(sc.vaccine || ' (' || sc.dose || ')', ', ' order by sc.sort) as doses, count(*) as n
        from subjects s
        join public.vaccine_schedule sc on sc.is_active and sc.kind = s.kind
        left join public.vaccinations v on v.subject_id = s.id and v.schedule_id = sc.id and v.deleted_at is null
       where s.birth_date is not null and v.id is null
         -- a dose whose window closed before the family joined is left out before the grouping (migration 6500)
         and not ((s.created_at at time zone v_tz)::date > s.birth_date + sc.due_age_days + sc.window_days)
       group by s.id, sc.visit, s.birth_date + sc.due_age_days
    )
    select jsonb_agg(x order by (x->>'due_at')) from (
      select jsonb_build_object(
        'subject_id', s.id, 'subject', s.name, 'module_id', s.module_id,
        'kind', 'treatment', 'label', tr.kind || coalesce(' · ' || tr.product, ''), 'icon', '💉',
        'due_on', tr.due_on, 'due_at', (tr.due_on::timestamp at time zone v_tz),
        'overdue', tr.due_on < v_today, 'entry_id', tr.id) as x
        from treatments tr join subjects s on s.id = tr.subject_id
       where tr.due_on <= v_today + p_days_ahead
      union all
      select jsonb_build_object(
        'subject_id', s.id, 'subject', s.name, 'module_id', s.module_id,
        'kind', 'interval', 'label', i.label, 'icon', i.icon, 'type_id', i.type_id,
        'due_at', i.last_at + make_interval(mins => i.due_after_min), 'last_at', i.last_at,
        'overdue', i.last_at + make_interval(mins => i.due_after_min) < now())
        from intervals i join subjects s on s.id = i.subject_id
       where i.last_at is not null and i.last_at + make_interval(mins => i.due_after_min) < now() + interval '1 day'
      union all
      select jsonb_build_object(
        'subject_id', s.id, 'subject', s.name, 'module_id', s.module_id,
        'kind', 'vaccine', 'label', 'Vaccines, ' || vx.visit || ': ' || vx.doses, 'icon', '💉',
        'visit', vx.visit, 'count', vx.n,
        'due_on', vx.due_on, 'due_at', (vx.due_on::timestamp at time zone v_tz),
        'overdue', vx.overdue)
        from vaccines vx join subjects s on s.id = vx.subject_id
       where vx.due_on <= v_today + p_days_ahead
    ) q), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 4. vaccine_record: the child's name, not "she"
-- ---------------------------------------------------------------------------
create or replace function public.vaccine_record(
  p_subject_id uuid, p_schedule_id text, p_given_on date, p_place text default null, p_batch text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_module text := private.subject_module(p_subject_id); v_id uuid; v_birth date; v_name text;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'vaccinations') then return private.denied(); end if;
  if not exists (select 1 from public.vaccine_schedule where id = p_schedule_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'bad_schedule', 'message', 'That vaccine is not on the schedule.');
  end if;
  if p_given_on is null or p_given_on > current_date + 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_date', 'message', 'The date must be today or earlier.');
  end if;
  select birth_date, name into v_birth, v_name from public.care_subjects where id = p_subject_id;
  if v_birth is not null and p_given_on < v_birth then
    return jsonb_build_object('ok', false, 'error', 'bad_date', 'message', 'That is before ' || v_name || ' was born.');
  end if;
  select id into v_id from public.vaccinations where subject_id = p_subject_id and schedule_id = p_schedule_id and deleted_at is null;
  if v_id is null then
    insert into public.vaccinations (subject_id, schedule_id, given_on, place, batch, note, recorded_by)
    values (p_subject_id, p_schedule_id, p_given_on, nullif(btrim(p_place), ''), nullif(btrim(p_batch), ''), nullif(btrim(p_note), ''), public.current_member_id())
    returning id into v_id;
  else
    update public.vaccinations
       set given_on = p_given_on, place = coalesce(nullif(btrim(p_place), ''), place), batch = coalesce(nullif(btrim(p_batch), ''), batch),
           note = coalesce(nullif(btrim(p_note), ''), note)
     where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
alter function public.vaccine_record(uuid, text, date, text, text, text) owner to app_rls;

-- ---------------------------------------------------------------------------
-- 5. The mood question: "Mood". Only that field's label, and only while it still reads
--    "How is she"; the rest of the row is left as it is.
-- ---------------------------------------------------------------------------
update public.care_entry_types
   set fields = (select jsonb_agg(case when f->>'key' = 'mood' and f->>'label' = 'How is she'
                                       then jsonb_set(f, '{label}', '"Mood"') else f end order by n)
                   from jsonb_array_elements(fields) with ordinality as x(f, n))
 where id = 'lana.mood' and fields @> '[{"key": "mood", "label": "How is she"}]';

-- ---------------------------------------------------------------------------
-- 6. Safe sleep is advice for a baby: it stops at 12 months, unless an admin set its ages.
-- ---------------------------------------------------------------------------
update public.assistant_skills
   set age_to_days = 365, version = version + 1, updated_at = now()
 where id = 'safe_sleep' and age_to_days is null;
