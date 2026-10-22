-- Demo data for screenshots and local play: two weeks of Lana's log,
-- notes, chat, milk, calendar, vaccines. Run after the
-- migrations on a local database built by run-local.sh (needs the stub).
--   su postgres -c "psql -d family_shots -v ON_ERROR_STOP=1 -f supabase/tests/demo_data.sql"
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null
update public.members set email = 'dana@test.local'  where id = '00000000-0000-4000-8000-000000000002' and email is null;
update public.members set email = 'wafa@test.local'  where id = '00000000-0000-4000-8000-000000000003' and email is null;
update public.members set email = 'luda@test.local'  where id = '00000000-0000-4000-8000-000000000004' and email is null;
update public.members set email = 'lilly@test.local' where id = '00000000-0000-4000-8000-000000000005' and email is null;
insert into auth.users (id, email) select m.id, m.email from public.members m where m.email is not null and m.user_id is null on conflict (email) do nothing;
update public.members set photo_path = null, breastfeeds = true where id = '00000000-0000-4000-8000-000000000002';

create or replace function pg_temp.at(day date, hm text) returns timestamptz language sql as $f$ select (day + hm::time) at time zone 'Asia/Dubai' $f$;
create or replace function pg_temp.act_as(p_member uuid) returns void language plpgsql as $$
declare v_user uuid;
begin
  select user_id into v_user from public.members where id = p_member;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, false);
end $$;
\set mido  '''00000000-0000-4000-8000-000000000001'''
\set dana  '''00000000-0000-4000-8000-000000000002'''
\set wafa  '''00000000-0000-4000-8000-000000000003'''
\set lilly '''00000000-0000-4000-8000-000000000005'''
\set lana  '''00000000-0000-4000-8000-00000000a001'''

-- Lana: fourteen days, as Dana (breast) and Lilly (bottles on weekdays)
select pg_temp.act_as(:dana);
set role authenticated;
do $$
declare d int; day date; tz text := 'Asia/Dubai'; n timestamptz := now();
begin
  for d in reverse 13..0 loop
    day := (n at time zone tz)::date - d;
    -- night sleep from the evening before, split by a 1 am feed
    if pg_temp.at(day, '00:55') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.sleep', pg_temp.at(day - 1, '19:50'), pg_temp.at(day, '00:55'), '{"place":"Cot"}'); end if;
    if pg_temp.at(day, '01:00') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '01:00'), pg_temp.at(day, '01:18'), '{"method":"Breast","side":"Right","duration_min":18}'); end if;
    if pg_temp.at(day, '06:10') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.sleep', pg_temp.at(day, '01:25'), pg_temp.at(day, '06:10'), '{"place":"Cot"}'); end if;
    if pg_temp.at(day, '06:30') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '06:30'), pg_temp.at(day, '06:52'), '{"method":"Breast","side":"Left","duration_min":22}'); end if;
    if pg_temp.at(day, '07:05') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.diaper', pg_temp.at(day, '07:05'), null, '{"kind":"Both"}'); end if;
    if pg_temp.at(day, '09:40') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.sleep', pg_temp.at(day, '08:30'), pg_temp.at(day, '09:40'), '{"place":"Pram"}'); end if;
    if pg_temp.at(day, '10:10') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.diaper', pg_temp.at(day, '10:10'), null, '{"kind":"Wet"}'); end if;
    if pg_temp.at(day, '12:50') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.sleep', pg_temp.at(day, '11:35'), pg_temp.at(day, '12:50'), '{"place":"Cot"}'); end if;
    if pg_temp.at(day, '13:05') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.diaper', pg_temp.at(day, '13:05'), null, '{"kind":"Dirty"}'); end if;
    if pg_temp.at(day, '15:35') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.sleep', pg_temp.at(day, '14:30'), pg_temp.at(day, '15:35'), '{"place":"Arms"}'); end if;
    if pg_temp.at(day, '16:20') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.diaper', pg_temp.at(day, '16:20'), null, '{"kind":"Wet"}'); end if;
    if pg_temp.at(day, '18:20') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '18:20'), pg_temp.at(day, '18:45'), '{"method":"Breast","side":"Right","duration_min":25}'); end if;
    if pg_temp.at(day, '19:30') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.diaper', pg_temp.at(day, '19:30'), null, '{"kind":"Both"}'); end if;
    if pg_temp.at(day, '21:30') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '21:30'), pg_temp.at(day, '21:45'), '{"method":"Bottle","amount_ml":150,"milk":"Fridge"}'); end if;
  end loop;
end $$;
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
do $$
declare d int; day date; tz text := 'Asia/Dubai'; n timestamptz := now();
begin
  for d in reverse 13..0 loop
    day := (n at time zone tz)::date - d;
    if extract(isodow from day) <= 5 then
      if pg_temp.at(day, '09:50') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '09:50'), pg_temp.at(day, '10:05'), '{"method":"Bottle","amount_ml":120,"milk":"Fridge"}'); end if;
      if pg_temp.at(day, '13:10') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '13:10'), pg_temp.at(day, '13:25'), '{"method":"Bottle","amount_ml":130,"milk":"Fridge"}'); end if;
      if pg_temp.at(day, '16:00') < n then perform public.care_entry_log('00000000-0000-4000-8000-00000000a001', 'lana.feed', pg_temp.at(day, '16:00'), pg_temp.at(day, '16:15'), '{"method":"Bottle","amount_ml":120,"milk":"Fridge"}'); end if;
    end if;
  end loop;
end $$;
reset role;

-- Right now: a nap that started 25 minutes ago, Dana has Lana, Lilly is in
select pg_temp.act_as(:dana);
set role authenticated;
select public.care_entry_log(:lana, 'lana.sleep', now() - interval '25 minutes', null, '{"place":"Cot"}');
select public.custody_set(:lana, :dana);
select public.milk_add(120, 'fridge', now() - interval '2 hours', 'Morning pump');
select public.milk_add(150, 'fridge', now() - interval '26 hours', null);
select public.milk_add(180, 'freezer', now() - interval '9 days', null);
select public.milk_add(180, 'freezer', now() - interval '12 days', null);
select public.chat_send('Lana had a big smile at bath time 😊', null);
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select public.attendance_toggle();
select public.chat_send('Lana fed 120 ml at 9:50 and went down for a nap', null);
reset role;

-- Growth and milestones, vaccines, the doctor's card
select pg_temp.act_as(:mido);
set role authenticated;
select public.care_entry_log(:lana, 'lana.growth', timestamptz '2026-06-05 12:00+04', null, '{"weight_kg":3.38,"length_cm":52,"head_cm":36}', 'At birth, NMC Royal Hospital Abu Dhabi');
select public.care_entry_log(:lana, 'lana.growth', timestamptz '2026-07-06 10:00+04', null, '{"weight_kg":4.55,"length_cm":55.5}', null);
select public.care_entry_log(:lana, 'lana.growth', timestamptz '2026-08-06 10:00+04', null, '{"weight_kg":5.5,"length_cm":59,"head_cm":39.5}', 'Two-month visit');
select public.care_entry_log(:lana, 'lana.growth', timestamptz '2026-09-07 10:00+04', null, '{"weight_kg":6.2,"length_cm":61.5}', null);
select public.care_entry_log(:lana, 'lana.growth', timestamptz '2026-10-05 10:00+04', null, '{"weight_kg":6.75,"length_cm":63,"head_cm":41}', null);
select public.care_entry_log(:lana, 'lana.milestone', timestamptz '2026-08-20 17:00+04', null, '{"what":"First real laugh"}', null);
select public.care_entry_log(:lana, 'lana.milestone', timestamptz '2026-09-28 11:00+04', null, '{"what":"Rolled from tummy to back"}', null);
select public.care_entry_log(:lana, 'lana.appointment', timestamptz '2026-08-06 10:30+04', null, '{"clinic":"NMC Royal Hospital Abu Dhabi","reason":"2-month check and vaccines"}', 'All good. 5.5 kg.');
select public.vaccine_record(:lana, 'bcg_1', date '2026-06-06', 'NMC Royal Hospital Abu Dhabi, Dr Sameh Abdelazim', '0375MA030', 'Expiry 06/27. From the NMC card.');
select public.vaccine_record(:lana, 'hepb_1', date '2026-06-06', 'NMC Royal Hospital Abu Dhabi, Dr Sameh Abdelazim', '0325Q016C', null);
select public.vaccine_record(:lana, 'hexa_1', date '2026-08-06', 'NMC Royal Hospital Abu Dhabi, Dr Sameh Abdelazim', 'A21CE609B', 'Infanrix Hexa');
select public.vaccine_record(:lana, 'pcv_1', date '2026-08-06', 'NMC Royal Hospital Abu Dhabi, Dr Sameh Abdelazim', 'NG6862', 'Prevenar 20');
select public.vaccine_record(:lana, 'rota_1', date '2026-08-06', 'NMC Royal Hospital Abu Dhabi, Dr Sameh Abdelazim', 'AROLES24AE', 'Rotarix');
select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) || '{"doctor_questions":"Hip screening was not ticked on the card. Was it done?\nFlu jab from 6 months?"}'::jsonb, null, null);

-- Calendar and notes
select public.calendar_save(null, 'Lana: 4-month vaccines (second doses)', 'appointment', timestamptz '2026-10-15 09:00+04', timestamptz '2026-10-15 10:00+04', true, 'household', null, 'Second doses of the 2-month vaccines.');
select public.calendar_save(null, 'Dana''s parents for dinner', 'guest', (current_date + 3 + time '19:00') at time zone 'Asia/Dubai', (current_date + 3 + time '22:00') at time zone 'Asia/Dubai', false, 'household', null, null);
select public.calendar_save(null, 'Amazon delivery', 'delivery', (current_date + 1 + time '14:00') at time zone 'Asia/Dubai', null, false, 'household', '00000000-0000-4000-8000-000000000005', 'Diapers size 3');
select public.calendar_save(null, 'AC service', 'contractor', (current_date + 5 + time '10:00') at time zone 'Asia/Dubai', (current_date + 5 + time '12:00') at time zone 'Asia/Dubai', false, 'household', null, null);
select public.note_save(null, 'Bedtime routine: bath 18:45, feed, story, cot by 19:30.', false, true);
select public.note_save(null, 'Formula tin opened Monday. Finish within 4 weeks.', false, false);
select public.note_save(null, 'Call insurance about the policy expiry on Lana''s card.', true, false);
reset role;

-- Wafa's preferences
select pg_temp.act_as(:wafa);
set role authenticated;
select public.me_prefs_save('ar', true, null, false);
reset role;
\o
\echo 'Demo data loaded.'
