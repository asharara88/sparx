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

-- The checks below are written for a child of about five months (a 3 h feed gap, play ideas for her
-- age and for the next band, the 4-month vaccines behind her). The test child has a fixed birth date,
-- 5 June 2026, so the suite used to depend on today's date: it would fail from 5 December 2026, when
-- the gap becomes 4 h, and again when the play ideas run out. Pin her age instead. Checks that need
-- another age set it themselves and put it back (see "the feed gap grows with age"). Her row is dated
-- the day before her birth, so she was in the home from birth: vaccines from before a family joined
-- are left out (migration 6500), and the checks below are about a family that was there throughout.
update public.care_subjects set birth_date = current_date - 160, created_at = now() - interval '161 days' where id = :lana;

-- ---------------------------------------------------------------- as Mido (admin)
-- On a Supabase project app_rls cannot use the auth schema (migration 4000's grant was a no-op
-- there: postgres holds USAGE on auth without the grant option). The local superuser did apply it,
-- which hid six failing functions until migration 4900. Take it away here so the suite runs under
-- the live condition.
revoke usage on schema auth from app_rls;

-- And the shared preview check works from an app_rls function even before anything has cached
-- the caller's identity (the cache is cleared first, then the check runs as app_rls).
select set_config('fam.m.preview', '', true);
set role app_rls;
select pg_temp.assert(private.read_only_preview() = false, 'read_only_preview() runs as app_rls with the auth schema out of reach');
reset role;

select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->>'ok' = 'true' and (public.me())#>>'{role,id}' = 'admin', 'Mido signs in as admin');
select pg_temp.assert((public.me()->'subjects'->0->>'night_from') ~ '^\d\d:\d\d' and (public.me()->'subjects'->0->>'night_to') ~ '^\d\d:\d\d', 'me() carries the child''s night window (migration 5000)');
select pg_temp.assert((public.custody_set(:lana, :dana))->>'ok' = 'true', 'Mido sets who has Lana (Dana)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '2 hours', null, '{"method":"Bottle","amount_ml":120}', null, 'aaaaaaaa-0000-4000-8000-000000000001'))->>'ok' = 'true', 'Mido logs a feed');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '2 hours', null, '{"method":"Bottle","amount_ml":120}', null, 'aaaaaaaa-0000-4000-8000-000000000001'))->>'duplicate' = 'true', 'same client_id twice is idempotent (offline queue)');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '90 minutes', now() - interval '30 minutes', '{"place":"Cot"}', null, null))->>'ok' = 'true', 'Mido logs a nap with an end time');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.medication', now() - interval '1 hour', null, '{"name":"Vitamin D drops","dose":"1 drop"}', null, null))->>'ok' = 'true', 'Mido logs medicine given');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.nope', now(), null, '{}', null, null))->>'error' = 'bad_type', 'an entry type that does not exist is rejected');
-- The latest feed, not today's list: logged two hours ago, it falls on yesterday between midnight and 2 am in Dubai.
select pg_temp.assert((public.home_summary())#>>'{last,lana.feed,by}' = 'Dana', 'entries attribute to whoever has Lana (Dana), not the logger');
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
select pg_temp.assert((public.job_runs_list())->>'ok' = 'true' and jsonb_array_length((public.job_runs_list())->'runs') = 0, 'and the nightly jobs'' record, empty before the first run');
select pg_temp.assert(pg_temp.fails('select * from public.job_runs'), 'the record itself is the server''s, not a member''s');
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
select pg_temp.assert((public.job_runs_list())->>'error' = 'not_allowed', 'nor the nightly jobs'' record');
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
-- Step 3: attachments
-- ===========================================================================
select pg_temp.act_as(:luda);
set role authenticated;
select pg_temp.assert((public.attachment_add('lana', 'care_entries', (select id from public.care_entries where type_id = 'lana.sleep' order by created_at limit 1), 'entries/x.jpg', null, null))->>'ok' = 'true', 'Luda (family carer) attaches a photo to a nap');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.attachment_add('lana', 'care_entries', (select id from public.care_entries where type_id = 'lana.sleep' order by created_at limit 1), 'entries/y.jpg', null, null))->>'ok' = 'false', 'Lilly (no view of the child yet) cannot');
reset role;


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
  jsonb_build_object('title', 'Dentist', 'kind', 'appointment', 'date', (current_date + 3)::text, 'time', '10:00', 'note', 'flea drops'),
  jsonb_build_object('title', 'Big shop', 'kind', 'plan', 'date', (current_date + 4)::text, 'time', null, 'note', null)))))->>'ok' = 'true', 'plan put');
select pg_temp.assert((select count(*) from public.suggestions where member_id = :mido and key = 'plan:test' and status = 'open') = 1, 'plan is open');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'dismiss', 3, null))->>'status' = 'dismissed', 'dismiss a plan');
select pg_temp.assert((select snooze_until from public.suggestions where member_id = :mido and key = 'plan:test') = (now() at time zone (select timezone from public.household limit 1))::date + 3, 'dismissed plans snooze');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.suggestions_list())->'suggestions') x where x->>'key' = 'plan:test') = 0, 'a snoozed plan is not listed');
select pg_temp.assert((public.suggestion_put('plan', 'plan:test', 'Plan for the week', 'Two things', '/calendar', jsonb_build_object('type', 'plan', 'entries', jsonb_build_array(
  jsonb_build_object('title', 'Dentist', 'kind', 'appointment', 'date', (current_date + 3)::text, 'time', '10:00', 'note', 'flea drops'),
  jsonb_build_object('title', 'Big shop', 'kind', 'plan', 'date', (current_date + 4)::text, 'time', null, 'note', null)))))->>'ok' = 'true', 'a new draft reopens it');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'approve', 7, '{"entries":[0]}'))->>'entries' = '1', 'approving with one entry ticked writes one');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'plan:test'), 'approve', 7, null))->>'error' = 'decided', 'cannot decide twice');
select pg_temp.assert(exists (select 1 from public.calendar_events where title = 'Dentist' and kind = 'appointment'), 'the ticked entry is on the calendar');
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
select pg_temp.assert((public.ask_chat_save(null, 'About naps', '[{"role":"user","text":"hi"}]'::jsonb))->>'ok' = 'true', 'Luda saves a chat');
select pg_temp.assert((select count(*) from public.ask_chats) = 1, 'she sees her own chat');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from public.ask_chats) = 0, 'Mido does not see Luda''s chat');
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
-- Migration 6000: a freezer bottle comes out of the freezer, oldest bag first; the fridge is left alone.
select pg_temp.assert((public.milk_add(150, 'freezer', now() - interval '20 days', 'old bag'))->>'ok' = 'true', 'Dana freezes an older bag');
select pg_temp.assert((public.milk_add(150, 'freezer', now() - interval '2 days', 'new bag'))->>'ok' = 'true', 'and a newer one');
create temp table fridge_before as select coalesce(sum(amount_ml), 0) as ml from public.milk_bottles where location = 'fridge' and used_at is null and deleted_at is null;
select pg_temp.assert((public.milk_consume(150, null, 'freezer'))->>'location' = 'freezer', 'a 150 ml freezer bottle is taken from the freezer');
select pg_temp.assert((select used_at is not null from public.milk_bottles where note = 'old bag') and (select used_at is null from public.milk_bottles where note = 'new bag'), 'the oldest bag went first');
select pg_temp.assert((select coalesce(sum(amount_ml), 0) from public.milk_bottles where location = 'fridge' and used_at is null and deleted_at is null) = (select ml from fridge_before), 'and the fridge was not touched');
select pg_temp.assert((public.milk_consume(60, null, 'cupboard'))->>'error' = 'bad_location', 'there is no cupboard');
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

-- Helper memory, second pass (migration 5600): kinds and links, suggestions, edits, expiry,
-- and the chat in progress left out of its own earlier chats.
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.memory_add('Wafa likes a short answer in Arabic.', 'person', :wafa, null, null))->>'ok' = 'true', 'Dana adds a memory about Wafa');
select pg_temp.assert((public.memory_add('Lana settles faster with white noise.', 'child', null, :lana, null))->>'ok' = 'true', 'and one about Lana');
select pg_temp.assert((public.memory_add('A memory about nobody', 'person', null, null, null))->>'error' = 'bad_about', 'a person memory needs the person');
select pg_temp.assert((public.memory_add('A memory about a stranger', 'person', gen_random_uuid(), null, null))->>'error' = 'bad_about', 'and the person must be in this home');
select pg_temp.assert((public.memory_add('A memory with a link it should not have', 'home', :wafa, null, null))->>'error' = 'bad_about', 'a home memory carries no link');
select pg_temp.assert((public.memory_add('Yesterday''s memory', 'home', null, null, now() - interval '1 day'))->>'error' = 'bad_expiry', 'an expiry must be in the future');
select pg_temp.assert((public.memory_add('Bad kind', 'pet', null, null, null))->>'error' = 'bad_kind', 'only home, child and person');
select (public.memory_add('The guests leave on Sunday.', 'home', null, null, now() + interval '2 days'))->>'id' as m_guests \gset
select pg_temp.assert((select x->>'kind' = 'person' and x->'about'->>'name' = 'Wafa' from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' like 'Wafa likes%'), 'memory_list says what each memory is about');
select pg_temp.assert((select x->'subject'->>'name' = 'Lana' from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' like 'Lana settles%'), 'and names the child');
select pg_temp.assert((public.memory_update(:'m_guests', 'The guests leave on Monday.', null))->>'ok' = 'true', 'the author changes a memory in place');
select pg_temp.assert((public.memory_update(:'m_guests', 'Wafa likes a short answer in Arabic.', null))->>'error' = 'duplicate', 'but not into one that exists');
reset role;
update public.assistant_memories set expires_at = now() - interval '1 minute' where id = :'m_guests';
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' like 'The guests%') = 0, 'an expired memory is gone from the list');
select pg_temp.assert((public.memory_add('The guests leave on Monday.', 'home', null, null, null))->>'duplicate' is null, 'and the same sentence can be remembered again');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' = 'The guests leave on Monday.') = 1, 'as a new live memory');
-- Suggestions: only for one of the member's own chats, never a duplicate, capped.
create temp table rc2 as select ((public.ask_chat_save(null, 'Bedtime', '[{"role":"user","text":"bedtime"},{"role":"assistant","text":"ok"},{"role":"user","text":"more"},{"role":"assistant","text":"ok"}]'::jsonb, 'bedtime → ok'))->>'id')::uuid as id;
select pg_temp.assert((public.memory_suggest((select id from rc2), 2, '[{"body":"Bedtime is 19:00 from Monday.","kind":"home"},{"body":"Wafa likes a short answer in Arabic.","kind":"person","about_member_id":"00000000-0000-4000-8000-000000000003"},{"body":"Lana is teething, says Dana.","kind":"child","subject_id":"00000000-0000-4000-8000-00000000a001"},{"body":"A fourth one that is over the three.","kind":"home"}]'::jsonb))->>'added' = '2', 'two of four are new (one is remembered already, one is past the three)');
select pg_temp.assert((select mined_turns from public.ask_chats where id = (select id from rc2)) = 2, 'the chat remembers how far it was read');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.memory_list())->'items') x where x->>'status' = 'suggested') = 2, 'the suggestions are listed');
select pg_temp.assert((select x->>'status' from jsonb_array_elements((public.memory_list())->'items') x limit 1) = 'suggested', 'suggestions come first');
select pg_temp.assert((public.memory_suggest(gen_random_uuid(), 2, '[{"body":"From a chat that is not mine.","kind":"home"}]'::jsonb))->>'error' = 'not_found', 'only for the member''s own chat');
select pg_temp.assert((public.memory_suggest((select id from rc2), 2, '"nope"'::jsonb))->>'error' = 'bad_items', 'items must be a list');
select (x->>'id') as m_sugg from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' like 'Bedtime is 19:00%' \gset
-- The chat in progress is not one of the earlier chats.
select pg_temp.assert((select count(*) from jsonb_array_elements((public.ask_chat_recaps(6, (select id from rc2)))->'items') x where x->>'id' = (select id::text from rc2)) = 0, 'ask_chat_recaps leaves out the chat in progress');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.ask_chat_recaps(6, null))->'items') x where x->>'id' = (select id::text from rc2)) = 1, 'and lists it when none is excluded');
reset role;
-- Wafa (not an admin, not the author) keeps one suggestion and drops the other; cannot edit Dana's memory.
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.memory_keep(:'m_sugg'))->>'ok' = 'true', 'anyone who sees a suggestion can keep it');
select pg_temp.assert((select x->>'status' = 'kept' and x->>'by' = 'Wafa' from jsonb_array_elements((public.memory_list())->'items') x where x->>'id' = :'m_sugg'), 'it is a memory now, hers');
select pg_temp.assert((public.memory_keep(:'m_sugg'))->>'error' = 'not_found', 'a second keep finds nothing');
select pg_temp.assert((public.memory_add('Lana is teething, says Dana.', 'home', null, null, null))->>'kept_suggestion' = 'true', 'typing a suggested sentence by hand keeps the suggestion');
select pg_temp.assert((public.memory_update((select (x->>'id')::uuid from jsonb_array_elements((public.memory_list())->'items') x where x->>'body' like 'Lana settles%'), 'Changed by Wafa', null))->>'error' = 'not_found', 'but cannot change Dana''s memory');
create temp table rc3 as select ((public.ask_chat_save(null, 'Walks', '[{"role":"user","text":"walks"},{"role":"assistant","text":"ok"},{"role":"user","text":"more"},{"role":"assistant","text":"ok"}]'::jsonb, 'walks → ok'))->>'id')::uuid as id;
select pg_temp.assert((public.memory_suggest((select id from rc3), 2, '[{"body":"Lana naps best in the pram after a walk.","kind":"child","subject_id":"00000000-0000-4000-8000-00000000a001"}]'::jsonb))->>'added' = '1', 'a carer''s own chat can suggest too');
select pg_temp.assert((public.memory_remove((select (x->>'id')::uuid from jsonb_array_elements((public.memory_list())->'items') x where x->>'status' = 'suggested' limit 1)))->>'ok' = 'true', 'and anyone can drop a suggestion');
select pg_temp.assert((public.memory_suggest((select id from rc3), 4, '[{"body":"Lana naps best in the pram after a walk.","kind":"home"}]'::jsonb))->>'added' = '0', 'a dropped suggestion is never suggested again');
select pg_temp.assert((select count(*) from jsonb_array_elements_text((public.memory_list())->'dropped') d where d = 'Lana naps best in the pram after a walk.') = 1, 'and memory_list hands the reader what was dropped');
reset role;
select pg_temp.preview_as(:mido, :wafa);
set role authenticated;
select pg_temp.assert((public.memory_keep(gen_random_uuid()))->>'error' = 'not_allowed', 'nothing is kept in a preview');
select pg_temp.assert((public.memory_update(:'m_sugg', 'x y', null))->>'error' = 'not_allowed', 'nor changed');
select pg_temp.assert((public.memory_suggest((select id from rc2), 9, '[]'::jsonb))->>'error' = 'not_allowed', 'nor suggested');
reset role;
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('memory_list', 'memory_add', 'memory_update', 'memory_keep', 'memory_remove', 'memory_suggest', 'ask_chat_recaps') and pg_get_userbyid(p.proowner) = 'app_rls') = 9, 'the memory functions run as app_rls');
update public.ask_chats set deleted_at = now() where id in (select id from rc2 union select id from rc3);
update public.assistant_memories set deleted_at = now() where body in ('Lana naps best in the pram after a walk.', 'The guests leave on Monday.', 'Wafa likes a short answer in Arabic.', 'Lana settles faster with white noise.', 'Bedtime is 19:00 from Monday.', 'Lana is teething, says Dana.') or id = :'m_guests';

\o
\echo

-- Sprouty round (migration 3100): mood type, the story kind, what was tried
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((select is_active from public.care_entry_types where id = 'lana.mood'), 'the mood type is on');
select pg_temp.assert((select f->>'label' from public.care_entry_types t, jsonb_array_elements(t.fields) f where t.id = 'lana.mood' and f->>'key' = 'mood') = 'Mood',
  'its question reads Mood, not "How is she" (migration 6500)');
select pg_temp.assert((public.assistant_brief_save(current_date, 'story', 'Month one.', 'test-model', null))->>'ok' = 'true', 'the monthly story is a brief kind');
create temp table act2 as select x->>'id' as id from jsonb_array_elements((public.activities_list(:lana))->'items') x where x->>'band' = 'now' limit 1;
select pg_temp.assert((public.activity_tick(:lana, (select id from act2), true, null))->>'ok' = 'true', 'Dana ticks an idea');
-- To tomorrow by the server's date: the tick is dated by the home's day, which is already
-- tomorrow in Dubai for the four hours before UTC midnight.
select pg_temp.assert((public.activity_done_list(:lana, current_date - 30, current_date + 1))->>'ok' = 'true', 'and lists what was tried');
select pg_temp.assert((select count(*) from jsonb_array_elements((public.activity_done_list(:lana, current_date - 30, current_date + 1))->'items')) >= 1, 'including that one');
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
-- Every table, not only the ones above: no row of another home is visible to the new family.
do $$
declare t record; v_n bigint; v_home uuid := ((select r from new_home)->>'household_id')::uuid;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'v')
              and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped) loop
    begin
      execute format('select count(*) from public.%I where household_id is distinct from %L', t.relname, v_home) into v_n;
    exception when insufficient_privilege then v_n := 0;
    end;
    if v_n > 0 then raise exception 'ASSERT FAILED: the new family sees % row(s) of another home in %', v_n, t.relname; end if;
  end loop;
  raise notice 'ok  - every table with a home: the new family sees only its own rows';
end $$;
-- And every read-only function it may call with no arguments answers about its own home only.
do $$
declare f record; v text;
begin
  for f in select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.pronargs = 0 and p.provolatile in ('s', 'i') and p.prorettype in ('jsonb'::regtype, 'json'::regtype)
              and has_function_privilege('authenticated', p.oid, 'execute') loop
    begin
      execute format('select public.%I()::text', f.proname) into v;
    exception when others then v := null;
    end;
    if v ~ '\m(Lana|Mido|Dana|Wafa|Luda|Lilly|Haitham|Zayd|Our home|The Khans)\M' then
      raise exception 'ASSERT FAILED: %() shows the new family another home: %', f.proname, left(v, 200);
    end if;
  end loop;
  raise notice 'ok  - every read-only function: no name from another home';
end $$;
reset role;

-- Migration 5700: the helper's daily allowance, the child's emergency number, no 998 in the skills.
select pg_temp.assert((select profile->>'emergency_ambulance' from public.care_subjects where household_id = ((select r from new_home)->>'household_id')::uuid) = '999',
  'a home made in London gets 999 as the child''s emergency number');
select pg_temp.assert((select count(*) from public.assistant_skills where body ~ '\m998\M') = 0, 'the shared skills name no country''s number');
select pg_temp.assert(not has_function_privilege('anon', 'public.assistant_reserve(integer)', 'execute'), 'anon cannot book a model call');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
do $$ begin
  update public.household set settings = '{"assistant_daily_home": null, "assistant_daily_member": null}' where id = private.current_household_id();
  raise exception 'ASSERT FAILED: a home''s admin cleared the helper''s limits from the client';
exception when insufficient_privilege then raise notice 'ok  - a home''s admin cannot change the limits from the client';
end $$;
update public.household set notes = 'Shoes off at the door.' where id = private.current_household_id();
select pg_temp.assert((select notes from public.household where id = private.current_household_id()) = 'Shoes off at the door.', 'the rest of the home''s row is still the admin''s to edit');
reset role;
select pg_temp.assert(pg_get_userbyid((select proowner from pg_proc where proname = 'assistant_reserve')) = 'app_rls', 'the booking runs as app_rls');
select pg_temp.assert(not has_table_privilege('authenticated', 'public.agent_calls', 'select') and not has_table_privilege('authenticated', 'public.agent_calls', 'insert'),
  'the client can neither read nor write the call count directly');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((select a->>'reserved' = 'true' and a->>'platform' = 'false' and (a->>'home_limit')::int = 40 and (a->>'member_limit')::int = 20 and (a->>'home_calls')::int = 0
  from (select public.assistant_reserve() as a) x), 'a new home starts the day with 40 for the home and 20 a member; the first call is booked');
reset role;
update public.household set settings = settings || '{"assistant_daily_home": 2}' where id = ((select r from new_home)->>'household_id')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((select a->>'reserved' = 'true' and (a->>'home_calls')::int = 1 and (a->>'member_calls')::int = 1 from (select public.assistant_reserve() as a) x), 'the second call is booked');
select pg_temp.assert((select a->>'reserved' = 'false' and (a->>'home_calls')::int = 2 and (a->>'home_limit')::int = 2 from (select public.assistant_reserve() as a) x),
  'the third is refused at the home''s limit of 2, with the counts that say why');
reset role;
select pg_temp.assert((select count(*) from public.agent_calls where household_id = ((select r from new_home)->>'household_id')::uuid) = 2, 'a refused call books nothing');
select pg_temp.assert(not exists (select 1 from pg_constraint where conrelid = 'public.agent_calls'::regclass and contype = 'f'),
  'the bookings outlive a deleted home or member, so the day''s total cannot be reset by deleting one');
update public.household set settings = settings || '{"assistant_daily_home": null, "assistant_daily_member": 2}' where id = ((select r from new_home)->>'household_id')::uuid;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((select a->>'reserved' = 'false' and a->'home_limit' = 'null'::jsonb and (a->>'member_limit')::int = 2 from (select public.assistant_reserve() as a) x),
  'null in the settings is no limit for the home; the member''s own limit still holds');
reset role;
update public.household set settings = settings - 'assistant_daily_member' where id = ((select r from new_home)->>'household_id')::uuid;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select a->>'reserved' = 'true' and a->>'platform' = 'true' and a->'home_limit' = 'null'::jsonb and a->'member_limit' = 'null'::jsonb and (a->>'home_calls')::int = 0
  and (a->>'total_calls')::int >= 2 from (select public.assistant_reserve() as a) x), 'the platform home has no limit by default and counts only its own calls; the total sees every home');
select pg_temp.assert((select a->>'reserved' = 'false' from (select public.assistant_reserve(1) as a) x), 'the deployment-wide cap the server passes in holds for the platform home too');
reset role;

-- Migration 5800: the meal, and the feed gap by age.
select pg_temp.assert((select is_active and module_id = 'lana' and not has_end from public.care_entry_types where id = 'lana.meal'), 'the meal type is there, shared like every other');
select pg_temp.assert((select array_agg(f->>'key' order by f->>'key') from public.care_entry_types t, jsonb_array_elements(t.fields) f where t.id = 'lana.meal' and (f->>'fresh')::boolean)
  = array['allergen', 'new_food', 'reaction'], 'a new meal never starts with the last one''s first time, allergen or reaction');
select pg_temp.assert(private.feed_every_min(current_date - 100) = 180 and private.feed_every_min(current_date - 250) = 240
  and private.feed_every_min(current_date - 500) = 300 and private.feed_every_min(null) = 180, 'the feed gap grows with age: 3 h, then 4 h, then 5 h');
select pg_temp.assert(not has_function_privilege('anon', 'private.feed_every_min(date)', 'execute'), 'anon cannot call the feed gap');
create temp table lana_birth as select birth_date from public.care_subjects where id = :lana;
update public.care_subjects set birth_date = current_date - 100 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.meal', now() - interval '5 minutes', null, '{"food":"Avocado","amount":"A few spoons","new_food":"Yes","allergen":"None","reaction":"None"}', null, null))->>'ok' = 'true', 'Mido logs a meal');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '1 minute', null, '{"method":"Bottle","amount_ml":120}', null, null))->>'ok' = 'true', 'and a bottle');
create temp table due_young as
  select (s->'last'->'lana.feed'->>'next_due')::timestamptz - (s->'last'->'lana.feed'->>'occurred_at')::timestamptz as gap from (select public.home_summary(:lana) as s) x;
reset role;
update public.care_subjects set birth_date = current_date - 250 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table due_older as
  select (s->'last'->'lana.feed'->>'next_due')::timestamptz - (s->'last'->'lana.feed'->>'occurred_at')::timestamptz as gap from (select public.home_summary(:lana) as s) x;
reset role;
select pg_temp.assert((select abs(extract(epoch from o.gap) / extract(epoch from y.gap) - 240.0 / 180) < 0.02 from due_young y, due_older o),
  'the same bottle puts the next feed a third further off at 8 months than at 3 months');
update public.care_subjects set birth_date = (select birth_date from lana_birth) where id = :lana;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c001","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((select count(*) from public.care_entries where type_id = 'lana.meal') = 0, 'another home does not see her meals');
reset role;

-- Migration 6500: after the first birthday. A toddler from day 366 on the home's calendar; no clock on
-- a toddler's milk, diapers and sleep; vaccines from before a family joined; the child's name in
-- vaccine_record; the mood label (with the Sprouty checks); safe sleep stops at 12 months.
-- The edge on the home's date, as the feed gap's (migration 6100): at UTC+14 the home's date is ahead
-- of UTC for most of the day, so a check there tells the two apart. Then the same on UTC.
create temp table tz6500 as select h.id, h.timezone from public.household h join public.members m on m.household_id = h.id where m.id = :mido;
create temp table lana6500 as select birth_date, created_at from public.care_subjects where id = :lana;
update public.household set timezone = 'Pacific/Kiritimati' where id = (select id from tz6500);
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(not private.is_toddler((now() at time zone 'Pacific/Kiritimati')::date - 365)
  and private.is_toddler((now() at time zone 'Pacific/Kiritimati')::date - 366), 'a toddler from day 366 on the home''s calendar; day 365 is a baby (home on UTC+14)');
reset role;
update public.household set timezone = 'UTC' where id = (select id from tz6500);
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(not private.is_toddler((now() at time zone 'UTC')::date - 365)
  and private.is_toddler((now() at time zone 'UTC')::date - 366), 'and the same with the home on UTC');
select pg_temp.assert(not private.is_toddler(null), 'with no birth date, never a toddler');
reset role;
update public.household h set timezone = t.timezone from tz6500 t where h.id = t.id;
select pg_temp.assert(not has_function_privilege('anon', 'private.is_toddler(date)', 'execute')
  and has_function_privilege('authenticated', 'private.is_toddler(date)', 'execute') and has_function_privilege('app_rls', 'private.is_toddler(date)', 'execute'),
  'anon cannot call is_toddler; members and app_rls can');

-- One feed, one diaper and one sleep: each has a next due at 300 days and with no birth date, none at
-- 400 days (the key stays, with null); the due list's interval rows go the same way.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '3 minutes', null, '{"method":"Bottle","amount_ml":120}', 'after one test', null))->>'ok' = 'true', 'Mido logs a bottle');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now() - interval '2 minutes', null, '{"kind":"Wet"}', 'after one test', null))->>'ok' = 'true', 'a diaper');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '40 minutes', now() - interval '4 minutes', '{"place":"Cot"}', 'after one test', null))->>'ok' = 'true', 'and a nap');
reset role;
update public.care_subjects set birth_date = current_date - 300 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table clock300 as select public.home_summary(:lana) as s, public.care_due_list(1) as d;
reset role;
update public.care_subjects set birth_date = null where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table clock_none as select public.home_summary(:lana) as s, public.care_due_list(1) as d;
reset role;
update public.care_subjects set birth_date = current_date - 400 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table clock400 as select public.home_summary(:lana) as s, public.care_due_list(1) as d;
reset role;
update public.care_subjects set birth_date = (select birth_date from lana6500) where id = :lana;
update public.care_entries set deleted_at = now() where note = 'after one test' and deleted_at is null;
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is not null and s#>>'{last,lana.diaper,next_due}' is not null and s#>>'{last,lana.sleep,next_due}' is not null from clock300),
  'at 300 days the last feed, diaper and sleep each have a next due');
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is not null and s#>>'{last,lana.diaper,next_due}' is not null and s#>>'{last,lana.sleep,next_due}' is not null from clock_none),
  'and with no birth date');
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is null and s#>>'{last,lana.diaper,next_due}' is null and s#>>'{last,lana.sleep,next_due}' is null from clock400),
  'at 400 days none has a next due');
select pg_temp.assert((select s->'last'->'lana.feed' ? 'next_due' and s->'last'->'lana.diaper' ? 'next_due' and s->'last'->'lana.sleep' ? 'next_due' from clock400),
  'though the key is still there');
select pg_temp.assert((select (s->'last'->'lana.feed') - 'next_due' from clock400) = (select (s->'last'->'lana.feed') - 'next_due' from clock300),
  'and the rest of the last feed is the same at both ages');
select pg_temp.assert((select count(*) from clock300, jsonb_array_elements(d->'items') x where x->>'kind' = 'interval' and x->>'type_id' in ('lana.feed', 'lana.diaper', 'lana.sleep')) = 3,
  'the due list has a feed, a diaper and a sleep row at 300 days');
select pg_temp.assert((select count(*) from clock_none, jsonb_array_elements(d->'items') x where x->>'kind' = 'interval') = 3, 'and with no birth date');
select pg_temp.assert((select count(*) from clock400, jsonb_array_elements(d->'items') x where x->>'kind' = 'interval') = 0, 'and none at 400 days');

-- Vaccines from before a family joined, on the test child. The shape of the live child: her row made on
-- day 127, after the 2-month window closed and five days after the 4-month date, her 4-month doses not
-- recorded, now 165 days old. Birth and 2 months are earlier, except the dose recorded (it stays given);
-- the 4-month doses stay due, never overdue, and are listed.
update public.care_subjects set birth_date = current_date - 165,
  created_at = ((current_date - 165 + 127)::timestamp + interval '12 hours') at time zone (select timezone from tz6500) where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table book127 as select x from jsonb_array_elements((public.vaccines_list(:lana))->'items') x;
create temp table due127 as select x from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine';
reset role;
select pg_temp.assert((select string_agg(x->>'id' || ' ' || (x->>'status'), ', ' order by (x->>'due_age_days')::int, x->>'id') from book127 where (x->>'due_age_days')::int <= 122)
  = 'bcg_1 earlier, hepb_1 earlier, hexa_1 given, pcv_1 earlier, rota_1 earlier, hexa_2 due, pcv_2 due, rota_2 due',
  'joined on day 127: Birth and 2 months earlier but the dose recorded, 4 months due (its date was before the row, its window open)');
select pg_temp.assert(not exists (select 1 from due127 where x->>'visit' in ('Birth', '2 months')), 'Birth and 2 months are not in the due list');
select pg_temp.assert((select x->>'count' = '3' and x->>'overdue' = 'false' from due127 where x->>'visit' = '4 months'), 'the 4-month visit is, with its three doses, and not overdue at 165 days');
-- A family that was there on the dose's date (row made on day 120): the 4-month doses are overdue as before.
update public.care_subjects set created_at = ((current_date - 165 + 120)::timestamp + interval '12 hours') at time zone (select timezone from tz6500) where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table book120 as select x from jsonb_array_elements((public.vaccines_list(:lana))->'items') x;
create temp table due120 as select x from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine';
reset role;
select pg_temp.assert((select bool_and(x->>'status' = 'overdue') from book120 where x->>'visit' = '4 months'), 'joined on day 120, before the 4-month date: those doses are overdue at 165 days');
select pg_temp.assert((select x->>'count' = '3' and x->>'overdue' = 'true' from due120 where x->>'visit' = '4 months'), 'and listed as overdue');
-- One visit with a 28-day and a 60-day dose (the flu dose, switched on here), the row made between the two
-- closing days (211 and 243): the 60-day dose is still listed, alone, and the visit is not overdue.
update public.vaccine_schedule set is_active = true where id = 'flu_1';
update public.care_subjects set birth_date = current_date - 230,
  created_at = ((current_date - 230 + 220)::timestamp + interval '12 hours') at time zone (select timezone from tz6500) where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table book220 as select x from jsonb_array_elements((public.vaccines_list(:lana))->'items') x;
create temp table due220 as select x from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine';
reset role;
update public.vaccine_schedule set is_active = false where id = 'flu_1';
update public.care_subjects set birth_date = (select birth_date from lana6500), created_at = (select created_at from lana6500) where id = :lana;
select pg_temp.assert((select string_agg(x->>'id' || ' ' || (x->>'status'), ', ' order by x->>'id') from book220 where x->>'visit' = '6 months') = 'bopv_1 earlier, flu_1 due, hexa_3 earlier, pcv_3 earlier',
  'per dose: the 28-day doses of the visit are earlier, the 60-day dose is due');
select pg_temp.assert((select x->>'count' = '1' and x->>'label' = 'Vaccines, 6 months: Flu (seasonal) (1)' and x->>'overdue' = 'false' from due220 where x->>'visit' = '6 months'),
  'and the due list keeps that one dose, not overdue');
select pg_temp.assert((select birth_date = (select birth_date from lana6500) and created_at = (select created_at from lana6500) from public.care_subjects where id = :lana)
  and not (select is_active from public.vaccine_schedule where id = 'flu_1'), 'her age, her row''s date and the schedule are put back');

-- A late joiner: a new account makes a home for a child of 400 days. Birth to 12 months are earlier and
-- out of the due list; the 18-month visit is upcoming. Recording one earlier dose leaves the rest earlier.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c651', 'late400@test.local') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c651","role":"authenticated"}', false);
set role authenticated;
create temp table late400 as select public.household_create('Late at 400', 'Asia/Dubai', 'Omar', current_date - 400, 'Boy', 'Rami') as r;
select r->>'subject_id' as omar, r->>'household_id' as omar_home from late400 \gset
create temp table book400 as select x from jsonb_array_elements((public.vaccines_list(:'omar'))->'items') x;
create temp table due400 as select x from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine';
reset role;
select pg_temp.assert((select r->>'ok' from late400) = 'true', 'a family joins with a child of 400 days');
select pg_temp.assert((select count(*) = 13 and bool_and(x->>'status' = 'earlier') from book400 where (x->>'due_age_days')::int <= 365),
  'its Birth to 12-month doses (13) are all earlier');
select pg_temp.assert((select count(*) = 3 and bool_and(x->>'status' = 'upcoming') from book400 where x->>'visit' = '18 months'), 'the 18-month visit is upcoming');
select pg_temp.assert(not exists (select 1 from due400 where x->>'visit' in ('Birth', '2 months', '4 months', '6 months', '12 months')), 'none of the earlier visits is in the due list');
select pg_temp.assert((select x->>'overdue' = 'false' from due400 where x->>'visit' = '18 months'), 'the 18-month visit is, looking far enough ahead, and not overdue');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c651","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.vaccine_record(:'omar', 'bcg_1', current_date - 400, 'Hospital', null, null))->>'ok' = 'true', 'the family records BCG, given before they joined');
select pg_temp.assert((public.vaccine_record(:'omar', 'hepb_1', current_date - 401, null, null, null))->>'message' = 'That is before Omar was born.', 'a date before the birth names the child');
create temp table book400b as select x from jsonb_array_elements((public.vaccines_list(:'omar'))->'items') x;
create temp table due400b as select x from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'kind' = 'vaccine';
-- Another home's member is refused as before, both ways.
select pg_temp.assert((public.vaccines_list(:lana))->>'error' = 'not_found' and (public.vaccine_record(:lana, 'pcv_2', current_date, null, null, null))->>'error' = 'not_found',
  'the new family can neither read nor write Lana''s vaccine book');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'subject' <> 'Omar'), 'and its due list has only Omar');
reset role;
select pg_temp.assert((select string_agg(x->>'id' || ' ' || (x->>'status'), ', ' order by x->>'id') from book400b where x->>'visit' = 'Birth') = 'bcg_1 given, hepb_1 earlier',
  'the recorded dose is given and the other stays earlier');
select pg_temp.assert(not exists (select 1 from due400b where x->>'visit' = 'Birth'), 'the Birth visit stays out of the due list');
select pg_temp.assert((select count(*) from public.vaccinations where subject_id = :'omar' and deleted_at is null) = 1, 'one dose was recorded');
select pg_temp.assert(pg_get_userbyid((select proowner from pg_proc where oid = 'public.vaccine_record(uuid, text, date, text, text, text)'::regprocedure)) = 'app_rls',
  'vaccine_record still runs as app_rls');
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.vaccines_list(:'omar'))->>'error' = 'not_found' and (public.vaccine_record(:'omar', 'hepb_1', current_date, null, null, null))->>'error' = 'not_found',
  'nor can Mido read or write Omar''s');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.care_due_list(400))->'items') x where x->>'subject' = 'Omar'), 'nor see him in his due list');
reset role;

-- A child of 380 days: the 12-month date was before the family joined, its window still open. Those doses
-- are due and listed, and stay due (never overdue) when her birth date and join date both move back 30 days.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c652', 'late380@test.local') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c652","role":"authenticated"}', false);
set role authenticated;
create temp table late380 as select public.household_create('Late at 380', 'Asia/Dubai', 'Noor', current_date - 380, 'Girl', 'Huda') as r;
select r->>'subject_id' as noor, r->>'household_id' as noor_home from late380 \gset
create temp table book380 as select x from jsonb_array_elements((public.vaccines_list(:'noor'))->'items') x;
create temp table due380 as select x from jsonb_array_elements((public.care_due_list(30))->'items') x where x->>'kind' = 'vaccine';
reset role;
create temp table noor6500 as select birth_date, created_at from public.care_subjects where id = :'noor';
update public.care_subjects set birth_date = birth_date - 30, created_at = created_at - interval '30 days' where id = :'noor';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c652","role":"authenticated"}', false);
set role authenticated;
create temp table book410 as select x from jsonb_array_elements((public.vaccines_list(:'noor'))->'items') x;
create temp table due410 as select x from jsonb_array_elements((public.care_due_list(30))->'items') x where x->>'kind' = 'vaccine';
reset role;
update public.care_subjects s set birth_date = n.birth_date, created_at = n.created_at from noor6500 n where s.id = :'noor';
select pg_temp.assert((select r->>'ok' from late380) = 'true', 'a family joins with a child of 380 days');
select pg_temp.assert((select count(*) = 2 and bool_and(x->>'status' = 'due') from book380 where x->>'visit' = '12 months'), 'her 12-month doses are due');
select pg_temp.assert((select x->>'count' = '2' and x->>'overdue' = 'false' from due380 where x->>'visit' = '12 months'), 'and listed');
select pg_temp.assert((select count(*) = 2 and bool_and(x->>'status' = 'due') from book410 where x->>'visit' = '12 months'), 'thirty days on, past the window, still due, not overdue');
select pg_temp.assert((select x->>'count' = '2' and x->>'overdue' = 'false' from due410 where x->>'visit' = '12 months'), 'and still listed, not overdue');
select pg_temp.assert((select s.birth_date = n.birth_date and s.created_at = n.created_at from public.care_subjects s, noor6500 n where s.id = :'noor'), 'her dates are put back');

-- The two late homes go, by their admins, through the app's own call.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c651","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.household_delete(:'omar_home', 'Late at 400'))->>'ok' = 'true', 'the 400-day home is deleted');
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c652","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.household_delete(:'noor_home', 'Late at 380'))->>'ok' = 'true', 'and the 380-day home');
reset role;

-- The safe sleep skill is for a baby: it stops at 12 months.
select pg_temp.assert((select age_to_days from public.assistant_skills where id = 'safe_sleep') = 365, 'the safe sleep skill stops at 12 months');

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
-- Migration 5700: an e-mail on the list joins only once that e-mail is confirmed.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.member_save(null, 'Neighbour', 'neighbour@test.local', 'family_carer', null, null, true, null))->>'ok' = 'true', 'Mido lists a neighbour by e-mail');
reset role;
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-4000-8000-00000000c00a', 'neighbour@test.local', null) on conflict do nothing;
select pg_temp.assert((select user_id from public.members where email = 'neighbour@test.local') is null, 'an unconfirmed account is not linked when it is made');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c00a","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.me())->>'error' = 'no_member', 'nor when it signs in');
reset role;
select pg_temp.assert((select user_id from public.members where email = 'neighbour@test.local') is null, 'the listed row stays free');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-00000000c00a';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c00a","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.me())->'member'->>'display_name' = 'Neighbour', 'once confirmed, the first sign-in joins the listed member');
reset role;
delete from public.members where email = 'neighbour@test.local';
delete from auth.users where id = '00000000-0000-4000-8000-00000000c00a';
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
      and p.proname not in ('current_member_id', 'has_permission', 'link_current_user', 'household_create', 'my_homes', 'home_switch', 'household_delete',
                            'timers_close_forgotten', 'timers_close_overdue', 'member_invite_create', 'member_invite_peek', 'member_invite_accept', 'members_accounts')) = 0,
  'every definer function in public belongs to app_rls, except the twelve that must see across homes or read the accounts');
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_rls'
      and p.proname not in ('current_household_id', 'only_household_id', 'home_for_new_rows', 'platform_home', 'shared_locked', 'photo_in_my_home',
                            'audit_write', 'auth_user_id_by_email', 'handle_auth_user_created', 'care_custody_fill_module', 'care_entries_fill_module', 'seed_home',
                            'preview_member_id', 'timers_close_forgotten', 'timers_close_overdue', 'user_signed_in', 'agent_calls_total_today')) = 0,
  'and so does every data-reading helper in private');
select pg_temp.assert(has_schema_privilege('app_rls', 'public', 'CREATE') and has_schema_privilege('app_rls', 'private', 'CREATE'), 'app_rls may own functions in both schemas (the transfer needs CREATE)');
-- And none of them may reach into the auth schema: the token is read through public.current_member_id()
-- and private.preview_member_id(), which stayed with postgres (migration 4900).
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and pg_get_userbyid(p.proowner) = 'app_rls' and p.prosrc ~ 'auth\.') = 0,
  'no function app_rls owns names the auth schema');
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
-- A named home the account is not in is a refusal, never a fallback (migration 4700).
select set_config('request.headers', jsonb_build_object('x-home', gen_random_uuid())::text, false);
set role authenticated;
select pg_temp.assert((public.me())->>'error' = 'not_in_home' and jsonb_array_length((public.me())->'homes') = 2, 'a header naming a home he is not in gets not_in_home, with his two homes to pick from');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}', null, null))->>'ok' = 'false', 'and a write under it is refused, not redirected to his chosen home');
select pg_temp.assert((select count(*) from public.members) = 0, 'and he reads nothing');
reset role;
-- Revoked membership: a phone still showing the Khans after Mido is deactivated there.
update public.members set is_active = false where id = :'mido_khan';
select set_config('request.headers', jsonb_build_object('x-home', :khan_home)::text, false);
set role authenticated;
select pg_temp.assert((public.me())->>'error' = 'not_in_home', 'a home he was removed from refuses him the same way');
select pg_temp.assert((public.care_entry_log(:zayd, 'lana.diaper', now(), null, '{"kind":"Wet"}', null, null))->>'ok' = 'false', 'and his write into it is refused');
reset role;
update public.members set is_active = true where id = :'mido_khan';
select set_config('request.headers', '{"x-home":"not-a-uuid"}', false);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home', 'a header that is not an id names no home, so his chosen home applies');
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
insert into public.retired_rows (household_id, table_name, row) values (:'beach_home', 'shopping_items', '{"name":"Sunscreen"}');  -- as the server would, for the cascade check below
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
select pg_temp.assert(not exists (select 1 from public.retired_rows where household_id = :'beach_home'), 'and its share of the archived rows went with it');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert(pg_temp.fails('select * from public.home_cleanups'), 'the cleanup queue is the server''s, not a member''s');
-- The rows of the dropped shopping and house tables (migration 4600) were kept, and are the server's too.
select pg_temp.assert(pg_temp.fails('select * from public.retired_rows'), 'the archive of retired rows is not a member''s to read');
reset role;
select pg_temp.assert((select count(*) from public.retired_rows where table_name = 'stores' and household_id = private.platform_home()) >= 1, 'the archive holds what the dropped tables held (the seeded stores, filed under the first home so a backup carries them)');
select pg_temp.assert(not exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('shopping_items', 'tickets', 'hub_entities', 'stores')), 'and the tables themselves are gone');
select pg_temp.assert(not exists (select 1 from public.modules where id in ('shopping', 'maintenance')), 'with their modules');
-- And the pet (migration 4800): its subject and entry types archived and gone, the routines feature with it, every subject a child.
select pg_temp.assert((select count(*) from public.retired_rows where table_name in ('care_subjects', 'care_entry_types')) >= 8, 'the pet''s subject and its seven entry types are archived');
select pg_temp.assert(not exists (select 1 from public.care_subjects where kind <> 'child') and not exists (select 1 from public.modules where id = 'fanta') and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'care_routines'), 'and gone, with the module and the routines table');
select pg_temp.assert(pg_temp.fails('insert into public.care_subjects (module_id, kind, name) values (''lana'', ''pet'', ''Rex'')'), 'a care subject can only be a child now');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'The Khans' and (public.me())->>'homes' = '1', 'Haitham is back to one home');
select pg_temp.assert((public.job_runs_list())->>'error' = 'not_allowed', 'the nightly jobs'' record is the platform home''s; another home does not read it');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->'household'->>'name' = 'Our home' and (public.me())->>'homes' = '2', 'Mido is at home, still listed in the Khans');
reset role;

-- Timers left on (migration 5200). In this test household only sleep and the night wake-up are
-- timers (the feed type's has_end is off here); live, a breastfeed is one too and gets the 20 min cap.
reset role;
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, payload, logged_by, household_id) values
  ('cccccccc-0000-4000-8000-000000000001', :lana, 'lana', 'lana.wake', now() - interval '2 days', '{}', :mido, (select household_id from public.care_subjects where id = :lana));
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(
  not exists (select 1 from jsonb_array_elements((public.home_summary())->'ongoing') o
               where o->>'id' = (select id::text from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000001')),
  'a timer left on for more than a day is not running on the home screen');
select pg_temp.assert(pg_temp.fails('select public.timers_close_forgotten()'), 'the nightly timers job is the server''s, not a member''s');
select pg_temp.assert((private.timers_close_forgotten(interval '0', null))->>'error' = 'not_allowed', 'nor can a member reach every home through the helper');
select pg_temp.assert((private.timers_close_forgotten(interval '0', :lana))->>'error' = 'not_allowed', 'nor shorten the day-old rule');
select pg_temp.assert((private.timers_close_forgotten(interval '24 hours', :zayd))->>'error' = 'not_allowed', 'nor reach a child of another home');
reset role;
-- Nor a member who may not log for the child (the carer's role, with logging taken away for the check), nor a view-as preview.
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action = 'add';
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((private.timers_close_forgotten(interval '24 hours', :lana))->>'error' = 'not_allowed', 'nor can a member who may not log for the child');
reset role;
update public.permissions set allowed = true where role_id = 'home_carer' and module_id = 'lana' and action = 'add';
select pg_temp.preview_as(:mido, :lilly);
set role authenticated;
select pg_temp.assert((private.timers_close_forgotten(interval '24 hours', :lana))->>'error' = 'not_allowed', 'nor a view-as preview, which is read only');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
reset role;
-- An earlier check's feed is still open, two hours in; the limits (migration 5500) would close
-- it too, so it is ended by hand first and the count below is the wake-up's alone.
update public.care_entries set ended_at = occurred_at + interval '10 minutes' where client_id = 'aaaaaaaa-0000-4000-8000-000000000001' and ended_at is null;
-- The wake-up above was closed the moment Mido opened Home (migration 5500), so the nightly
-- gets a wake-up of its own, left on for two days with nobody opening Home in between.
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, payload, logged_by, household_id) values
  ('cccccccc-0000-4000-8000-000000000007', :lana, 'lana', 'lana.wake', now() - interval '2 days', '{}', :mido, (select household_id from public.care_subjects where id = :lana));
-- As the server: its own key, no member behind it (the production cron), so no home in scope.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select pg_temp.assert((public.timers_close_forgotten())->>'closed' = '1', 'the nightly job closes the night wake-up left on for two days, with no member behind it');
reset role;
select pg_temp.assert((select ended_at = occurred_at + interval '1 hour' and note like '%Timer left on; end set to 1 h.%' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000001'),
  'a wake-up left on ends 1 h after it started, with a note');
-- A new start closes a timer of its type left on since yesterday instead of handing it back.
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, payload, logged_by, household_id) values
  ('cccccccc-0000-4000-8000-000000000002', :lana, 'lana', 'lana.sleep', now() - interval '30 hours', '{}', :mido, (select household_id from public.care_subjects where id = :lana)),
  ('cccccccc-0000-4000-8000-000000000004', :lana, 'lana', 'lana.wake', now() - interval '30 hours', '{}', :mido, (select household_id from public.care_subjects where id = :lana));
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now(), null, '{}', null, 'cccccccc-0000-4000-8000-000000000003'))->>'ok' = 'true', 'a new sleep can start while one was left on since yesterday');
select pg_temp.assert((select ended_at is null from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000004'), 'only a timer of the same type is closed by the new start; the wake-up left on is not touched');
select pg_temp.assert((select ended_at = occurred_at + interval '12 hours' and note like '%Timer left on; end set to 12 h.%' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000002'),
  'the sleep left on ends 12 h after it started, with a note, instead of being handed back');
reset role;
update public.care_entries set ended_at = now() where client_id in ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004');
select pg_temp.assert((select ended_at = occurred_at + interval '1 hour' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000007'), 'the nightly closed its wake-up at 1 h');

-- Timer limits (migration 5500): a feed runs an hour at most, a sleep a day. Past that it
-- is closed at its usual length the moment someone who may log for the child opens Home.
-- The feed is a timer for these checks, as in a home that breastfeeds (the demo's is).
select has_end as feed_was_timer from public.care_entry_types where id = 'lana.feed' \gset
update public.care_entry_types set has_end = true where id = 'lana.feed';
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, payload, logged_by, household_id) values
  ('cccccccc-0000-4000-8000-000000000005', :lana, 'lana', 'lana.feed', now() - interval '2 hours', '{"method":"Breast","side":"Left"}', :mido, (select household_id from public.care_subjects where id = :lana)),
  ('cccccccc-0000-4000-8000-000000000006', :lana, 'lana', 'lana.sleep', now() - interval '20 hours', '{}', :mido, (select household_id from public.care_subjects where id = :lana));
select id as feed5 from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000005' \gset
select id as sleep6 from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000006' \gset
-- A member who may only look (the carer, logging taken away for the check) closes nothing.
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action = 'add';
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.home_summary(:lana))->>'ok' = 'true', 'Home still opens for a member who may not log');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.home_summary(:lana))->'ongoing') o where o->>'id' = :'feed5'), 'but a feed past the hour is not shown as running to anyone');
reset role;
update public.permissions set allowed = true where role_id = 'home_carer' and module_id = 'lana' and action = 'add';
select pg_temp.assert((select ended_at is null from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000005'), 'a member who may not log leaves the timer to be closed by one who may');
-- Nor a view-as preview.
select pg_temp.preview_as(:mido, :lilly);
set role authenticated;
select pg_temp.assert((private.timers_close_overdue(:lana))->>'error' = 'not_allowed', 'a view-as preview cannot close timers');
reset role;
-- Mido opens Home: the feed past the hour is closed at 20 min; the sleep at 20 h still runs.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.home_summary(:lana))->'ongoing') o where o->>'id' = :'sleep6'), 'a sleep of 20 hours is still running: the limit is a day');
reset role;
select pg_temp.assert((select ended_at = occurred_at + interval '20 minutes' and note like '%Timer left on; end set to 20 min.%' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000005'),
  'the feed past the hour was closed at 20 min with a note when Home opened');
-- The real end, stopped on a phone with no signal and synced after the hour, replaces the guess.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_end(:'feed5', now() - interval '85 minutes'))->>'ok' = 'true', 'a real end replaces the end the limit guessed');
select pg_temp.assert((public.care_entry_end(:'feed5', now() - interval '80 minutes'))->>'error' = 'already_ended', 'and a second end is refused as before');
reset role;
select pg_temp.assert((select ended_at - occurred_at between interval '34 minutes' and interval '36 minutes' and (payload ? 'auto_end') = false and coalesce(note, '') not like '%Timer left on%' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000005'),
  'the feed carries the real end, no guess flag and no note');
-- A hand that corrects a guessed end in the sheet wins over a stop that syncs later.
insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, payload, logged_by, household_id) values
  ('cccccccc-0000-4000-8000-000000000008', :lana, 'lana', 'lana.feed', now() - interval '3 hours', '{"method":"Breast","side":"Right"}', :mido, (select household_id from public.care_subjects where id = :lana));
select id as feed8 from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000008' \gset
select pg_temp.act_as(:mido);
set role authenticated;
select private.timers_close_overdue(:lana, 'lana.feed');
select pg_temp.assert((public.care_entry_update(:'feed8', now() - interval '3 hours', now() - interval '140 minutes', '{"method":"Breast","side":"Right","auto_end":true}'::jsonb, 'Timer left on; end set to 20 min.'))->>'ok' = 'true',
  'the sheet corrects a guessed end, sending the payload and note it was given');
select pg_temp.assert((public.care_entry_end(:'feed8', now() - interval '100 minutes'))->>'error' = 'already_ended', 'a stop syncing after the correction is refused');
reset role;
select pg_temp.assert((select ended_at - occurred_at between interval '39 minutes' and interval '41 minutes' and (payload ? 'auto_end') = false and note is null from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000008'),
  'the corrected end stays, the guess flag and its note are gone');
-- The same through the entry check: keeping or ending a flagged entry clears the flag.
update public.care_entries set ended_at = occurred_at + interval '20 minutes', payload = payload || '{"auto_end": true}', note = 'Timer left on; end set to 20 min.' where id = :'feed8';
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_check(:'feed8', 'end', now() - interval '130 minutes'))->>'ok' = 'true', 'the check ends a flagged entry');
select pg_temp.assert((public.care_entry_end(:'feed8', now() - interval '100 minutes'))->>'error' = 'already_ended', 'and a stop syncing after that is refused too');
reset role;
select pg_temp.assert((select (payload ? 'auto_end') = false and note is null and payload->>'checked' = 'true' from public.care_entries where id = :'feed8'), 'the check cleared the flag and the note');
select pg_temp.assert((select ended_at is null from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000006'), 'the sleep of 20 hours was left alone');
-- Past the day, the sleep goes too, at 12 h.
update public.care_entries set occurred_at = now() - interval '25 hours' where client_id = 'cccccccc-0000-4000-8000-000000000006';
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.home_summary(:lana))->'ongoing') o where o->>'id' = :'sleep6'), 'past a day the sleep is not running either');
reset role;
select pg_temp.assert((select ended_at = occurred_at + interval '12 hours' and note like '%Timer left on; end set to 12 h.%' from public.care_entries where client_id = 'cccccccc-0000-4000-8000-000000000006'),
  'a sleep past the day was closed at 12 h with a note when Home opened');
update public.care_entry_types set has_end = :'feed_was_timer' where id = 'lana.feed';

-- ============================================================================
-- Joining by invite link (migration 5300): an admin sends a link, whoever opens it
-- becomes that member, whatever e-mail they signed in with.
-- ============================================================================
\set c003 '''00000000-0000-4000-8000-00000000c003'''
\set c004 '''00000000-0000-4000-8000-00000000c004'''
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.member_invite_create(:wafa))->>'error' = 'not_allowed', 'a carer cannot make invite links');
select pg_temp.assert((public.members_accounts())->>'error' = 'not_allowed', 'nor see who has signed in');
reset role;
select pg_temp.preview_as(:mido, :lilly);
set role authenticated;
select pg_temp.assert((public.member_invite_create(:wafa))->>'error' = 'not_allowed', 'nor a view-as preview');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.members_accounts())->'members'->>'00000000-0000-4000-8000-000000000003' = 'never', 'Mido sees that Wafa''s account has never signed in');
select pg_temp.assert((public.member_invite_create(:haitham))->>'error' = 'not_found', 'and cannot make a link for a member of another home');
select (public.member_invite_create(:wafa))->>'token' as inv_wafa \gset
select pg_temp.assert((public.member_invite_create(:wafa))->>'ok' = 'true' and (public.member_invite_create(:wafa))->>'token' = :'inv_wafa', 'Mido makes a link for Wafa, and asking again hands back the same open link');
select pg_temp.assert((public.member_invite_create(:wafa))->>'signed_in' = 'false', 'which says she has not signed in yet');
select (public.me())->'household'->>'name' as home_name \gset
reset role;
-- Whoever opens the link, signed out, sees where it leads.
select set_config('request.jwt.claims', '', false);
set role anon;
select pg_temp.assert((public.member_invite_peek(:'inv_wafa'))->>'state' = 'open' and (public.member_invite_peek(:'inv_wafa'))->>'home' = :'home_name'
  and (public.member_invite_peek(:'inv_wafa'))->>'display_name' = 'Wafa' and (public.member_invite_peek(:'inv_wafa'))->>'invited_by' = 'Mido',
  'signed out, the link shows the home, the name and who sent it');
select pg_temp.assert((public.member_invite_peek(gen_random_uuid()))->>'error' = 'not_found', 'a made-up link shows nothing');
select pg_temp.assert(pg_temp.fails('select public.member_invite_accept(' || quote_literal(:'inv_wafa') || ')'), 'and cannot be accepted without signing in');
select pg_temp.assert(pg_temp.fails('select * from private.member_invites'), 'nor are the links readable');
reset role;
-- Wafa signs in with her real e-mail, one nobody listed: in no home, until the link.
insert into auth.users (id, email, last_sign_in_at) values (:c003, 'wafa.real@test.local', now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c003","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.me())->>'error' = 'no_member', 'an e-mail nobody listed is in no home');
create temp table joined as select public.member_invite_accept(:'inv_wafa') as r;
select pg_temp.assert((select r->>'ok' from joined) = 'true' and (select r->>'display_name' from joined) = 'Wafa', 'the link makes the account Wafa');
select pg_temp.assert((public.me())->>'ok' = 'true' and (public.me())->'member'->>'display_name' = 'Wafa' and (public.me())->'household'->>'name' = :'home_name', 'and me() is Wafa in the family home from now on');
select pg_temp.assert((select user_id = :c003 and email = 'wafa.real@test.local' from public.members where id = :wafa), 'the row carries her account and the e-mail she really signs in with');
select pg_temp.assert((public.member_invite_peek(:'inv_wafa'))->>'state' = 'joined', 'the link now says she is in');
select pg_temp.assert((public.member_invite_accept(:'inv_wafa'))->>'already' = 'true', 'and tapping it again just lands her there');
reset role;
select pg_temp.assert((select count(*) from auth.users where email = 'wafa@test.local') = 0, 'the placeholder account that never signed in is gone');
-- Nobody else can use it.
insert into auth.users (id, email, last_sign_in_at) values (:c004, 'stranger@test.local', now());
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c004","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.member_invite_peek(:'inv_wafa'))->>'state' = 'used', 'to another account the link is used');
select pg_temp.assert((public.member_invite_accept(:'inv_wafa'))->>'error' = 'used', 'and refused');
reset role;
-- A link never takes over an account that has signed in.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.members_accounts())->'members'->>'00000000-0000-4000-8000-000000000003' = 'signed_in', 'Mido now sees Wafa as signed in');
select (public.member_invite_create(:wafa))->>'token' as inv_wafa2 \gset
select pg_temp.assert((public.member_invite_create(:wafa))->>'signed_in' = 'true', 'a new link for her says so');
select (public.member_invite_create(:luda))->>'token' as inv_luda \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c004","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.member_invite_accept(:'inv_wafa2'))->>'error' = 'taken', 'a stranger with her new link cannot become her');
reset role;
select pg_temp.assert((select user_id from public.members where id = :wafa) = :c003, 'she is still herself');
-- A week later the link is dead.
update private.member_invites set expires_at = now() - interval '1 hour' where token = :'inv_luda';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c004","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.member_invite_peek(:'inv_luda'))->>'state' = 'expired' and (public.member_invite_accept(:'inv_luda'))->>'error' = 'expired', 'an old link is refused');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select (public.member_invite_create(:luda))->>'token' as inv_luda2 \gset
select pg_temp.assert(:'inv_luda2' <> :'inv_luda', 'asking again after it expired makes a new one');
reset role;
-- Someone already in the home as themselves stays themselves.
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.member_invite_accept(:'inv_luda2'))->>'error' = 'already_member', 'Dana cannot become Luda: she is already in the home');
reset role;
-- Nor someone taken out of the home: an inactive row is made active again, never doubled.
update public.members set is_active = false where id = :dana;
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.member_invite_accept(:'inv_luda2'))->>'error' = 'inactive_member', 'nor can Dana, made inactive, come back as Luda');
reset role;
update public.members set is_active = true where id = :dana;
-- An account from another home joins this one too, and is in two homes.
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.member_invite_accept(:'inv_luda2'))->>'ok' = 'true', 'Haitham takes the place made for Luda');
select pg_temp.assert((public.me())->'member'->>'display_name' = 'Luda' and (public.me())->'household'->>'name' = :'home_name' and (public.me())->>'homes' = '2', 'and runs as the family home now, with the Khans in his switcher');
select pg_temp.assert((public.home_switch(:khan_home))->>'ok' = 'true' and (public.me())->'household'->>'name' = 'The Khans', 'and can switch back');
reset role;
select pg_temp.assert((select count(*) from auth.users where email = 'luda@test.local') = 0, 'Luda''s placeholder account is gone too');

-- Badges (migration 5900): won from the log, once, by whoever did it; nobody hands themselves one.
select household_id as fam_home from public.members where id = :dana \gset
insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id)
select :lana, 'lana', 'lana.pump', ((now() at time zone h.timezone)::date - d)::timestamp at time zone h.timezone + interval '10 hours',
       jsonb_build_object('amount_ml', ceil(h.milk_target_ml * 1.2)), h.id
  from public.household h, generate_series(1, 3) d
 where h.id = :'fam_home';
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_check())->'new') x where x->>'badge' = 'pump_goal' and x->>'tier' = '2' and x->>'mine' = 'true'), 'Dana wins three days on her pumping goal');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_check())->'new') x where x->>'badge' = 'pump_beat' and x->>'tier' = '1'), 'and beating it by a tenth');
select pg_temp.assert(((public.achievements_list())->'numbers'->>'best_run')::int >= 3, 'the shelf has her best run');
select pg_temp.assert(((public.achievements_seen((select array_agg((x->>'id')::uuid) from jsonb_array_elements((public.achievements_check())->'new') x)))->>'seen')::int >= 2, 'she has seen them');
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'new') = 0, 'so they do not show again');
select pg_temp.assert((select count(*) from public.achievements where badge = 'pump_goal' and tier = 2) = 1, 'checking again wins nothing twice');
select pg_temp.assert(pg_temp.fails($q$insert into public.achievements (household_id, member_id, badge, tier) values (private.current_household_id(), public.current_member_id(), 'pump_goal', 5)$q$), 'nobody writes a badge for themselves');
select pg_temp.assert(pg_temp.fails($q$update public.achievements set tier = 5$q$) or (select count(*) from public.achievements where tier = 5) = 0, 'nor raises one');
reset role;
-- A run forgives one day off a week (migration 6900). On goal 6 and 5 days ago, nothing 4 days
-- ago, then the three days above: one run of five.
insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id)
select :lana, 'lana', 'lana.pump', ((now() at time zone h.timezone)::date - d)::timestamp at time zone h.timezone + interval '10 hours',
       jsonb_build_object('amount_ml', h.milk_target_ml), h.id
  from public.household h, unnest(array[5, 6]) d
 where h.id = :'fam_home';
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert(((public.achievements_list())->'numbers'->>'current_run')::int = 5 and ((public.achievements_list())->'numbers'->>'best_run')::int = 5, 'one day off in the week does not break her run: five days on goal, the day off not counted');
reset role;
-- A second day off inside the same week is not stepped over: on goal 9 and 8 days ago makes
-- the day 7 days ago the one forgiven, and the day 4 days ago ends that run.
insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id)
select :lana, 'lana', 'lana.pump', ((now() at time zone h.timezone)::date - d)::timestamp at time zone h.timezone + interval '10 hours',
       jsonb_build_object('amount_ml', h.milk_target_ml), h.id
  from public.household h, unnest(array[8, 9]) d
 where h.id = :'fam_home';
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert(((public.achievements_list())->'numbers'->>'current_run')::int = 3 and ((public.achievements_list())->'numbers'->>'best_run')::int = 4, 'a second day off in the same week is not forgiven: the older run ends at four, the newer stands at three');
select pg_temp.assert((select count(*) from public.achievements where badge = 'pump_goal' and tier = 2) = 1, 'and the medal she won is still hers');
reset role;
-- Yesterday missed: the run is still going today, because yesterday can be the day off.
update public.care_entries e set deleted_at = now()
  from public.household h
 where h.id = :'fam_home' and e.household_id = h.id and e.type_id = 'lana.pump'
   and (e.occurred_at at time zone h.timezone)::date = (now() at time zone h.timezone)::date - 1;
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert(((public.achievements_list())->'numbers'->>'current_run')::int = 2, 'a missed yesterday has not ended her run: it stands at two until today is over');
reset role;
-- And the day put back, for the checks below.
update public.care_entries e set deleted_at = null
  from public.household h
 where h.id = :'fam_home' and e.household_id = h.id and e.type_id = 'lana.pump'
   and (e.occurred_at at time zone h.timezone)::date = (now() at time zone h.timezone)::date - 1;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.achievements_check())->'new') x where x->>'badge' like 'pump%'), 'Mido is not handed Dana''s pumping badges');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_list())->'earned') x where x->>'badge' = 'pump_goal' and x->>'member_name' = 'Dana'), 'but sees them on the family shelf');
select pg_temp.assert(((public.achievements_seen(array[(select id from public.achievements where badge = 'pump_goal' and tier = 2)]))->>'seen')::int = 0, 'and cannot mark Dana''s as seen');
reset role;
update public.achievements set seen_by = '{}' where badge = 'pump_goal' and tier = 2;
select pg_temp.preview_as(:mido, :dana);
set role authenticated;
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_check())->'new') x where x->>'badge' = 'pump_goal' and x->>'tier' = '2'), 'viewing as Dana, Mido sees what she has not seen yet');
select pg_temp.assert((public.achievements_seen(array[(select id from public.achievements where badge = 'pump_goal' and tier = 2)]))->>'ok' = 'false', 'but cannot take her moment by closing it');
reset role;
select pg_temp.assert((select not (:dana = any (seen_by)) from public.achievements where badge = 'pump_goal' and tier = 2), 'so it still waits for Dana');
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.home_switch(:khan_home))->>'ok' = 'true', 'Haitham is back in the Khans'' home');
select pg_temp.assert((select count(*) from public.achievements) = 0, 'where the family''s badges are not his to see');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements((public.achievements_check())->'new') x where x->>'badge' like 'pump%'), 'nor won by his home');
reset role;
set role anon;
select pg_temp.assert(pg_temp.fails('select public.achievements_check()'), 'signed out, no badges');
reset role;

-- Cheers and shared nights (migration 7000). By role: an admin cheers the other admin (the one
-- who pumps); a family carer and a home carer for the refusals; the other home for the walls.
\set an_admin :mido
\set the_pumper :dana
\set a_carer :wafa
\set a_home_carer :lilly
select display_name as admin_name from public.members where id = :an_admin \gset
select timezone as fam_tz from public.household where id = :'fam_home' \gset
with i as (insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id, logged_by, note)
           values (:lana, 'lana', 'lana.diaper', now() - interval '3 hours', '{"kind":"Wet"}', :'fam_home', :the_pumper, 'cheer test') returning id)
select id as c_hers from i \gset
with i as (insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id, logged_by, note)
           values (:lana, 'lana', 'lana.diaper', now() - interval '4 hours', '{"kind":"Wet"}', :'fam_home', :an_admin, 'cheer test') returning id)
select id as c_his from i \gset
select id as c_medal from public.achievements where badge = 'pump_goal' and tier = 2 and member_id = :the_pumper \gset
-- Earlier checks leave the home carer able to see the child's log; here she is as the seed makes her.
create temp table perm7000 as select role_id, module_id, action, allowed from public.permissions where role_id = 'home_carer' and module_id = 'lana';
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana';
select pg_temp.assert((select count(*) from public.care_entries e where e.deleted_at is null and (e.logged_by = :the_pumper or e.attributed_to = :the_pumper)
  and (e.occurred_at at time zone :'fam_tz')::date = (now() at time zone :'fam_tz')::date - 3) = 0, 'the pumping parent saved nothing three days ago (the check below leans on it)');
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, '  Thank you  '))->>'id' is not null, 'an admin cheers an entry the other parent saved');
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, 'Proud of you'))->>'already' = 'true', 'the same cheer again says it is already sent');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date, 'Proud of you'))->>'id' is not null, 'and cheers her day');
select pg_temp.assert((public.cheer_send(:the_pumper, 'medal', :'c_medal', null, 'You are doing so much'))->>'id' is not null, 'and a medal that is hers');
-- The refusals.
select pg_temp.assert((public.cheer_send(:an_admin, 'log', :'c_his', null, 'Thank you'))->>'ok' = 'false', 'nobody cheers themselves');
select pg_temp.assert((public.cheer_send(null, 'log', :'c_hers', null, 'Thank you'))->>'ok' = 'false', 'nor nobody');
select pg_temp.assert((public.cheer_send(:a_home_carer, 'day', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'a member who cannot see the child''s log cannot be cheered: it would never show');
select pg_temp.assert((public.cheer_send(:haitham, 'day', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'nor a member of another home');
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_his', null, 'Thank you'))->>'ok' = 'false', 'an entry she did not save is not hers to be cheered for');
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', gen_random_uuid(), null, 'Thank you'))->>'ok' = 'false', 'nor an entry that does not exist');
select pg_temp.assert((public.cheer_send(:the_pumper, 'medal', gen_random_uuid(), null, 'Thank you'))->>'ok' = 'false', 'nor a medal that does not exist');
select pg_temp.assert((public.cheer_send(:the_pumper, 'medal', :'c_hers', null, 'Thank you'))->>'ok' = 'false', 'an entry is not a medal');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date + 1, 'Thank you'))->>'ok' = 'false', 'a day that has not come is refused');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date - 7, 'Thank you'))->>'ok' = 'false', 'and a day more than a week back');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date - 3, 'Thank you'))->>'ok' = 'false', 'and a day she saved nothing on');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', :'c_hers', (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'a day cheer names a day, not an entry');
select pg_temp.assert((public.cheer_send(:the_pumper, 'week', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'a kind that does not exist is refused');
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, '   '))->>'error' = 'bad_words', 'a cheer needs words');
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, repeat('a', 81)))->>'error' = 'bad_words', 'and no more than one short line');
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date - 1, 'Thank you'))->>'ok' = 'false', 'a night she has not said yes to sharing cannot be cheered');
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'and the other admin is told nothing about it');
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'cheers') = 0, 'the sender is not handed the cheers he sent');
select pg_temp.assert(pg_temp.fails('select * from public.cheers') and pg_temp.fails($q$insert into public.cheers (household_id, from_member, to_member, about, ref_day, words) values (private.current_household_id(), public.current_member_id(), '00000000-0000-4000-8000-000000000002', 'day', current_date, 'x')$q$)
  and pg_temp.fails($q$update public.cheers set words = 'x'$q$) and pg_temp.fails('delete from public.cheers'), 'nobody reads or writes the table itself');
reset role;
select pg_temp.assert((select count(*) from public.cheers where from_member = :an_admin and to_member = :the_pumper) = 3 and (select words from public.cheers where about = 'log') = 'Thank you',
  'three cheers stored, once each, the words trimmed');
-- A receiver on the simple screen: there is no place to show it yet, so the sender is told.
update public.members set simple_mode = true where id = :the_pumper;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, 'Thank you'))->>'error' = 'simple_screen', 'a cheer to someone on the simple screen is refused in plain words');
reset role;
update public.members set simple_mode = false where id = :the_pumper;
-- A dozen in a day is plenty.
insert into public.cheers (household_id, from_member, to_member, about, ref_day, words)
select :'fam_home', :an_admin, :a_carer, 'day', date '2000-01-01' + g, 'plenty test' from generate_series(1, 12) g;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers', null, 'Thank you'))->>'already' = 'true', 'past the day''s dozen, one already sent still says so');
select pg_temp.assert((public.cheer_send(:a_carer, 'medal', gen_random_uuid(), null, 'Thank you'))->>'ok' = 'false', 'and one that was never allowed is still refused');
reset role;
with i as (insert into public.care_entries (subject_id, module_id, type_id, occurred_at, payload, household_id, logged_by, note)
           values (:lana, 'lana', 'lana.diaper', now() - interval '5 hours', '{"kind":"Wet"}', :'fam_home', :the_pumper, 'cheer test') returning id)
select id as c_hers2 from i \gset
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.cheer_send(:the_pumper, 'log', :'c_hers2', null, 'Thank you'))->>'error' = 'plenty', 'a thirteenth cheer in a day is refused, kindly');
reset role;
delete from public.cheers where words = 'plenty test';
-- Her switch: hers alone.
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.achievements_check()) ? 'night_share' and (public.achievements_check())->>'night_share' is null and (public.me_night_share())->>'night_share' is null,
  'she has not been asked yet, and her Home and her Display are told so');
select pg_temp.assert(not ((public.me())->'member' ? 'night_share'), 'her row in members carries nothing about it: every admin may edit that row and every carer may read it');
select pg_temp.assert(jsonb_array_length((public.me_night_share())->'parents') = 1 and (public.me_night_share())->'parents'->0->>'name' = :'admin_name' and (public.me_night_share())->'parents'->0->>'id' = :an_admin::text,
  'her Display is told the other parent, by name and id');
select pg_temp.assert((public.me_night_share_set(null))->>'ok' = 'false', 'her switch takes yes or no, not nothing');
select pg_temp.assert((public.me_night_share_set(false))->>'ok' = 'true', 'she says no');
reset role;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date - 1, 'Thank you'))->>'ok' = 'false' and jsonb_array_length((public.achievements_check())->'nights') = 0, 'after a no, still nothing for the other admin');
reset role;
select pg_temp.preview_as(:an_admin, :the_pumper);
set role authenticated;
select pg_temp.assert((public.me_night_share_set(true))->>'ok' = 'false', 'an admin viewing as her cannot say yes for her');
select pg_temp.assert((public.me_night_share())->>'night_share' is null and (public.achievements_check())->>'night_share' is null, 'nor read that she said no');
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'cheers') = 0, 'nor read the cheers that wait for her');
select pg_temp.assert((public.cheers_seen(array[(select gen_random_uuid())]))->>'ok' = 'false' and (public.cheer_send(:a_carer, 'day', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'nor mark them seen, nor send one in her name');
reset role;
select pg_temp.assert((select share from public.night_shares where member_id = :the_pumper) = false and (select count(*) from public.cheers where to_member = :the_pumper and seen_at is not null) = 0, 'her no stands and her cheers still wait');
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.me_night_share_set(true, array[:an_admin::uuid]))->>'night_share' = 'true', 'she says yes to the parent her screen named');
reset role;
select pg_temp.assert((select share and told = array[:an_admin::uuid] from public.night_shares where member_id = :the_pumper) and (select count(*) from public.night_shares) = 1, 'her answer is stored with the parent she said yes to, and nobody else has one');
-- The other parent cannot reach her answer any other way: not by reading it, not by writing it.
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(pg_temp.fails('select * from public.night_shares') and pg_temp.fails($q$update public.night_shares set share = false$q$) and pg_temp.fails('delete from public.night_shares')
  and pg_temp.fails($q$insert into public.night_shares (member_id, household_id, share) values ('00000000-0000-4000-8000-000000000003', private.current_household_id(), true)$q$),
  'an admin can neither read nor write anyone''s answer directly');
select pg_temp.assert(pg_temp.fails('select private.night_share_of(public.current_member_id())'), 'nor ask the helper that reads it');
select pg_temp.assert((public.achievements_check())->>'night_share' is null and (public.me_night_share())->>'night_share' is null, 'his own Home and Display are told only about himself: not asked yet');
reset role;
select pg_temp.act_as(:a_carer);
set role authenticated;
select pg_temp.assert(pg_temp.fails('select * from public.night_shares'), 'a family carer cannot read it either');
reset role;
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.achievements_check())->>'night_share' = 'true' and (public.me_night_share())->>'night_share' = 'true', 'her own Home and Display know her yes');
reset role;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.achievements_check())->'nights' = jsonb_build_array(jsonb_build_object('member_id', :the_pumper::uuid, 'cheered', false)), 'now the other admin is told she shares, and that he has not cheered last night');
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false', 'a night cheer is for last night only');
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', :'c_hers', (now() at time zone :'fam_tz')::date - 1, 'Thank you'))->>'ok' = 'false', 'and names a night, not an entry');
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date - 1, 'Rest, I have the morning'))->>'id' is not null, 'he cheers her night');
select pg_temp.assert((public.achievements_check())->'nights'->0->>'cheered' = 'true', 'and Home knows he has');
reset role;
select pg_temp.act_as(:a_carer);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'a family carer is told nothing about anyone''s night');
select pg_temp.assert((public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date - 1, 'Thank you'))->>'ok' = 'false', 'and cannot cheer one');
select pg_temp.assert((public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'id' is not null, 'but can cheer her day');
reset role;
select pg_temp.act_as(:a_home_carer);
set role authenticated;
select pg_temp.assert(not ((public.achievements_check()) ? 'nights') and not ((public.achievements_check()) ? 'cheers') and (public.cheer_send(:the_pumper, 'day', null, (now() at time zone :'fam_tz')::date, 'Thank you'))->>'ok' = 'false',
  'a home carer, who has no child''s log, gets neither key and sends no cheer');
reset role;
-- Receiving: hers alone, oldest first, with what each is about; gone once opened.
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'cheers') = 5, 'five cheers wait for her');
select pg_temp.assert((public.achievements_check())->'cheers'->0->>'about' = 'log' and (public.achievements_check())->'cheers'->0->>'from_name' = :'admin_name' and (public.achievements_check())->'cheers'->0->>'words' = 'Thank you'
  and (public.achievements_check())->'cheers'->0->>'type_label' is not null and (public.achievements_check())->'cheers'->0->>'occurred_at' is not null, 'the oldest first: who sent it, the words, and the entry it is about');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_check())->'cheers') x where x->>'about' = 'medal' and x->>'badge' = 'pump_goal' and x->>'tier' = '2'), 'the medal cheer says which medal');
select pg_temp.assert(exists (select 1 from jsonb_array_elements((public.achievements_check())->'cheers') x where x->>'about' = 'night' and (x->>'ref_day')::date = (now() at time zone :'fam_tz')::date - 1), 'the night cheer says which night');
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'she is told nothing about her own night');
select (public.achievements_check())->'cheers'->0->>'id' as c_first \gset
reset role;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(((public.cheers_seen(array[:'c_first'::uuid]))->>'seen')::int = 0, 'the sender cannot mark it seen for her');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert(((public.cheers_seen(array[:'c_first'::uuid]))->>'seen')::int = 0 and jsonb_array_length(coalesce((public.achievements_check())->'cheers', '[]'::jsonb)) = 0
  and (public.cheer_send(:the_pumper, 'log', :'c_hers', null, 'Thank you'))->>'ok' = 'false', 'another home sees none of it, marks none of it and cannot cheer into this one');
reset role;
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert(((public.cheers_seen(array[:'c_first'::uuid]))->>'seen')::int = 1 and jsonb_array_length((public.achievements_check())->'cheers') = 4, 'she opens the first and four wait');
select pg_temp.assert(((public.cheers_seen(array[:'c_first'::uuid]))->>'seen')::int = 0, 'opening it again marks nothing twice');
select pg_temp.assert(((public.cheers_seen((select array_agg((x->>'id')::uuid) from jsonb_array_elements((public.achievements_check())->'cheers') x)))->>'seen')::int = 4 and jsonb_array_length((public.achievements_check())->'cheers') = 0, 'and once all are opened none comes back');
reset role;
-- Her yes was to the parent named when she gave it. Another parent joins the home: her yes
-- waits, for everyone, until she has been asked again with the new name in front of her.
update public.members set role_id = 'admin' where id = :a_carer;
select pg_temp.act_as(:a_carer);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'a parent who joined after her yes is told nothing');
reset role;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0 and (public.cheer_send(:the_pumper, 'night', null, (now() at time zone :'fam_tz')::date - 1, 'Thank you'))->>'ok' = 'false',
  'and the parent she did say yes to hears nothing either until she has answered again');
reset role;
select pg_temp.assert((select count(*) from public.night_shares where member_id = :the_pumper and share) = 1, 'her stored yes is still there: nobody but her touches it');
-- Her screen was open before the new parent joined: it still names one. A yes from it names
-- one, so it is not a yes to both, and nobody is told.
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.me_night_share_set(true, array[:an_admin::uuid]))->>'night_share' is null, 'a yes from a screen that named only the first parent does not reach the second: it waits');
reset role;
select pg_temp.act_as(:a_carer);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'so the new parent is still told nothing');
reset role;
-- She opens her Home: it asks her again, and the waiting yes is ended there and then, so
-- that it cannot come back by itself.
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.achievements_check())->>'night_share' is null and jsonb_array_length((public.me_night_share())->'parents') = 2, 'her Home asks her again, and her Display names both');
reset role;
select pg_temp.assert((select count(*) from public.night_shares where member_id = :the_pumper) = 0, 'the waiting yes is gone from the moment her own screen showed it as off');
update public.members set role_id = 'family_carer' where id = :a_carer;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'the new parent leaves again: her old yes does not come back by itself');
reset role;
update public.members set role_id = 'admin' where id = :a_carer;
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.me_night_share_set(true, array[:an_admin::uuid, :a_carer::uuid]))->>'night_share' = 'true', 'she says yes to both');
reset role;
select pg_temp.act_as(:a_carer);
set role authenticated;
select pg_temp.assert((public.achievements_check())->'nights'->0->>'member_id' = :the_pumper::text, 'now the new parent is told');
reset role;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert((public.achievements_check())->'nights'->0->>'cheered' = 'true', 'and the first one again, with the cheer he already sent');
reset role;
-- A parent leaving changes nothing for those who stay.
update public.members set role_id = 'family_carer' where id = :a_carer;
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 1, 'one parent fewer: her yes still holds for the one who stays');
reset role;
-- Sharing is between parents: a yes she gave as one ends when she opens Home as a carer.
update public.members set role_id = 'family_carer' where id = :the_pumper;
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.achievements_check())->>'night_share' is null, 'no longer a parent: her Home is told nothing about a switch');
reset role;
update public.members set role_id = 'admin' where id = :the_pumper;
select pg_temp.assert((select count(*) from public.night_shares where member_id = :the_pumper) = 0, 'and the yes she gave as a parent is gone');
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'a parent again: nothing is told until she says yes again');
reset role;
-- And a no is a no whoever joins.
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.me_night_share_set(false))->>'night_share' = 'false', 'she says no');
reset role;
update public.members set role_id = 'admin' where id = :a_carer;
select pg_temp.act_as(:the_pumper);
set role authenticated;
select pg_temp.assert((public.achievements_check())->>'night_share' = 'false', 'a no stays a no when a parent joins: she is not asked again');
reset role;
update public.members set role_id = 'family_carer' where id = :a_carer;
-- "Her" must mean her: an admin cannot point her member row at another account and sign in
-- as her. The same write as the database owner goes through, so it is the role that is refused.
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(pg_temp.fails($q$update public.members set user_id = '00000000-0000-4000-8000-00000000c004' where id = '00000000-0000-4000-8000-000000000002'$q$)
  and pg_temp.fails($q$update public.members set user_id = null where id = '00000000-0000-4000-8000-000000000002'$q$),
  'an admin cannot re-point or clear the account a member row is linked to');
select pg_temp.assert(not pg_temp.fails($q$update public.members set relationship = relationship where id = '00000000-0000-4000-8000-000000000002'$q$), 'while the rest of her row is his to edit as before');
reset role;
begin;
update public.members set user_id = '00000000-0000-4000-8000-00000000c004' where id = :the_pumper;
select pg_temp.assert((select user_id = '00000000-0000-4000-8000-00000000c004' from public.members where id = :the_pumper), 'the same write by the database owner goes through: only the signed-in role is refused');
rollback;
select pg_temp.assert((select user_id from public.members where id = :the_pumper) = '00000000-0000-4000-8000-000000000002', 'and her row still carries her own account');
select pg_temp.act_as(:an_admin);
set role authenticated;
select pg_temp.assert(jsonb_array_length((public.achievements_check())->'nights') = 0, 'and the other admin is told nothing from then on');
reset role;
set role anon;
select pg_temp.assert(pg_temp.fails($q$select public.cheer_send('00000000-0000-4000-8000-000000000002', 'day', null, current_date, 'x')$q$) and pg_temp.fails('select public.cheers_seen(array[gen_random_uuid()])')
  and pg_temp.fails('select public.me_night_share_set(true)') and pg_temp.fails('select public.me_night_share()'), 'signed out: no cheers, no switch');
reset role;
select pg_temp.assert((select count(*) from public.audit_log where detail::text like '%night%' or target_table = 'night_shares') = 0, 'her answer leaves no line in the audit log, which every admin can read');
-- Put back: the entries made for these checks, her switch, and the cheers.
update public.care_entries set deleted_at = now() where note = 'cheer test';
delete from public.night_shares;
delete from public.cheers;
update public.permissions p set allowed = f.allowed from perm7000 f where p.role_id = f.role_id and p.module_id = f.module_id and p.action = f.action;

-- Migration 6100: the feed gap counts her age on the home's calendar, not the server's (UTC).
-- At UTC+14 the home's date is ahead of UTC for most of the day, so a check on the home's
-- date tells the two apart: 183 days at home is past 6 months (4 h), 182 is not (3 h).
create temp table mido_tz as select h.id, h.timezone from public.household h join public.members m on m.household_id = h.id where m.id = :mido;
update public.household set timezone = 'Pacific/Kiritimati' where id = (select id from mido_tz);
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(private.feed_every_min((now() at time zone 'Pacific/Kiritimati')::date - 183) = 240
  and private.feed_every_min((now() at time zone 'Pacific/Kiritimati')::date - 182) = 180, 'the feed gap changes at the home''s midnight');
reset role;
update public.household h set timezone = t.timezone from mido_tz t where h.id = t.id;
select pg_temp.assert(not has_function_privilege('anon', 'private.feed_every_min(date)', 'execute'), 'anon still cannot call the feed gap');

-- The rows every home shares name no family (migration 5400): a new home reads its own names only.
do $$
declare t record; v_n bigint;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('household', 'job_runs')
              and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped) loop
    execute format($q$select count(*) from public.%I t where t::text ~ '\m(Lana|Dana|Mido|Wafa|Luda|Lilly|Fanta)\M' or t::text ~* 'while dana'$q$, t.relname) into v_n;
    if v_n > 0 then raise exception 'ASSERT FAILED: % shared row(s) in % name the first family', v_n, t.relname; end if;
  end loop;
  raise notice 'ok  - shared rows (modules, roles, play ideas, skills, types…) name no family';
end $$;

-- The helper's write cards (13 November): each card calls the screen's own RPC as the member
-- who taps it, so each refuses whom the screen refuses. Permissions are set here, not inherited.
reset role;
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action in ('add', 'edit', 'delete');
update public.permissions set allowed = true  where role_id = 'family_carer' and module_id = 'lana' and action in ('add', 'edit');
update public.permissions set allowed = false where role_id = 'family_carer' and module_id = 'lana' and action = 'delete';
select pg_temp.act_as(:mido);
set role authenticated;
create temp table hc as select ((public.care_entry_log(:lana, 'lana.feed', now() - interval '5 minutes', null, '{"method":"Bottle","amount_ml":120}'::jsonb, 'helper cards test', null))->>'id')::uuid as id;
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.custody_set(:lana, :lilly))->>'error' = 'not_allowed', 'helper card: a member who cannot log for her cannot say who has her');
select pg_temp.assert((public.care_entry_update((select id from hc), now(), null, '{"method":"Bottle","amount_ml":90}'::jsonb, null))->>'error' = 'not_allowed', 'helper card: nor change an entry');
select pg_temp.assert((public.care_entry_delete((select id from hc)))->>'error' = 'not_allowed', 'helper card: nor delete one');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.custody_set(:lana, :wafa))->>'ok' = 'true', 'helper card: Wafa says she has Lana now');
select pg_temp.assert((public.care_entry_update((select id from hc), (select occurred_at from public.care_entries where id = (select id from hc)), null, '{"method":"Bottle","amount_ml":90}'::jsonb, null))->>'ok' = 'true', 'helper card: Wafa (may edit) changes the bottle to 90 ml');
select pg_temp.assert((public.care_entry_delete((select id from hc)))->>'error' = 'not_allowed', 'helper card: Wafa (may not delete) cannot delete it');
reset role;
select pg_temp.assert((select payload->>'amount_ml' from public.care_entries where id = (select id from hc)) = '90'
  and (select deleted_at from public.care_entries where id = (select id from hc)) is null, 'the change stuck, and the refused delete left the entry in place');
select pg_temp.assert((select m.display_name from public.care_custody c join public.members m on m.id = c.member_id where c.subject_id = :lana order by c.since desc, c.id desc limit 1) = 'Wafa', 'who has Lana is now Wafa');
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_delete((select id from hc)))->>'ok' = 'true', 'helper card: an admin deletes it');
reset role;
select pg_temp.assert((select deleted_at from public.care_entries where id = (select id from hc)) is not null, 'and it is gone from the log');

-- Diaper, never nappy (migration 6200): no helper skill or play idea says nappy, and the
-- illness skill wakes for diapers as well as nappies.
reset role;
select pg_temp.assert(not exists (select 1 from public.assistant_skills where body ~* '\mnapp(y|ies)\M' or "when" ~* '\mnapp(y|ies)\M'), 'no helper skill says nappy');
select pg_temp.assert(not exists (select 1 from public.activities where title ~* '\mnapp(y|ies)\M' or how ~* '\mnapp(y|ies)\M' or why ~* '\mnapp(y|ies)\M'), 'no play idea says nappy');
select pg_temp.assert((select triggers @> array['dry diapers', 'fewer diapers', 'dry nappies'] from public.assistant_skills where id = 'illness'), 'the illness skill wakes for diapers, and still for nappies');

-- Family words (migration 6300): the + sheet's labels match Home's rows (Pump, Medicine).
select pg_temp.assert((select label from public.care_entry_types where id = 'lana.pump') = 'Pump'
  and (select label from public.care_entry_types where id = 'lana.medication') = 'Medicine'
  and (select label from public.care_entry_types where id = 'lana.diaper') = 'Diaper', 'entry types match Home''s rows: Diaper, Pump, Medicine');

-- Milk past its time can only be binned (migration 6400): no thaw, warm, use or freeze brings it
-- back, a warmed bottle is not warmed again, and signed-out callers cannot run it at all.
reset role;
update public.permissions set allowed = true where role_id = 'admin' and module_id = 'lana' and action = 'add';
select pg_temp.act_as(:dana);
set role authenticated;
create temp table mf as select
  ((public.milk_add(91, 'fridge',  now() - interval '5 days',   'fresh test'))->>'id')::uuid as old_fridge,
  ((public.milk_add(92, 'freezer', now() - interval '7 months', 'fresh test'))->>'id')::uuid as old_bag,
  ((public.milk_add(93, 'fridge',  now() - interval '1 hour',   'fresh test'))->>'id')::uuid as new_fridge;
select pg_temp.assert((public.milk_move((select old_fridge from mf), 'warmed'))->>'error' = 'expired', 'expired milk cannot be warmed');
select pg_temp.assert((public.milk_move((select old_fridge from mf), 'used'))->>'error' = 'expired', 'nor marked used');
select pg_temp.assert((public.milk_move((select old_fridge from mf), 'freezer'))->>'error' = 'expired', 'nor frozen');
select pg_temp.assert((public.milk_move((select old_bag from mf), 'fridge'))->>'error' = 'expired', 'an expired frozen bag cannot be thawed');
select pg_temp.assert((public.milk_move((select new_fridge from mf), 'warmed'))->>'ok' = 'true', 'fresh milk is warmed');
select pg_temp.assert((public.milk_move((select new_fridge from mf), 'warmed'))->>'error' = 'already_warmed', 'and not warmed twice');
select pg_temp.assert((public.milk_move((select old_fridge from mf), 'binned'))->>'ok' = 'true', 'expired milk is binned');
select pg_temp.assert((public.milk_move((select old_bag from mf), 'binned'))->>'ok' = 'true', 'and so is an expired bag');
reset role;
select pg_temp.assert((select warmed_at is null and thawed_at is null from public.milk_bottles where id = (select old_bag from mf)), 'a refused thaw left the bag untouched');
select pg_temp.assert(not has_function_privilege('anon', 'public.milk_move(uuid, text)', 'execute'), 'signed-out callers cannot move milk');
select pg_temp.assert(pg_get_userbyid((select proowner from pg_proc where oid = 'public.milk_move(uuid, text)'::regprocedure)) = 'app_rls', 'milk_move still runs as app_rls');
update public.milk_bottles set deleted_at = now() where note = 'fresh test' and deleted_at is null;

-- The child's facts (migration 6600): only an admin of the home on screen changes the name, the birth
-- date, girl or boy or the name in other languages, through the save or through the table itself;
-- nobody else adds or removes a child; a carer still edits the rest of the health card. Permissions
-- are set here, not inherited, and the child's row is put back at the end.
reset role;
update public.permissions set allowed = true  where role_id in ('admin', 'family_carer') and module_id = 'lana' and action in ('view', 'edit');
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action = 'edit';
-- True only for a refusal (42501: the guard, or row security); any other error stops the suite.
create or replace function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return true;
end $$;
create temp table facts6600 as select name, birth_date, profile, settings, sort, is_active, created_at from public.care_subjects where id = :lana;
select birth_date as zayd_birth from public.care_subjects where id = :zayd \gset
select pg_temp.assert((select profile->>'sex' = 'Girl' and not (profile ? 'names') from facts6600), 'the test child starts as a girl with no other names');
insert into public.care_subjects (id, household_id, module_id, kind, name, is_active, sort)
select '00000000-0000-4000-8000-00000000a066', household_id, 'lana', 'child', 'Spare', false, 90 from public.care_subjects where id = :lana;
select pg_temp.assert(not has_function_privilege('anon', 'private.is_admin()', 'execute') and has_function_privilege('authenticated', 'private.is_admin()', 'execute')
  and pg_get_userbyid((select proowner from pg_proc where oid = 'private.is_admin()'::regprocedure)) = 'app_rls', 'is_admin runs as app_rls; members can ask it, anon cannot');
select pg_temp.assert(not has_function_privilege('anon', 'public.subject_profile_save(uuid, jsonb, date, text)', 'execute')
  and not (select prosecdef from pg_proc where oid = 'public.subject_profile_save(uuid, jsonb, date, text)'::regprocedure),
  'signed-out callers cannot save a profile, and the save runs as the caller, so the guard on the table holds it too');
select pg_temp.assert(not has_function_privilege('public', 'private.admin_names()', 'execute') and has_function_privilege('authenticated', 'private.admin_names()', 'execute'),
  'the admins'' names are for signed-in members, by a named grant');
select pg_temp.assert((select prosrc ~ 'for no key update;' and prosrc !~ 'for update;' from pg_proc where oid = 'public.subject_profile_save(uuid, jsonb, date, text)'::regprocedure),
  'the save takes the lock an update takes, so a new log entry for the child does not wait on it');

-- Wafa, a family carer who may edit the log: the health card is hers to edit, the facts are not.
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert(not private.is_admin(), 'Wafa is not an admin');
select pg_temp.assert(r->>'ok' = 'true' and not (r ? 'kept'), 'Wafa saves a health card line, sending the profile back whole')
  from (select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) || '{"blood_group": "O+"}'::jsonb, null, null) as r) x;
select pg_temp.assert(r->>'error' = 'not_allowed' and r->>'message' like 'Ask % to change the name or the birth date.' and r->>'message' ~ 'Mido' and r->>'message' ~ 'Dana',
  'a new birth date from her is refused, naming the admins to ask')
  from (select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana), current_date - 30, null) as r) x;
select pg_temp.assert((public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana), null, 'Hacked'))->>'error' = 'not_allowed', 'and so is a new name');
select pg_temp.assert((public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana), (select birth_date from public.care_subjects where id = :lana), (select name from public.care_subjects where id = :lana)))->>'ok' = 'true',
  'the name and date she was shown, sent back unchanged, are not a change');
select pg_temp.assert(r->>'ok' = 'true' and r->'kept' = '["sex", "names"]'::jsonb, 'a save carrying another sex and other names saves the rest and says what it kept')
  from (select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) || '{"sex": "Boy", "names": {"ar": "x"}, "allergies": "None known"}'::jsonb, null, null) as r) x;
select pg_temp.assert((public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) - 'sex', null, null))->'kept' = '["sex"]'::jsonb,
  'a page from before girl or boy was set does not take it away');
-- The same through the table itself (PostgREST): the guard answers, whoever asks.
with u as (update public.care_subjects set profile = profile || '{"hospital_number": "H-1"}' where id = :lana returning 1) select count(*) as n_card from u \gset
select pg_temp.assert(:n_card = 1, 'Wafa''s direct write of a health card line goes through');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set name = %L where id = %L', 'Hacked', :lana)), 'her direct write of the name is refused');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set birth_date = current_date - 30 where id = %L', :lana)), 'of the birth date');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set birth_date = null where id = %L', :lana)), 'or clearing it');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set profile = profile || %L where id = %L', '{"sex": "Boy"}', :lana)), 'of girl or boy');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set profile = profile - %L where id = %L', 'sex', :lana)), 'or dropping it');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set profile = profile || %L where id = %L', '{"names": {"ar": "x"}}', :lana)), 'of the name in another language');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set created_at = now() where id = %L', :lana)), 'of the day she joined, which the vaccine book counts from');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set sort = 1, is_active = false, settings = %L where id = %L', '{}', :lana)), 'and of the rest of the row');
select pg_temp.assert(pg_temp.refused($q$insert into public.care_subjects (module_id, kind, name, sort) values ('lana', 'child', 'Second', 1)$q$), 'she cannot add a second child, which a lower sort would put first');
select pg_temp.assert(pg_temp.refused(format('delete from public.care_subjects where id = %L', '00000000-0000-4000-8000-00000000a066')), 'nor remove one');
reset role;
select pg_temp.assert((select s.name = f.name and s.birth_date = f.birth_date and s.created_at = f.created_at and s.sort = f.sort and s.is_active and s.settings = f.settings
  and s.profile->>'sex' = 'Girl' and not (s.profile ? 'names')
  and s.profile->>'blood_group' = 'O+' and s.profile->>'allergies' = 'None known' and s.profile->>'hospital_number' = 'H-1'
  from public.care_subjects s, facts6600 f where s.id = :lana), 'her name, age and sex are as they were; the health card lines were saved');
select pg_temp.assert(exists (select 1 from public.care_subjects where id = '00000000-0000-4000-8000-00000000a066')
  and (select count(*) from public.care_subjects where household_id = (select household_id from public.care_subjects where id = :lana)) = 2, 'the spare row is still there and no row was added');
select pg_temp.assert(exists (select 1 from public.audit_log where actor_member = :wafa and target_table = 'care_subjects' and not allowed and detail->'facts' ? 'birth_date')
  and exists (select 1 from public.audit_log where actor_member = :wafa and target_table = 'care_subjects' and allowed and detail->'kept' ? 'sex'), 'the audit log has the refused birth date and the kept sex');

-- Lilly may see the log but not edit it: the older rule still answers first.
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.subject_profile_save(:lana, '{}'::jsonb, null, null))->>'message' = 'You are not allowed to change this profile.', 'a member who may not edit the log cannot save the card at all');
reset role;

-- A role that may edit but not view: the write policy is "for all", so the save can read the row it changes.
update public.permissions set allowed = false where role_id = 'family_carer' and module_id = 'lana' and action = 'view';
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert(public.has_permission('lana', 'edit') and not public.has_permission('lana', 'view'), 'Wafa may edit but not view, for the check');
select pg_temp.assert((public.subject_profile_save(:lana, '{"sex": "Girl", "emergency_ambulance": "998", "insurance": "Card 7"}'::jsonb, null, null))->>'ok' = 'true', 'she still saves the health card');
select pg_temp.assert((public.subject_profile_save(:lana, '{}'::jsonb, current_date - 30, null))->>'error' = 'not_allowed', 'and is refused the birth date like any carer');
reset role;
update public.permissions set allowed = true where role_id = 'family_carer' and module_id = 'lana' and action = 'view';
select pg_temp.assert((select profile->>'insurance' = 'Card 7' and profile->>'sex' = 'Girl' from public.care_subjects where id = :lana), 'the card was written');

-- A child who has her name in other languages: a carer's save keeps them as stored. And the health
-- card stays a card, also on a row with no facts to keep (the spare one).
update public.care_subjects set profile = profile || '{"names": {"ar": "A", "ru": "B"}}'::jsonb where id = :lana;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert(r->>'ok' = 'true' and r->'kept' = '["names"]'::jsonb, 'a save carrying another name in another language keeps the stored ones and says so')
  from (select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) || '{"names": {"ar": "x"}}'::jsonb, null, null) as r) x;
select pg_temp.assert((public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) - 'names', null, null))->'kept' = '["names"]'::jsonb, 'and a save with none does not take them away');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set profile = jsonb_set(profile, %L, %L) where id = %L', '{names,ar}', '"x"', :lana)), 'her direct write of one of them is refused');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set profile = %L where id = %L', '["sex"]', '00000000-0000-4000-8000-00000000a066')), 'and she cannot turn a health card into a list');
reset role;
select pg_temp.assert((select profile->'names' = '{"ar": "A", "ru": "B"}'::jsonb and profile->>'insurance' = 'Card 7' from public.care_subjects where id = :lana)
  and (select jsonb_typeof(profile) = 'object' from public.care_subjects where id = '00000000-0000-4000-8000-00000000a066'), 'the stored names and both cards are as they were');

-- An admin at home is a carer in the Khans' home: there the facts are not his to change.
select pg_temp.act_as(:mido);
select set_config('request.headers', jsonb_build_object('x-home', :khan_home)::text, false);
set role authenticated;
select pg_temp.assert(not private.is_admin(), 'Mido is not an admin of the home on screen, the Khans''');
select pg_temp.assert((public.subject_profile_save(:zayd, '{}'::jsonb, current_date - 30, null))->>'message' = 'Ask Haitham to change the name or the birth date.', 'so a new birth date for Zayd is refused, naming that home''s admin');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set birth_date = current_date - 30 where id = %L', :zayd)), 'through the table too');
reset role;
select set_config('request.headers', '', false);
select pg_temp.assert((select birth_date from public.care_subjects where id = :zayd) = :'zayd_birth'::date, 'Zayd''s birth date is as it was');

-- View-as is read only (migration 3600), also when the member viewed is an admin.
select pg_temp.preview_as(:mido, :dana);
set role authenticated;
select pg_temp.assert((public.subject_profile_save(:lana, '{}'::jsonb, current_date - 30, 'Hacked'))->>'error' = 'not_allowed', 'viewing as an admin, nothing about the child is saved');
with u as (update public.care_subjects set birth_date = current_date - 30 where id = :lana returning 1) select count(*) as n_preview from u \gset
select pg_temp.assert(:n_preview = 0, 'and a direct write in a preview changes no row');
reset role;

-- An admin changes all three, through the save and through the table; the server's own key is not held.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(private.is_admin(), 'Mido is an admin at home');
select pg_temp.assert(r->>'ok' = 'true' and not (r ? 'kept'), 'Mido corrects the name, the birth date and girl or boy in one save')
  from (select public.subject_profile_save(:lana, (select profile from public.care_subjects where id = :lana) || '{"sex": "Boy"}'::jsonb, current_date - 200, 'Layla') as r) x;
reset role;
select pg_temp.assert((select name = 'Layla' and birth_date = current_date - 200 and profile->>'sex' = 'Boy' and profile->>'insurance' = 'Card 7' from public.care_subjects where id = :lana), 'all three are stored, the card with them');
select pg_temp.assert(exists (select 1 from public.audit_log where actor_member = :mido and target_table = 'care_subjects' and allowed and detail->'facts' @> '["name", "birth_date", "sex"]'), 'and the audit row names the facts that changed');
select pg_temp.act_as(:mido);
set role authenticated;
with u as (update public.care_subjects set birth_date = current_date - 201 where id = :lana returning 1) select count(*) as n_admin from u \gset
select pg_temp.assert(:n_admin = 1, 'an admin''s direct write is not held either');
with i as (insert into public.care_subjects (module_id, kind, name, is_active, sort) values ('lana', 'child', 'Third', false, 99) returning id) select id as third_id from i \gset
with d as (delete from public.care_subjects where id = :'third_id' returning 1) select count(*) as n_third from d \gset
select pg_temp.assert(:n_third = 1, 'and an admin still adds and removes a child row through the table');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
with u as (update public.care_subjects set birth_date = current_date - 202 where id = :lana returning 1) select count(*) as n_server from u \gset
select pg_temp.assert(:n_server = 1, 'nor is the server''s own key (the setup script)');
reset role;

-- Put back: her pinned age (the top of this file), her card, and the spare row.
update public.care_subjects s set name = f.name, birth_date = f.birth_date, profile = f.profile, settings = f.settings, sort = f.sort, is_active = f.is_active, created_at = f.created_at
  from facts6600 f where s.id = :lana;
delete from public.care_subjects where id = '00000000-0000-4000-8000-00000000a066';
select pg_temp.assert((select (s.name, s.birth_date, s.profile, s.settings, s.sort, s.is_active, s.created_at) is not distinct from (f.name, f.birth_date, f.profile, f.settings, f.sort, f.is_active, f.created_at)
  from public.care_subjects s, facts6600 f where s.id = :lana)
  and not exists (select 1 from public.care_subjects where id = '00000000-0000-4000-8000-00000000a066'), 'her name, her age and her card are put back, and the spare row is gone');

-- The answer follows the member (migration 6700). has_permission keeps its answer for the transaction;
-- it now counts only for the member it was worked out for. The app's requests are one call each, so
-- they never met this; several calls in ONE transaction did: make a home (its admin), ask, switch
-- back, and the admin's answer still answered. Everything here is rolled back.
select pg_temp.act_as(:wafa);
begin;
set local role authenticated;
select (public.household_create('Wafa''s flat', 'Asia/Dubai', 'Test', null, null, 'Wafa'))->>'household_id' as wafa_flat \gset
select pg_temp.assert(:'wafa_flat'::uuid <> :'our_home'::uuid and public.has_permission('members', 'edit'), 'one transaction: Wafa makes a home and is its admin');
select pg_temp.assert((public.home_switch(:'our_home'))->>'ok' = 'true' and public.current_member_id() = :wafa, 'and switches back to her real home');
select pg_temp.assert(not public.has_permission('members', 'edit'), 'where the admin''s answer from the other home does not follow her');
with u as (update public.members set role_id = 'admin' where id = :wafa returning 1)
select pg_temp.assert(count(*) = 0, 'so she cannot make herself an admin at home') from u;
select pg_temp.assert(not public.has_permission('members', 'edit') and public.has_permission('lana', 'edit'), 'asked again, the answers are still hers');
select pg_temp.assert(current_setting('fam.p.lana.edit', true) = :wafa::text || ':lana:edit:t' and current_setting('fam.p.members.edit', true) = :wafa::text || ':members:edit:f',
  'the kept answers name the member and the question');
select pg_temp.assert((select count(*) from generate_series(1, 2000) g where public.has_permission('lana', case when g > 0 then 'edit' end)) = 2000, '2000 asks in one statement are answered from it');
select pg_temp.assert(not public.has_permission('LANA', 'edit') and public.has_permission('lana', 'edit') and not public.has_permission('lana', 'EDIT') and public.has_permission('lana', 'edit'),
  'and a question spelled another way does not borrow the answer, nor spoil it');
rollback;
select pg_temp.assert((select role_id from public.members where id = :wafa) = 'family_carer' and not exists (select 1 from public.household where name = 'Wafa''s flat'), 'and nothing of it stayed');

-- A home whose member rows are gone is nobody's to move into (migration 6700). household_create took
-- the oldest home with no members, child and log included; that was meant for a fresh deployment's
-- seeded home, and now happens only when there are no member rows anywhere.
select user_id as wafa_user from public.members where id = :wafa \gset
begin;
delete from public.members where household_id = :khan_home;
select count(*) as homes_before from public.household \gset
select pg_temp.act_as(:wafa);
set local role authenticated;
select (public.household_create('Wafa''s flat', 'Asia/Dubai', 'Test', null, null, 'Wafa'))->>'household_id' as wafa_flat \gset
reset role;
select pg_temp.assert((select count(*) from public.household) = :homes_before + 1 and :'wafa_flat'::uuid <> :khan_home::uuid, 'Wafa gets a new home, not the one left without members');
select pg_temp.assert((select count(*) from public.members where household_id = :khan_home) = 0 and (select name from public.household where id = :khan_home) = 'The Khans'
  and exists (select 1 from public.care_subjects where id = :zayd and household_id = :khan_home and name = 'Zayd'), 'which keeps its name and its child, and stays empty');
rollback;
select pg_temp.assert((select count(*) from public.members where household_id = :khan_home) > 0 and not exists (select 1 from public.household where name = 'Wafa''s flat'), 'and nothing of it stayed');
-- The one peopled home emptied, which is every deployment with a single family: it has a child and a
-- log, so it is still nobody's to move into.
begin;
delete from public.members;
select count(*) as homes_before from public.household \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', :'wafa_user', 'role', 'authenticated')::text, true);
set local role authenticated;
select (public.household_create('Someone else', 'Asia/Dubai', 'Test', null, null, 'Wafa'))->>'household_id' as else_home \gset
reset role;
select pg_temp.assert((select count(*) from public.household) = :homes_before + 1 and :'else_home'::uuid not in (:'our_home'::uuid, :khan_home::uuid),
  'with every member row gone, a newcomer still gets a new home');
select pg_temp.assert((select count(*) from public.care_subjects where household_id = :'our_home') = 1 and (select name from public.household where id = :'our_home') = 'Our home'
  and not exists (select 1 from public.members where household_id = :'our_home'), 'and the first home keeps its name, its one child and nobody in it');
rollback;
-- A deployment with nobody in it and a home with nothing in it: the first to arrive moves in.
begin;
delete from public.members;
insert into public.household (name, timezone, created_at) values ('Seeded', 'Asia/Dubai', '2000-01-01') returning id as seeded_home \gset
select count(*) as homes_before from public.household \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', :'wafa_user', 'role', 'authenticated')::text, true);
set local role authenticated;
select (public.household_create('First family', 'Asia/Dubai', 'Test', null, null, 'Wafa'))->>'household_id' as first_home \gset
reset role;
select pg_temp.assert((select count(*) from public.household) = :homes_before and :'first_home'::uuid = :'seeded_home'::uuid and (select name from public.household where id = :'seeded_home') = 'First family',
  'a deployment with nobody in it: the first to arrive still moves into the home with nothing in it');
rollback;
select pg_temp.assert((select count(*) from public.members) > 5 and not exists (select 1 from public.household where name in ('First family', 'Seeded', 'Someone else')), 'and the members are all back');

-- The family's day (migration 6800). From 12 months an admin saves what age and the log cannot say
-- (milk on a clock, as a drink or not logged; naps; diapers; stored milk); home_summary and me()
-- follow it. A baby, a child with no birth date, a day with a bad answer and a day saved under a
-- birth date that was later moved all read as no day. An age on an edge is counted on the home's
-- date, as the 6500 checks above; current_date only well away from one (160, 400, 600). The potty
-- checks switch the Potty type off, or make it, inside a transaction that is rolled back, so they
-- hold before a migration brings that type and after. Permissions are set here, not inherited; the
-- child's row, the log and the permissions are put back at the end.
reset role;
select set_config('request.headers', '', false);
create temp table day6800 as select name, birth_date, profile, settings, created_at from public.care_subjects where id = :lana;
create temp table perm6800 as select role_id, module_id, action, allowed from public.permissions where module_id = 'lana' and action in ('view', 'edit');
update public.permissions set allowed = true  where role_id in ('admin', 'family_carer') and module_id = 'lana' and action in ('view', 'edit');
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana' and action in ('view', 'edit');
select timezone as home_tz from public.household where id = :'our_home' \gset
select settings as zayd_settings from public.care_subjects where id = :zayd \gset
\set day_ok '''{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": true}'''
-- Is this kind among the ones Home is given?
create or replace function pg_temp.listed(p_subject uuid, p_type text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements((public.home_summary(p_subject))->'types') t where t->>'id' = p_type)
$$;
-- The day as me() carries it for one child: SQL null when the key is not there at all.
create or replace function pg_temp.me_day(p_subject uuid) returns jsonb language sql as $$
  select x->'day' from jsonb_array_elements((public.me())->'subjects') x where x->>'id' = p_subject::text
$$;
-- Writes a day straight into the settings and says how it is then read, one letter each: in me(),
-- a next due on the last feed, Potty among the kinds.
create or replace function pg_temp.day_reads(p_subject uuid, p_day jsonb) returns text language plpgsql as $$
begin
  update public.care_subjects set settings = settings || jsonb_build_object('day', p_day) where id = p_subject;
  return case when pg_temp.me_day(p_subject) <> 'null'::jsonb then 'y' else 'n' end
      || case when (public.home_summary(p_subject))#>>'{last,lana.feed,next_due}' is not null then 'y' else 'n' end
      || case when pg_temp.listed(p_subject, 'lana.potty') then 'y' else 'n' end;
end $$;

select pg_temp.assert((select count(*) = 3 and not bool_or(prosecdef) from pg_proc
  where oid in ('private.day_band(date)'::regprocedure, 'private.subject_day(jsonb, date)'::regprocedure, 'public.subject_day_save(uuid, jsonb, text, text)'::regprocedure)),
  'the band, the day and its save run as the caller, so row security and the guard on the child''s row hold the save too');
select pg_temp.assert((select bool_and(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute') and has_function_privilege('authenticated', f, 'execute'))
  from unnest(array['private.day_band(date)', 'private.subject_day(jsonb, date)', 'public.subject_day_save(uuid, jsonb, text, text)']) f),
  'signed-out callers can run none of the three; members can');
select pg_temp.assert(has_function_privilege('app_rls', 'private.day_band(date)', 'execute') and has_function_privilege('app_rls', 'private.subject_day(jsonb, date)', 'execute'),
  'and app_rls can run the two helpers, which me() needs');
select pg_temp.assert((select prosecdef and pg_get_userbyid(proowner) = 'app_rls' and prosrc !~ 'auth\.' from pg_proc where oid = 'private.subject_names()'::regprocedure),
  'subject_names is still a definer of app_rls and does not name the auth schema');

-- The bands turn on days 366, 548, 731 and 1096 of the home's calendar. At UTC+14 the home's date is
-- ahead of UTC for most of the day, so a count on the server's date would show; then the home's own zone.
update public.household set timezone = 'Pacific/Kiritimati' where id = :'our_home';
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(private.day_band(d - 365) is null and private.day_band(d - 366) = 12 and private.day_band(d - 547) = 12 and private.day_band(d - 548) = 18
  and private.day_band(d - 730) = 18 and private.day_band(d - 731) = 24 and private.day_band(d - 1095) = 24 and private.day_band(d - 1096) = 36,
  'no band on day 365, then 12 from day 366, 18 from 548, 24 from 731 and 36 from 1096, on the home''s calendar (home on UTC+14)')
  from (select (now() at time zone 'Pacific/Kiritimati')::date as d) x;
reset role;
update public.household set timezone = :'home_tz' where id = :'our_home';
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(private.day_band(d - 365) is null and private.day_band(d - 366) = 12 and private.day_band(d - 547) = 12 and private.day_band(d - 548) = 18
  and private.day_band(d - 730) = 18 and private.day_band(d - 731) = 24 and private.day_band(d - 1095) = 24 and private.day_band(d - 1096) = 36,
  'and the same in the home''s own zone')
  from (select (now() at time zone :'home_tz')::date as d) x;
select pg_temp.assert(private.day_band(null) is null, 'with no birth date there is no band');
reset role;

-- Who may save it: an admin of the home on screen, and nobody in a preview. The child is 400 days old.
update public.care_subjects set birth_date = current_date - 400 where id = :lana;
select birth_date as birth400 from public.care_subjects where id = :lana \gset
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert(r->>'error' = 'not_allowed' and r->>'message' like 'Ask % to change Lana''s day.' and r->>'message' ~ 'Mido' and r->>'message' ~ 'Dana',
  'Wafa, a carer who may edit the log, is refused the day, naming the admins to ask')
  from (select public.subject_day_save(:lana, :day_ok::jsonb) as r) x;
select pg_temp.assert((public.subject_day_save(:lana))->>'error' = 'not_allowed', 'nor can she settle the question as it is');
select pg_temp.assert(pg_temp.refused(format('update public.care_subjects set settings = settings || %L where id = %L', '{"day": {"v": 1}}', :lana)), 'and her direct write of the settings is refused');
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'message' = 'You are not allowed to do this.', 'Lilly, who may not edit the log, is refused');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'error' = 'not_found', 'another home''s admin is told there is no such child');
reset role;
select pg_temp.preview_as(:mido, :dana);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'error' = 'preview', 'viewing as an admin, the day is not saved');
reset role;
select pg_temp.assert((select settings from public.care_subjects where id = :lana) = (select settings from day6800), 'after the refusals her settings are as they were');
select pg_temp.assert(exists (select 1 from public.audit_log where actor_member = :wafa and target_table = 'care_subjects' and not allowed and detail ? 'day')
  and exists (select 1 from public.audit_log where actor_member = :lilly and target_table = 'care_subjects' and not allowed and detail ? 'day'), 'and the audit log has Wafa''s and Lilly''s');

-- The day opens at 12 months: a baby is refused, to the day, and so is a child with no birth date.
update public.care_subjects set birth_date = current_date - 160 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(r->>'error' = 'too_young' and r->>'message' = 'Lana''s day opens at 12 months.', 'Mido is refused for a baby of 160 days')
  from (select public.subject_day_save(:lana, :day_ok::jsonb) as r) x;
reset role;
update public.care_subjects set birth_date = (now() at time zone :'home_tz')::date - 365 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'error' = 'too_young', 'and on day 365 of the home''s calendar, her last day as a baby');
select pg_temp.assert((public.subject_day_save(:lana))->>'error' = 'too_young', 'also when only settling the question');
reset role;
select pg_temp.act_as(:mido);
begin;
update public.care_subjects set birth_date = (now() at time zone :'home_tz')::date - 366 where id = :lana;
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana))->'asked' = '12'::jsonb, 'on day 366 it is open');
rollback;
update public.care_subjects set birth_date = null where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(r->>'error' = 'no_birth_date' and r->>'message' = 'Add the date of birth first, on Doctor.', 'with no birth date he is asked for it first')
  from (select public.subject_day_save(:lana, :day_ok::jsonb) as r) x;
reset role;

-- At 400 days, each thing that is not an answer is refused as bad input, never as a database error.
update public.care_subjects set birth_date = :'birth400' where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select bool_and((public.subject_day_save(:lana, d::jsonb))->>'error' = 'bad_input') from (values
    ('{"milk": "x", "naps": 1, "diapers": "diapers", "stores_milk": true}'),
    ('{"naps": 1, "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "naps": 1, "diapers": "nappy", "stores_milk": true}'),
    ('{"milk": "drink", "naps": 1, "stores_milk": true}'),
    ('{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": "yes"}'),
    ('{"milk": "drink", "naps": 1, "diapers": "diapers"}')) v(d)),
  'a milk, diapers or stored-milk answer that is not one of its values, or is missing, is refused');
select pg_temp.assert((select bool_and((public.subject_day_save(:lana, d::jsonb))->>'error' = 'bad_input') from (values
    ('{"milk": "drink", "naps": 3, "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "naps": 1.5, "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "naps": 99999999999, "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "naps": "1", "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "naps": -1, "diapers": "diapers", "stores_milk": true}'),
    ('{"milk": "drink", "diapers": "diapers", "stores_milk": true}')) v(d)),
  'so are 3 naps, 1.5, 99999999999, the text "1", -1 and none given');
select pg_temp.assert((public.subject_day_save(:lana, '[{"milk": "drink"}]'::jsonb))->>'error' = 'bad_input' and (public.subject_day_save(:lana, '"drink"'::jsonb))->>'error' = 'bad_input',
  'and a list or a word in place of the day');
select pg_temp.assert((select bool_and((public.subject_day_save(:lana, :day_ok::jsonb, f, t))->>'error' = 'bad_time') from (values
    ('25:00', null), ('7pm', null), ('12:00', null), ('16:59', null), ('23:46', null), ('19:30:00', null),
    (null, '19:00'), (null, '03:59'), (null, '10:01'), ('19:00', '7:00')) v(f, t)),
  'a time that is not one, a bedtime outside 17:00 to 23:45 and a morning outside 04:00 to 10:00 are refused');
select pg_temp.assert(r->>'error' = 'too_young_potty' and r->>'message' = 'Potty is offered from 18 months.', 'both diapers and potty is not an answer under 18 months')
  from (select public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "both", "stores_milk": true}'::jsonb) as r) x;
reset role;
select pg_temp.assert((select settings from public.care_subjects where id = :lana) = (select settings from day6800), 'after every one of them her settings are still as they were');

-- From 18 months potty is an answer only where there is a Potty entry to log. The type is switched
-- off here (no row at all before the migration that brings it), and that is rolled back.
select pg_temp.act_as(:mido);
begin;
update public.care_entry_types set is_active = false where id = 'lana.potty';
update public.care_subjects set birth_date = current_date - 600 where id = :lana;
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "both", "stores_milk": true}'::jsonb))->>'error' = 'bad_input',
  'at 600 days, both is refused while there is no Potty entry to log');
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "potty", "stores_milk": true}'::jsonb))->>'error' = 'bad_input', 'and so is potty alone');
rollback;

-- "No stored milk" is refused while a bottle is in stock, and a bottle past its time is not stock
-- (the rule behind milk_list's counts). The home's own bottles are set aside first; rolled back.
select pg_temp.act_as(:mido);
begin;
update public.milk_bottles set deleted_at = now() where household_id = :'our_home' and deleted_at is null;
set local role authenticated;
select pg_temp.assert((public.milk_add(100, 'fridge', now() - interval '5 days', 'day test'))->>'ok' = 'true', 'Mido puts away a bottle pumped five days ago, past its four days in the fridge');
select pg_temp.assert((select (m->>'fridge_count')::int + (m->>'freezer_count')::int = 0 and jsonb_array_length(m->'bottles') = 1 from (select public.milk_list() as m) x), 'the milk list holds it and counts nothing in stock');
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": false}'::jsonb, '17:00', '04:00'))->>'ok' = 'true',
  'with only that bottle "no stored milk" is saved, with the earliest bedtime and morning');
-- While the day says no milk is stored, the stash's one door is shut for every caller (a Milk
-- screen or a helper card opened before the parent answered, an older build): milk_add refuses,
-- for the parent and for a carer, in the words every screen shows, and nothing is added.
select pg_temp.assert((public.milk_add(120, 'fridge', now() - interval '1 hour', 'day test'))
  = '{"ok": false, "error": "no_stored_milk", "message": "Lana''s day says no milk is stored. A parent turns it on in Lana''s day."}'::jsonb,
  'with "no stored milk" saved, a bottle is not put away: the answer says where a parent turns it on');
reset role;
select pg_temp.act_as(:wafa);
set local role authenticated;
select pg_temp.assert((public.milk_add(90, 'freezer', now(), 'day test'))->>'error' = 'no_stored_milk', 'nor by Wafa, who may add to the log');
reset role;
select pg_temp.assert((select count(*) = 1 from public.milk_bottles where note = 'day test'), 'nothing went into the stash');
-- A day that does not count shuts nothing: the same child a baby again, by the birth date.
update public.care_subjects set birth_date = current_date - 160 where id = :lana;
select pg_temp.act_as(:mido);
set local role authenticated;
select pg_temp.assert((public.milk_add(60, 'fridge', now() - interval '1 hour', 'day test baby'))->>'ok' = 'true', 'for a baby the stored day is no day: the bottle is put away');
reset role;
update public.milk_bottles set deleted_at = now() where note = 'day test baby';
update public.care_subjects set birth_date = current_date - 600 where id = :lana;
select pg_temp.act_as(:mido);
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": true}'::jsonb, '23:45', '10:00'))->>'ok' = 'true',
  '"stored milk: yes" is saved, with the latest bedtime and morning');
select pg_temp.assert((public.milk_add(120, 'fridge', now() - interval '1 hour', 'day test'))->>'ok' = 'true', 'and now he puts away a bottle that is in date');
select pg_temp.assert(r->>'error' = 'milk_in_stock' and r->>'message' = 'Use or bin the bottles on Milk first.', 'with it in stock "no stored milk" is refused: use or bin the bottles first')
  from (select public.subject_day_save(:lana, '{"milk": "drink", "naps": 1, "diapers": "diapers", "stores_milk": false}'::jsonb) as r) x;
rollback;
select pg_temp.assert((select prosecdef and pg_get_userbyid(proowner) = 'app_rls' and prosrc !~ 'auth\.' and has_function_privilege('authenticated', oid, 'execute') from pg_proc where oid = 'public.milk_add(integer, text, timestamptz, text)'::regprocedure),
  'milk_add still runs as app_rls, names no auth table, and signed-in members may call it as before');
-- The two cannot pass each other: the save locks the child's row before it looks at the stash, and
-- milk_add reads the day under the lock that waits for that one (two sessions cannot be run from
-- here; the refusals above show the locked read still finds the row for a parent and a carer).
select pg_temp.assert((select prosrc ~ 'for share;' from pg_proc where oid = 'public.milk_add(integer, text, timestamptz, text)'::regprocedure)
  and (select prosrc ~ 'for no key update;' and position('for no key update;' in prosrc) < position('milk_bottles' in prosrc) from pg_proc where oid = 'public.subject_day_save(uuid, jsonb, text, text)'::regprocedure),
  'milk_add reads the day under a share lock on the child''s row, and subject_day_save locks that row before it reads the stash');

-- A good save. What is stored is built again from the checked answers: a key that is not an answer,
-- and a version, a date and a name that were sent, are not kept, and 1.0 naps is one nap.
update public.care_subjects set settings = settings || '{"marker": "kept"}' where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table save6800 as select public.subject_day_save(:lana,
  '{"milk": "drink", "naps": 1.0, "diapers": "diapers", "stores_milk": true, "v": 9, "saved_on": "1999-01-01", "saved_by": "x", "extra": "x"}'::jsonb, '20:30', null) as r;
create temp table me6800 as select 'mido' as who, pg_temp.me_day(:lana) as day;
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
insert into me6800 select 'wafa', pg_temp.me_day(:lana);
reset role;
select pg_temp.act_as(:lilly);
set role authenticated;
insert into me6800 select 'lilly', pg_temp.me_day(:lana);
reset role;
select pg_temp.assert((select r->>'ok' = 'true' and r->'asked' = '12'::jsonb and r->>'night_from' = '20:30' and r->>'night_to' = '07:00' from save6800), 'Mido saves the day at 400 days, with a new bedtime');
select pg_temp.assert((select array_agg(k order by k) from public.care_subjects s, jsonb_object_keys(s.settings->'day') k where s.id = :lana)
  = array['diapers', 'milk', 'naps', 'saved_at', 'saved_by', 'saved_on', 'stores_milk', 'v'], 'the stored day has its eight keys and nothing else that was sent');
select pg_temp.assert((select d->'v' = '1'::jsonb and d->>'milk' = 'drink' and d->>'naps' = '1' and d->>'diapers' = 'diapers' and d->'stores_milk' = 'true'::jsonb
    and d->>'saved_on' = to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD') and d->>'saved_by' = :mido::text and (d->>'saved_at')::timestamptz > now() - interval '1 minute'
  from (select settings->'day' as d from public.care_subjects where id = :lana) x), 'the answers as checked (1.0 naps is stored as 1), dated on the home''s day, by Mido');
select pg_temp.assert((select settings->'day_asked' = '12'::jsonb and settings->>'day_asked_on' = to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')
    and settings->>'night_from' = '20:30' and settings->>'night_to' = (select settings->>'night_to' from day6800) and settings->>'marker' = 'kept'
  from public.care_subjects where id = :lana), 'the 12-month question is settled, bedtime is replaced, and morning (not given) and a key of another kind are kept');
select pg_temp.assert((select s.name = f.name and s.birth_date = :'birth400' and s.profile = f.profile and s.created_at = f.created_at from public.care_subjects s, day6800 f where s.id = :lana),
  'her name, her birth date, her health card and the day she joined are untouched');
select pg_temp.assert(exists (select 1 from public.audit_log where actor_member = :mido and target_table = 'care_subjects' and allowed and detail->'day'->>'milk' = 'drink' and detail->>'night_from' = '20:30'),
  'and the audit log has the save');
select pg_temp.assert((select r->'day' from save6800) = (select settings->'day' from public.care_subjects where id = :lana)
  and (select day from me6800 where who = 'mido') = (select settings->'day' from public.care_subjects where id = :lana)
  and (select day from me6800 where who = 'wafa') = (select settings->'day' from public.care_subjects where id = :lana), 'the save answers with the stored day, and me() carries it for Mido and for Wafa');
select pg_temp.assert((select day from me6800 where who = 'lilly') = 'null'::jsonb, 'for Lilly, who may not view the child, the key is there and null');

-- home_summary follows the milk answer: a next due on the last feed only on a clock. Diapers and sleep stay without.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.feed', now() - interval '3 minutes', null, '{"method":"Bottle","amount_ml":120}', 'day test', null))->>'ok' = 'true', 'Mido logs a bottle');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now() - interval '2 minutes', null, '{"kind":"Wet"}', 'day test', null))->>'ok' = 'true', 'a diaper');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', now() - interval '40 minutes', now() - interval '4 minutes', '{"place":"Cot"}', 'day test', null))->>'ok' = 'true', 'and a nap');
create temp table sum_drink as select public.home_summary(:lana) as s;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "clock", "naps": 2, "diapers": "diapers", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'he puts milk on a clock');
create temp table sum_clock as select public.home_summary(:lana) as s;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "off", "naps": 0, "diapers": "off", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'and then stops logging it, and diapers');
create temp table sum_off as select public.home_summary(:lana) as s;
reset role;
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is null and s#>>'{last,lana.diaper,next_due}' is null and s#>>'{last,lana.sleep,next_due}' is null and s->'last'->'lana.feed' ? 'next_due' from sum_drink),
  'milk as a drink: the last feed has no next due (the key stays, with null), nor the diaper or the sleep');
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is not null and s#>>'{last,lana.diaper,next_due}' is null and s#>>'{last,lana.sleep,next_due}' is null from sum_clock),
  'milk on a clock: the last feed has its next due again; the diaper and the sleep still have none');
select pg_temp.assert((select s#>>'{last,lana.feed,next_due}' is null and s#>>'{last,lana.diaper,next_due}' is null and s#>>'{last,lana.sleep,next_due}' is null from sum_off), 'milk not logged: none');
select pg_temp.assert((select (s->'last'->'lana.feed') - 'next_due' from sum_clock) = (select (s->'last'->'lana.feed') - 'next_due' from sum_drink)
  and (select s->'types' from sum_clock) = (select s->'types' from sum_drink) and (select s->'types' from sum_off) = (select s->'types' from sum_drink),
  'the rest of the last feed and the kinds listed are the same under all three');
select pg_temp.assert((select settings->>'night_from' = '20:30' and settings->>'night_to' = (select settings->>'night_to' from day6800) from public.care_subjects where id = :lana),
  'and a save with no times keeps the bedtime and the morning');

-- Keep it as it is, at 600 days: the 18-month question is settled and nothing else moves.
update public.care_subjects set birth_date = current_date - 600 where id = :lana;
create temp table before_keep as select settings from public.care_subjects where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, null, '19:00', null))->>'error' = 'bad_input', 'a time with no day is refused');
select pg_temp.assert((public.subject_day_save(:lana)) = '{"ok": true, "asked": 18}'::jsonb, 'Mido keeps the day as it is, at 600 days');
select pg_temp.assert((public.subject_day_save(:lana, 'null'::jsonb)) = '{"ok": true, "asked": 18}'::jsonb, 'and a JSON null for the day is the same request');
reset role;
select pg_temp.assert((select s.settings - 'day_asked' - 'day_asked_on' = b.settings - 'day_asked' - 'day_asked_on' and s.settings->'day' = b.settings->'day' and b.settings->'day_asked' = '12'::jsonb
    and s.settings->'day_asked' = '18'::jsonb and s.settings->>'day_asked_on' = to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')
  from public.care_subjects s, before_keep b where s.id = :lana), 'the day is unchanged and the question is settled at 18 months, on the home''s date');

-- A kind of entry marked settings.needs is listed only in a home whose day has turned it on. A Potty
-- type is made here (switched on, once a migration brings the real one) beside a kind that nothing
-- turns on, and it is all rolled back. Then a day written straight into the settings, which an
-- admin may do: it counts only when it reads whole.
select pg_temp.act_as(:mido);
begin;
insert into public.care_entry_types (id, module_id, key, label, icon, sort, has_end, due_after_min, fields, settings, show_on_home, is_active) values
  ('lana.potty', 'lana', 'potty', 'Potty', '🚽', 22, false, null,
   '[{"key":"kind","label":"What","type":"choice","options":["Wee","Poo","Tried","Accident"],"required":true}]'::jsonb, '{"needs": "potty"}'::jsonb, false, true)
on conflict (id) do update set is_active = true, settings = excluded.settings;
insert into public.care_entry_types (id, module_id, key, label, sort, settings, show_on_home, is_active) values
  ('lana.day_probe', 'lana', 'day_probe', 'Probe', 23, '{"needs": "something else"}'::jsonb, false, true);
set local role authenticated;
select pg_temp.assert(not pg_temp.listed(:lana, 'lana.potty') and not pg_temp.listed(:lana, 'lana.day_probe') and pg_temp.listed(:lana, 'lana.diaper'),
  'at 600 days with diapers not logged, Potty is not among the kinds, nor is a kind nothing turns on; the others are');
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "off", "naps": 0, "diapers": "both", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'with a Potty entry to log, both is an answer at 600 days');
select pg_temp.assert(pg_temp.listed(:lana, 'lana.potty'), 'and Potty is listed');
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "off", "naps": 0, "diapers": "potty", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'so is potty alone');
select pg_temp.assert(pg_temp.listed(:lana, 'lana.potty') and not pg_temp.listed(:lana, 'lana.day_probe'), 'Potty is listed; the other marked kind never is');
reset role;
update public.care_subjects set birth_date = :'birth400' where id = :lana;
set local role authenticated;
select pg_temp.assert(not pg_temp.listed(:lana, 'lana.potty'), 'under 18 months a day that says potty does not list it (a corrected birth date gets there)');
reset role;
update public.care_subjects set birth_date = current_date - 160 where id = :lana;
set local role authenticated;
select pg_temp.assert(not pg_temp.listed(:lana, 'lana.potty'), 'nor for a baby');
reset role;
update public.care_subjects set birth_date = current_date - 600 where id = :lana;
set local role authenticated;
select pg_temp.assert(pg_temp.listed(:lana, 'lana.potty'), 'back at 600 days it is listed again');
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "off", "naps": 0, "diapers": "diapers", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'Mido goes back to diapers');
select pg_temp.assert(not pg_temp.listed(:lana, 'lana.potty'), 'and Potty is gone from the kinds');
select pg_temp.assert(pg_temp.day_reads(:lana, b) = 'yyy' and pg_temp.day_reads(:lana, b || '{"v": "1", "naps": 2.0, "more": "x"}') = 'yyy',
  'a whole day written directly is read: in me(), the feed due again, Potty listed')
  from (select jsonb_build_object('v', 1, 'milk', 'clock', 'naps', 1, 'diapers', 'both', 'stores_milk', true,
                                  'saved_on', to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')) as b) x;
select pg_temp.assert(bool_and(pg_temp.day_reads(:lana, v.d) = 'nnn'), 'with a bad or missing answer it is no day: null in me(), no next due on the feed, Potty not listed')
  from (select jsonb_build_object('v', 1, 'milk', 'clock', 'naps', 1, 'diapers', 'both', 'stores_milk', true,
                                  'saved_on', to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')) as b) x,
       lateral (values (b || '{"v": 2}'), (b - 'v'), (b || '{"milk": "bottle"}'), (b - 'milk'), (b || '{"naps": 3}'), (b || '{"naps": 1.5}'), (b || '{"naps": "1"}'), (b - 'naps'),
                       (b || '{"diapers": "nappy"}'), (b - 'diapers'), (b || '{"stores_milk": "yes"}'), (b - 'stores_milk'),
                       (b || '{"saved_on": "06/06/2027"}'), (b || '{"saved_on": 20270606}'), (b - 'saved_on'), ('[1]'::jsonb), ('"clock"'::jsonb), ('null'::jsonb)) v(d);
rollback;
select pg_temp.assert(not exists (select 1 from public.care_entry_types where id = 'lana.day_probe')
  and (select settings from public.care_subjects where id = :lana) = (select settings from before_keep) || jsonb_build_object('day_asked', 18, 'day_asked_on', to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')),
  'none of that stayed');

-- Bedtime and morning are read when the numbers are asked for: a sleep at 19:30, 45 days ago, is a
-- nap while bedtime is 20:30 and night sleep once it is 19:00. Nothing stored is rewritten.
select ((now() at time zone :'home_tz')::date - 45) as stat_day \gset
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.sleep', (:'stat_day'::date + time '19:30') at time zone :'home_tz', (:'stat_day'::date + time '19:50') at time zone :'home_tz', '{"place":"Cot"}', 'day test', null))->>'ok' = 'true',
  'Mido logs a sleep from 19:30 to 19:50, 45 days ago');
create temp table nap2030 as select (public.care_daily_stats(:lana, :'stat_day', :'stat_day'))->'days'->0 as d;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "off", "naps": 0, "diapers": "off", "stores_milk": true}'::jsonb, '19:00', '06:30'))->>'ok' = 'true', 'and moves bedtime to 19:00 and morning to 06:30');
create temp table nap1900 as select (public.care_daily_stats(:lana, :'stat_day', :'stat_day'))->'days'->0 as d;
reset role;
select pg_temp.assert((select d->>'nap_count' = '1' and d->>'night_sleep_min' = '0' from nap2030), 'with bedtime at 20:30 it is a nap');
select pg_temp.assert((select d->>'nap_count' = '0' and d->>'night_sleep_min' = '20' from nap1900), 'with bedtime at 19:00 it is twenty minutes of night sleep');
select pg_temp.assert((select settings->>'night_from' = '19:00' and settings->>'night_to' = '06:30' from public.care_subjects where id = :lana), 'both times are stored');

-- Absent means as before. Back at 160 days, and on day 365, with the day still stored (milk not
-- logged, which gives a toddler no next due): no day in me(), and the baby's clocks are all there.
update public.care_subjects set birth_date = current_date - 160 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table baby160 as select public.home_summary(:lana) as s, pg_temp.me_day(:lana) as day;
reset role;
update public.care_subjects set birth_date = (now() at time zone :'home_tz')::date - 365 where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table baby365 as select public.home_summary(:lana) as s, pg_temp.me_day(:lana) as day;
reset role;
-- The age is asked on its own account, not left to the day's date: a date still to come does not open it.
update public.care_subjects set settings = jsonb_set(settings, '{day,saved_on}', '"2999-01-01"') where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(pg_temp.me_day(:lana) = 'null'::jsonb, 'a baby has no day whatever date the stored one carries');
reset role;
select pg_temp.assert((select settings->'day'->>'milk' = 'off' from public.care_subjects where id = :lana)
  and (select day = 'null'::jsonb and s#>>'{last,lana.feed,next_due}' is not null and s#>>'{last,lana.diaper,next_due}' is not null and s#>>'{last,lana.sleep,next_due}' is not null from baby160),
  'at 160 days a stored day is not read: null in me(), and the last feed, diaper and sleep each have a next due');
select pg_temp.assert((select day = 'null'::jsonb and s#>>'{last,lana.feed,next_due}' is not null and s#>>'{last,lana.diaper,next_due}' is not null and s#>>'{last,lana.sleep,next_due}' is not null from baby365),
  'and the same on day 365 of the home''s calendar');

-- A day saved under a birth date that was later moved (a mistyped year at sign-up) does not come
-- into force when the child reaches 12 months by the true date. The suite cannot wait a year, so
-- the day's date is moved back instead: 400 days old today, and a day saved on her day 365, then 366.
update public.care_subjects set birth_date = :'birth400' where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, '{"milk": "clock", "naps": 1, "diapers": "diapers", "stores_milk": true}'::jsonb))->>'ok' = 'true', 'Mido saves a day with milk on a clock, at 400 days');
reset role;
update public.care_subjects set settings = jsonb_set(settings, '{day,saved_on}', to_jsonb(to_char(birth_date + 365, 'YYYY-MM-DD'))) where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table moved365 as select public.home_summary(:lana) as s, pg_temp.me_day(:lana) as day;
reset role;
update public.care_subjects set settings = jsonb_set(settings, '{day,saved_on}', to_jsonb(to_char(birth_date + 366, 'YYYY-MM-DD'))) where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table moved366 as select public.home_summary(:lana) as s, pg_temp.me_day(:lana) as day;
reset role;
select pg_temp.assert((select day = 'null'::jsonb and s#>>'{last,lana.feed,next_due}' is null from moved365), 'saved on what is now her day 365, it is no day: null in me() and no clock on the milk');
select pg_temp.assert((select day->>'milk' = 'clock' and s#>>'{last,lana.feed,next_due}' is not null from moved366), 'saved on her day 366, it counts');

-- An admin at home is a carer in the Khans' home: there the day is not his to save.
select pg_temp.act_as(:mido);
select set_config('request.headers', jsonb_build_object('x-home', :khan_home)::text, false);
set role authenticated;
select pg_temp.assert(not private.is_admin() and (public.subject_day_save(:zayd, :day_ok::jsonb))->>'message' = 'Ask Haitham to change Zayd''s day.', 'Mido, a carer in the home on screen, is refused Zayd''s day, naming that home''s admin');
reset role;
select set_config('request.headers', '', false);
select pg_temp.assert((select settings from public.care_subjects where id = :zayd) = :'zayd_settings'::jsonb, 'Zayd''s settings are as they were');

-- The stamps are the home's calendar day, not the server's. A home 14 hours ahead of UTC and one
-- 12 hours behind: at any moment one of them is on another date than the server, so a stamp taken
-- from the server's clock fails here whatever the hour the suite runs at. Rolled back with the zone.
select pg_temp.act_as(:mido);
begin;
update public.household set timezone = 'Pacific/Kiritimati' where id = :'our_home';
update public.care_subjects set birth_date = (now() at time zone 'Pacific/Kiritimati')::date - 600 where id = :lana;
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana))->>'ok' = 'true', 'kept as it is, in a home 14 hours ahead of UTC');
reset role;
select pg_temp.assert((select settings->>'day_asked_on' = to_char((now() at time zone 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') from public.care_subjects where id = :lana), 'the question is dated on that home''s day');
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'ok' = 'true', 'and saved there');
reset role;
select pg_temp.assert((select settings->'day'->>'saved_on' = to_char((now() at time zone 'Pacific/Kiritimati')::date, 'YYYY-MM-DD') and settings->>'day_asked_on' = settings->'day'->>'saved_on' from public.care_subjects where id = :lana), 'the day is dated on that home''s day too');
update public.household set timezone = 'Etc/GMT+12' where id = :'our_home';
update public.care_subjects set birth_date = (now() at time zone 'Etc/GMT+12')::date - 600 where id = :lana;
set local role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'ok' = 'true', 'saved in a home 12 hours behind UTC');
reset role;
select pg_temp.assert((select settings->'day'->>'saved_on' = to_char((now() at time zone 'Etc/GMT+12')::date, 'YYYY-MM-DD') and settings->>'day_asked_on' = settings->'day'->>'saved_on' from public.care_subjects where id = :lana), 'and dated on that home''s day');
rollback;
select pg_temp.assert((select timezone = :'home_tz' from public.household where id = :'our_home'), 'the home is back in its own zone');

-- Settings that are not an object (only a hand-written update stores that): a save replaces them
-- with an object that holds the day; it does not append to a list.
update public.care_subjects set birth_date = current_date - 600, settings = '[]'::jsonb where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb, '19:30', null))->'day'->>'milk' = 'drink', 'a save onto settings that are a list answers with the day');
reset role;
select pg_temp.assert((select jsonb_typeof(settings) = 'object' and settings->'day'->>'milk' = 'drink' and settings->>'night_from' = '19:30' and settings->'day_asked' = '18'::jsonb from public.care_subjects where id = :lana),
  'the stored settings are an object again, with the day, the bedtime and the question settled');
update public.care_subjects set settings = '"x"'::jsonb where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.subject_day_save(:lana))->>'ok' = 'true', 'kept as it is onto settings that are a bare text');
reset role;
select pg_temp.assert((select settings = jsonb_build_object('day_asked', 18, 'day_asked_on', to_char((now() at time zone :'home_tz')::date, 'YYYY-MM-DD')) from public.care_subjects where id = :lana), 'and only the settled question is stored');

-- A birth date no calendar holds (only a hand-made call stores one) must not sign the home out:
-- me() still answers, with no day, and the day cannot be saved.
update public.care_subjects set birth_date = 'infinity' where id = :lana;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.me())->>'ok' = 'true' and pg_temp.me_day(:lana) = 'null'::jsonb, 'with a birth date of infinity me() still answers, and there is no day');
select pg_temp.assert((public.subject_day_save(:lana, :day_ok::jsonb))->>'error' = 'too_young', 'and the day is not opened for it');
reset role;

-- Put back: her row as it was (the top of this file pins her age), the log, and who may do what.
update public.care_subjects s set name = f.name, birth_date = f.birth_date, profile = f.profile, settings = f.settings, created_at = f.created_at from day6800 f where s.id = :lana;
update public.care_entries set deleted_at = now() where note = 'day test' and deleted_at is null;
update public.permissions p set allowed = f.allowed from perm6800 f where p.role_id = f.role_id and p.module_id = f.module_id and p.action = f.action;
select pg_temp.assert((select (s.name, s.birth_date, s.profile, s.settings, s.created_at) is not distinct from (f.name, f.birth_date, f.profile, f.settings, f.created_at) from public.care_subjects s, day6800 f where s.id = :lana)
  and not exists (select 1 from public.care_entries where note = 'day test' and deleted_at is null) and not exists (select 1 from public.milk_bottles where note = 'day test')
  and not exists (select 1 from public.permissions p join perm6800 f using (role_id, module_id, action) where p.allowed is distinct from f.allowed),
  'her row, the log and the permissions are put back');

-- Effort, counted (migration 7050): the caller's own sums and the home's, never another member's.
-- Read before and after a known handful of entries, so the checks do not lean on what the log holds.
select not prosecdef as effort_invoker from pg_proc where proname = 'effort_totals' and pronamespace = 'public'::regnamespace \gset
select pg_temp.assert(:'effort_invoker'::boolean, 'effort_totals runs as the caller, so row security decides what it may read');
select pg_temp.act_as(:dana);
set role authenticated;
create temp table eff_a0 as select public.effort_totals(:lana) as r;
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table eff_b0 as select public.effort_totals(:lana) as r;
reset role;
select birth_date as eff_birth from public.care_subjects where id = :lana \gset
insert into public.care_entries (subject_id, module_id, type_id, occurred_at, ended_at, payload, household_id, logged_by, attributed_to, deleted_at, note) values
  (:lana, 'lana', 'lana.feed',   now() - interval '26 hours', now() - interval '26 hours' + interval '40 minutes', '{"method":"Breast","side":"Left"}', :'fam_home', :dana, null, null, 'effort test'),
  (:lana, 'lana', 'lana.feed',   now() - interval '20 hours', now() - interval '15 hours', '{"method":"Breast","side":"Right"}', :'fam_home', :dana, null, null, 'effort test'),
  (:lana, 'lana', 'lana.feed',   now() - interval '12 hours', null, '{"method":"Bottle","amount_ml":120}', :'fam_home', :mido, :dana, null, 'effort test'),
  (:lana, 'lana', 'lana.pump',   now() - interval '11 hours', null, '{"amount_ml":120}', :'fam_home', :dana, null, null, 'effort test'),
  (:lana, 'lana', 'lana.pump',   now() - interval '10 hours', null, '{"amount_ml":"lots"}', :'fam_home', :dana, null, null, 'effort test'),
  (:lana, 'lana', 'lana.diaper', now() - interval '9 hours',  null, '{"kind":"Wet"}', :'fam_home', :dana, :mido, null, 'effort test'),
  (:lana, 'lana', 'lana.sleep',  now() - interval '8 hours',  now() - interval '7 hours', '{}', :'fam_home', :mido, null, null, 'effort test'),
  (:lana, 'lana', 'lana.feed',   now() - interval '6 hours',  null, '{"method":"Bottle"}', :'fam_home', :dana, null, now(), 'effort test'),
  (:lana, 'lana', 'lana.feed',   now() + interval '2 hours',  null, '{"method":"Bottle"}', :'fam_home', :dana, null, null, 'effort test'),
  (:lana, 'lana', 'lana.feed',   (:'eff_birth'::date - 2)::timestamp at time zone :'home_tz', null, '{"method":"Bottle"}', :'fam_home', :dana, null, null, 'effort test'),
  -- What only she can do stays hers even when the entry carries the other parent as having the child.
  (:lana, 'lana', 'lana.feed',   now() - interval '5 hours',  now() - interval '5 hours' + interval '20 minutes', '{"method":"Breast","side":"Left"}', :'fam_home', :dana, :mido, null, 'effort test'),
  (:lana, 'lana', 'lana.pump',   now() - interval '4 hours',  null, '{"amount_ml":30}', :'fam_home', :dana, :mido, null, 'effort test'),
  -- One hour into the day of the birth at home: the evening before on the server's calendar.
  (:lana, 'lana', 'lana.diaper', (:'eff_birth'::date + interval '1 hour') at time zone :'home_tz', null, '{"kind":"Wet"}', :'fam_home', :dana, null, null, 'effort test');
select pg_temp.act_as(:dana);
set role authenticated;
create temp table eff_a1 as select public.effort_totals(:lana) as r;
select pg_temp.assert((select (a1.r->'mine'->>'feeds')::int - (a0.r->'mine'->>'feeds')::int = 4 and (a1.r->'all'->>'feeds')::int - (a0.r->'all'->>'feeds')::int = 4 from eff_a0 a0, eff_a1 a1),
  'her feeds grow by four: three breastfeeds she saved and a bottle saved in her name; a deleted one, one not yet happened and one from before the birth are not counted');
select pg_temp.assert((select (a1.r->'mine'->>'breast_min')::int - (a0.r->'mine'->>'breast_min')::int = 150 from eff_a0 a0, eff_a1 a1),
  'a breastfeed counts for as long as it ran, a timer left running for at most 90 minutes, and one saved while the other parent had the child is still hers');
select pg_temp.assert((select (a1.r->'mine'->>'pumps')::int - (a0.r->'mine'->>'pumps')::int = 3 and (a1.r->'mine'->>'pump_ml')::int - (a0.r->'mine'->>'pump_ml')::int = 150 from eff_a0 a0, eff_a1 a1),
  'three pumps, the one carrying the other parent''s name among them; an amount that is not a number counts as nothing rather than failing');
select pg_temp.assert((select (a1.r->'mine'->>'diapers')::int - (a0.r->'mine'->>'diapers')::int = 1 and (a1.r->'all'->>'diapers')::int - (a0.r->'all'->>'diapers')::int = 2
  and (a1.r->'mine'->>'sleeps')::int = (a0.r->'mine'->>'sleeps')::int and (a1.r->'all'->>'sleeps')::int - (a0.r->'all'->>'sleeps')::int = 1 from eff_a0 a0, eff_a1 a1),
  'a diaper she saved while the other parent had the child and a sleep he saved are the home''s, not hers');
select pg_temp.assert((select (r->'mine'->>'days')::int between 1 and (r->'all'->>'days')::int and (r->'all'->>'first_day')::date <= (r->'mine'->>'first_day')::date
  and (r->'all'->>'first_day')::date = :'eff_birth'::date and r->>'birth_date' = :'eff_birth' from eff_a1),
  'days are counted on the home''s calendar: an entry one hour into the day of the birth at home is the first day, and nothing before the birth is');
select pg_temp.assert((select not (r ? 'members') and (select count(*) from jsonb_object_keys(r)) = 4 from eff_a1), 'the answer holds her sums and the home''s and nobody else''s');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
create temp table eff_b1 as select public.effort_totals(:lana) as r;
select pg_temp.assert((select (b1.r->'mine'->>'diapers')::int - (b0.r->'mine'->>'diapers')::int = 1 and (b1.r->'mine'->>'sleeps')::int - (b0.r->'mine'->>'sleeps')::int = 1
  and (b1.r->'mine'->>'feeds')::int = (b0.r->'mine'->>'feeds')::int and (b1.r->'mine'->>'pumps')::int = (b0.r->'mine'->>'pumps')::int
  and (b1.r->'mine'->>'breast_min')::int = (b0.r->'mine'->>'breast_min')::int and (b1.r->'all'->>'feeds')::int - (b0.r->'all'->>'feeds')::int = 4 from eff_b0 b0, eff_b1 b1),
  'the other parent is credited the diaper saved while he had the child and his own sleep; not the bottle he saved in her name, nor her breastfeed, nor her pump');
-- The app's own path: he takes the child with the "with ..." switch, she saves a pump, a
-- breastfeed and a diaper from her phone. care_entry_log marks all three as his (he has the
-- child); the pump and the breastfeed are still counted as hers.
select pg_temp.assert((public.custody_set(:lana, :mido))->>'ok' = 'true', 'he says he has the child');
reset role;
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.care_entry_log(:lana, 'lana.pump', now() - interval '40 minutes', null, '{"amount_ml":150}', 'effort test', null))->>'ok' = 'true'
  and (public.care_entry_log(:lana, 'lana.feed', now() - interval '30 minutes', now() - interval '5 minutes', '{"method":"Breast","side":"Left"}', 'effort test', null))->>'ok' = 'true'
  and (public.care_entry_log(:lana, 'lana.diaper', now() - interval '3 minutes', null, '{"kind":"Wet"}', 'effort test', null))->>'ok' = 'true', 'she saves a pump, a breastfeed and a diaper while he has the child');
create temp table eff_a2 as select public.effort_totals(:lana) as r;
select pg_temp.assert((select (a2.r->'mine'->>'pumps')::int - (a1.r->'mine'->>'pumps')::int = 1 and (a2.r->'mine'->>'pump_ml')::int - (a1.r->'mine'->>'pump_ml')::int = 150
  and (a2.r->'mine'->>'feeds')::int - (a1.r->'mine'->>'feeds')::int = 1 and (a2.r->'mine'->>'breast_min')::int - (a1.r->'mine'->>'breast_min')::int = 25
  and (a2.r->'mine'->>'diapers')::int = (a1.r->'mine'->>'diapers')::int from eff_a1 a1, eff_a2 a2),
  'saved through the app while he has the child: her pump and her breastfeed are hers, the diaper is not');
reset role;
select pg_temp.assert((select count(*) from public.care_entries where note = 'effort test' and logged_by = :dana and attributed_to = :mido and occurred_at > now() - interval '45 minutes') = 3,
  'all three carry him as having the child, as the app saves them: the count above did not pass for want of that');
select pg_temp.act_as(:mido);
set role authenticated;
create temp table eff_b2 as select public.effort_totals(:lana) as r;
select pg_temp.assert((select (b2.r->'mine'->>'diapers')::int - (b1.r->'mine'->>'diapers')::int = 1 and (b2.r->'mine'->>'pumps')::int = (b1.r->'mine'->>'pumps')::int
  and (b2.r->'mine'->>'feeds')::int = (b1.r->'mine'->>'feeds')::int and (b2.r->'mine'->>'breast_min')::int = (b1.r->'mine'->>'breast_min')::int from eff_b1 b1, eff_b2 b2),
  'and he is shown the diaper, never her litres or her hours at the breast');
reset role;
delete from public.care_custody where subject_id = :lana and set_by = :mido and since > now() - interval '1 minute';
-- "View as": the admin is answered the home's sums alone, never the viewed member's own.
select pg_temp.preview_as(:mido, :dana);
set role authenticated;
select pg_temp.assert((public.effort_totals(:lana))->'mine' = 'null'::jsonb and ((public.effort_totals(:lana))->'all'->>'feeds')::int > 0, 'viewing as her, he is not handed her own sums; the home''s are there');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((public.effort_totals(:lana))->>'error' = 'not_found', 'another home''s child is not found');
reset role;
create temp table perm7050 as select role_id, module_id, action, allowed from public.permissions where role_id = 'home_carer' and module_id = 'lana';
update public.permissions set allowed = false where role_id = 'home_carer' and module_id = 'lana';
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.effort_totals(:lana))->>'ok' = 'false', 'a member who may not view the child is refused');
reset role;
update public.permissions p set allowed = f.allowed from perm7050 f where p.role_id = f.role_id and p.module_id = f.module_id and p.action = f.action;
set role anon;
select pg_temp.assert(pg_temp.fails($q$select public.effort_totals('00000000-0000-4000-8000-00000000a001')$q$), 'signed out, no sums');
reset role;
update public.care_entries set deleted_at = now() where note = 'effort test' and deleted_at is null;

\echo 'All Step 1 to 6 database checks passed (view-as, adoptions, finishing, perf, chat, vaccines, end_if, milk, parity, smart care, coach, skills, week, helper skills, entry checks, memory, sprouty, timers, preview guards, signed out, end once, many homes, definer scope, home ops, homes per account, home on screen, invite links, helper cards, diaper, family words, milk past its time, after the first birthday, the child''s facts, the answer follows the member, the family''s day).'
select count(*) as audit_rows, sum(case when allowed then 0 else 1 end) as denied from public.audit_log;
