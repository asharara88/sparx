-- Badges for what the family does (Mido, 9 November: "dopamine triggering motivation and
-- award winning badges for achievements on target and exceeding", "mainly designed to
-- motivate Dana and the rest, not Lana"). Never for the baby's own numbers (how much she
-- drank or slept is hers to set), only for what the grown-ups do:
--
--   pump_goal  the day's pumping reached the goal (90% of household.milk_target_ml, the
--              bottom of the "Goal 360 to 400 ml" band) on N days in a row: tiers 1, 3, 7,
--              14 and 30 days (first, bronze, silver, gold, diamond). The pumping parent's.
--   pump_beat  a day at 110% of the goal or more: on 1, 5 and 15 days. The pumping parent's.
--   stash      the freezer held 500 ml, 1 litre, 2 litres at once. The family's.
--
-- Worked out from what is already logged, in the database, so nobody can hand themselves a
-- badge: the client reads, it never writes. A badge is won once (one row per home, member,
-- badge and tier) and kept even if the freezer is later emptied. seen_by holds who has
-- had the moment on screen, so it shows once per person, on whichever phone opens first.

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  member_id uuid references public.members (id) on delete cascade, -- null: the family's
  badge text not null check (badge in ('pump_goal', 'pump_beat', 'stash')),
  tier integer not null check (tier between 1 and 9),
  earned_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  seen_by uuid[] not null default '{}'
);
create unique index if not exists achievements_once
  on public.achievements (household_id, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), badge, tier);
alter table public.achievements enable row level security;
revoke all on public.achievements from anon, authenticated;
grant select on public.achievements to authenticated;
drop policy if exists achievements_read on public.achievements;
create policy achievements_read on public.achievements for select to authenticated using (public.has_permission('lana', 'view'));
drop policy if exists achievements_app on public.achievements;
create policy achievements_app on public.achievements for all to app_rls using (true) with check (true);
drop policy if exists achievements_home on public.achievements;
create policy achievements_home on public.achievements as restrictive for all to authenticated, app_rls
  using (household_id = private.current_household_id()) with check (household_id = private.current_household_id());

-- The numbers the badges are measured on, for one home: the pumping goal, today's pumped
-- millilitres, the best and the current run of days on goal (the current run ends today,
-- or yesterday while today is still under way), days at 110% or more, and what the freezer
-- holds now. Days are the home's calendar days, the last 120 of them.
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
      v_run := case when v_prev is not null and v_d = v_prev + 1 then v_run + 1 else 1 end;
      v_best := greatest(v_best, v_run);
      v_prev := v_d;
    end loop;
    -- The run still going: it ends today, or yesterday (today is not over yet).
    if v_prev is not null and v_prev >= v_today - 1 then v_current := v_run; end if;
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

-- The tiers, in one place: what each needs, and its name on screen.
create or replace function private.achievement_tiers() returns table (badge text, tier integer, need integer)
language sql immutable set search_path = public as $$
  values ('pump_goal', 1, 1), ('pump_goal', 2, 3), ('pump_goal', 3, 7), ('pump_goal', 4, 14), ('pump_goal', 5, 30),
         ('pump_beat', 1, 1), ('pump_beat', 2, 5), ('pump_beat', 3, 15),
         ('stash', 1, 500), ('stash', 2, 1000), ('stash', 3, 2000)
$$;
revoke execute on function private.achievement_tiers() from public, anon;
grant execute on function private.achievement_tiers() to authenticated, app_rls;

-- Awards what the log has earned (once), then returns the badges the caller has not seen
-- yet: their own and the family's, best first. Home calls it on every load; it is a few
-- small queries. Pumping badges go to each active member who breastfeeds; with none, to
-- the family. "View as" is read only: an admin previewing someone sees their unseen badges
-- but awards nothing.
create or replace function public.achievements_check() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_n jsonb;
  v_pumpers uuid[];
  v_new jsonb;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if not public.has_permission('lana', 'view') then return jsonb_build_object('ok', true, 'new', '[]'::jsonb); end if;
  v_n := private.achievement_numbers(v_home);
  select coalesce(array_agg(id), '{}') into v_pumpers
    from public.members where household_id = v_home and breastfeeds and coalesce(is_active, true);
  if cardinality(v_pumpers) = 0 then v_pumpers := array[null::uuid]; end if;

  if not private.read_only_preview() then
  insert into public.achievements (household_id, member_id, badge, tier, detail)
  select v_home, p.m, t.badge, t.tier, jsonb_build_object('need', t.need)
    from private.achievement_tiers() t
    cross join unnest(v_pumpers) as p(m)
   where (t.badge = 'pump_goal' and (v_n->>'best_run')::integer >= t.need)
      or (t.badge = 'pump_beat' and (v_n->>'beat_days')::integer >= t.need)
  on conflict do nothing;

  insert into public.achievements (household_id, member_id, badge, tier, detail)
  select v_home, null, t.badge, t.tier, jsonb_build_object('need', t.need)
    from private.achievement_tiers() t
   where t.badge = 'stash' and (v_n->>'freezer_ml')::integer >= t.need
  on conflict do nothing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'badge', a.badge, 'tier', a.tier, 'need', a.detail->'need',
           'mine', a.member_id is not distinct from v_me, 'earned_at', a.earned_at) order by a.tier desc, a.earned_at desc), '[]'::jsonb)
    into v_new
    from public.achievements a
   where a.household_id = v_home
     and (a.member_id = v_me or a.member_id is null)
     and not (v_me = any (a.seen_by));
  return jsonb_build_object('ok', true, 'new', v_new, 'numbers', v_n);
end $$;
alter function public.achievements_check() owner to app_rls;
revoke execute on function public.achievements_check() from public, anon;
grant execute on function public.achievements_check() to authenticated, service_role;

-- The moment was shown: these badges are seen by the caller, on every phone. Not while an
-- admin views as someone else: that would take the member's own moment from them.
create or replace function public.achievements_seen(p_ids uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_n integer;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  update public.achievements
     set seen_by = array_append(seen_by, v_me)
   where household_id = v_home and id = any (coalesce(p_ids, '{}')) and not (v_me = any (seen_by))
     and (member_id = v_me or member_id is null);
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'seen', v_n);
end $$;
alter function public.achievements_seen(uuid[]) owner to app_rls;
revoke execute on function public.achievements_seen(uuid[]) from public, anon;
grant execute on function public.achievements_seen(uuid[]) to authenticated, service_role;

-- The trophy shelf: every badge the home has won (whose, when), and the numbers for
-- what comes next.
create or replace function public.achievements_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if not public.has_permission('lana', 'view') then return private.denied(); end if;
  return jsonb_build_object(
    'ok', true,
    'earned', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'badge', a.badge, 'tier', a.tier, 'need', a.detail->'need',
               'member_id', a.member_id, 'member_name', m.display_name, 'earned_at', a.earned_at) order by a.earned_at desc, a.tier desc)
        from public.achievements a left join public.members m on m.id = a.member_id
       where a.household_id = v_home), '[]'::jsonb),
    'numbers', private.achievement_numbers(v_home),
    'pumpers', coalesce((select jsonb_agg(display_name) from public.members where household_id = v_home and breastfeeds and coalesce(is_active, true)), '[]'::jsonb));
end $$;
alter function public.achievements_list() owner to app_rls;
revoke execute on function public.achievements_list() from public, anon;
grant execute on function public.achievements_list() to authenticated, service_role;
