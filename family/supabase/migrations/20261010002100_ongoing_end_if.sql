-- A bottle feed logged from the form has no end time (only breastfeeds are
-- timed), yet home_summary listed it under "ongoing", so the home screen said
-- "Feeding" for days. Ongoing now honours the type's end_if rule.
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
                where e.subject_id = v_subject and e.deleted_at is null and t.has_end and e.ended_at is null
                  -- a type that only times some entries (feed: end_if method = Breast) must not call a bottle "still going"
                  and (t.settings->'end_if' is null
                       or not exists (select 1 from jsonb_each_text(t.settings->'end_if') k where e.payload->>k.key is distinct from k.value))),
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
