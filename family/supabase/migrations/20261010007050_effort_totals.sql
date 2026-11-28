-- ============================================================================
-- Effort, counted (28 November 2026). Plain totals of the care that was saved since the
-- child was born: how many feeds, hours at the breast, litres pumped, diapers, times
-- settled to sleep, meals, and on how many days. One function, read by one screen
-- ("Since {Name} was born", reached from Achievements and from a line on Home at each
-- monthly birthday).
--
-- It answers two sums and no more: the caller's own, and the whole home's. It never
-- answers another member's, so no screen can set one person's numbers beside another's:
-- rewards lift, they do not compare (DESIGN.md, "Effort, counted"). Nothing here is a goal.
--
-- An entry is credited as the app shows it everywhere else ("Logged by ..."): to the member
-- it was saved for when there is one, else to whoever saved it.
--
-- Reads only. Invoker, as care_daily_stats is, so row security decides what is seen: a
-- member who may not view the child gets a refusal, another home's child is not found.
-- (7050, between 7000 and the 7100 that docs/ages-step2/README.md keeps for step 2.)
-- ============================================================================

create or replace function public.effort_totals(p_subject_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_me uuid := public.current_member_id();
  v_tz text;
  v_birth date;
  v_all jsonb;
  v_mine jsonb;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_me is null or not public.has_permission(v_module, 'view') then return private.denied(); end if;
  select h.timezone into v_tz from public.household h where h.id = private.current_household_id();
  select s.birth_date into v_birth from public.care_subjects s where s.id = p_subject_id;

  -- One pass over the child's entries, on the home's calendar, from the birth to now. A
  -- breastfeed counts for as long as it ran, at most 90 minutes (a timer left running is
  -- not an evening at the breast). An amount that is not a plain number counts as nothing:
  -- stored text is never cast on trust.
  with e as (
    select x.type_id, x.payload, x.occurred_at, x.ended_at,
           coalesce(x.attributed_to, x.logged_by) as who,
           (x.occurred_at at time zone v_tz)::date as d
      from public.care_entries x
     where x.subject_id = p_subject_id and x.deleted_at is null and x.occurred_at <= now()
       and (v_birth is null or (x.occurred_at at time zone v_tz)::date >= v_birth)
  ), s as (
    select g.mine,
           jsonb_build_object(
             'days', count(distinct e.d),
             'first_day', min(e.d),
             'feeds', count(*) filter (where e.type_id = v_module || '.feed'),
             'breast_min', coalesce(round(sum(least(extract(epoch from (e.ended_at - e.occurred_at)) / 60, 90))
               filter (where e.type_id = v_module || '.feed' and e.payload->>'method' = 'Breast' and e.ended_at is not null)), 0),
             'pumps', count(*) filter (where e.type_id = v_module || '.pump'),
             'pump_ml', coalesce(round(sum(case when e.payload->>'amount_ml' ~ '^\d{1,5}(\.\d+)?$' then (e.payload->>'amount_ml')::numeric else 0 end)
               filter (where e.type_id = v_module || '.pump')), 0),
             'diapers', count(*) filter (where e.type_id = v_module || '.diaper'),
             'sleeps', count(*) filter (where e.type_id = v_module || '.sleep'),
             'meals', count(*) filter (where e.type_id = v_module || '.meal')) as j
      from e
      cross join (values (false), (true)) as g(mine)
     where not g.mine or e.who = v_me
     group by g.mine
  )
  select (select j from s where not mine), (select j from s where mine) into v_all, v_mine;

  return jsonb_build_object(
    'ok', true,
    'birth_date', v_birth,
    'all', coalesce(v_all, private.effort_none()),
    'mine', coalesce(v_mine, private.effort_none()));
end $$;

-- What a sum is when nothing was saved: every count zero, no first day.
create or replace function private.effort_none() returns jsonb
language sql immutable as $$
  select jsonb_build_object('days', 0, 'first_day', null, 'feeds', 0, 'breast_min', 0, 'pumps', 0, 'pump_ml', 0, 'diapers', 0, 'sleeps', 0, 'meals', 0)
$$;
revoke execute on function private.effort_none() from public, anon;
grant execute on function private.effort_none() to authenticated, service_role, app_rls;

revoke execute on function public.effort_totals(uuid) from public, anon;
grant execute on function public.effort_totals(uuid) to authenticated, service_role;
