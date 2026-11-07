-- Age stages: the app grows with the child (lib/stage.ts holds the same table for the screens).
--
--   1. A meal entry. From about 6 months a baby eats; there was no way to log it. The type
--      is shared like every other (one row for every home); the app offers it from 24 weeks
--      of age, and Home's fourth row becomes Meal from then. Its first-time, allergen and
--      reaction answers are "fresh": a new meal never starts with the last one's.
--   2. The gap before the next feed is due grows with age: 3 h under 6 months (as before),
--      4 h to 12 months, 5 h after. home_summary is as in migration 5500 with that one change.

-- ---------------------------------------------------------------------------
-- 1. The meal
-- ---------------------------------------------------------------------------
insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('lana.meal', 'lana', 'meal', 'Meal', '🥣', '#65a30d', 12, false, null,
   '[{"key":"food","label":"What was eaten","type":"text","required":true},
     {"key":"amount","label":"How much","type":"choice","options":["A taste","A few spoons","Half a bowl","A full bowl"],
      "labels":{"ar":{"A taste":"تذوّق","A few spoons":"بضع ملاعق","Half a bowl":"نصف وعاء","A full bowl":"وعاء كامل"},
                "ru":{"A taste":"Попробовать","A few spoons":"Несколько ложек","Half a bowl":"Полмиски","A full bowl":"Полная миска"}}},
     {"key":"new_food","label":"First time trying it","type":"choice","options":["No","Yes"],"default":"No","fresh":true,
      "labels":{"ar":{"No":"لا","Yes":"نعم"},"ru":{"No":"Нет","Yes":"Да"}}},
     {"key":"allergen","label":"Allergen in it","type":"choice","options":["None","Egg","Peanut","Milk","Wheat","Fish","Sesame","Tree nuts","Soy","Shellfish"],"default":"None","fresh":true},
     {"key":"reaction","label":"Any reaction","type":"choice","options":["None","Rash","Vomiting","Swelling","Other"],"default":"None","fresh":true}]'::jsonb,
   false, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The feed gap by age
-- ---------------------------------------------------------------------------
-- Minutes between full milk feeds for a child born on p_birth (lib/stage.ts, feedEveryMin):
-- 180 under 6 months, 240 to 12 months, 300 after. No birth date: 180.
create or replace function private.feed_every_min(p_birth date) returns integer
language sql stable set search_path = public as $$
  select case
    when p_birth is null then 180
    when (current_date - p_birth) < 6 * 30.4375 then 180
    when (current_date - p_birth) < 12 * 30.4375 then 240
    else 300 end
$$;
revoke execute on function private.feed_every_min(date) from public, anon;
grant execute on function private.feed_every_min(date) to authenticated, service_role, app_rls;

-- As in migration 5500, with the feed gap from the child's age.
create or replace function public.home_summary(p_subject_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  v_usual   numeric;
  v_feed_every integer;
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
                   'next_due', case when t.due_after_min is not null
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
