-- The family's day (step 2 of the plan by age, docs/AGES.md). From 12 months a child's day is no
-- longer a matter of age: one family keeps milk on a clock at 14 months and another has stopped
-- logging it, one two-year-old naps and another does not. Age and the log cannot say which, so a
-- parent says it once, on "{Name}'s day", and every screen follows the answer.
--
--   1. Where it is kept: care_subjects.settings, beside night_from and night_to, as
--        "day": {v, milk: clock | drink | off, naps: 0 | 1 | 2, diapers: diapers | both | potty | off,
--                stores_milk, saved_on, saved_at, saved_by}
--      with "day_asked" (the last age band settled: 12, 18, 24 or 36) and "day_asked_on". saved_on
--      and day_asked_on are the home's calendar day as text, compared as text and never cast. No
--      new table or column and no row is changed here; the guard of migration 6600 already keeps
--      settings to admins.
--   2. private.day_band(birth date): the band a child is in, 12, 18, 24 or 36, counted on the
--      home's calendar as private.is_toddler counts (migration 6500); null for a baby and with no
--      birth date. The edges are days 366, 548, 731 and 1096, where lib/stage.ts turns.
--   3. private.subject_day(settings, birth date): the one definition in SQL of "a day counts".
--      The stored day, whole, when the child is a toddler by the birth date stored now, every
--      answer reads as one of its values, and it was saved on or after the child's day 366; else
--      null. So a baby, a child with no birth date, a day written by hand with a bad answer and a
--      day saved under a birth date that was later moved (a mistyped year at sign-up) all have no
--      day, and every reader does what it did before this migration. lib/day.ts (readDay) makes
--      the same tests, so the screens and the database never disagree about a home.
--   4. me() carries it: private.subject_names is as in migration 5000 with one more key, "day",
--      for the tab bar. Only for a member who may view the child; anyone else gets null.
--   5. home_summary is as in migration 6500 with three changes: the day is read; the last feed
--      has its next due again when the day says milk is on a clock (diapers and sleep stay
--      without); and a kind of entry marked settings.needs is listed only in a home whose day has
--      turned it on. "potty" is the one such mark, on from 18 months when the day says both or
--      potty. No such row exists yet, so every home's list is as it was.
--   6. public.subject_day_save: an admin of the home on screen saves the day, with bedtime and
--      morning when given, or settles the question as it is (no day given). It runs as the
--      caller, so row security and the guard hold it too. A baby is refused: the day opens at 12
--      months. The day is built again from the checked answers; nothing is stored as it was sent.
--   7. public.milk_add, the one way a bottle enters the stash, is as in migration 1300 with one
--      check: it refuses while the day that counts says no milk is stored. A Milk screen or a
--      helper card opened before the parent answered, and an older build on someone's phone, can
--      then add nothing, so "no stored milk" and a bottle in the stash are never both true and the
--      Milk tab never hides live stock. With no day (a baby's home, every home today) it adds as
--      it always did.
-- Signed-in members only: execute is taken from public and anon (functions are public by default).

-- ---------------------------------------------------------------------------
-- 1. The band a child is in
-- ---------------------------------------------------------------------------
create or replace function private.day_band(p_birth date) returns integer
language sql stable security invoker set search_path = public as $$
  with home as (
    select (now() at time zone coalesce(
              (select h.timezone from public.household h where h.id = private.current_household_id()), 'UTC'))::date as today)
  select case
    when p_birth is null or not isfinite(p_birth) then null
    when (home.today - p_birth) >= 36 * 30.4375 then 36
    when (home.today - p_birth) >= 24 * 30.4375 then 24
    when (home.today - p_birth) >= 18 * 30.4375 then 18
    when (home.today - p_birth) >= 12 * 30.4375 then 12 end
    from home
$$;
revoke execute on function private.day_band(date) from public, anon;
grant execute on function private.day_band(date) to authenticated, service_role, app_rls;

-- ---------------------------------------------------------------------------
-- 2. A day that counts
-- ---------------------------------------------------------------------------
-- Nothing stored is cast: this runs inside me(), and a cast that raised would sign a home out.
-- The answers are compared as JSON values (the number 1, written 1 or 1.0), the pattern names its
-- digits and the two dates are compared byte by byte, so for every day subject_day_save can store
-- the answer here is the answer readDay gives, whatever the database's locale. (A number written by
-- hand that only rounds to 0, 1 or 2 as a double is no day here and a day on the phone; only a
-- hand-written update stores one.) A birth date of infinity, which a hand-made call can store, is
-- no day either: date arithmetic on it would raise.
create or replace function private.subject_day(p_settings jsonb, p_birth date) returns jsonb
language sql stable security invoker set search_path = public as $$
  select case when p_birth is null or not isfinite(p_birth) then null
              when private.is_toddler(p_birth)
               and jsonb_typeof(d) = 'object'
               and d->'v' in ('1'::jsonb, '"1"'::jsonb)
               and d->>'milk' in ('clock', 'drink', 'off')
               and d->'naps' in ('0'::jsonb, '1'::jsonb, '2'::jsonb)
               and d->>'diapers' in ('diapers', 'both', 'potty', 'off')
               and jsonb_typeof(d->'stores_milk') = 'boolean'
               and d->>'saved_on' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               and (d->>'saved_on') collate "C" >= to_char(p_birth + 366, 'YYYY-MM-DD')
              then d end
    from (select p_settings->'day' as d) x
$$;
revoke execute on function private.subject_day(jsonb, date) from public, anon;
grant execute on function private.subject_day(jsonb, date) to authenticated, service_role, app_rls;

-- ---------------------------------------------------------------------------
-- 3. me() carries the day: as in migration 5000, with the day for whoever may view the child
-- ---------------------------------------------------------------------------
create or replace function private.subject_names() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'module_id', s.module_id, 'kind', s.kind, 'name', s.name,
           'birth_date', s.birth_date, 'names', coalesce(s.profile->'names', '{}'::jsonb),
           'sex', s.profile->>'sex',
           'night_from', coalesce(nullif(s.settings->>'night_from', ''), '19:00'),
           'night_to', coalesce(nullif(s.settings->>'night_to', ''), '07:00'),
           -- the name and the night hours are every member's; the day is the log's business
           'day', case when public.has_permission(s.module_id, 'view') then private.subject_day(s.settings, s.birth_date) end) order by s.sort, s.name), '[]'::jsonb)
    from public.care_subjects s
   where s.is_active and s.household_id = private.current_household_id()
$$;
alter function private.subject_names() owner to app_rls;

-- ---------------------------------------------------------------------------
-- 4. home_summary: as in migration 6500, following the day
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
  v_day     jsonb;
  v_feed_clock boolean;
  v_potty   boolean;
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
  -- The family's day (migration 6800). With none, both are false and everything below is as it was.
  v_day := (select private.subject_day(s.settings, s.birth_date) from public.care_subjects s where s.id = v_subject);
  v_feed_clock := coalesce(v_day->>'milk' = 'clock', false);
  v_potty := coalesce(private.day_band((select birth_date from public.care_subjects where id = v_subject)) >= 18
                      and v_day->>'diapers' in ('both', 'potty'), false);
  return jsonb_build_object(
    'ok', true, 'today', v_today, 'timezone', v_tz,
    'subject', (select to_jsonb(s) from public.care_subjects s where s.id = v_subject),
    'custody', (select jsonb_build_object('member_id', c.member_id, 'name', m.display_name, 'since', c.since)
                from public.care_custody c left join public.members m on m.id = c.member_id
                where c.subject_id = v_subject order by c.since desc limit 1),
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]'::jsonb)
              from public.care_entry_types t where t.module_id = v_module and t.is_active
                -- a kind that needs the day to turn it on is left out until it has (migration 6800)
                and (coalesce(t.settings->>'needs', '') = '' or (t.settings->>'needs' = 'potty' and v_potty))),
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
                   -- a toddler's milk, diapers and sleep have no clock (migration 6500), but for the
                   -- milk of a family whose day keeps it on one (migration 6800)
                   'next_due', case when t.due_after_min is not null
                                         and not (v_toddler and (t.id in ('lana.diaper', 'lana.sleep') or (t.id = 'lana.feed' and not v_feed_clock)))
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
-- 5. Saving the day
-- ---------------------------------------------------------------------------
-- p_day null is "Keep it as it is": the question is settled for this age and nothing else moves.
-- Otherwise p_day holds the four answers; bedtime and morning are kept as stored when not given.
--   errors: not_found | preview | not_allowed | no_birth_date | too_young | bad_input
--           | too_young_potty | milk_in_stock | bad_time
create or replace function public.subject_day_save(
  p_subject_id uuid, p_day jsonb default null, p_night_from text default null, p_night_to text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz     text := coalesce((select h.timezone from public.household h where h.id = private.current_household_id()), 'UTC');
  -- the home's calendar day, as the text that is stored and compared
  v_today  text := to_char((now() at time zone v_tz)::date, 'YYYY-MM-DD');
  v_old    public.care_subjects;
  v_whose  text;
  v_band   integer;
  v_day    jsonb;
  v_new    jsonb;
  v_bad    constant jsonb := jsonb_build_object('ok', false, 'error', 'bad_input', 'message', 'That is not one of the answers.');
  v_hhmm   constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if private.read_only_preview() then
    return jsonb_build_object('ok', false, 'error', 'preview', 'message', 'Not while viewing the app as someone else.');
  end if;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_subjects', p_subject_id::text, jsonb_build_object('day', true));
    return private.denied();
  end if;
  -- Locked while it is read, with the lock the update takes anyway: "for update" would make every
  -- new log entry for the child wait for a save (migration 6600).
  select * into v_old from public.care_subjects where id = p_subject_id for no key update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- "Lana's", "James'": as the screen's own title has it.
  v_whose := v_old.name || case when v_old.name ~* 's$' then '''' else '''s' end;
  if not private.is_admin() then
    perform private.audit_write(v_module, 'edit', false, 'care_subjects', p_subject_id::text, jsonb_build_object('day', true));
    return private.denied('Ask ' || private.admin_names() || ' to change ' || v_whose || ' day.');
  end if;
  if v_old.birth_date is null then
    return jsonb_build_object('ok', false, 'error', 'no_birth_date', 'message', 'Add the date of birth first, on Doctor.');
  end if;
  v_band := private.day_band(v_old.birth_date);
  if v_band is null then
    return jsonb_build_object('ok', false, 'error', 'too_young', 'message', v_whose || ' day opens at 12 months.');
  end if;

  -- Keep it as it is: only the question is settled, for both parents.
  if p_day is null or jsonb_typeof(p_day) = 'null' then
    if p_night_from is not null or p_night_to is not null then return v_bad; end if;
    update public.care_subjects
       set settings = case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end || jsonb_build_object('day_asked', v_band, 'day_asked_on', v_today),
           updated_at = now()
     where id = p_subject_id;
    if not found then return private.denied(); end if;
    perform private.audit_write(v_module, 'edit', true, 'care_subjects', p_subject_id::text, jsonb_build_object('day', 'kept', 'asked', v_band));
    return jsonb_build_object('ok', true, 'asked', v_band);
  end if;

  -- The four answers, each one of its values. naps is compared as a JSON number: 1.0 is one nap,
  -- while 1.5, 3 and "1" are none of the answers, and no cast is left to raise on what was sent.
  if not coalesce(jsonb_typeof(p_day) = 'object'
                  and p_day->>'milk' in ('clock', 'drink', 'off')
                  and p_day->'naps' in ('0'::jsonb, '1'::jsonb, '2'::jsonb)
                  and p_day->>'diapers' in ('diapers', 'both', 'potty', 'off')
                  and jsonb_typeof(p_day->'stores_milk') = 'boolean', false) then
    return v_bad;
  end if;
  if p_day->>'diapers' in ('both', 'potty') then
    if v_band < 18 then
      return jsonb_build_object('ok', false, 'error', 'too_young_potty', 'message', 'Potty is offered from 18 months.');
    end if;
    -- Potty is an answer only where there is a Potty entry to log.
    if not exists (select 1 from public.care_entry_types t where t.id = v_module || '.potty' and t.is_active) then return v_bad; end if;
  end if;
  -- "No stored milk" takes the Milk tab away, so not while a bottle is in stock: not used, not
  -- binned and not past its time, the rule behind milk_list's counts.
  if not (p_day->'stores_milk')::boolean
     and exists (select 1 from public.milk_bottles b where b.used_at is null and b.deleted_at is null and private.milk_expires_at(b) >= now()) then
    return jsonb_build_object('ok', false, 'error', 'milk_in_stock', 'message', 'Use or bin the bottles on Milk first.');
  end if;
  -- care_daily_stats casts the stored times and builds the night from bedtime to the next
  -- morning, so each must be a time and the two must fall either side of midnight.
  if (p_night_from is not null and not coalesce(p_night_from ~ v_hhmm and p_night_from collate "C" between '17:00' and '23:45', false))
     or (p_night_to is not null and not coalesce(p_night_to ~ v_hhmm and p_night_to collate "C" between '04:00' and '10:00', false)) then
    return jsonb_build_object('ok', false, 'error', 'bad_time', 'message', 'Bedtime is from 17:00 to 23:45, morning from 04:00 to 10:00.');
  end if;

  v_day := jsonb_build_object(
    'v', 1, 'milk', p_day->>'milk', 'naps', (p_day->>'naps')::numeric::int, 'diapers', p_day->>'diapers',
    'stores_milk', (p_day->'stores_milk')::boolean,
    'saved_on', v_today, 'saved_at', now(), 'saved_by', public.current_member_id());
  update public.care_subjects
     set settings = case when jsonb_typeof(settings) = 'object' then settings else '{}'::jsonb end
                    || jsonb_strip_nulls(jsonb_build_object('night_from', p_night_from, 'night_to', p_night_to))
                    || jsonb_build_object('day', v_day, 'day_asked', v_band, 'day_asked_on', v_today),
         updated_at = now()
   where id = p_subject_id
  returning settings into v_new;
  if not found then return private.denied(); end if;
  perform private.audit_write(v_module, 'edit', true, 'care_subjects', p_subject_id::text,
    jsonb_strip_nulls(jsonb_build_object('day', v_day - 'saved_on' - 'saved_at' - 'saved_by', 'asked', v_band,
                                         'night_from', p_night_from, 'night_to', p_night_to)));
  return jsonb_build_object('ok', true, 'day', v_new->'day',
    'night_from', coalesce(nullif(v_new->>'night_from', ''), '19:00'),
    'night_to', coalesce(nullif(v_new->>'night_to', ''), '07:00'),
    'asked', v_band);
end $$;
revoke execute on function public.subject_day_save(uuid, jsonb, text, text) from public, anon;
grant execute on function public.subject_day_save(uuid, jsonb, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The stash's one door honours the day
-- ---------------------------------------------------------------------------
-- As in migration 1300, with the check before the insert. The child is the home's child, found
-- as home_summary finds it; with no child, or no day that counts, nothing is refused. The words
-- are the helper's own (lib/assistant/tools.ts, propose_milk_add) and each screen shows them.
create or replace function public.milk_add(p_amount_ml integer, p_location text default 'fridge', p_pumped_at timestamptz default now(), p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_child public.care_subjects;
  v_whose text;
begin
  if not private.authz('lana', 'add', 'milk_bottles') then return private.denied(); end if;
  if p_location not in ('fridge', 'freezer') then return jsonb_build_object('ok', false, 'error', 'bad_location'); end if;
  -- Read under a lock that waits for a save of the day in flight, and makes one wait for this:
  -- subject_day_save holds "for no key update" on this row from before it looks at the stash, and
  -- "for share" is the lock that conflicts with it. So of a bottle put away and "no stored milk"
  -- saved in the same instant, the second always sees the first and one of them is refused.
  -- Logging for the child does not wait on it (its foreign key takes "for key share").
  select * into v_child from public.care_subjects where id = private.default_subject('child') for share;
  if (private.subject_day(v_child.settings, v_child.birth_date)->'stores_milk') = 'false'::jsonb then
    v_whose := v_child.name || case when v_child.name ~* 's$' then '''' else '''s' end;
    return jsonb_build_object('ok', false, 'error', 'no_stored_milk',
      'message', v_whose || ' day says no milk is stored. A parent turns it on in ' || v_whose || ' day.');
  end if;
  insert into public.milk_bottles (amount_ml, pumped_at, location, note, created_by)
  values (p_amount_ml, coalesce(p_pumped_at, now()), p_location, nullif(btrim(p_note), ''), public.current_member_id())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
alter function public.milk_add(integer, text, timestamptz, text) owner to app_rls;
