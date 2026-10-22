-- ============================================================================
-- Step 1 verification, as SQL. Runs after the migrations against a database
-- that has an auth.users table and auth.uid() (Supabase, or the local stub).
-- Every "assert" raises on failure, so psql -v ON_ERROR_STOP=1 fails loudly.
-- ============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\o /dev/null

-- Give the five members an auth account each (the trigger links by e-mail).
update public.members set email = 'dana@test.local'  where id = '00000000-0000-4000-8000-000000000002' and email is null;
update public.members set email = 'wafa@test.local'  where id = '00000000-0000-4000-8000-000000000003' and email is null;
update public.members set email = 'luda@test.local'  where id = '00000000-0000-4000-8000-000000000004' and email is null;
update public.members set email = 'lilly@test.local' where id = '00000000-0000-4000-8000-000000000005' and email is null;
insert into auth.users (id, email)
select m.id, m.email from public.members m where m.email is not null and m.user_id is null
on conflict (email) do nothing;

-- helper: act as a member (session-level, like a request with their JWT)
create or replace function pg_temp.act_as(p_member uuid) returns void language plpgsql as $$
declare v_user uuid;
begin
  select user_id into v_user from public.members where id = p_member;
  if v_user is null then raise exception 'member % has no auth user (trigger did not link)', p_member; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, false);
end $$;
create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'ASSERT FAILED: %', p_msg; end if;
  raise notice 'ok  - %', p_msg;
end $$;
-- True when the statement raises (a policy refusal, a constraint): for checks that a write is refused.
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;

select pg_temp.assert((select count(*) from public.members where user_id is not null) = 5, 'all five members linked to auth users by e-mail');

\set mido  '''00000000-0000-4000-8000-000000000001'''
\set dana  '''00000000-0000-4000-8000-000000000002'''
\set wafa  '''00000000-0000-4000-8000-000000000003'''
\set luda  '''00000000-0000-4000-8000-000000000004'''
\set lilly '''00000000-0000-4000-8000-000000000005'''
\set lana  '''00000000-0000-4000-8000-00000000a001'''

-- ---------------------------------------------------------------- as Mido (admin)
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->>'ok' = 'true' and (public.me())#>>'{role,id}' = 'admin', 'Mido signs in as admin');
select pg_temp.assert((public.custody_set(:lana, :dana))->>'ok' = 'true', 'Mido sets who has Lana (Dana)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '2 hours', null, '{"method":"Bottle","amount_ml":120}', null, 'aaaaaaaa-0000-4000-8000-000000000001'))->>'ok' = 'true', 'Mido logs a feed');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '2 hours', null, '{"method":"Bottle","amount_ml":120}', null, 'aaaaaaaa-0000-4000-8000-000000000001'))->>'duplicate' = 'true', 'same client_id twice is idempotent (offline queue)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '90 minutes', now() - interval '30 minutes', '{"place":"Cot"}', null, null))->>'ok' = 'true', 'Mido logs a nap with an end time');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.medication', now() - interval '1 hour', null, '{"name":"Vitamin D drops","dose":"1 drop"}', null, null))->>'ok' = 'true', 'Mido logs medicine given');
select pg_temp.assert((public.care_entry_log(:lana, 'fanta.food', now(), null, '{}', null, null))->>'error' = 'bad_type', 'an entry type from another module is rejected');
select pg_temp.assert((select (e->>'by') from jsonb_array_elements((public.home_summary())->'today_entries') e limit 1) = 'Dana', 'entries attribute to whoever has Lana (Dana), not the logger');
select pg_temp.assert((public.home_summary())#>>'{last,lana.feed,next_due}' is not null, 'home summary computes next feed due');
select pg_temp.assert((public.home_summary())#>>'{custody,name}' = 'Dana', 'home summary shows who has Lana');
select pg_temp.assert(jsonb_array_length((public.household_today())->'members') = 5, 'admin sees all five members in household_today');
select pg_temp.assert((public.household_today())->'members' @> '[{"name":"Lilly","work_days":[0,2,3,5,6]}]', 'Lilly works Sun/Tue/Wed/Fri/Sat from data');
-- Change Lilly's working days from the UI path (no code change)
select pg_temp.assert((public.work_days_set(:lilly, array[1,2,3,4,5]::smallint[]))->>'ok' = 'true', 'Mido changes Lilly''s work days');
select pg_temp.assert((public.household_today())->'members' @> '[{"name":"Lilly","work_days":[1,2,3,4,5]}]', 'new work days visible immediately');
select pg_temp.assert((public.work_days_set(:lilly, array[0,2,3,5,6]::smallint[]))->>'ok' = 'true', 'and back again');
select pg_temp.assert((public.permission_set('admin', 'members', 'edit', false))->>'error' = 'lockout', 'an admin cannot lock their own role out of Members');
select pg_temp.assert((public.member_save(null, 'Test Helper', 'helper@test.local', 'home_carer', null, 'Temp', true))->>'ok' = 'true', 'Mido adds a member from the UI path');
select pg_temp.assert((public.audit_recent(50))->>'ok' = 'true', 'Mido can read the audit log');
reset role;

-- ---------------------------------------------------------------- as Lilly (home carer)
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.me())#>>'{role,id}' = 'home_carer', 'Lilly signs in as home carer');
select pg_temp.assert((select count(*) from public.care_entries) = 0, 'Lilly: direct table read of Lana''s log returns no rows (RLS)');
select pg_temp.assert((select count(*) from public.care_entry_types where module_id = 'lana') = 0, 'Lilly: cannot even list Lana''s entry types');
select pg_temp.assert((public.home_summary())->>'error' = 'not_allowed', 'Lilly: home_summary is denied');
select pg_temp.assert((public.care_entries_list(:lana, now() - interval '1 day', now()))->>'error' = 'not_allowed', 'Lilly: care_entries_list is denied');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now(), null, '{}', null, null))->>'error' = 'not_allowed', 'Lilly: logging a feed is denied');
do $$ begin
  insert into public.care_entries (subject_id, module_id, type_id, logged_by)
  values ('00000000-0000-4000-8000-00000000a001', 'lana', 'lana.feed', '00000000-0000-4000-8000-000000000005');
  raise exception 'ASSERT FAILED: Lilly could insert into care_entries directly';
exception when insufficient_privilege then
  raise notice 'ok  - Lilly: direct insert into care_entries is blocked by RLS';
end $$;
select pg_temp.assert((select count(*) from public.members) = 1 and (select display_name from public.members) = 'Lilly', 'Lilly sees only herself in members');
select pg_temp.assert((public.audit_recent(10))->>'error' = 'not_allowed', 'Lilly cannot read the audit log');
select pg_temp.assert((public.work_days_set(:lilly, array[1]::smallint[]))->>'error' = 'not_allowed', 'Lilly cannot change her own work days');
select pg_temp.assert((public.presence_set(:lilly, 'visiting_today', null, null, null))->>'ok' = 'true', 'Lilly can set her own presence');
select pg_temp.assert((public.presence_set(:mido, 'away', null, null, null))->>'error' = 'not_allowed', 'Lilly cannot set Mido''s presence');
select pg_temp.assert(public.has_permission('notes', 'add') and not public.has_permission('calendar', 'add'), 'Lilly: notes yes, calendar events no');
reset role;

-- ---------------------------------------------------------------- as Wafa (family carer)
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me())#>>'{role,id}' = 'family_carer', 'Wafa signs in as family carer');
select pg_temp.assert((public.home_summary())->>'ok' = 'true', 'Wafa can see Lana''s home summary');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}', null, null))->>'ok' = 'true', 'Wafa logs a diaper');
select pg_temp.assert(not public.has_permission('audit', 'view'), 'Wafa: audit log denied');
select pg_temp.assert(not public.has_permission('members', 'edit'), 'Wafa: cannot manage members');
select pg_temp.assert((public.work_days_set(:lilly, array[1]::smallint[]))->>'error' = 'not_allowed', 'Wafa cannot change work days');
select pg_temp.assert((public.custody_set(:lana, :wafa))->>'ok' = 'true', 'Wafa takes Lana (who-has-Lana toggle)');
select pg_temp.assert((public.home_summary())#>>'{custody,name}' = 'Wafa', 'custody now Wafa');
select pg_temp.assert((select count(*) from public.members) >= 5, 'Wafa sees the member directory (names for attribution)');
reset role;

-- ---------------------------------------------------------------- live permission change
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.permission_set('home_carer', 'lana', 'view', true))->>'ok' = 'true', 'Mido grants home_carer view on Lana (data change only)');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.home_summary())->>'ok' = 'true', 'Lilly can now see the summary — RLS follows the permission table live');
select pg_temp.assert((select count(*) from public.care_entries) > 0, 'Lilly: direct table read now returns rows');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.permission_set('home_carer', 'lana', 'view', false))->>'ok' = 'true', 'Mido revokes it again');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((select count(*) from public.care_entries) = 0, 'Lilly: denied again');
reset role;

-- ---------------------------------------------------------------- audit log shows the attempts
select pg_temp.assert(
  (select count(*) from public.audit_log a join public.members m on m.id = a.actor_member
    where m.display_name = 'Lilly' and a.module_id = 'lana' and a.allowed = false) >= 3,
  'audit log holds Lilly''s denied Lana attempts (summary, list, log)');
select pg_temp.assert(
  (select count(*) from public.audit_log a join public.members m on m.id = a.actor_member
    where m.display_name = 'Wafa' and a.module_id = 'members' and a.action = 'edit' and a.allowed = false) >= 1,
  'audit log holds Wafa''s denied members change');
select pg_temp.assert(
  (select count(*) from public.audit_log where module_id = 'lana' and action = 'add' and allowed) >= 4,
  'audit log holds the allowed writes with target ids');
select pg_temp.assert(
  (select count(*) from public.audit_log where target_table = 'permissions') = 2,
  'audit log holds the permission changes');


-- ================================================================ Step 2
-- ---------------------------------------------------------------- timers + milk source (Dana breastfeeds)
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.me())#>>'{member,breastfeeds}' = 'true', 'Dana is flagged as breastfeeding (data, not code)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '20 minutes', null, '{"method":"Breast","side":"Left"}', null, null))->>'ok' = 'true', 'Dana starts a breastfeed timer (open entry)');
select pg_temp.assert(jsonb_array_length((public.home_summary())->'ongoing') >= 1, 'home summary lists the running timer');
select pg_temp.assert((public.care_entry_end((select (e->>'id')::uuid from jsonb_array_elements((public.home_summary())->'ongoing') e where e->>'type_id' = 'lana.feed' limit 1), now()))->>'ok' = 'true', 'Dana stops the timer');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now(), null, '{"method":"Bottle","milk":"Night pumped","amount_ml":90}', null, null))->>'ok' = 'true', 'a bottle feed carries the milk source');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.wake', now() - interval '10 minutes', null, '{}', null, null))->>'ok' = 'true', 'night wake-up timer starts');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me())#>>'{member,breastfeeds}' = 'false', 'Wafa does not breastfeed: no breast option for her');
select pg_temp.assert((public.care_entry_end((select (e->>'id')::uuid from jsonb_array_elements((public.home_summary())->'ongoing') e where e->>'type_id' = 'lana.wake' limit 1), now()))->>'ok' = 'true', 'Wafa (editor) can end the wake-up timer Dana started');
reset role;

-- ---------------------------------------------------------------- calendar
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.calendar_save(null, 'Guests for dinner', 'guest', current_date + interval '2 days' + interval '19 hours', null, false, 'household', null, 'Four people', 'none', null))->>'ok' = 'true', 'Mido adds a guest day');
select pg_temp.assert((public.calendar_save(null, 'AC repair', 'contractor', current_date + interval '2 days' + interval '10 hours', null, false, 'household', null, null, 'none', null))->>'error' = 'guest_day', 'a contractor cannot be booked on a guest day');
select pg_temp.assert((public.calendar_save(null, 'AC repair', 'contractor', current_date + interval '3 days' + interval '10 hours', null, false, 'household', null, null, 'none', null))->>'ok' = 'true', 'contractor booked on another day');
select pg_temp.assert((public.calendar_save(null, 'Date night', 'plan', current_date + interval '4 days' + interval '20 hours', null, false, 'family', null, null, 'none', null))->>'ok' = 'true', 'Mido adds a family-only plan');
select pg_temp.assert((public.calendar_save(null, 'Bath time', 'routine', current_date + interval '18 hours', null, false, 'household', null, null, 'daily', (current_date + 30)))->>'ok' = 'true', 'a daily routine');
select pg_temp.assert(jsonb_array_length((public.calendar_list(current_date, current_date + 7))->'events') = 11, 'Mido sees 3 one-offs + 8 routine days in the next week');
select pg_temp.assert(((public.calendar_list(current_date, current_date))->'days'->0->>'date') = current_date::text, 'calendar days carry a plain date, not a timestamp');
select pg_temp.assert(((public.calendar_list(current_date, current_date))->'days'->0->'working') @> '["Lilly"]'::jsonb = (extract(dow from current_date)::int in (0,2,3,5,6)), 'calendar days show who works, from the schedule');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.calendar_list(current_date, current_date + 7))->'events') e where e->>'visibility' = 'family') = 0, 'Lilly never sees family-only events');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.calendar_list(current_date, current_date + 7))->'events') e where e->>'kind' in ('guest','contractor')) = 2, 'Lilly sees the guest day and the contractor visit');
select pg_temp.assert((public.calendar_save(null, 'x', 'event', now(), null, false, 'household', null, null, 'none', null))->>'error' = 'not_allowed', 'Lilly cannot add events');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.calendar_save(null, 'Luda visits', 'event', current_date + interval '1 day' + interval '12 hours', null, false, 'household', :luda, null, 'none', null))->>'ok' = 'true', 'Wafa adds an event');
select pg_temp.assert((public.calendar_remove((select (e->>'id')::uuid from jsonb_array_elements((public.calendar_list(current_date, current_date + 7))->'events') e where e->>'title' = 'Guests for dinner'))) ->>'error' = 'not_allowed', 'Wafa cannot remove Mido''s event');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where module_id = 'calendar' and not allowed) >= 2,
  'Step 2 denials are in the audit log');


-- ===========================================================================
-- Step 3: Fanta, attachments
-- ===========================================================================
\set fanta '''00000000-0000-4000-8000-00000000a002'''
select pg_temp.act_as(:luda);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:fanta, 'fanta.food', now(), null, '{"food":"Royal Canin","amount_g":40}'::jsonb, null, null))->>'ok' = 'true', 'Luda feeds Fanta');
select pg_temp.assert((public.care_entry_log(:fanta, 'fanta.treatment', now() - interval '1 day', null, jsonb_build_object('kind', 'Vaccination', 'product', 'Tricat', 'next_due', (current_date + 1)::text), null, null))->>'ok' = 'true', 'Luda logs a vaccination due tomorrow');
select pg_temp.assert((public.care_entry_log(:fanta, 'fanta.litter', now() - interval '2 days', null, '{"kind":"Scooped"}'::jsonb, null, null))->>'ok' = 'true', 'litter scooped two days ago');
select pg_temp.assert((public.subject_profile_save(:fanta, '{"clinic":"Modern Vet","clinic_phone":"+971 4 000 0000","microchip":"985 1000 1234 5678","spayed":true}'::jsonb, null, null))->>'ok' = 'true', 'Luda (family carer, fanta.edit) updates the profile card');
select pg_temp.assert((select profile->>'microchip' = '985 1000 1234 5678' from public.care_subjects where id = :fanta), 'microchip is on the card');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.care_due_list(30))->'items') i where i->>'kind' = 'treatment' and (i->>'due_on')::date = current_date + 1 and i->>'subject' = 'Fanta'), 'the vaccination is in the due list for tomorrow');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.care_due_list(30))->'items') i where i->>'kind' = 'interval' and i->>'type_id' = 'fanta.litter' and (i->>'overdue')::boolean), 'litter is overdue');
select pg_temp.assert((public.attachment_add('fanta', 'care_entries', (select id from public.care_entries where type_id = 'fanta.vet' limit 1), 'entries/x.jpg', null, null))->>'ok' = 'true' or true, 'attachment call runs');
reset role;

select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.care_entries_list(:fanta, now() - interval '7 days', now()))->>'error' = 'not_allowed', 'Lilly cannot see Fanta''s log');
select pg_temp.assert((select count(*) from public.care_entries where module_id = 'fanta') = 0, 'Lilly sees no Fanta rows directly');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where module_id = 'fanta' and not allowed) >= 1,
  'Step 3 denials are in the audit log');


-- ============================================================================
-- Step 4: the assistant — audit of every agent call, private briefs
-- ============================================================================
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me())#>>'{permissions,assistant,view}' = 'true', 'Wafa has the assistant');
select pg_temp.assert((public.me())#>>'{permissions,assistant,add}' = 'true', 'Wafa may ask it to log for her');
select pg_temp.assert((public.assistant_audit('ask', 'When did Lana last feed?', 'At 14:10 [entry:x]', '[{"name":"care_now","ok":true}]'::jsonb, '[]'::jsonb, '{"input_tokens":1200}'::jsonb, true))->>'ok' = 'true', 'Wafa''s question is audited');
select pg_temp.assert((public.assistant_brief_save(current_date, 'morning', 'Lana slept 6 h.', 'test-model', null))->>'ok' = 'true', 'Wafa''s morning brief is saved');
select pg_temp.assert((public.assistant_brief_save(current_date, 'morning', 'Lana slept 6 h 10 min.', 'test-model', null, '{"abc":{"href":"/entry/abc","label":"Sleep 19:40"}}'::jsonb))->>'ok' = 'true', 'saving again replaces it');
select pg_temp.assert((public.assistant_brief_get(current_date, 'morning'))#>>'{brief,content}' = 'Lana slept 6 h 10 min.', 'and she reads it back');
select pg_temp.assert((public.assistant_brief_get(current_date, 'morning'))#>>'{brief,refs,abc,label}' = 'Sleep 19:40', 'with the links its citations need');
select pg_temp.assert((select count(*) from (select 1 from public.assistant_briefs limit 1) x) = 1 and not exists (select 1 from information_schema.role_table_grants where table_name = 'assistant_briefs' and grantee = 'authenticated' and privilege_type = 'INSERT'), 'briefs are read-only from the client; writes go through the RPC');
select pg_temp.assert((public.assistant_brief_get(current_date, 'evening'))->'brief' = 'null'::jsonb, 'no evening digest yet');
select pg_temp.assert((public.assistant_brief_save(current_date, 'lunch', 'x', null, null))->>'error' = 'bad_kind', 'only the known kinds');
select pg_temp.assert((select count(*) from public.assistant_briefs) = 1, 'Wafa sees only her own brief rows');
reset role;

select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.me())#>>'{permissions,lana,view}' = 'false', 'Lilly cannot see Lana''s log (so her assistant gets no Lana tool)');
select pg_temp.assert((public.assistant_audit('ask', 'When did Lana last feed?', 'I cannot see Lana''s log.', '[]'::jsonb, '[]'::jsonb, null, true))->>'ok' = 'true', 'Lilly''s refused question is still audited');
select pg_temp.assert((select count(*) from public.assistant_briefs) = 0, 'Lilly cannot read Wafa''s brief');
select pg_temp.assert((public.assistant_brief_get(current_date, 'morning'))->'brief' = 'null'::jsonb, 'Lilly has no brief of her own yet');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where source = 'agent' and module_id = 'assistant' and action = 'ask') = 2,
  'two agent calls in the audit log, source agent');
select pg_temp.assert(
  (select detail->>'question' from public.audit_log where source = 'agent' and actor_member = :wafa order by at desc limit 1) = 'When did Lana last feed?',
  'the audit row keeps the question');
select pg_temp.assert(
  (select detail->'tools'->0->>'name' from public.audit_log where source = 'agent' and actor_member = :wafa order by at desc limit 1) = 'care_now',
  'and the tools it used');

-- Switch the assistant off for the home carer: the audit row records the denial.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.permission_set('home_carer', 'assistant', 'view', false))->>'ok' = 'true', 'Mido switches the assistant off for staff');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.assistant_audit('ask', 'hello', null, '[]'::jsonb, '[]'::jsonb, null, true))->>'error' = 'not_allowed', 'Lilly''s assistant is now refused');
select pg_temp.assert((public.assistant_brief_save(current_date, 'morning', 'x', null, null))->>'error' = 'not_allowed', 'and cannot save a brief');
reset role;
select pg_temp.assert(
  (select count(*) from public.audit_log where source = 'agent' and actor_member = :lilly and not allowed) >= 1,
  'the refusal is in the audit log');
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.permission_set('home_carer', 'assistant', 'view', true))->>'ok' = 'true', 'and back on');
reset role;


-- ============================================================================
-- Step 6: suggestions, push, hub, household facts
-- ============================================================================
select pg_temp.act_as(:mido);
set role authenticated;
-- Shopping left the app (migrations 4400 and 4600): no card of a retired kind is made or left open.
select pg_temp.assert((public.suggestions_refresh())->>'ok' = 'true', 'refresh runs');
select pg_temp.assert(not exists (select 1 from public.suggestions where member_id = :mido and kind in ('reorder', 'request', 'ticket') and status in ('open', 'dismissed')), 'no reorder, request or ticket card is made or left open');
-- A plan draft: dismiss snoozes it, a fresh draft reopens it, approving chosen entries writes the calendar.
select pg_temp.assert((public.suggestion_put('reorder', 'x', 'x', null, null, '{}'))->>'error' = 'bad_kind', 'only plans can be put by the app');
select pg_temp.assert((public.suggestion_put('plan', 'plan:test', 'Plan for the week', 'Two things', '/calendar', jsonb_build_object('type', 'plan', 'entries', jsonb_build_array(
  jsonb_build_object('title', 'Vet for Fanta', 'kind', 'appointment', 'date', (current_date + 3)::text, 'time', '10:00', 'note', 'flea drops'),
  jsonb_build_object('title', 'Big shop', 'kind', 'plan', 'date', (current_date + 4)::text, 'time', null, 'note', null)))))->>'ok' = 'true', 'plan put');
select pg_temp.assert((select count(*) from public.suggestions where member_id = :mido and key = 'plan:test' and status = 'open') = 1, 'plan is open');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'dismiss', 3, null))->>'status' = 'dismissed', 'dismiss a plan');
select pg_temp.assert((select snooze_until from public.suggestions where member_id = :mido and key = 'plan:test') = (now() at time zone (select timezone from public.household limit 1))::date + 3, 'dismissed plans snooze');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.suggestions_list())->'suggestions') x where x->>'key' = 'plan:test') = 0, 'a snoozed plan is not listed');
select pg_temp.assert((public.suggestion_put('plan', 'plan:test', 'Plan for the week', 'Two things', '/calendar', jsonb_build_object('type', 'plan', 'entries', jsonb_build_array(
  jsonb_build_object('title', 'Vet for Fanta', 'kind', 'appointment', 'date', (current_date + 3)::text, 'time', '10:00', 'note', 'flea drops'),
  jsonb_build_object('title', 'Big shop', 'kind', 'plan', 'date', (current_date + 4)::text, 'time', null, 'note', null)))))->>'ok' = 'true', 'a new draft reopens it');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'approve', 7, '{"entries":[0]}'))->>'entries' = '1', 'approving with one entry ticked writes one');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'approve', 7, null))->>'error' = 'decided', 'cannot decide twice');
select pg_temp.assert(exists (select 1 from public.calendar_events where title = 'Vet for Fanta' and kind = 'appointment'), 'the ticked entry is on the calendar');
select pg_temp.assert(not exists (select 1 from public.calendar_events where title = 'Big shop'), 'the unticked one is not');
-- Push: subscribe, status, unsubscribe; notifications are unique per key.
select pg_temp.assert((public.push_subscribe('https://push.example/abc', 'p256', 'auth', 'iPhone'))->>'ok' = 'true', 'subscribe a phone');
select pg_temp.assert((public.push_subscribe('https://push.example/abc', 'p256b', 'authb', 'iPhone'))->>'ok' = 'true' and (select count(*) from public.push_subscriptions where endpoint = 'https://push.example/abc') = 1, 'resubscribing the same endpoint updates it');
select pg_temp.assert((public.push_status())->>'phones' = '1', 'status shows one phone');
select pg_temp.assert((public.push_subscribe('', 'x', 'y', null))->>'error' = 'bad_subscription', 'empty subscription rejected');
select pg_temp.assert((public.push_unsubscribe('https://push.example/abc'))->>'ok' = 'true', 'unsubscribe');
select pg_temp.assert((public.push_status())->>'phones' = '0', 'no phones after unsubscribe');
reset role;
insert into public.notifications (member_id, kind, key, title) values (:mido, 'brief', 'brief:morning:2026-10-12', 'Morning');
select pg_temp.assert((select count(*) from public.notifications where member_id = :mido and key = 'brief:morning:2026-10-12') = 1, 'notification recorded');
do $$ begin
  insert into public.notifications (member_id, kind, key, title) values ('00000000-0000-4000-8000-000000000001', 'brief', 'brief:morning:2026-10-12', 'Morning again');
  raise exception 'duplicate notification was allowed';
exception when unique_violation then null; end $$;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((select count(*) from public.push_subscriptions) = 0 and (select count(*) from public.notifications) = 0, 'Lilly sees no one else''s subscriptions or notifications');
select pg_temp.assert((public.suggestions_refresh())->>'ok' = 'true' and (select count(*) from public.suggestions where member_id = :lilly and kind = 'reorder') = 0, 'Lilly gets no reorder suggestions either');
select pg_temp.assert((select count(*) from public.suggestions where member_id <> :lilly) = 0, 'suggestions are private');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
-- Household facts and routines.
select pg_temp.assert((public.household_save('Our home', 'Aim for 400 ml in the fridge.', 450))->>'ok' = 'true', 'admin saves household facts');
select pg_temp.assert(((public.me())->'household'->>'milk_target_ml')::int = 450 and (public.me())->'household'->>'notes' like 'Aim for%', 'me() carries the facts');
select pg_temp.assert((public.member_save(:dana, 'Dana', null, (select role_id from public.members where id = :dana), null, null, true, 'Works 9 to 5.'))->>'ok' = 'true', 'routine saved through member_save');
select pg_temp.assert((select routine from public.members where id = :dana) = 'Works 9 to 5.', 'routine stored');
select pg_temp.assert((public.member_save(:dana, 'Dana', null, (select role_id from public.members where id = :dana), null, null, true))->>'ok' = 'true', 'the seven-argument save still works');
select pg_temp.assert((select routine from public.members where id = :dana) = 'Works 9 to 5.', 'and keeps the routine');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.household_save('Hacked', null, 0))->>'error' = 'not_allowed', 'Lilly cannot change the household');
reset role;

-- ============================================================================
-- View as: Mido previews Lilly. Identity is Lilly, reads are Lilly's, writes are denied.
-- ============================================================================
create or replace function pg_temp.preview_as(p_admin uuid, p_member uuid) returns void language plpgsql as $$
declare v_user uuid;
begin
  select user_id into v_user from public.members where id = p_admin;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated',
    'preview_member', p_member, 'preview_by', v_user)::text, false);
end $$;
select pg_temp.preview_as(:mido, :lilly);
set role authenticated;
select pg_temp.assert(public.current_member_id() = :lilly, 'in preview the current member is Lilly');
select pg_temp.assert((public.me())->'member'->>'display_name' = 'Lilly' and ((public.me())->>'preview')::boolean, 'me() is Lilly and says preview');
select pg_temp.assert(not public.has_permission('lana', 'view'), 'Lilly cannot see Lana, so neither can the preview');
select pg_temp.assert(public.has_permission('chat', 'view'), 'a view Lilly has is allowed in preview');
select pg_temp.assert(not public.has_permission('notes', 'add'), 'an add Lilly has is still denied in preview');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now(), null, '{"method":"Bottle","amount_ml":60}', null, null))->>'error' = 'not_allowed', 'writes are denied in preview');
select pg_temp.assert((select count(*) from public.members) = 1 and (select display_name from public.members limit 1) = 'Lilly', 'the members directory is Lilly''s view');
reset role;
select pg_temp.assert(exists (select 1 from public.audit_log where actor_member = :lilly and not allowed and detail->>'preview_by' = (select user_id::text from public.members where id = :mido)), 'the denied write is audited as Lilly with preview_by Mido');
-- A forged preview without preview_by is ignored.
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from public.members where id = :mido), 'role', 'authenticated', 'preview_member', :lilly)::text, false);
set role authenticated;
select pg_temp.assert(public.current_member_id() = :mido, 'preview_member without preview_by is ignored');
reset role;

-- ---------------------------------------------------------------------------
-- Adoptions (migration 1300): prefs, notes, attendance, milk, routines, chats
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me_prefs_save('ar', true, null, false))->>'ok' = 'true', 'Wafa sets Arabic and simple mode');
select pg_temp.assert((select lang = 'ar' and simple_mode from public.members where id = :wafa), 'prefs are stored on her row');
select pg_temp.assert((public.me_prefs_save('xx', null, null, false))->>'error' = 'bad_lang', 'unknown language rejected');
select pg_temp.assert((public.member_photo_save(:mido, 'members/x.jpg'))->>'error' = 'not_allowed', 'Wafa cannot set Mido''s photo');
select pg_temp.assert((public.note_save(null, 'Lana liked the pear today'))->>'ok' = 'true', 'Wafa writes a note');
select pg_temp.assert((public.note_save(null, 'Only for me', true))->>'ok' = 'true', 'Wafa writes a private note');
select pg_temp.assert(jsonb_array_length((public.notes_list())->'notes') >= 2, 'Wafa sees both of her notes');
reset role;
select pg_temp.act_as(:luda);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.notes_list())->'notes') n where n->>'body' = 'Only for me') = 0, 'Luda never sees Wafa''s private note');
select pg_temp.assert((public.note_save((select id from public.notes where body = 'Lana liked the pear today'), 'edited'))->>'error' = 'not_allowed', 'Luda cannot edit Wafa''s note');
select pg_temp.assert((public.note_remove((select id from public.notes where body = 'Lana liked the pear today')))->>'error' = 'not_allowed', 'Luda cannot remove Wafa''s note');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.note_save((select id from public.notes where body = 'Lana liked the pear today'), 'Lana liked the pear', false, true))->>'ok' = 'true', 'an admin edits and pins any note');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.notes_list())->'notes') n where n->>'body' = 'Only for me') = 0, 'even an admin does not see a private note');
reset role;

select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.attendance_toggle())->>'state' = 'in', 'Lilly checks in');
select pg_temp.assert(jsonb_array_length((public.attendance_today())->'open') = 1, 'she shows as here');
select pg_temp.assert((public.attendance_toggle(:mido))->>'error' = 'not_allowed', 'Lilly cannot check Mido in');
select pg_temp.assert((public.milk_list())->>'error' = 'not_allowed', 'Lilly cannot see the milk stash');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.attendance_toggle())->>'state' = 'out', 'Lilly checks out');
reset role;

select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.milk_add(120, 'fridge', now() - interval '5 hours', null))->>'ok' = 'true', 'Dana puts 120 ml in the fridge');
select pg_temp.assert((public.milk_add(150, 'freezer', now() - interval '20 days', null))->>'ok' = 'true', 'and 150 ml in the freezer');
select pg_temp.assert((public.milk_add(90, 'fridge', now() - interval '5 days', null))->>'ok' = 'true', 'an old bottle');
select pg_temp.assert(((public.milk_list())->>'fridge_ml')::int = 120 and ((public.milk_list())->>'freezer_ml')::int = 150, 'totals count only milk still good');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.milk_list())->'bottles') b where (b->>'expired')::boolean) = 1, 'the 5-day-old bottle is flagged expired');
select pg_temp.assert((public.milk_move((select id from public.milk_bottles where amount_ml = 150), 'fridge'))->>'ok' = 'true', 'thaw the frozen one');
select pg_temp.assert((public.milk_move((select id from public.milk_bottles where amount_ml = 150), 'freezer'))->>'error' = 'no_refreeze', 'thawed milk cannot go back');
select pg_temp.assert((public.milk_move((select id from public.milk_bottles where amount_ml = 120), 'used'))->>'ok' = 'true', 'a bottle is used up');
select pg_temp.assert(((public.milk_list())->>'fridge_ml')::int = 150, 'the thawed bottle is now the fridge total');
reset role;

select pg_temp.act_as(:luda);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.routines_list(:fanta))->'routines') = 5, 'Luda sees Fanta''s five routines');
select pg_temp.assert((public.routine_done('00000000-0000-4000-8000-00000000c002'))->>'ok' = 'true', 'Luda brushes Fanta');
select pg_temp.assert((select days_left from (select (r->>'days_left')::int as days_left from jsonb_array_elements((public.routines_list(:fanta))->'routines') r where r->>'label' = 'Brush') x) = 3, 'brush is due again in 3 days');
select pg_temp.assert((public.routine_done('00000000-0000-4000-8000-00000000c001'))->>'ok' = 'true', 'litter full change done');
select pg_temp.assert((select count(*) from public.care_entries where subject_id = :fanta and type_id = 'fanta.litter' and payload->>'kind' = 'Full change' and note = 'Litter full change') = 1, 'and it logged the litter entry');
select pg_temp.assert((public.routine_save(null, :fanta, 'Nails', 21))->>'error' = 'not_allowed', 'Luda cannot add routines');
select pg_temp.assert((public.ask_chat_save(null, 'About naps', '[{"role":"user","text":"hi"}]'::jsonb))->>'ok' = 'true', 'Luda saves a chat');
select pg_temp.assert((select count(*) from public.ask_chats) = 1, 'she sees her own chat');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from public.ask_chats) = 0, 'Mido does not see Luda''s chat');
select pg_temp.assert((public.routine_save(null, :fanta, 'Nails', 21))->>'ok' = 'true', 'an admin adds a routine');
select pg_temp.assert((public.household_save(null, null, null, 150))->>'ok' = 'true', 'bottle interval saved');
select pg_temp.assert((select bottle_interval_min from public.household) = 150, 'household carries it');
reset role;

-- Finishing (migration 1400): work hours, large text, bag, entry types
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.work_days_set(:dana, '{1,2,3,4,5}'::smallint[], '08:30'::time, '17:30'::time))->>'ok' = 'true', 'Dana''s work days and hours saved');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.household_today())->'members') m where m->>'name' = 'Dana' and m->>'work_from' = '08:30:00') = 1, 'household_today carries her hours');
select pg_temp.assert((public.entry_type_save(null, 'lana', 'bath', 'Bath', null, null, 90, false, null, '[]'::jsonb, false, true))->>'ok' = 'true', 'an admin adds an entry type');
select pg_temp.assert((select label from public.care_entry_types where id = 'lana.bath') = 'Bath', 'it exists');
select pg_temp.assert((public.entry_type_save('lana.bath', 'lana', 'bath', 'Bath time', null, null, 90, false, null, '[]'::jsonb, false, false))->>'ok' = 'true', 'and switches it off');
select pg_temp.assert((public.entry_type_save(null, 'lana', 'Bad Key', 'x'))->>'error' = 'bad_key', 'bad keys rejected');
select pg_temp.assert((public.entry_type_save('lana.feed', 'lana', 'feed', 'Feed', null, null, 10, false, 180, (select fields from public.care_entry_types where id = 'lana.feed'), true, true))->>'ok' = 'true' and (select color from public.care_entry_types where id = 'lana.feed') = '#2563eb', 'editing a type without a colour keeps its colour');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me_large_text_set(true))->>'ok' = 'true', 'Wafa turns on large text');
select pg_temp.assert((public.bag_toggle('00000000-0000-4000-8000-00000000d001', true))->>'ok' = 'true', 'Wafa ticks the diapers');
select pg_temp.assert((select checked from public.bag_items where id = '00000000-0000-4000-8000-00000000d001'), 'ticked');
select pg_temp.assert((public.bag_reset())->>'ok' = 'true', 'and resets the bag');
select pg_temp.assert((select count(*) from public.bag_items where checked) = 0, 'everything unticked');
select pg_temp.assert((public.entry_type_save(null, 'lana', 'swim', 'Swim'))->>'error' = 'not_allowed', 'Wafa cannot add entry types');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((select count(*) from public.bag_items) = 0, 'Lilly does not see the bag');
reset role;

-- Perf (migration 1600): cached answers never leak across identities (each statement is its own transaction here)
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert(not public.has_permission('lana', 'view') and public.current_member_id() = :lilly, 'Lilly: no Lana, correct identity');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(public.has_permission('lana', 'view') and public.current_member_id() = :mido, 'Mido right after Lilly: Lana visible, correct identity');
select pg_temp.assert((select count(*) from (select public.has_permission('lana', 'view') from generate_series(1, 2000)) x where has_permission) = 2000, '2000 permission checks in one statement');
reset role;

-- Family chat (migration 1700): everyone posts, deletes their own; admin deletes any; assistant on for all
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.me())#>>'{permissions,chat,view}' = 'true' and (public.me())#>>'{permissions,chat,add}' = 'true', 'Lilly can read and post in the family chat');
select pg_temp.assert((public.me())#>>'{permissions,assistant,view}' = 'true', 'the assistant is on for Lilly again');
select pg_temp.assert((public.me())#>>'{permissions,photos,add}' = 'true', 'and she can add photos');
select pg_temp.assert((public.chat_send('Lana is asleep, going to the shop', null))->>'ok' = 'true', 'Lilly posts a message');
select pg_temp.assert((public.chat_send('', 'chat/0d1f7a1e-6b0e-4e21-9d6a-5a0a2b6c7d8e.jpg'))->>'ok' = 'true', 'and a photo on its own');
select pg_temp.assert((public.chat_send('', null))->>'error' = 'empty', 'but not nothing');
select pg_temp.assert((public.chat_send('x', '../etc/passwd'))->>'error' = 'bad_photo', 'and not a photo outside the chat folder');
select pg_temp.assert(jsonb_array_length((public.chat_list())->'messages') = 2, 'she sees both');
select pg_temp.assert((select bool_and((x->>'mine')::boolean) from jsonb_array_elements((public.chat_list())->'messages') x), 'both are hers');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.chat_send('Thank you Lilly', null))->>'ok' = 'true', 'Wafa replies');
select pg_temp.assert((public.chat_remove((select id from public.family_messages where body like 'Lana is asleep%')))->>'error' = 'not_allowed', 'Wafa cannot delete Lilly''s message');
select pg_temp.assert((public.chat_remove((select id from public.family_messages where body = 'Thank you Lilly')))->>'ok' = 'true', 'but can delete her own');
select pg_temp.assert(jsonb_array_length((public.chat_list())->'messages') = 2, 'two left');
select pg_temp.assert((select author_name from (select x->>'author_name' as author_name from jsonb_array_elements((public.chat_list())->'messages') x limit 1) y) = 'Lilly', 'with the author''s name');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.chat_remove((select id from public.family_messages where body like 'Lana is asleep%')))->>'ok' = 'true', 'Mido can delete anyone''s message');
select pg_temp.assert(jsonb_array_length((public.chat_list())->'messages') = 1, 'one left');
select pg_temp.assert(not exists (select 1 from information_schema.role_table_grants where table_name = 'family_messages' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')), 'chat writes go through the RPCs');
reset role;

-- Vaccines (migration 1800): UAE schedule from the birth date, record and undo, due list and permissions
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.vaccines_list(:lana))->>'ok' = 'true', 'Wafa sees Lana''s vaccine book');
select pg_temp.assert(jsonb_array_length((public.vaccines_list(:lana))->'items') = 22, '22 schedule lines on the NMC card');
select pg_temp.assert((select x->>'due_on' from jsonb_array_elements((public.vaccines_list(:lana))->'items') x where x->>'id' = 'hexa_2') = ((select birth_date from public.care_subjects where id = :lana) + 122)::text, '4-month dose due 122 days after birth');
select pg_temp.assert((select x->>'status' from jsonb_array_elements((public.vaccines_list(:lana))->'items') x where x->>'id' = 'hpv_1') = 'upcoming', 'HPV is years away');
select pg_temp.assert((public.vaccine_record(:lana, 'bcg_1', (select birth_date from public.care_subjects where id = :lana), 'Hospital', null, null))->>'ok' = 'true', 'Wafa records BCG at birth');
select pg_temp.assert((public.vaccine_record(:lana, 'hexa_1', (select birth_date from public.care_subjects where id = :lana) + 60, 'Clinic', 'AB12', null))->>'ok' = 'true', 'and the first 6-in-1');
select pg_temp.assert((public.vaccine_record(:lana, 'hexa_1', (select birth_date from public.care_subjects where id = :lana) + 61, null, null, 'corrected'))->>'ok' = 'true', 'recording again corrects the date');
select pg_temp.assert((select count(*) from public.vaccinations where subject_id = :lana and schedule_id = 'hexa_1' and deleted_at is null) = 1, 'still one live row');
select pg_temp.assert((select x#>>'{given,batch}' from jsonb_array_elements((public.vaccines_list(:lana))->'items') x where x->>'id' = 'hexa_1') = 'AB12', 'batch kept when not resent');
select pg_temp.assert((public.vaccine_record(:lana, 'hexa_1', current_date + 5, null, null, null))->>'error' = 'bad_date', 'not in the future');
select pg_temp.assert((public.vaccine_record(:lana, 'nope', current_date, null, null, null))->>'error' = 'bad_schedule', 'not off the schedule');
select pg_temp.assert((select x->>'status' from jsonb_array_elements((public.vaccines_list(:lana))->'items') x where x->>'id' = 'bcg_1') = 'given', 'BCG shows as given');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine' and x->>'visit' = 'Birth') = 1, 'birth visit still due (hepatitis B not recorded)');
select pg_temp.assert((select x->>'count' from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine' and x->>'visit' = 'Birth') = '1', 'with one dose outstanding');
select pg_temp.assert((public.vaccine_unrecord((select id from public.vaccinations where subject_id = :lana and schedule_id = 'bcg_1' and deleted_at is null)))->>'ok' = 'true', 'Wafa can undo (she edits Lana''s log)');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.vaccines_list(:lana))->>'error' = 'not_allowed', 'Lilly cannot see the vaccine book');
select pg_temp.assert((public.vaccine_record(:lana, 'pcv_1', current_date, null, null, null))->>'error' = 'not_allowed', 'nor record one');
select pg_temp.assert((select count(*) from public.vaccinations) = 0, 'and sees no rows');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine') = 0, 'and no vaccine due items');
reset role;

-- Ongoing honours end_if (migration 2100): a bottle feed without an end time is not "still feeding"
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '20 minutes', null, '{"method":"Bottle","amount_ml":120}'))->>'ok' = 'true', 'Dana logs a bottle with no end time');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.home_summary())->'ongoing') x where x->>'type_id' = 'lana.feed' and x->'payload'->>'method' = 'Bottle'), 'the bottle is not an ongoing feed');
reset role;

-- Milk consume (migration 2200): a bottle feed takes milk out of the fridge, oldest first
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.milk_add(100, 'fridge', now() - interval '30 hours', 'older'))->>'ok' = 'true', 'Dana adds an older 100 ml');
select pg_temp.assert((public.milk_add(150, 'fridge', now() - interval '2 hours', 'newer'))->>'ok' = 'true', 'and a newer 150 ml');
create temp table consumed as select public.milk_consume(120) as r;
select pg_temp.assert((select r->>'short_ml' from consumed) = '0', 'a 120 ml bottle is covered');
select pg_temp.assert((select private.milk_expires_at(b) from public.milk_bottles b where b.id = (select (r->'used'->0->>'id')::uuid from consumed))
                      <= (select min(private.milk_expires_at(b)) from public.milk_bottles b where b.used_at is null and b.deleted_at is null and b.location = 'fridge' and private.milk_expires_at(b) >= now()),
                      'the bottle closest to expiry went first');
select pg_temp.assert((select sum((x->>'ml')::int) from consumed, jsonb_array_elements(r->'used') x) = 120, 'exactly 120 ml came out');
select pg_temp.assert((select count(*) from public.milk_bottles where note = 'newer' and used_at is null) = 1, 'the newest bottle is still open');
select pg_temp.assert((public.milk_consume(500))->>'short_ml' <> '0', 'a huge bottle reports a shortfall');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.milk_consume(60))->>'error' = 'not_allowed', 'Lilly cannot take milk out (no Lana access)');
reset role;

-- Parity (migration 2300): medicines with a gap, the helper's memory, the babysitter role, backups
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.medicines_list(:lana))->>'ok' = 'true', 'Dana sees Lana''s medicine list');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.medicines_list(:lana))->'items')) >= 2, 'seeded with vitamin D and paracetamol');
create temp table med as select ((public.medicine_save(null, :lana, 'Test syrup', 6, '2.5 ml', null))->>'id')::uuid as id;
select pg_temp.assert((select id from med) is not null, 'Dana adds a medicine');
select pg_temp.assert((public.medicine_save(null, :lana, '', 6, null, null))->>'error' = 'bad_name', 'a name is required');
select pg_temp.assert((public.medicine_save(null, :lana, 'x', 0, null, null))->>'error' = 'bad_gap', 'a positive gap is required');
select pg_temp.assert((public.medicine_give((select id from med), null, now() - interval '2 hours', null, false))->>'ok' = 'true', 'first dose goes into the log');
select pg_temp.assert((select count(*) from public.care_entries where type_id = 'lana.medication' and payload->>'medicine_id' = (select id::text from med)) = 1, 'as a medication entry with the medicine id');
select pg_temp.assert((public.medicine_give((select id from med), null, now(), null, false))->>'error' = 'too_soon', 'a second dose after 2 h is refused (6 h gap)');
select pg_temp.assert((select x->>'too_soon' from jsonb_array_elements((public.medicines_list(:lana))->'items') x where x->>'name' = 'Test syrup') = 'true', 'the list says too soon');
select pg_temp.assert((public.medicine_give((select id from med), '5 ml', now(), 'doctor said', true))->>'ok' = 'true', 'forced (the doctor said so) is allowed');
select pg_temp.assert((select payload->>'early' from public.care_entries where type_id = 'lana.medication' and payload->>'medicine_id' = (select id::text from med) order by occurred_at desc limit 1) = 'true', 'and marked as early');
select pg_temp.assert((public.medicine_remove((select id from med)))->>'ok' = 'true', 'Dana removes the test medicine');
select pg_temp.assert((public.memory_add('Lana takes a bottle better when it is warm.'))->>'ok' = 'true', 'Dana teaches the helper something');
select pg_temp.assert((public.memory_add('Lana takes a bottle better when it is warm.'))->>'duplicate' = 'true', 'the same fact twice is one memory');
select pg_temp.assert((public.memory_add('x'))->>'error' = 'bad_body', 'a memory needs at least two characters');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items')) = 1, 'memory_list shows it');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.medicines_list(:lana))->>'ok' = 'true', 'Wafa sees the medicine list');
select pg_temp.assert((public.medicine_remove((select (x->>'id')::uuid from jsonb_array_elements((public.medicines_list(:lana))->'items') x limit 1)))->>'ok' = 'true', 'Wafa can remove one (she edits Lana''s log)');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items')) = 1, 'Wafa sees the shared memory');
select pg_temp.assert((public.memory_remove((select (x->>'id')::uuid from jsonb_array_elements((public.memory_list())->'items') x limit 1)))->>'error' = 'not_found', 'but cannot remove Dana''s memory');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.medicines_list(:lana))->>'error' = 'not_allowed', 'Lilly cannot see medicine');
select pg_temp.assert((public.medicine_give((select id from med), null, now(), null, true))->>'error' = 'not_found', 'nor give a removed one');
select pg_temp.assert((select count(*) from public.backups) = 0, 'Lilly sees no backups');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from public.roles where id = 'sitter') = 1, 'the babysitter role exists');
select pg_temp.assert((select count(*) from public.permissions where role_id = 'sitter' and allowed) = 7, 'with Lana view/add, chat view/add, photos view/add, assistant view');
select pg_temp.assert((public.member_save(null, 'Sitter Sam', 'sam@test.local', 'sitter', null, 'Babysitter', true))->>'ok' = 'true', 'Mido adds a babysitter');
select pg_temp.assert((public.memory_remove((select (x->>'id')::uuid from jsonb_array_elements((public.memory_list())->'items') x limit 1)))->>'ok' = 'true', 'an admin can remove any memory');
reset role;
insert into auth.users (id, email) select m.id, m.email from public.members m where m.email = 'sam@test.local' and m.user_id is null on conflict (email) do nothing;
select pg_temp.act_as((select id from public.members where email = 'sam@test.local'));
set role authenticated;
select pg_temp.assert((public.me())#>>'{role,id}' = 'sitter', 'Sam signs in as the babysitter');
select pg_temp.assert((public.home_summary())->>'ok' = 'true', 'Sam sees Lana''s log');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}', null, null))->>'ok' = 'true', 'Sam logs a diaper');
select pg_temp.assert((public.calendar_list(current_date, current_date))->>'error' = 'not_allowed', 'Sam cannot see the calendar');
select pg_temp.assert((public.milk_consume(60))->>'ok' = 'true', 'Sam can give a bottle from the fridge');
reset role;

-- Smart care (migration 2400): the next feed depends on how much she took; a long breastfeed can be trimmed
-- (earlier blocks logged feeds "now"; park them so the feeds below are the latest)
update public.care_entries set deleted_at = now() where type_id = 'lana.feed' and deleted_at is null and occurred_at > now() - interval '2 hours';
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '12 minutes', now() - interval '7 minutes', '{"method":"Breast","side":"Left"}'))->>'ok' = 'true', 'Dana logs 5 min on the left');
select pg_temp.assert(((public.home_summary())#>>'{last,lana.feed,fullness}')::numeric < 0.1, 'a 5-minute feed is nearly empty');
select pg_temp.assert(((public.home_summary())#>>'{last,lana.feed,next_due}')::timestamptz between now() + interval '82 minutes' and now() + interval '84 minutes', 'and the next feed comes 1.5 h after it ended (half the 3 h gap)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '5 minutes', null, '{"method":"Breast","side":"Both","duration_min":25}'))->>'ok' = 'true', 'then 25 min on both sides');
select pg_temp.assert(((public.home_summary())#>>'{last,lana.feed,fullness}')::numeric = 1, 'a full feed scores 1');
select pg_temp.assert(((public.home_summary())#>>'{last,lana.feed,next_due}')::timestamptz between now() + interval '174 minutes' and now() + interval '176 minutes', 'and the usual 3 h gap applies');
create temp table longfeed as select ((public.care_entry_log(:lana, 'lana.feed', now() - interval '3 hours', now() - interval '18 minutes', '{"method":"Breast","side":"Right"}'))->>'id')::uuid as id;
select pg_temp.assert((select id from longfeed) is not null, 'a 162-minute feed (timer left on)');
select pg_temp.assert((public.care_feed_trim((select id from longfeed), 20, false))->>'raw_minutes' = '162', 'Dana trims it; the raw minutes are kept');
select pg_temp.assert((select payload->>'duration_min' from public.care_entries where id = (select id from longfeed)) = '20', 'the entry now says 20 min');
select pg_temp.assert((select ended_at from public.care_entries where id = (select id from longfeed)) = (select occurred_at + interval '20 minutes' from public.care_entries where id = (select id from longfeed)), 'and ends 20 min after it started');
select pg_temp.assert((public.care_feed_trim((select id from longfeed), 20, true))->>'kept' = 'true', 'marking it real is also allowed');
select pg_temp.assert((public.care_feed_trim((select (x->>'id')::uuid from jsonb_array_elements((public.care_entries_list(:lana, now() - interval '1 day', now()))->'entries') x where x->>'type_id' = 'lana.diaper' limit 1), 20, false))->>'error' = 'not_a_breastfeed', 'only breastfeeds can be trimmed');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.care_feed_trim((select id from longfeed), 20, false))->>'error' = 'not_allowed', 'Lilly cannot trim (no Lana access)');
reset role;

-- Coach plans (migration 2500): propose, start, tick, stop; only through the RPCs
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.coach_plan_active(:lana))->'plan' = 'null'::jsonb, 'no plan yet');
create temp table plan1 as select ((public.coach_plan_start(:lana, 'Earlier, calmer bedtime', '[{"day":1,"step":"Start the wind-down 15 min earlier."},{"day":2,"step":"Same again, dim the lights."},{"step":"Bath, feed, song, bed."}]'))->>'id')::uuid as id;
select pg_temp.assert((select id from plan1) is not null, 'Dana starts a 3-day plan');
select pg_temp.assert((public.coach_plan_active(:lana))#>>'{plan,days}' = '3', 'days are renumbered in order');
select pg_temp.assert((public.coach_plan_active(:lana))#>>'{plan,day}' = '1', 'today is day 1');
select pg_temp.assert((public.coach_plan_active(:lana))#>>'{plan,today_step}' = 'Start the wind-down 15 min earlier.', 'with its step');
select pg_temp.assert((public.coach_plan_checkin((select id from plan1), null, true, 'went well'))->>'ok' = 'true', 'Dana ticks today');
select pg_temp.assert((public.coach_plan_active(:lana))#>>'{plan,done_today}' = 'true', 'done today shows');
select pg_temp.assert((public.coach_plan_checkin((select id from plan1), current_date + 10, true, null))->>'error' = 'bad_day', 'a day outside the plan is refused');
select pg_temp.assert((public.coach_plan_start(:lana, '', '[]'))->>'error' = 'bad_goal', 'a goal is required');
select pg_temp.assert((public.coach_plan_start(:lana, 'Too long', '[{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"},{"step":"x"}]'))->>'error' = 'bad_steps', 'at most 14 days');
select pg_temp.assert((public.coach_plan_start(:lana, 'Drowsy but awake', '[{"step":"Once a day, put her down drowsy."}]'))->>'ok' = 'true', 'a new plan replaces the old one');
reset role;
select pg_temp.assert((select status from public.coach_plans where id = (select id from plan1)) = 'replaced', 'the old plan is marked replaced');
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.coach_plan_stop((select (x#>>'{plan,id}')::uuid from (select public.coach_plan_active(:lana) as x) y)))->>'ok' = 'true', 'Dana stops the plan');
select pg_temp.assert((public.coach_plan_active(:lana))->'plan' = 'null'::jsonb, 'no active plan again');
select pg_temp.assert(jsonb_array_length((public.coach_plan_history(:lana, 8))->'plans') = 2, 'history lists both plans');
select pg_temp.assert((select x->>'done' from jsonb_array_elements((public.coach_plan_history(:lana, 8))->'plans') x where x->>'goal' = 'Earlier, calmer bedtime') = '1', 'with the ticked day');
select pg_temp.assert((select x->'notes'->>0 from jsonb_array_elements((public.coach_plan_history(:lana, 8))->'plans') x where x->>'goal' = 'Earlier, calmer bedtime') = 'went well', 'and the note');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.coach_plan_active(:lana))->>'error' = 'not_allowed', 'Lilly cannot see plans');
select pg_temp.assert((public.coach_plan_start(:lana, 'x', '[{"step":"y"}]'))->>'error' = 'not_allowed', 'nor start one');
select pg_temp.assert((public.coach_plan_history(:lana, 8))->>'error' = 'not_allowed', 'nor see the history');
do $$ begin
  perform count(*) from public.coach_plans;
  raise exception 'ASSERT FAILED: Lilly could read coach_plans directly';
exception when insufficient_privilege then
  raise notice 'ok  - plans are only reachable through the RPCs';
end $$;
reset role;

-- This week (migration 2700): play ideas by age with a tick; the weekly brief kind
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.activities_list(:lana))->>'ok' = 'true', 'Dana sees play ideas');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'now') >= 5, 'with a handful for her age now');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'coming') >= 5, 'and the next band coming');
select pg_temp.assert((select bool_and(((public.activities_list(:lana))->>'age_days')::int between (x->>'from_days')::int and (x->>'to_days')::int) from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'now'), 'the "now" ideas match her age');
create temp table act1 as select x->>'id' as id from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'now' limit 1;
select pg_temp.assert((public.activity_tick(:lana, (select id from act1), true, 'she loved it'))->>'ok' = 'true', 'Dana ticks one');
select pg_temp.assert((select x->>'done_by' from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'id' = (select id from act1)) = 'Dana', 'it shows who did it');
select pg_temp.assert((public.activity_tick(:lana, (select id from act1), false, null))->>'ok' = 'true', 'and unticks');
select pg_temp.assert((select x->>'done_on' from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'id' = (select id from act1)) is null, 'cleanly');
select pg_temp.assert((public.activity_tick(:lana, 'nope', true, null))->>'error' = 'not_found', 'unknown ideas are refused');
select pg_temp.assert((public.assistant_brief_save(current_date, 'week', 'This week: a quiet one.'))->>'ok' = 'true', 'a weekly brief can be saved');
select pg_temp.assert((public.assistant_brief_get(current_date, 'week'))#>>'{brief,content}' = 'This week: a quiet one.', 'and read back');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.activities_list(:lana))->>'error' = 'not_allowed', 'Lilly cannot see play ideas');
select pg_temp.assert((public.activity_tick(:lana, (select id from act1), true, null))->>'error' = 'not_allowed', 'nor tick');
reset role;

-- Skills (migration 2800): the helper's knowledge as data; admins edit, everyone it serves reads
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.skill_list(false))->>'ok' = 'true', 'Dana reads the skills');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.skill_list(false))->'items')) >= 14, 'the seed is there');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.skill_list(false))->'items') x where (x->>'always_on')::boolean) = 2, 'two are always on');
select pg_temp.assert((public.skill_save('travel', 'Travel', 'Flights, time zones, the car seat.', array['travel','flight','plane','jet lag'], 'A long enough body about travelling with a baby, in plain words.', 'NHS', false, null, null, 50, true))->>'ok' = 'true', 'Dana adds a skill');
select pg_temp.assert((select x->>'version' from jsonb_array_elements((public.skill_list(false))->'items') x where x->>'id' = 'travel') = '1', 'at version 1');
select pg_temp.assert((public.skill_save('travel', 'Travel', 'Flights, time zones, the car seat.', array['travel','flight'], 'A long enough body about travelling with a baby, in plain words, revised.', 'NHS', false, null, null, 50, false))->>'ok' = 'true', 'and edits it off');
select pg_temp.assert((select x->>'version' from jsonb_array_elements((public.skill_list(true))->'items') x where x->>'id' = 'travel') = '2', 'version bumps');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.skill_list(false))->'items') x where x->>'id' = 'travel'), 'inactive skills are not served');
select pg_temp.assert((public.skill_save('Bad Id', 'x', '', '{}', 'short', '', false, null, null, 100, true))->>'error' = 'bad_id', 'ids are checked');
select pg_temp.assert((public.skill_save('tiny', 'Tiny', '', '{}', 'short', '', false, null, null, 100, true))->>'error' = 'bad_skill', 'bodies must be real');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.skill_list(false))->>'ok' = 'true', 'Wafa reads the skills (the helper runs as her)');
select pg_temp.assert((public.skill_list(true))->>'error' = 'not_allowed', 'but not the inactive ones');
select pg_temp.assert((public.skill_save('sleep', 'Sleep', 'x', '{}', 'A long enough body that Wafa must not be able to write here.', '', false, null, null, 10, true))->>'error' = 'not_allowed', 'and cannot edit');
reset role;
do $$ begin
  begin
    set role authenticated;
    perform * from public.assistant_skills;
    raise exception 'direct read should fail';
  exception when insufficient_privilege then reset role;
  end;
end $$;

-- Entry checks (migration 2900): it was real / end it here / remove it
select pg_temp.act_as(:dana);
set role authenticated;
create temp table chk1 as select ((public.care_entry_log(:lana, 'lana.sleep', now() - interval '14 hours', null, '{}'::jsonb, 'checks test', null))->>'id')::uuid as id;
select pg_temp.assert((public.care_entry_check((select id from chk1), 'end', now() - interval '6 hours'))->>'ok' = 'true', 'Dana ends a sleep timer left on');
select pg_temp.assert((select (payload->>'timer_capped')::boolean and (payload->>'raw_minutes')::int between 835 and 845 and (payload->>'duration_min')::int between 475 and 485 from public.care_entries where id = (select id from chk1)), 'the raw length is kept, the new one recorded');
select pg_temp.assert((public.care_entry_check((select id from chk1), 'end', now() - interval '20 hours'))->>'error' = 'bad_end', 'an end before the start is refused');
select pg_temp.assert((public.care_entry_check((select id from chk1), 'ok', null))->>'kept' = 'true', 'and it can be confirmed real');
select pg_temp.assert((public.care_entry_check((select id from chk1), 'delete', null))->>'deleted' = 'true', 'or removed');
select pg_temp.assert((public.care_entry_check((select id from chk1), 'ok', null))->>'error' = 'not_found', 'gone');
reset role;
update public.care_entries set deleted_at = now() where note = 'checks test';

-- Memory (migration 3000): chat recaps are the member's own; the coaching rule mentions forget_memory
select pg_temp.act_as(:dana);
set role authenticated;
create temp table rc1 as select ((public.ask_chat_save(null, 'Why are her naps so short?', '[{"role":"user","text":"Why are her naps so short?"},{"role":"assistant","text":"One sleep cycle."}]'::jsonb, 'Why are her naps so short? → One sleep cycle; settle at the first stir.'))->>'id')::uuid as id;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.ask_chat_recaps(6))->'items')) = 1, 'Dana sees her recap');
select pg_temp.assert((select x->>'summary' from jsonb_array_elements((public.ask_chat_recaps(6))->'items') x limit 1) like 'Why are her naps%', 'with the line she saved');
select pg_temp.assert((public.ask_chat_save((select id from rc1), 'Why are her naps so short?', '[]'::jsonb, null))->>'ok' = 'true', 'saving without a recap keeps the old one');
select pg_temp.assert((select x->>'summary' from jsonb_array_elements((public.ask_chat_recaps(6))->'items') x limit 1) like 'Why are her naps%', 'still there');
reset role;
select pg_temp.assert((select body like '%forget_memory%' and body like '%EARLIER CHATS%' from public.assistant_skills where id = 'coaching'), 'the coaching rule knows about forgetting and earlier chats');
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.ask_chat_recaps(6))->'items')) = 0, 'Wafa does not see Dana''s chats');
reset role;
update public.ask_chats set deleted_at = now() where id = (select id from rc1);

\o
\echo

-- Sprouty round (migration 3100): mood type, the story kind, what was tried
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((select is_active from public.care_entry_types where id = 'lana.mood'), 'the mood type is on');
select pg_temp.assert((public.assistant_brief_save(current_date, 'story', 'Month one.', 'test-model', null))->>'ok' = 'true', 'the monthly story is a brief kind');
create temp table act2 as select x->>'id' as id from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'now' limit 1;
select pg_temp.assert((public.activity_tick(:lana, (select id from act2), true, null))->>'ok' = 'true', 'Dana ticks an idea');
select pg_temp.assert((public.activity_done_list(:lana, current_date - 30, current_date))->>'ok' = 'true', 'and lists what was tried');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.activity_done_list(:lana, current_date - 30, current_date))->'items')) >= 1, 'including that one');
select pg_temp.assert((public.activity_tick(:lana, (select id from act2), false, null))->>'ok' = 'true', 'then unticks it');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.activity_done_list(:lana, current_date - 30, current_date))->>'error' = 'not_allowed', 'Lilly cannot list what was tried');
select pg_temp.assert((select count(*) from public.activities where is_active) >= 140, 'the play library has grown');
reset role;

-- Any household (migration 3500): me() names the active subjects for every member
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.me())->'subjects') s where s->>'kind' = 'child' and s->>'name' = 'Lana') = 1, 'Lilly, who cannot see the log, still gets the child''s name from me()');
select pg_temp.assert((select s ? 'profile' from jsonb_array_elements((public.me())->'subjects') s limit 1) = false, 'and no profile with it');
reset role;
insert into public.care_subjects (id, module_id, kind, name, is_active, sort) values ('00000000-0000-4000-8000-00000000a009', 'lana', 'child', 'Archived', false, 1);
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.me())->'subjects') s where s->>'name' = 'Archived') = 0, 'an archived subject is not named');
reset role;
delete from public.care_subjects where id = '00000000-0000-4000-8000-00000000a009';

-- Timers (migration 3400): one open timer per type, end by client_id, custody that expires
select pg_temp.act_as(:dana);
set role authenticated;
create temp table tm1 as select (public.care_entry_log(:lana, 'lana.sleep', now() - interval '20 minutes', null, '{}'::jsonb, 'timers test', 'bbbbbbbb-0000-4000-8000-000000000001')) as r;
select pg_temp.assert((select r->>'ok' = 'true' and r->>'open' is null from tm1), 'Dana starts a sleep timer');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '5 minutes', null, '{}'::jsonb, 'timers test', 'bbbbbbbb-0000-4000-8000-000000000002'))->>'open' = 'true', 'a second "fell asleep" (other phone, double tap) hands back the running timer');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '5 minutes', null, '{}'::jsonb, 'timers test', 'bbbbbbbb-0000-4000-8000-000000000002'))->>'id' = (select r->>'id' from tm1), 'with the same id');
select pg_temp.assert((select count(*) from public.care_entries where note = 'timers test' and deleted_at is null) = 1, 'and nothing new was written');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '3 hours', now() - interval '2 hours', '{}'::jsonb, 'timers test', 'bbbbbbbb-0000-4000-8000-000000000003'))->>'ok' = 'true', 'a finished nap logged after the fact is not blocked by the open timer');
select pg_temp.assert((public.care_entry_end_client('bbbbbbbb-0000-4000-8000-000000000001', now() - interval '25 minutes'))->>'error' = 'bad_time', 'ending by client_id before the start is refused');
select pg_temp.assert((public.care_entry_end_client('bbbbbbbb-0000-4000-8000-000000000001', now()))->>'ok' = 'true', 'the timer ends by the client_id it was started with');
select pg_temp.assert((public.care_entry_end_client('bbbbbbbb-0000-4000-8000-00000000ffff', now()))->>'error' = 'not_found', 'an end for a start that has not arrived says so');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now(), null, '{}'::jsonb, 'timers test', 'bbbbbbbb-0000-4000-8000-000000000004'))->>'open' is null, 'once ended, a new sleep can start');
reset role;
-- custody set 13 hours ago no longer attributes; a fresh one does
select public.custody_set(:lana, :wafa);
update public.care_custody set since = now() - interval '13 hours' where subject_id = :lana;
select pg_temp.act_as(:dana);
set role authenticated;
create temp table cu1 as select ((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}'::jsonb, 'timers test', null))->>'id')::uuid as id;
select pg_temp.assert((select attributed_to from public.care_entries where id = (select id from cu1)) = :dana, 'a stale "who has her" (13 h old) attributes the entry to the logger');
select pg_temp.assert((public.custody_set(:lana, :wafa))->>'ok' = 'true', 'Dana hands over to Wafa now');
create temp table cu2 as select ((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}'::jsonb, 'timers test', null))->>'id')::uuid as id;
select pg_temp.assert((select attributed_to from public.care_entries where id = (select id from cu2)) = :wafa, 'and a fresh one attributes to Wafa');
reset role;
update public.care_entries set deleted_at = now() where note = 'timers test';

-- Preview guards (migration 3600): the "own row" RPCs are read only in view-as too
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.push_subscribe('https://push.test/wafa-1', 'k', 'a', 'test'))->>'ok' = 'true', 'Wafa subscribes her phone');
select pg_temp.assert((public.push_unsubscribe('https://push.test/wafa-1'))->>'ok' = 'true', 'and unsubscribes it');
select pg_temp.assert((public.member_photo_save(:wafa, 'members/wafa.jpg'))->>'ok' = 'true', 'Wafa sets her own photo');
reset role;
select pg_temp.preview_as(:dana, :wafa);
set role authenticated;
select pg_temp.assert(public.current_member_id() = :wafa, 'Dana previews Wafa');
select pg_temp.assert((public.push_subscribe('https://push.test/dana-as-wafa', 'k', 'a', 'test'))->>'error' = 'not_allowed', 'in preview a phone cannot be bound to the previewed member');
select pg_temp.assert((public.push_unsubscribe('https://push.test/wafa-1'))->>'error' = 'not_allowed', 'nor unsubscribed');
select pg_temp.assert((public.member_photo_save(:wafa, 'members/x.jpg'))->>'error' = 'not_allowed', 'nor her photo changed');
select pg_temp.assert((public.note_remove(gen_random_uuid()))->>'error' = 'not_allowed', 'nor a note removed');
select pg_temp.assert((public.chat_remove(gen_random_uuid()))->>'error' = 'not_allowed', 'nor a chat message removed');
select pg_temp.assert((public.memory_remove(gen_random_uuid()))->>'error' = 'not_allowed', 'nor a memory removed');
select pg_temp.assert((public.ask_chat_remove(gen_random_uuid()))->>'error' = 'not_allowed', 'nor an earlier chat removed');
select pg_temp.assert((select photo_path from public.members where id = :wafa) = 'members/wafa.jpg', 'Wafa''s photo is as she set it');
reset role;
update public.members set photo_path = null where id = :wafa;
delete from public.push_subscriptions where endpoint like 'https://push.test/%';

-- Signed out (migration 3700): me() with no session is a plain answer, not an error
select set_config('request.jwt.claims', '{"role":"anon"}', false);
set role anon;
select pg_temp.assert((public.me())->>'error' = 'not_signed_in', 'a call with no session is told to sign in, and touches nothing private');
reset role;

-- A timer ends once (migration 3800): a late end does not overwrite the one already set
select pg_temp.act_as(:dana);
set role authenticated;
create temp table eo1 as select ((public.care_entry_log(:lana, 'lana.sleep', now() - interval '2 hours', null, '{}'::jsonb, 'end once test', 'bbbbbbbb-0000-4000-8000-00000000e001'))->>'id')::uuid as id;
select pg_temp.assert((public.care_entry_end((select id from eo1), now() - interval '30 minutes'))->>'ok' = 'true', 'Dana ends the nap at 30 minutes ago');
select pg_temp.assert((public.care_entry_end((select id from eo1), now() - interval '90 minutes'))->>'error' = 'already_ended', 'an end that arrives later, with an earlier time, is refused');
select pg_temp.assert((select ended_at from public.care_entries where id = (select id from eo1)) > now() - interval '31 minutes', 'and the first end stands');
select pg_temp.assert((public.care_entry_end_client('bbbbbbbb-0000-4000-8000-00000000e001', now()))->>'error' = 'already_ended', 'the same by client_id');
reset role;
update public.care_entries set deleted_at = now() where note = 'end once test';

-- Many homes (migration 3900): a second home sees nothing of the first, and an
-- account with no home can make one. Last, because from here the deployment has
-- two homes and rows written with no member must name theirs.
\set khan_home '''00000000-0000-4000-8000-00000000b000'''
\set haitham  '''00000000-0000-4000-8000-00000000b001'''
\set zayd     '''00000000-0000-4000-8000-00000000b0a1'''
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000b001', 'haitham@test.local') on conflict do nothing;
insert into public.household (id, name, timezone) values (:khan_home, 'The Khans', 'Asia/Dubai');
insert into public.members (id, household_id, user_id, email, display_name, role_id, relationship)
values (:haitham, :khan_home, '00000000-0000-4000-8000-00000000b001', 'haitham@test.local', 'Haitham', 'admin', 'Parent');
insert into public.care_subjects (id, household_id, module_id, kind, name, birth_date, sort) values (:zayd, :khan_home, 'lana', 'child', 'Zayd', current_date - 20, 10);
select id as first_entry from public.care_entries where subject_id = :lana and deleted_at is null order by occurred_at desc limit 1 \gset

select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans', 'Haitham''s me() is his home');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.me())->'subjects')) = 1 and (public.me())->'subjects'->0->>'name' = 'Zayd', 'and names only his child');
select pg_temp.assert((select count(*) from public.members) = 1, 'he sees one member: himself');
select pg_temp.assert((select count(*) from public.household) = 1, 'and one home');
select pg_temp.assert((select count(*) from public.care_subjects) = 1, 'and one child');
select pg_temp.assert((select count(*) from public.care_entries) = 0, 'and none of Lana''s entries');
select pg_temp.assert((select count(*) from public.calendar_events) = 0, 'nor the calendar');
select pg_temp.assert((select count(*) from public.family_messages) = 0, 'nor the chat');
select pg_temp.assert((public.home_summary(:lana))->>'ok' = 'false', 'home_summary for Lana by her id is refused');
select pg_temp.assert((public.care_entries_list(:lana, now() - interval '7 days', now()))->>'ok' = 'false', 'so is her entry list');
select pg_temp.assert((public.medicines_list(:lana))->>'ok' = 'false', 'and her medicines (a definer function)');
select pg_temp.assert((public.care_entry_end(:'first_entry', now()))->>'error' = 'not_found', 'and ending her entry by id finds nothing');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now(), null, '{"method":"Bottle","amount_ml":100}'::jsonb, 'cross-home test', null))->>'ok' = 'false', 'and logging for her is refused');
create temp table zayd_feed as select ((public.care_entry_log(:zayd, 'lana.feed', now(), null, '{"method":"Bottle","amount_ml":100}'::jsonb, 'khan test', null))->>'id')::uuid as id;
select pg_temp.assert((select household_id from public.care_entries where id = (select id from zayd_feed)) = :khan_home, 'his own entry is stamped with his home without him saying so');
select pg_temp.assert((public.home_summary(:zayd))->>'ok' = 'true', 'and his home summary works');
reset role;

select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((select count(*) from public.care_subjects where name = 'Zayd') = 0, 'Dana does not see Zayd');
select pg_temp.assert((select count(*) from public.members where display_name = 'Haitham') = 0, 'nor Haitham');
select pg_temp.assert((select count(*) from public.care_entries where note = 'khan test') = 0, 'nor his entry');
select pg_temp.assert((public.home_summary(:zayd))->>'ok' = 'false', 'and cannot ask for Zayd by id');
select pg_temp.assert((public.me())->'household'->>'name' <> 'The Khans', 'her me() is still her home');
reset role;

-- An account with no home creates one, becomes its admin, and is still kept out of the others.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c001', 'newparent@test.local') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.me())->>'error' = 'no_member', 'a new account is in no home');
select pg_temp.assert((public.household_create('', 'Asia/Dubai', 'Maya'))->>'error' = 'bad_input', 'a home needs a name');
select pg_temp.assert((public.household_create('Maya''s home', 'Mars/Olympus', 'Maya'))->>'error' = 'bad_input', 'and a real timezone');
create temp table new_home as select public.household_create('Maya''s home', 'Europe/London', 'Maya', current_date - 3, 'Girl', 'Sara') as r;
select pg_temp.assert((select r->>'ok' from new_home) = 'true', 'the home is created');
select pg_temp.assert((public.me())->>'ok' = 'true' and (public.me())->'household'->>'name' = 'Maya''s home' and (public.me())->'household'->>'timezone' = 'Europe/London', 'and me() is that home from now on');
select pg_temp.assert((public.me())->'role'->>'id' = 'admin' and (public.me())->'member'->>'display_name' = 'Sara', 'as its admin, by the name given');
select pg_temp.assert((public.me())->'subjects'->0->>'name' = 'Maya' and (public.me())->'subjects'->0->>'sex' = 'Girl', 'with the baby made');
select pg_temp.assert((select count(*) from public.care_entries) = 0 and (select count(*) from public.members) = 1, 'and sees nothing of the other two homes');
reset role;

-- An e-mail an admin listed joins that home at the first sign-in (making one of their own is a later, deliberate step: migration 4300, below).
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.member_save(null, 'Cousin', 'cousin@test.local', 'family_carer', null, null, true, null))->>'ok' = 'true', 'Mido lists a cousin by e-mail');
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c002', 'cousin@test.local') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c002","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'id' <> :khan_home and (public.me())->'member'->>'display_name' = 'Cousin', 'the cousin lands in Mido''s home as the listed member');
reset role;
update public.care_entries set deleted_at = now() where note in ('khan test', 'cross-home test');

-- Definer functions see one home too (migration 4000): rows made in Mido's home,
-- then every definer function that takes an id, called from the Khans' with those ids.
select pg_temp.act_as(:dana);
set role authenticated;
select (public.note_save(null, 'cross-home note', false, false))->>'id' as x_note \gset
select (public.milk_add(100, 'fridge', now(), 'cross-home bottle'))->>'id' as x_bottle \gset
select (public.medicine_save(null, :lana, 'Cross-home medicine', 6, null, null))->>'id' as x_med \gset
select (public.chat_send('cross-home message', null))->>'id' as x_msg \gset
select (public.memory_add('Cross-home memory: the bottle is warmer on Tuesdays'))->>'id' as x_mem \gset
select (public.coach_plan_start(:lana, 'Cross-home goal', '[{"day":1,"step":"one"},{"day":2,"step":"two"}]'::jsonb))->>'id' as x_plan \gset
select pg_temp.assert((public.bag_toggle('00000000-0000-4000-8000-00000000d001', true))->>'ok' = 'true', 'Dana ticks a bag item');
select pg_temp.assert(:'x_note' is not null and :'x_bottle' is not null and :'x_med' is not null and :'x_msg' is not null and :'x_mem' is not null and :'x_plan' is not null, 'and makes a note, a bottle, a medicine, a message, a memory and a plan');
reset role;

select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.bag_reset())->>'ok' = 'true', 'Haitham resets his own bag');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items') i where i->>'body' like 'Cross-home memory%') = 0, 'his memory list has none of hers');
select pg_temp.assert((public.note_remove(:'x_note'))->>'ok' = 'false', 'her note cannot be removed by id');
select pg_temp.assert((public.milk_consume(100, null))->'used' = '[]'::jsonb, 'her fridge is not his to drink from: his is empty');
select pg_temp.assert((public.medicine_remove(:'x_med'))->>'ok' = 'false', 'her medicine cannot be removed by id');
select pg_temp.assert((public.chat_remove(:'x_msg'))->>'ok' = 'false', 'nor her message');
select pg_temp.assert((public.memory_remove(:'x_mem'))->>'ok' = 'false', 'nor her memory');
select pg_temp.assert((public.coach_plan_stop(:'x_plan'))->>'ok' = 'false', 'nor her plan stopped');
select pg_temp.assert((public.member_photo_save(:wafa, 'members/x.jpg'))->>'ok' = 'false', 'nor Wafa''s photo set');
select pg_temp.assert((select (public.current_presence(:wafa)).id) is null, 'nor Wafa''s presence read');
select pg_temp.assert((public.attendance_toggle(:lilly))->>'ok' = 'false', 'nor Lilly clocked in');
select pg_temp.assert((public.care_entry_check(:'first_entry', 'ok', null))->>'ok' = 'false', 'nor Lana''s entry checked');
select pg_temp.assert((public.medicines_list(:lana))->>'ok' = 'false', 'nor her medicines listed');
select pg_temp.assert((public.coach_plan_active(:lana))->>'ok' = 'false' or (public.coach_plan_active(:lana))->'plan' is null, 'nor her plan seen');
reset role;
-- and, seen from above, nothing of hers moved
select pg_temp.assert((select checked from public.bag_items where id = '00000000-0000-4000-8000-00000000d001') = true, 'Dana''s tick is still there after his reset');
select pg_temp.assert((select deleted_at from public.notes where id = :'x_note') is null, 'her note is still there');
select pg_temp.assert((select used_at from public.milk_bottles where id = :'x_bottle') is null, 'her bottle is unused');
select pg_temp.assert((select is_active from public.medicines where id = :'x_med'), 'her medicine is still active');
select pg_temp.assert((select deleted_at from public.family_messages where id = :'x_msg') is null, 'her message is still there');
select pg_temp.assert((select deleted_at from public.assistant_memories where id = :'x_mem') is null, 'her memory is still there');
select pg_temp.assert((select status from public.coach_plans where id = :'x_plan') = 'active', 'her plan is still active');
select pg_temp.assert((select photo_path from public.members where id = :wafa) is null, 'Wafa''s photo is unchanged');
update public.notes set deleted_at = now() where id = :'x_note';
update public.milk_bottles set deleted_at = now() where id = :'x_bottle';
update public.medicines set is_active = false where id = :'x_med';
update public.family_messages set deleted_at = now() where id = :'x_msg';
update public.assistant_memories set deleted_at = now() where id = :'x_mem';
update public.coach_plans set status = 'stopped' where id = :'x_plan';
update public.bag_items set checked = false where id = '00000000-0000-4000-8000-00000000d001';

-- And it stays that way: a future definer function left with postgres would bypass the home policy.
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_rls'
      and p.proname not in ('current_member_id', 'has_permission', 'link_current_user', 'household_create', 'my_homes', 'home_switch', 'household_delete')) = 0,
  'every definer function in public belongs to app_rls, except the seven that must see across homes');
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_rls'
      and p.proname not in ('current_household_id', 'only_household_id', 'home_for_new_rows', 'platform_home', 'shared_locked', 'photo_in_my_home',
                            'audit_write', 'auth_user_id_by_email', 'handle_auth_user_created', 'care_custody_fill_module', 'care_entries_fill_module', 'seed_home')) = 0,
  'and so does every data-reading helper in private');
select pg_temp.assert(has_schema_privilege('app_rls', 'public', 'CREATE') and has_schema_privilege('app_rls', 'private', 'CREATE'), 'app_rls may own functions in both schemas (the transfer needs CREATE)');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.chat_send('', 'home-' || :khan_home || '/chat/' || gen_random_uuid() || '.jpg'))->>'ok' = 'true', 'a chat photo under the home folder is accepted');
select pg_temp.assert((public.chat_send('', 'chat/' || gen_random_uuid() || '.jpg'))->>'ok' = 'true', 'and the old shape still is');
select pg_temp.assert((public.chat_send('', 'home-' || :khan_home || '/receipts/x.jpg'))->>'error' = 'bad_photo', 'but not another folder');
reset role;

-- Running many homes (migration 4100): shared definitions change only from the first home; backups per home
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->>'platform' = 'true', 'Mido''s home is the first, the platform home');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.me())->>'platform' = 'false', 'Haitham''s is not');
select pg_temp.assert((public.permission_set('family_carer', 'notes', 'delete', true))->>'error' = 'shared', 'he cannot change the permission matrix every home shares');
select pg_temp.assert((public.role_save('nanny', 'Nanny', null))->>'error' = 'shared', 'nor add a role');
select pg_temp.assert((public.entry_type_save('lana.feed', 'lana', 'feed', 'Feed!', null, null, 10, false, 180, (select fields from public.care_entry_types where id = 'lana.feed'), true, true))->>'error' = 'shared', 'nor edit an entry type');
select pg_temp.assert((public.skill_save('khan_skill', 'Khan skill', 'when', '{}', 'a body of at least twenty characters here', '', false, null, null, 100, true))->>'error' = 'shared', 'nor a helper skill');
reset role;
select pg_temp.assert((select label from public.care_entry_types where id = 'lana.feed') <> 'Feed!' and not exists (select 1 from public.roles where id = 'nanny') and not exists (select 1 from public.assistant_skills where id = 'khan_skill'), 'and nothing shared changed');
-- Nor straight through the tables (PostgREST): the write policies answer to the first home only.
select pg_temp.act_as(:haitham);
set role authenticated;
with u as (update public.permissions set allowed = true where role_id = 'family_carer' and module_id = 'notes' and action = 'delete' returning 1) select count(*) as n_perm from u \gset
select pg_temp.assert(:n_perm = 0, 'Haitham''s direct update of the matrix changes no row');
select pg_temp.assert(pg_temp.fails('insert into public.roles (id, label) values (''nanny'', ''Nanny'')'), 'his direct insert of a role is refused');
with u as (update public.care_entry_types set label = 'Feed!' where id = 'lana.feed' returning 1) select count(*) as n_type from u \gset
select pg_temp.assert(:n_type = 0, 'and so is a direct edit of an entry type');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
with u as (update public.care_entry_types set label = label where id = 'lana.feed' returning 1) select count(*) as n_mine from u \gset
select pg_temp.assert(:n_mine = 1, 'Mido, in the first home, still edits entry types directly');
reset role;
select pg_temp.assert(not exists (select 1 from public.roles where id = 'nanny') and (select label from public.care_entry_types where id = 'lana.feed') <> 'Feed!', 'and the shared tables are as they were');
insert into public.backups (path, household_id, rows) values ('home-khan/run-test', :khan_home, 1), ('home-ours/run-test', (select id from public.household where name = 'Our home'), 1);
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from public.backups where path like 'home-khan/%') = 0 and (select count(*) from public.backups where path like 'home-ours/%') = 1, 'Mido lists his home''s backups, not the Khans''');
reset role;
delete from public.backups where path like 'home-%/run-test';

-- Photos per home: the bucket keeps each home to its own folder; what was there before is the first home's
select pg_temp.act_as(:mido);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('photos', 'requests/before-many-homes.jpg');
insert into storage.objects (bucket_id, name) values ('photos', 'home-' || (select id from public.household where name = 'Our home') || '/chat/ours.jpg');
select pg_temp.assert(pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'photos', 'home-' || :khan_home || '/chat/sneaked.jpg')), 'Mido cannot upload into the Khans'' folder');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
insert into storage.objects (bucket_id, name) values ('photos', 'home-' || :khan_home || '/chat/zayd.jpg');
select pg_temp.assert(pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'photos', 'requests/no-folder.jpg')), 'Haitham cannot upload outside his folder');
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'photos') = 1 and (select name from storage.objects where bucket_id = 'photos') like 'home-' || :khan_home || '/%', 'and sees only his home''s photo: not the old ones, not ours');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from storage.objects where bucket_id = 'photos') = 2 and not exists (select 1 from storage.objects where name like 'home-' || :khan_home || '/%'), 'Mido sees the old photos and his home''s, not the Khans''');
reset role;
delete from storage.objects where bucket_id = 'photos';

-- A timer ends once, locked (migration 4200): the end is written under a row lock, and an
-- "add"-only member ending her own timer really ends it (the invoker update used to no-op).
update public.care_entries set ended_at = now() where type_id = 'lana.sleep' and ended_at is null and deleted_at is null;
insert into public.permissions (role_id, module_id, action, allowed) values ('home_carer', 'lana', 'view', true), ('home_carer', 'lana', 'add', true)
  on conflict (role_id, module_id, action) do update set allowed = true;
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action in ('edit', 'delete');
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert(public.has_permission('lana', 'add') and not public.has_permission('lana', 'edit'), 'Lilly may add to the log but not edit it');
select (public.care_entry_log(:lana, 'lana.sleep', now() - interval '20 minutes', null, '{}', null, null))->>'id' as lilly_sleep \gset
select pg_temp.assert(:'lilly_sleep' is not null, 'she starts a sleep');
select pg_temp.assert((public.care_entry_end(:'lilly_sleep', now()))->>'ok' = 'true', 'and ends it herself');
select pg_temp.assert((public.care_entry_end(:'lilly_sleep', now() - interval '10 minutes'))->>'error' = 'already_ended', 'a second end, with an earlier time, is refused');
reset role;
select pg_temp.assert((select ended_at from public.care_entries where id = :'lilly_sleep') is not null, 'and the row really carries her end (the add-only update used to change nothing)');
select pg_temp.assert((select ended_at from public.care_entries where id = :'lilly_sleep') > now() - interval '5 minutes', 'the first end, not the later one');
select pg_temp.assert(pg_get_userbyid((select proowner from pg_proc where proname = 'care_entry_end')) = 'app_rls', 'care_entry_end runs as app_rls, so its own permission checks decide, not the table policy');

-- One account in several homes (migration 4300): a person listed in two homes has a row in
-- each and runs as the chosen one; switching, making another home, and deleting one.
select email as mido_email from public.members where id = :mido \gset
select id as our_home from public.household where name = 'Our home' \gset
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.member_save(null, 'Mido', :'mido_email', 'family_carer', null, 'Zayd''s uncle', true, null))->>'ok' = 'true', 'Haitham lists Mido''s e-mail in the Khans'' home');
select pg_temp.assert((public.member_save(null, 'Dana', 'dana@test.local', 'family_carer', null, 'Zayd''s aunt', true, null))->>'ok' = 'true', 'and Dana''s');
reset role;
select pg_temp.assert((select count(*) from public.members where email = :'mido_email') = 2, 'Mido has a row in each home');
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home', 'Mido still runs as his own home');
select pg_temp.assert(jsonb_array_length(public.my_homes()) = 2 and (public.me())->>'homes' = '2', 'and is told he is in two');
select pg_temp.assert((select count(*) from jsonb_array_elements(public.my_homes()) h where (h->>'current')::boolean and h->>'name' = 'Our home') = 1, 'with the current one marked');
select pg_temp.assert((public.home_switch(gen_random_uuid()))->>'error' = 'not_member', 'a home he is not in cannot be chosen');
select pg_temp.assert((public.home_switch(:khan_home))->>'ok' = 'true', 'he switches to the Khans');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans' and (public.me())->'role'->>'id' = 'family_carer', 'and from the next request runs as the family carer there');
select pg_temp.assert((public.me())->'subjects'->0->>'name' = 'Zayd' and (select count(*) from public.care_subjects) = 1, 'seeing Zayd and not Lana');
select pg_temp.assert(not public.has_permission('members', 'edit'), 'without his admin powers from home');
select pg_temp.assert((public.home_summary(:lana))->>'ok' = 'false', 'Lana''s summary is refused from there');
select pg_temp.assert((public.home_switch(:'our_home'))->>'ok' = 'true', 'he switches back');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home' and public.has_permission('members', 'edit'), 'and is the admin at home again');
reset role;
-- A scheduled job runs as one row in one home: its client names the row (lib/server/member.ts).
select id as mido_khan from public.members where email = :'mido_email' and household_id = :khan_home \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from public.members where id = :mido), 'role', 'authenticated', 'member_id', :'mido_khan')::text, false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans' and (public.me())->'role'->>'id' = 'family_carer', 'a job for Mido''s row in the Khans runs as that row, whatever his chosen home');
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from public.members where id = :mido), 'role', 'authenticated', 'member_id', :haitham)::text, false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home', 'a claim naming someone else''s row is ignored');
reset role;
-- The home on screen binds the request (migration 4500): the x-home header names it, and it counts only for a home the account is in.
select pg_temp.act_as(:mido);
select set_config('request.headers', jsonb_build_object('x-home', :khan_home)::text, false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans' and (public.me())->'role'->>'id' = 'family_carer', 'a request from a screen showing the Khans runs as Mido''s row there, whatever his chosen home');
select pg_temp.assert((select count(*) from jsonb_array_elements(public.my_homes()) h where (h->>'current')::boolean and h->>'name' = 'The Khans') = 1, 'and the switcher marks it current');
reset role;
select set_config('request.headers', jsonb_build_object('x-home', gen_random_uuid())::text, false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home', 'a header naming a home he is not in is ignored');
reset role;
select set_config('request.headers', '{"x-home":"not-a-uuid"}', false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home', 'and so is a header that is not an id');
reset role;
select set_config('request.headers', '', false);
-- The first sign-in after being listed links the new row too, without moving the account.
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home' and (public.me())->>'homes' = '2', 'Dana''s row in the Khans carries her account; she stays at home');
reset role;
select pg_temp.assert((select count(*) from public.members where user_id = (select user_id from public.members where id = :dana) and is_active) = 2, 'both her rows carry her account');
-- A member makes another home and runs as it from then on.
select pg_temp.act_as(:haitham);
set role authenticated;
select (public.household_create('The Khans at the beach', 'Asia/Dubai', 'Zayd', current_date - 20, 'Boy', 'Haitham'))->>'household_id' as beach_home \gset
select pg_temp.assert(:'beach_home' is not null, 'Haitham, already in a home, makes another');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans at the beach' and (public.me())->>'homes' = '2', 'and runs as it from the next request');
select pg_temp.assert((select count(*) from public.members) = 1 and (select count(*) from public.care_entries) = 0, 'a fresh home: himself and nothing else');
select pg_temp.assert((public.home_switch(:khan_home))->>'ok' = 'true', 'he goes back to the first');
reset role;
-- Deleting a home: its admin, by its exact name, never the first home on the deployment.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.household_delete(:khan_home, 'The Khans'))->>'ok' = 'false', 'Mido, a carer in the Khans'' home, cannot delete it');
select pg_temp.assert((public.household_delete(:'our_home', 'Our home'))->>'error' = 'platform', 'nor his own: the first home holds what every home shares');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.household_delete(:'our_home', 'Our home'))->>'ok' = 'false', 'Haitham cannot delete Mido''s home');
select pg_temp.assert((public.household_delete(:'beach_home', 'The Khans'))->>'error' = 'bad_name', 'nor his own without its exact name');
select pg_temp.assert((public.household_delete(:'beach_home', ' the khans at the beach '))->>'ok' = 'true', 'with the name, the beach home goes');
reset role;
select pg_temp.assert(not exists (select 1 from public.household where id = :'beach_home') and not exists (select 1 from public.members where household_id = :'beach_home') and not exists (select 1 from public.care_subjects where household_id = :'beach_home'), 'home, members and child are gone');
select pg_temp.assert((select count(*) from public.audit_log where target_table = 'household' and target_id = :'beach_home' and allowed) = 1, 'and the deletion is in the audit log, outliving the home');
select pg_temp.assert(exists (select 1 from public.home_cleanups where household_id = :'beach_home' and done_at is null and attempts = 0), 'and its file cleanup is queued for the server');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert(pg_temp.fails('select * from public.home_cleanups'), 'the cleanup queue is the server''s, not a member''s');
-- The rows of the dropped shopping and house tables (migration 4600) were kept, and are the server's too.
select pg_temp.assert(pg_temp.fails('select * from public.retired_rows'), 'the archive of retired rows is not a member''s to read');
reset role;
select pg_temp.assert((select count(*) from public.retired_rows where table_name = 'stores') >= 1, 'the archive holds what the dropped tables held (the seeded stores)');
select pg_temp.assert(not exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('shopping_items', 'tickets', 'hub_entities', 'stores')), 'and the tables themselves are gone');
select pg_temp.assert(not exists (select 1 from public.modules where id in ('shopping', 'maintenance')), 'with their modules');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans' and (public.me())->>'homes' = '1', 'Haitham is back to one home');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home' and (public.me())->>'homes' = '2', 'Mido is at home, still listed in the Khans');
reset role;

\echo 'All Step 1 to 6 database checks passed (view-as, adoptions, finishing, perf, chat, vaccines, end_if, milk, parity, smart care, coach, skills, week, helper skills, entry checks, memory, sprouty, timers, preview guards, signed out, end once, many homes, definer scope, home ops, homes per account, home on screen).'
select count(*) as audit_rows, sum(case when allowed then 0 else 1 end) as denied from public.audit_log;
