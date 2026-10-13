-- Vaccines: the UAE childhood schedule (MOHAP National Immunization Program as
-- applied by DHA, Clinical Guideline for Best Practice in Immunization v4),
-- due dates from the child's birth date, a record of what was given and when,
-- and the next visit on the calendar, the home screen and the due list.
--
-- The schedule is data, not code: an admin can correct a row from SQL if the
-- clinic's card differs, and the app shows the clinic's card as the source of
-- truth whenever it disagrees.

-- ---------------------------------------------------------------------------
-- 1. Schedule
-- ---------------------------------------------------------------------------
create table if not exists public.vaccine_schedule (
  id           text primary key,
  kind         text not null default 'child' check (kind in ('child', 'pet')),
  visit        text not null,            -- "2 months", "12 months", "5 to 6 years"
  due_age_days integer not null,         -- days after birth
  window_days  integer not null default 28,
  vaccine      text not null,
  dose         smallint not null default 1,
  note         text,
  sort         integer not null default 100,
  is_active    boolean not null default true
);
alter table public.vaccine_schedule enable row level security;
create policy vaccine_schedule_read on public.vaccine_schedule for select to authenticated using (public.current_member_id() is not null);
grant select on public.vaccine_schedule to authenticated;
grant all on public.vaccine_schedule to service_role;

insert into public.vaccine_schedule (id, visit, due_age_days, window_days, vaccine, dose, note, sort) values
  ('bcg_1',     'Birth',          0,    14, 'BCG (tuberculosis)',                           1, 'Given in the hospital, usually within 24 hours.', 10),
  ('hepb_1',    'Birth',          0,    14, 'Hepatitis B',                                  1, 'Given in the hospital, usually within 24 hours.', 11),
  ('hexa_1',    '2 months',       61,   28, '6-in-1 (DTaP, polio, Hib, hepatitis B)',       1, null, 20),
  ('pcv_1',     '2 months',       61,   28, 'Pneumococcal (PCV)',                           1, null, 21),
  ('rota_1',    '2 months',       61,   28, 'Rotavirus (oral drops)',                       1, 'First dose must be given before 15 weeks.', 22),
  ('hexa_2',    '4 months',       122,  28, '6-in-1 (DTaP, polio, Hib, hepatitis B)',       2, null, 30),
  ('pcv_2',     '4 months',       122,  28, 'Pneumococcal (PCV)',                           2, null, 31),
  ('rota_2',    '4 months',       122,  28, 'Rotavirus (oral drops)',                       2, null, 32),
  ('hexa_3',    '6 months',       183,  28, '6-in-1 or 5-in-1 with oral polio',             3, 'The clinic chooses the combination; both complete the third dose.', 40),
  ('pcv_3',     '6 months',       183,  28, 'Pneumococcal (PCV)',                           3, 'UAE gives three doses: 2, 4 and 6 months.', 41),
  ('rota_3',    '6 months',       183,  28, 'Rotavirus (oral drops)',                       3, 'Only if the brand needs three doses (RotaTeq). Rotarix is two. Last dose by 8 months.', 42),
  ('flu_1',     '6 months',       183,  60, 'Flu (seasonal)',                               1, 'From 6 months. Two doses four weeks apart the first season, then yearly.', 43),
  ('mmr_1',     '12 months',      365,  28, 'MMR (measles, mumps, rubella)',                1, null, 50),
  ('var_1',     '12 months',      365,  28, 'Chickenpox (varicella)',                       1, null, 51),
  ('menacwy_1', '12 months',      365,  28, 'Meningococcal ACWY',                           1, 'Added to the DHA schedule in 2024.', 52),
  ('hepa_1',    '12 months',      365,  28, 'Hepatitis A',                                  1, 'On the DHA schedule. Confirm with the clinic.', 53),
  ('penta_4',   '18 months',      548,  28, '5-in-1 booster (DTaP, polio, Hib)',            4, null, 60),
  ('mmr_2',     '18 months',      548,  28, 'MMR (measles, mumps, rubella)',                2, null, 61),
  ('var_2',     '18 months',      548,  28, 'Chickenpox (varicella)',                       2, null, 62),
  ('hepa_2',    '18 months',      548,  28, 'Hepatitis A',                                  2, 'Six months after the first.', 63),
  ('dtap_5',    '5 to 6 years',   1826, 180, '4-in-1 booster (DTaP, polio)',                5, 'School entry.', 70),
  ('mmrv_s',    '5 to 6 years',   1826, 180, 'MMR and chickenpox (school entry)',           3, 'Only if the 18-month doses were missed.', 71),
  ('menacwy_2', '10 to 11 years', 3835, 365, 'Meningococcal ACWY',                          2, null, 80),
  ('hpv_1',     '13 years',       4745, 365, 'HPV',                                         1, 'Two doses, six months apart.', 90),
  ('tdap_6',    '15 to 16 years', 5660, 365, 'Tdap booster',                                6, null, 95),
  ('menacwy_3', '16 to 18 years', 6025, 365, 'Meningococcal ACWY',                          3, 'Grade 11.', 96)
on conflict (id) do update set visit = excluded.visit, due_age_days = excluded.due_age_days, window_days = excluded.window_days,
  vaccine = excluded.vaccine, dose = excluded.dose, note = excluded.note, sort = excluded.sort;

-- ---------------------------------------------------------------------------
-- 2. What was given. One live row per subject and schedule line.
-- ---------------------------------------------------------------------------
create table if not exists public.vaccinations (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.care_subjects (id) on delete cascade,
  schedule_id text not null references public.vaccine_schedule (id),
  given_on    date not null,
  place       text,
  batch       text,
  note        text,
  recorded_by uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists vaccinations_live_idx on public.vaccinations (subject_id, schedule_id) where deleted_at is null;
alter table public.vaccinations enable row level security;
create policy vaccinations_read on public.vaccinations for select to authenticated
  using (deleted_at is null and public.has_permission(private.subject_module(subject_id), 'view'));
grant select on public.vaccinations to authenticated;
grant all on public.vaccinations to service_role;

create or replace function public.vaccine_record(
  p_subject_id uuid, p_schedule_id text, p_given_on date, p_place text default null, p_batch text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_module text := private.subject_module(p_subject_id); v_id uuid; v_birth date;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'vaccinations') then return private.denied(); end if;
  if not exists (select 1 from public.vaccine_schedule where id = p_schedule_id and is_active) then
    return jsonb_build_object('ok', false, 'error', 'bad_schedule', 'message', 'That vaccine is not on the schedule.');
  end if;
  if p_given_on is null or p_given_on > current_date + 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_date', 'message', 'The date must be today or earlier.');
  end if;
  select birth_date into v_birth from public.care_subjects where id = p_subject_id;
  if v_birth is not null and p_given_on < v_birth then
    return jsonb_build_object('ok', false, 'error', 'bad_date', 'message', 'That is before she was born.');
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
grant execute on function public.vaccine_record(uuid, text, date, text, text, text) to authenticated, service_role;

create or replace function public.vaccine_unrecord(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_subject uuid; v_module text;
begin
  select subject_id into v_subject from public.vaccinations where id = p_id and deleted_at is null;
  if v_subject is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_module := private.subject_module(v_subject);
  if not private.authz(v_module, 'edit', 'vaccinations') then return private.denied('Only someone who can edit the log can undo a vaccine.'); end if;
  update public.vaccinations set deleted_at = now() where id = p_id and deleted_at is null;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.vaccine_unrecord(uuid) to authenticated, service_role;

-- Every schedule line for one child with its due date, status and record.
--   status: given | due (window open) | overdue (window closed) | upcoming | unknown (no birth date)
create or replace function public.vaccines_list(p_subject_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
  v_birth date;
  v_kind text;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied(); end if;
  select birth_date, kind into v_birth, v_kind from public.care_subjects where id = p_subject_id;
  return jsonb_build_object('ok', true, 'today', v_today, 'birth_date', v_birth, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'visit', s.visit, 'vaccine', s.vaccine, 'dose', s.dose, 'note', s.note,
             'due_age_days', s.due_age_days, 'window_days', s.window_days,
             'due_on', v_birth + s.due_age_days,
             'status', case
               when v.id is not null then 'given'
               when v_birth is null then 'unknown'
               when v_today > v_birth + s.due_age_days + s.window_days then 'overdue'
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
grant execute on function public.vaccines_list(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The due list now carries one line per vaccine visit with doses outstanding.
-- ---------------------------------------------------------------------------
create or replace function public.care_due_list(p_days_ahead integer default 30) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone v_tz)::date;
begin
  return jsonb_build_object('ok', true, 'items', coalesce((
    with subjects as (
      select s.id, s.name, s.module_id, s.birth_date, s.kind from public.care_subjects s
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
    ),
    vaccines as (
      select s.id as subject_id, sc.visit, s.birth_date + sc.due_age_days as due_on,
             min(sc.window_days) as window_days,
             string_agg(sc.vaccine || ' (' || sc.dose || ')', ', ' order by sc.sort) as doses, count(*) as n
        from subjects s
        join public.vaccine_schedule sc on sc.is_active and sc.kind = s.kind
        left join public.vaccinations v on v.subject_id = s.id and v.schedule_id = sc.id and v.deleted_at is null
       where s.birth_date is not null and v.id is null
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
        'overdue', vx.due_on + vx.window_days < v_today)
        from vaccines vx join subjects s on s.id = vx.subject_id
       where vx.due_on <= v_today + p_days_ahead
    ) q), '[]'::jsonb));
end $$;
