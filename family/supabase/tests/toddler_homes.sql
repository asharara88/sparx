-- Four homes with an older child, for screenshots and local play: a girl of 380 days, a boy of
-- 563, a girl of 746 and a boy of 1111 (about 12, 18, 24 and 36 months), each made the way sign-up
-- makes a home (household_create, as a signed-in parent) and given a normal week through
-- care_entry_log: two naps and two bottles at 12 months, one nap and no bottle at 18, one nap and
-- part-time potty at 24, no nap and no diapers at 36. Meals and snacks at every age. A sleep
-- that has begun and not ended when the file runs (tonight's night, a nap) is left running, as a
-- family with a timer has it.
--
-- Load it after the migrations, 01_test_household.sql and demo_data.sql (a home made before the
-- test household exists would become the first home, which has no helper limit):
--   su postgres -c "psql -d family_shots -v ON_ERROR_STOP=1 -f supabase/tests/toddler_homes.sql"
-- Open the app as one of the parents with the shot_as cookie set to the account id below
-- (00000000-0000-4000-8000-000000001200, ...1800, ...2400, ...3600).
-- The homes are in Asia/Dubai unless a zone is given: -v tz=Pacific/Auckland puts them where it
-- is afternoon when it is morning in the Gulf, so "today" has something in it.
-- Screenshot mode only: nothing in CI loads this file. Running it twice does nothing the second time.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?tz}
\else
\set tz 'Asia/Dubai'
\endif
select set_config('seed.tz', :'tz', false);
\o /dev/null
do $$
declare
  tz text := current_setting('seed.tz');
  n timestamptz := now();
  home record; rec record;
  subj uuid; d int; day date; r jsonb; made int; fails int;
  s timestamptz; e timestamptz;
begin
  for home in
    select * from (values
      ('00000000-0000-4000-8000-000000001200'::uuid, 12, 380,  'Noor',  'Girl', 'Sara'),
      ('00000000-0000-4000-8000-000000001800'::uuid, 18, 563,  'Adam',  'Boy',  'Layla'),
      ('00000000-0000-4000-8000-000000002400'::uuid, 24, 746,  'Maya',  'Girl', 'Omar'),
      ('00000000-0000-4000-8000-000000003600'::uuid, 36, 1111, 'Yusuf', 'Boy',  'Hana')
    ) as h(uid, age, days, child, sex, parent)
  loop
    if exists (select 1 from public.members m where m.user_id = home.uid) then
      raise notice '%: already there, left alone', home.child;
      continue;
    end if;
    insert into auth.users (id, email) values (home.uid, 'parent' || home.age || '@test.local') on conflict do nothing;
    perform set_config('request.jwt.claims', json_build_object('sub', home.uid, 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
    r := public.household_create(home.child || '''s home', tz, home.child, (n at time zone tz)::date - home.days, home.sex, home.parent);
    execute 'reset role';
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'household_create failed for %: %', home.child, r; end if;
    select sub.id into subj from public.care_subjects sub join public.members m using (household_id) where m.user_id = home.uid;
    made := 0; fails := 0;
    execute 'set role authenticated';
    -- To tomorrow: tonight's night is the first row of the day after today.
    for d in reverse 7..-1 loop
      day := (n at time zone tz)::date - d;
      for rec in
        select * from (values
          -- age, type, from (day offset, hh:mm), to (day offset, hh:mm), payload
          (12, 'lana.sleep', -1, '19:30', 0, '06:45', '{"place":"Cot"}'),
          (12, 'lana.feed', 0, '07:00', 0, '07:10', '{"method":"Bottle","milk":"Formula","amount_ml":180}'),
          (12, 'lana.diaper', 0, '07:05', null, null, '{"kind":"Wet"}'),
          (12, 'lana.meal', 0, '07:45', null, null, '{"food":"porridge and banana","amount":"Half a bowl","new_food":"No","allergen":"None"}'),
          (12, 'lana.sleep', 0, '09:45', 0, '11:00', '{"place":"Cot"}'),
          (12, 'lana.diaper', 0, '11:05', null, null, '{"kind":"Dirty"}'),
          (12, 'lana.meal', 0, '12:00', null, null, '{"food":"chicken, rice and peas","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (12, 'lana.sleep', 0, '14:30', 0, '15:45', '{"place":"Cot"}'),
          (12, 'lana.diaper', 0, '15:50', null, null, '{"kind":"Wet"}'),
          (12, 'lana.meal', 0, '16:00', null, null, '{"food":"yoghurt and berries","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (12, 'lana.meal', 0, '17:45', null, null, '{"food":"pasta with vegetables","amount":"Half a bowl","new_food":"No","allergen":"None"}'),
          (12, 'lana.feed', 0, '18:45', 0, '18:55', '{"method":"Bottle","milk":"Formula","amount_ml":200}'),
          (12, 'lana.diaper', 0, '19:15', null, null, '{"kind":"Wet"}'),
          (18, 'lana.sleep', -1, '19:45', 0, '07:00', '{"place":"Cot"}'),
          (18, 'lana.diaper', 0, '07:15', null, null, '{"kind":"Wet"}'),
          (18, 'lana.meal', 0, '07:30', null, null, '{"food":"egg on toast, milk in a cup","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (18, 'lana.meal', 0, '10:00', null, null, '{"food":"apple slices","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (18, 'lana.diaper', 0, '10:30', null, null, '{"kind":"Dirty"}'),
          (18, 'lana.meal', 0, '11:45', null, null, '{"food":"lentil soup and bread","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (18, 'lana.sleep', 0, '12:30', 0, '14:30', '{"place":"Cot"}'),
          (18, 'lana.diaper', 0, '14:45', null, null, '{"kind":"Wet"}'),
          (18, 'lana.meal', 0, '15:30', null, null, '{"food":"banana and crackers","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (18, 'lana.meal', 0, '18:00', null, null, '{"food":"fish, potato and carrots","amount":"Half a bowl","new_food":"No","allergen":"None"}'),
          (18, 'lana.diaper', 0, '19:30', null, null, '{"kind":"Wet"}'),
          (24, 'lana.sleep', -1, '20:00', 0, '07:00', '{"place":"Bed"}'),
          (24, 'lana.diaper', 0, '07:15', null, null, '{"kind":"Wet"}'),
          (24, 'lana.meal', 0, '07:30', null, null, '{"food":"cereal with milk, strawberries","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (24, 'lana.meal', 0, '10:00', null, null, '{"food":"cheese and cucumber","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (24, 'lana.meal', 0, '12:00', null, null, '{"food":"chicken and rice","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (24, 'lana.sleep', 0, '13:00', 0, '14:30', '{"place":"Bed"}'),
          (24, 'lana.diaper', 0, '14:40', null, null, '{"kind":"Wet"}'),
          (24, 'lana.meal', 0, '15:30', null, null, '{"food":"yoghurt","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (24, 'lana.meal', 0, '18:00', null, null, '{"food":"pasta and meatballs","amount":"Half a bowl","new_food":"No","allergen":"None"}'),
          (24, 'lana.diaper', 0, '19:45', null, null, '{"kind":"Wet"}'),
          (36, 'lana.sleep', -1, '19:45', 0, '07:00', '{"place":"Bed"}'),
          (36, 'lana.meal', 0, '07:30', null, null, '{"food":"toast, egg and orange juice","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (36, 'lana.meal', 0, '12:00', null, null, '{"food":"rice, chicken and salad","amount":"A full bowl","new_food":"No","allergen":"None"}'),
          (36, 'lana.meal', 0, '15:30', null, null, '{"food":"fruit and biscuits","amount":"A few spoons","new_food":"No","allergen":"None"}'),
          (36, 'lana.meal', 0, '18:00', null, null, '{"food":"soup and bread","amount":"Half a bowl","new_food":"No","allergen":"None"}')
        ) as t(a, typ, d1, t1, d2, t2, payload) where a = home.age
      loop
        s := ((day + rec.d1) + rec.t1::time) at time zone tz;
        e := case when rec.t2 is null then null else ((day + rec.d2) + rec.t2::time) at time zone tz end;
        if coalesce(e, s) < n or (rec.typ = 'lana.sleep' and s < n) then
          r := public.care_entry_log(subj, rec.typ, s, case when e < n then e end, rec.payload::jsonb);
          if coalesce((r->>'ok')::boolean, false) then made := made + 1; else fails := fails + 1; raise notice 'FAILED % % %: %', rec.typ, s, e, r; end if;
        end if;
      end loop;
    end loop;
    r := public.care_entry_log(subj, 'lana.growth', n - interval '3 days', null,
      case home.age when 12 then '{"weight_kg":9.6,"length_cm":75.5,"head_cm":45.5}' when 18 then '{"weight_kg":11.2,"length_cm":82,"head_cm":47}'
        when 24 then '{"weight_kg":12.4,"length_cm":87,"head_cm":48}' else '{"weight_kg":14.6,"length_cm":96,"head_cm":49.5}' end::jsonb);
    execute 'reset role';
    if fails > 0 then raise exception '%: % entries failed', home.child, fails; end if;
    raise notice '%: % days old, % entries', home.child, home.days, made + 1;
  end loop;
  perform set_config('request.jwt.claims', '', false);
end $$;
\o
