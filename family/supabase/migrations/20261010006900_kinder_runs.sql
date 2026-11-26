-- A run of days on the pumping goal forgives one day off a week (Mido, 26 November: rewards
-- should lift Dana, not add guilt). A bad night, a low day or a day out no longer sends a run
-- back to zero: one day under the goal between two days on it is stepped over, as long as no
-- other day was stepped over in the seven days before it. The day off adds nothing to the
-- count; it only does not end it. The best run is the best such run, so no medal already won
-- is touched, and a run that does end is simply not spoken of: the app never says one was
-- lost.
--
-- Only how best_run and current_run are counted changes; the keys the app reads are the same.
-- The run still going is one whose last day on goal is today or yesterday, or the day before
-- yesterday while yesterday can still be the week's day off.
create or replace function private.achievement_numbers(p_home uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_target integer;
  v_today date;
  v_days date[];
  v_best integer := 0;
  v_run integer := 0;
  v_prev date;
  v_off date; -- the last day stepped over in the run being counted
  v_d date;
  v_current integer := 0;
  v_beat integer := 0;
  v_today_ml integer := 0;
  v_freezer integer := 0;
begin
  select coalesce(timezone, 'UTC'), milk_target_ml into v_tz, v_target from public.household where id = p_home;
  v_today := (now() at time zone v_tz)::date;
  if v_target > 0 then
    with days as (
      select (e.occurred_at at time zone v_tz)::date as d, sum((e.payload->>'amount_ml')::numeric) as ml
        from public.care_entries e
       where e.household_id = p_home and e.type_id = 'lana.pump' and e.deleted_at is null
         and e.occurred_at > now() - interval '120 days'
         and coalesce(e.payload->>'amount_ml', '') ~ '^\d+(\.\d+)?$'
       group by 1)
    select coalesce(array_agg(d order by d) filter (where ml >= v_target * 0.9), '{}'),
           count(*) filter (where ml >= v_target * 1.1),
           coalesce(max(ml) filter (where d = v_today), 0)::integer
      into v_days, v_beat, v_today_ml
      from days;
    foreach v_d in array v_days loop
      if v_prev is not null and v_d = v_prev + 1 then
        v_run := v_run + 1;
      elsif v_prev is not null and v_d = v_prev + 2 and (v_off is null or (v_prev + 1) - v_off >= 7) then
        -- One day under the goal, and none other stepped over in the week before it.
        v_off := v_prev + 1;
        v_run := v_run + 1;
      else
        v_run := 1;
        v_off := null;
      end if;
      v_best := greatest(v_best, v_run);
      v_prev := v_d;
    end loop;
    -- The run still going: it ends today or yesterday (today is not over yet), or the day
    -- before yesterday when yesterday can be the day off.
    if v_prev is not null and (v_prev >= v_today - 1
        or (v_prev = v_today - 2 and (v_off is null or (v_today - 1) - v_off >= 7))) then
      v_current := v_run;
    end if;
  end if;
  select coalesce(sum(amount_ml), 0)::integer into v_freezer
    from public.milk_bottles
   where household_id = p_home and location = 'freezer' and used_at is null and deleted_at is null;
  return jsonb_build_object('target', v_target, 'goal_from', round(coalesce(v_target, 0) * 0.9), 'today_ml', v_today_ml,
    'best_run', v_best, 'current_run', v_current, 'beat_days', v_beat, 'freezer_ml', v_freezer);
end $$;
alter function private.achievement_numbers(uuid) owner to app_rls;
revoke execute on function private.achievement_numbers(uuid) from public, anon, authenticated;
grant execute on function private.achievement_numbers(uuid) to app_rls;
