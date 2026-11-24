-- The day each toddler home's parent has saved, for screenshots, local play and the walk. From
-- 12 months Home's rows, the strip, the tab bar and the + menu follow "{Name}'s day" (migration
-- 6800); toddler_homes.sql alone leaves the four homes with none, as a family has it before a
-- parent saves.
--   Noor  (12 months): milk on a clock, two naps, diapers, stored milk, with one bottle put away
--   Adam  (18 months): milk not logged, one nap, diapers
--   Maya  (24 months): milk as a drink, one nap, diapers; a bottle logged at 15:00 on the last days
--   Yusuf (36 months): milk not logged, no nap, diapers not logged
-- Each day is saved by the home's parent through subject_day_save, as the screen saves it. Noor's
-- home also gains two members, joined the way the Members screen does it (the parent adds them
-- and makes each a link, the new account opens it), so every screen can be read as a parent, as a
-- carer and on the simple screen. Their accounts, for the shot_as cookie:
--   00000000-0000-4000-8000-000000001201  Mona, a family carer
--   00000000-0000-4000-8000-000000001202  Salma, a family carer on the simple screen
--
-- Load it after toddler_homes.sql:
--   su postgres -c "psql -d family_shots -v ON_ERROR_STOP=1 -f supabase/tests/toddler_days.sql"
-- Running it twice does nothing the second time. CI loads it after the suite, with demo_data.sql
-- and toddler_homes.sql, so a migration that breaks a seed fails there.
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- Who a request comes from is kept for its transaction, so each call below is one statement,
-- signed in as one account, as a request from that person's phone is.

-- The child of the home this account is in.
create or replace function pg_temp.child_of(p_account uuid) returns uuid language sql as $$
  select s.id from public.care_subjects s join public.members m on m.household_id = s.household_id
   where m.user_id = p_account and s.is_active and s.kind = 'child' order by s.sort, s.created_at limit 1
$$;

-- A parent saves the child's day; with p_bottle_ml, after putting one bottle in the fridge.
create or replace function pg_temp.save_day(p_account uuid, p_child text, p_day jsonb, p_bottle_ml integer default null) returns void language plpgsql as $$
declare v_subject uuid := pg_temp.child_of(p_account); r jsonb;
begin
  if v_subject is null then raise exception '%: no home for this account. Load toddler_homes.sql first.', p_child; end if;
  if (select settings ? 'day' from public.care_subjects where id = v_subject) then
    raise notice '%: a day is saved already, left alone', p_child;
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_account, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if p_bottle_ml is not null then
    r := public.milk_add(p_bottle_ml, 'fridge', now() - interval '2 hours', null);
    if not coalesce((r->>'ok')::boolean, false) then raise exception '%: the bottle was not put away: %', p_child, r; end if;
  end if;
  r := public.subject_day_save(v_subject, p_day);
  execute 'reset role';
  if not coalesce((r->>'ok')::boolean, false) then raise exception '%: the day was not saved: %', p_child, r; end if;
  raise notice '%: day saved: milk %, naps %, diapers %, stored milk %', p_child, r->'day'->>'milk', r->'day'->>'naps', r->'day'->>'diapers', r->'day'->>'stores_milk';
end $$;

-- A home whose milk is a drink logs it: a bottle at 15:00 (after the nap) two days back, yesterday
-- and, once it is past 15:00 there, today. So the Milk card, the milk tile and the handover's
-- feeds have something to say in one of the four homes.
create or replace function pg_temp.log_milk(p_account uuid, p_child text) returns void language plpgsql as $$
declare
  v_subject uuid := pg_temp.child_of(p_account);
  v_tz text := (select h.timezone from public.household h join public.care_subjects s on s.household_id = h.id where s.id = v_subject);
  d int; t timestamptz; r jsonb; made int := 0;
begin
  if exists (select 1 from public.care_entries e where e.subject_id = v_subject and e.type_id = 'lana.feed' and e.deleted_at is null) then
    raise notice '%: milk is logged already, left alone', p_child;
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_account, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  for d in reverse 2..0 loop
    t := ((now() at time zone v_tz)::date - d + time '15:00') at time zone v_tz;
    if t + interval '10 minutes' < now() then
      r := public.care_entry_log(v_subject, 'lana.feed', t, t + interval '10 minutes', '{"method": "Bottle", "milk": "Formula", "amount_ml": 150}'::jsonb);
      if not coalesce((r->>'ok')::boolean, false) then raise exception '%: the bottle was not logged: %', p_child, r; end if;
      made := made + 1;
    end if;
  end loop;
  execute 'reset role';
  raise notice '%: % bottles logged', p_child, made;
end $$;

-- The links made below, from the parent's call to the new account's.
create temp table if not exists links (account uuid primary key, token uuid not null);
truncate links;

-- A parent adds a member of the home and makes their link.
create or replace function pg_temp.invite(p_parent uuid, p_account uuid, p_name text, p_relationship text) returns void language plpgsql as $$
declare v_home uuid; v_member uuid; r jsonb;
begin
  select m.household_id into v_home from public.members m where m.user_id = p_parent and m.role_id = 'admin';
  if v_home is null then raise exception '%: no home for the parent. Load toddler_homes.sql first.', p_name; end if;
  if exists (select 1 from public.members m where m.user_id = p_account) then
    raise notice '%: joined already, left alone', p_name;
    return;
  end if;
  -- A row left by a run that stopped half way is used again.
  select m.id into v_member from public.members m where m.household_id = v_home and m.display_name = p_name and m.user_id is null;
  perform set_config('request.jwt.claims', json_build_object('sub', p_parent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if v_member is null then
    r := public.member_save(null, p_name, null, 'family_carer', null, p_relationship, true);
    if not coalesce((r->>'ok')::boolean, false) then raise exception '%: not added: %', p_name, r; end if;
    v_member := (r->>'id')::uuid;
  end if;
  r := public.member_invite_create(v_member);
  execute 'reset role';
  if not coalesce((r->>'ok')::boolean, false) then raise exception '%: no link: %', p_name, r; end if;
  insert into links (account, token) values (p_account, (r->>'token')::uuid);
end $$;

-- The new account opens its link, and turns the simple screen on where asked.
create or replace function pg_temp.accept(p_account uuid, p_email text, p_name text, p_simple boolean default false) returns void language plpgsql as $$
declare v_token uuid := (select token from links where account = p_account); r jsonb;
begin
  if v_token is null then return; end if;
  insert into auth.users (id, email) values (p_account, p_email) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_account, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.member_invite_accept(v_token);
  if coalesce((r->>'ok')::boolean, false) and p_simple then r := public.me_prefs_save(null, true, null, false); end if;
  execute 'reset role';
  if not coalesce((r->>'ok')::boolean, false) then raise exception '%: did not join: %', p_name, r; end if;
  raise notice '%: joined%', p_name, case when p_simple then ', on the simple screen' else '' end;
end $$;

select pg_temp.save_day('00000000-0000-4000-8000-000000001200', 'Noor',  '{"milk": "clock", "naps": 2, "diapers": "diapers", "stores_milk": true}', 150);
select pg_temp.save_day('00000000-0000-4000-8000-000000001800', 'Adam',  '{"milk": "off", "naps": 1, "diapers": "diapers", "stores_milk": false}');
select pg_temp.save_day('00000000-0000-4000-8000-000000002400', 'Maya',  '{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": false}');
select pg_temp.save_day('00000000-0000-4000-8000-000000003600', 'Yusuf', '{"milk": "off", "naps": 0, "diapers": "off", "stores_milk": false}');
select pg_temp.log_milk('00000000-0000-4000-8000-000000002400', 'Maya');

select pg_temp.invite('00000000-0000-4000-8000-000000001200', '00000000-0000-4000-8000-000000001201', 'Mona', 'Aunt');
select pg_temp.accept('00000000-0000-4000-8000-000000001201', 'carer12@test.local', 'Mona');
select pg_temp.invite('00000000-0000-4000-8000-000000001200', '00000000-0000-4000-8000-000000001202', 'Salma', 'Grandmother');
select pg_temp.accept('00000000-0000-4000-8000-000000001202', 'simple12@test.local', 'Salma', true);
\o
