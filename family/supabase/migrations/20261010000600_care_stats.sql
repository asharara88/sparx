-- Day-by-day numbers for the trends screen: feeds, sleep, night stretches,
-- diapers, growth. One row per local day. Nights belong to the day they start.
create or replace function public.care_daily_stats(p_subject_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz     text;
  v_nf     time;
  v_nt     time;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'view', 'care_stats', p_subject_id::text,
                       jsonb_build_object('from', p_from, 'to', p_to)) then
    return private.denied('You are not allowed to see this log.');
  end if;
  if p_to - p_from > 400 then return jsonb_build_object('ok', false, 'error', 'range'); end if;
  select h.timezone, coalesce((s.settings->>'night_from')::time, time '19:00'), coalesce((s.settings->>'night_to')::time, time '07:00')
    into v_tz, v_nf, v_nt
    from public.care_subjects s cross join public.household h where s.id = p_subject_id;

  return jsonb_build_object('ok', true, 'timezone', v_tz, 'night_from', v_nf, 'night_to', v_nt, 'days', coalesce((
    with days as (
      select d::date as day,
             (d::date::timestamp) at time zone v_tz as day_start,
             ((d::date + 1)::timestamp) at time zone v_tz as day_end,
             (d::date + v_nf)::timestamp at time zone v_tz as night_start,
             ((d::date + 1) + v_nt)::timestamp at time zone v_tz as night_end
        from generate_series(p_from, p_to, interval '1 day') d
    ),
    e as (
      select e.type_id, e.occurred_at, coalesce(e.ended_at, e.occurred_at) as ended_at, e.payload
        from public.care_entries e
       where e.subject_id = p_subject_id and e.deleted_at is null
         and e.occurred_at >= ((p_from - 1)::timestamp at time zone v_tz)
         and e.occurred_at <  ((p_to + 2)::timestamp at time zone v_tz)
    ),
    x as (
      -- each entry meets at most two days: the day it is in, and the night that spills into the next morning
      select d.day, e.type_id, e.payload, e.occurred_at, e.ended_at,
             (e.occurred_at >= d.day_start and e.occurred_at < d.day_end) as in_day,
             (e.occurred_at >= d.night_start and e.occurred_at < d.night_end) as in_night,
             case when e.ended_at > d.day_start and e.occurred_at < d.day_end
                  then extract(epoch from (least(e.ended_at, d.day_end) - greatest(e.occurred_at, d.day_start))) / 60 else 0 end as day_min,
             case when e.ended_at > d.night_start and e.occurred_at < d.night_end
                  then extract(epoch from (least(e.ended_at, d.night_end) - greatest(e.occurred_at, d.night_start))) / 60 else 0 end as night_min,
             ((e.occurred_at at time zone v_tz)::time >= v_nt and (e.occurred_at at time zone v_tz)::time < v_nf) as starts_in_daytime
        from days d
        left join e on e.ended_at > d.day_start and e.occurred_at < d.night_end
    )
    select jsonb_agg(to_jsonb(q) order by q.day) from (
      select x.day,
             count(*) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'method' = 'Breast') as breast_count,
             coalesce(sum(extract(epoch from (x.ended_at - x.occurred_at)) / 60) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'method' = 'Breast'), 0)::int as breast_min,
             count(*) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'side' = 'Left') as left_count,
             count(*) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'side' = 'Right') as right_count,
             count(*) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'method' = 'Bottle') as bottle_count,
             coalesce(sum((x.payload->>'amount_ml')::numeric) filter (where x.in_day and x.type_id = 'lana.feed' and x.payload->>'method' = 'Bottle'), 0)::int as bottle_ml,
             coalesce(sum((x.payload->>'amount_ml')::numeric) filter (where x.in_day and x.type_id = 'lana.pump'), 0)::int as pump_ml,
             coalesce(sum(x.day_min) filter (where x.type_id = 'lana.sleep'), 0)::int as sleep_min,
             count(*) filter (where x.in_day and x.type_id = 'lana.sleep' and x.starts_in_daytime) as nap_count,
             coalesce(sum(x.night_min) filter (where x.type_id = 'lana.sleep'), 0)::int as night_sleep_min,
             coalesce(max(x.night_min) filter (where x.type_id = 'lana.sleep'), 0)::int as longest_stretch_min,
             count(*) filter (where x.in_night and x.type_id = 'lana.wake') as night_wakes,
             count(*) filter (where x.in_night and x.type_id = 'lana.feed') as night_feeds,
             count(*) filter (where x.in_day and x.type_id = 'lana.diaper' and x.payload->>'kind' in ('Wet', 'Both')) as diapers_wet,
             count(*) filter (where x.in_day and x.type_id = 'lana.diaper' and x.payload->>'kind' in ('Dirty', 'Both')) as diapers_dirty,
             count(*) filter (where x.in_day and x.type_id = 'lana.diaper') as diapers,
             max((x.payload->>'weight_kg')::numeric) filter (where x.in_day and x.type_id = 'lana.growth') as weight_kg,
             max((x.payload->>'length_cm')::numeric) filter (where x.in_day and x.type_id = 'lana.growth') as length_cm,
             max((x.payload->>'head_cm')::numeric) filter (where x.in_day and x.type_id = 'lana.growth') as head_cm,
             coalesce(jsonb_agg(x.payload->>'what') filter (where x.in_day and x.type_id = 'lana.milestone'), '[]'::jsonb) as milestones
        from x group by x.day) q), '[]'::jsonb));
end $$;
grant execute on function public.care_daily_stats(uuid, date, date) to authenticated;
