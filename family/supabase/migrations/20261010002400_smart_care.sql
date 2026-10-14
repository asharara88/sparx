-- Smart care: the next feed depends on how much she actually took, and a
-- breastfeed timer left running can be trimmed with one tap.

-- How full a feed was, 0 (a few sips) to 1 (a proper feed). Breast: minutes on
-- the breast (5 min → 0, 20 min → 1) and one side counts as half unless it ran
-- 20 min or more. Bottle: ml against her usual bottle. Unknown → 1.
create or replace function private.feed_fullness(p_payload jsonb, p_occurred_at timestamptz, p_ended_at timestamptz, p_usual_ml numeric)
returns numeric language plpgsql immutable as $$
declare
  v_ml   numeric := nullif(regexp_replace(coalesce(p_payload->>'amount_ml', ''), '[^0-9.]', '', 'g'), '')::numeric;
  v_min  numeric := nullif(regexp_replace(coalesce(p_payload->>'duration_min', ''), '[^0-9.]', '', 'g'), '')::numeric;
  v_side text := p_payload->>'side';
  v_by_min numeric;
  v_by_side numeric;
begin
  if p_payload->>'method' = 'Bottle' or (v_ml is not null and p_payload->>'method' is distinct from 'Breast') then
    if v_ml is null or v_ml <= 0 then return 1; end if;
    return least(1, greatest(0, v_ml / greatest(coalesce(p_usual_ml, 120), 30)));
  end if;
  if v_min is null and p_ended_at is not null and p_ended_at > p_occurred_at then
    v_min := extract(epoch from p_ended_at - p_occurred_at) / 60;
  end if;
  v_by_min := case when v_min is null then 1 else least(1, greatest(0, (v_min - 5) / 15)) end;
  v_by_side := case when v_side in ('Left', 'Right') then (case when coalesce(v_min, 0) >= 20 then 0.75 else 0.5 end) else 1 end;
  return round(least(v_by_min, v_by_side), 2);
end $$;

-- Her usual bottle: the median ml of the last 7 days, 120 when there are fewer than three.
create or replace function private.usual_bottle_ml(p_subject_id uuid) returns numeric
language sql stable as $$
  with x as (
    select nullif(regexp_replace(coalesce(e.payload->>'amount_ml', ''), '[^0-9.]', '', 'g'), '')::numeric as ml
      from public.care_entries e
     where e.subject_id = p_subject_id and e.deleted_at is null and e.type_id like '%.feed'
       and e.payload->>'method' = 'Bottle' and e.occurred_at > now() - interval '7 days')
  select case when count(ml) >= 3 then percentile_cont(0.5) within group (order by ml) else 120 end
    from x where ml > 20
$$;

-- home_summary: the feed's next_due shrinks after a small feed (half the gap at
-- most, never under an hour), and the row carries the fullness so the screen can
-- say "short feed on the left". Everything else is as before.
create or replace function public.home_summary(p_subject_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  v_usual   numeric;
begin
  if v_module is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Nobody to show yet.');
  end if;
  if not private.authz(v_module, 'view', 'care_entries', v_subject::text) then
    return private.denied('You are not allowed to see this log.');
  end if;
  v_usual := private.usual_bottle_ml(v_subject);
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
                                             then greatest(60, round(t.due_after_min * (0.5 + 0.5 * private.feed_fullness(e.payload, e.occurred_at, e.ended_at, v_usual))))::int
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

-- A breastfeed over 45 min on one side almost always means the timer was left
-- on. Trim it to p_keep_min (the raw minutes stay in the payload) or mark it as
-- real so it is not asked again. Needs edit on the module, like any correction.
create or replace function public.care_feed_trim(p_id uuid, p_keep_min integer default 20, p_ok boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.care_entries;
  v_module text;
  v_raw_min integer;
begin
  select * into e from public.care_entries where id = p_id and deleted_at is null;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_module := e.module_id;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text);
    return private.denied('You are not allowed to change this entry.');
  end if;
  if e.type_id not like '%.feed' or e.payload->>'method' is distinct from 'Breast' then
    return jsonb_build_object('ok', false, 'error', 'not_a_breastfeed');
  end if;
  if coalesce(p_ok, false) then
    update public.care_entries set payload = payload || '{"timer_ok": true}'::jsonb where id = p_id;
    perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"timer_ok": true}'::jsonb);
    return jsonb_build_object('ok', true, 'id', p_id, 'kept', true);
  end if;
  if p_keep_min is null or p_keep_min < 1 or p_keep_min > 60 then return jsonb_build_object('ok', false, 'error', 'bad_minutes'); end if;
  v_raw_min := coalesce(nullif(regexp_replace(coalesce(e.payload->>'duration_min', ''), '[^0-9]', '', 'g'), '')::int,
                        case when e.ended_at is not null then round(extract(epoch from e.ended_at - e.occurred_at) / 60)::int end);
  update public.care_entries
     set ended_at = occurred_at + make_interval(mins => p_keep_min),
         payload = payload || jsonb_build_object('duration_min', p_keep_min, 'timer_capped', true, 'raw_minutes', v_raw_min)
   where id = p_id;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, jsonb_build_object('trimmed_to_min', p_keep_min, 'raw_minutes', v_raw_min));
  return jsonb_build_object('ok', true, 'id', p_id, 'kept', false, 'raw_minutes', v_raw_min);
end $$;
grant execute on function public.care_feed_trim(uuid, integer, boolean) to authenticated, service_role;
