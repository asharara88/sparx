-- Coach plans: a short day-by-day plan the helper proposes (earlier bedtime,
-- drowsy-but-awake practice) and the family starts with one tap. One active
-- plan per child; a daily "done" check-in. Read and written through RPCs only.

create table if not exists public.coach_plans (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.care_subjects (id) on delete cascade,
  member_id  uuid references public.members (id) on delete set null,
  goal       text not null check (length(btrim(goal)) between 2 and 120),
  steps      jsonb not null default '[]'::jsonb,
  starts_on  date not null,
  ends_on    date not null,
  status     text not null default 'active' check (status in ('active', 'done', 'stopped', 'replaced')),
  created_at timestamptz not null default now()
);
create index if not exists coach_plans_active_idx on public.coach_plans (subject_id) where status = 'active';
alter table public.coach_plans enable row level security;
grant all on public.coach_plans to service_role;

create table if not exists public.coach_checkins (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.coach_plans (id) on delete cascade,
  day        date not null,
  done       boolean not null default true,
  note       text check (note is null or length(note) <= 300),
  by_member  uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, day)
);
alter table public.coach_checkins enable row level security;
grant all on public.coach_checkins to service_role;

-- The active plan with its check-ins and today's step.
create or replace function public.coach_plan_active(p_subject_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  p public.coach_plans;
  v_day int;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied(); end if;
  select * into p from public.coach_plans where subject_id = v_subject and status = 'active' order by created_at desc limit 1;
  if p.id is null then return jsonb_build_object('ok', true, 'plan', null); end if;
  v_day := (v_today - p.starts_on) + 1;
  return jsonb_build_object('ok', true, 'plan', jsonb_build_object(
    'id', p.id, 'goal', p.goal, 'steps', p.steps, 'starts_on', p.starts_on, 'ends_on', p.ends_on,
    'day', v_day, 'days', jsonb_array_length(p.steps), 'over', v_today > p.ends_on,
    'today_step', (select s->>'step' from jsonb_array_elements(p.steps) s where (s->>'day')::int = least(greatest(v_day, 1), jsonb_array_length(p.steps)) limit 1),
    'done_today', exists (select 1 from public.coach_checkins c where c.plan_id = p.id and c.day = v_today and c.done),
    'checkins', (select coalesce(jsonb_agg(jsonb_build_object('day', c.day, 'done', c.done, 'note', c.note, 'by', m.display_name) order by c.day), '[]'::jsonb)
                 from public.coach_checkins c left join public.members m on m.id = c.by_member where c.plan_id = p.id)));
end $$;
grant execute on function public.coach_plan_active(uuid) to authenticated, service_role;

-- Start a plan (replaces the active one). Steps: [{"day":1,"step":"..."}, ...], 1 to 14 days.
create or replace function public.coach_plan_start(p_subject_id uuid, p_goal text, p_steps jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz     text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today  date := (now() at time zone v_tz)::date;
  v_steps  jsonb;
  v_n      int;
  v_id     uuid;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'coach_plans') then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if nullif(btrim(coalesce(p_goal, '')), '') is null or length(btrim(p_goal)) > 120 then return jsonb_build_object('ok', false, 'error', 'bad_goal', 'message', 'Give the plan a short goal.'); end if;
  if jsonb_typeof(p_steps) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_steps'); end if;
  select jsonb_agg(jsonb_build_object('day', rn, 'step', left(btrim(s->>'step'), 300)) order by rn) into v_steps
    from (select s, row_number() over () as rn from jsonb_array_elements(p_steps) s where nullif(btrim(coalesce(s->>'step', '')), '') is not null) x(s, rn);
  v_n := coalesce(jsonb_array_length(v_steps), 0);
  if v_n < 1 or v_n > 14 then return jsonb_build_object('ok', false, 'error', 'bad_steps', 'message', 'A plan has 1 to 14 days, one step each.'); end if;
  update public.coach_plans set status = 'replaced' where subject_id = p_subject_id and status = 'active';
  insert into public.coach_plans (subject_id, member_id, goal, steps, starts_on, ends_on)
  values (p_subject_id, public.current_member_id(), btrim(p_goal), v_steps, v_today, v_today + (v_n - 1))
  returning id into v_id;
  perform private.audit_write(v_module, 'add', true, 'coach_plans', v_id::text, jsonb_build_object('goal', btrim(p_goal), 'days', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'days', v_n);
end $$;
grant execute on function public.coach_plan_start(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.coach_plan_checkin(p_plan_id uuid, p_day date default null, p_done boolean default true, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.coach_plans;
  v_module text;
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_day date := coalesce(p_day, (now() at time zone v_tz)::date);
begin
  select * into p from public.coach_plans where id = p_plan_id;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_module := private.subject_module(p.subject_id);
  if not private.authz(v_module, 'add', 'coach_checkins', p_plan_id::text) then return private.denied(); end if;
  if v_day < p.starts_on or v_day > p.ends_on + 1 then return jsonb_build_object('ok', false, 'error', 'bad_day', 'message', 'That day is not part of this plan.'); end if;
  insert into public.coach_checkins (plan_id, day, done, note, by_member)
  values (p_plan_id, v_day, coalesce(p_done, true), nullif(btrim(coalesce(p_note, '')), ''), public.current_member_id())
  on conflict (plan_id, day) do update set done = excluded.done, note = coalesce(excluded.note, public.coach_checkins.note), by_member = excluded.by_member;
  if v_day >= p.ends_on and p.status = 'active' then update public.coach_plans set status = 'done' where id = p_plan_id; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.coach_plan_checkin(uuid, date, boolean, text) to authenticated, service_role;

create or replace function public.coach_plan_stop(p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := (select private.subject_module(subject_id) from public.coach_plans where id = p_plan_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'coach_plans', p_plan_id::text) then return private.denied(); end if;
  update public.coach_plans set status = 'stopped' where id = p_plan_id and status = 'active';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.coach_plan_stop(uuid) to authenticated, service_role;
