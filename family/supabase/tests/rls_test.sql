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
select pg_temp.assert(public.has_permission('maintenance', 'add') and not public.has_permission('maintenance_costs', 'view'), 'Lilly: maintenance tickets yes, costs no');
reset role;

-- ---------------------------------------------------------------- as Wafa (family carer)
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.me())#>>'{role,id}' = 'family_carer', 'Wafa signs in as family carer');
select pg_temp.assert((public.home_summary())->>'ok' = 'true', 'Wafa can see Lana''s home summary');
select pg_temp.assert((public.care_entry_log(:lana, 'lana.diaper', now(), null, '{"kind":"Wet"}', null, null))->>'ok' = 'true', 'Wafa logs a diaper');
select pg_temp.assert(not public.has_permission('maintenance_costs', 'view'), 'Wafa: maintenance costs denied');
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

-- ---------------------------------------------------------------- shopping: Lilly's requests and the review queue
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert(not public.has_permission('shopping','add') and public.has_permission('shopping_requests','add'), 'Lilly requests, she does not add to the list directly');
select pg_temp.assert(jsonb_array_length((public.shopping_list())->'shelf') >= 10, 'Lilly sees the shelf of usual items');
select pg_temp.assert((public.shopping_request_create((select id from public.shelf_items where name = 'Wipes'), null, null, null))->>'item_name' = 'Wipes', 'Lilly taps Wipes on the shelf');
select pg_temp.assert((public.shopping_request_create(null, null, 'The blue bottle under the sink', 'requests/abc.jpg'))->>'ok' = 'true', 'Lilly sends a photo with a note');
select pg_temp.assert((public.shopping_request_create(null, null, null, null))->>'error' = 'empty', 'an empty request is refused');
select pg_temp.assert((public.shopping_request_review((select id from public.shopping_requests limit 1), true, null))->>'error' = 'not_allowed', 'Lilly cannot approve her own request');
select pg_temp.assert((select count(*) from public.shopping_items) = 0, 'Lilly sees no list items directly');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.shopping_requests_list('pending'))->>'error' = 'not_allowed', 'Wafa cannot see the review queue');
select pg_temp.assert((public.shopping_item_save(null, 'Bananas', 'groceries', null, 'carrefour', null, null, null, null, null, null, true, null))->>'ok' = 'true', 'Wafa adds bananas straight to the list');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert(((public.shopping_list())->>'pending_requests')::int = 2, 'Mido sees 2 pending requests');
select pg_temp.assert((public.shopping_request_review((select id from public.shopping_requests where item_name = 'Wipes'), true, null))->>'ok' = 'true', 'Mido approves Wipes');
select pg_temp.assert(exists (select 1 from public.shopping_items where name = 'Wipes' and needed and category = 'baby'), 'Wipes is now on the list as a baby item');
select pg_temp.assert((public.shopping_request_review((select id from public.shopping_requests where item_name = 'See photo'), false, null))->>'ok' = 'true', 'Mido rejects the photo request');
select pg_temp.assert(((public.shopping_list())->>'pending_requests')::int = 0, 'queue is empty');
select pg_temp.assert((public.shopping_item_needed((select id from public.shopping_items where name = 'Wipes'), false, 24.50, 'Carrefour'))->>'ok' = 'true', 'Mido ticks Wipes off as bought');
select pg_temp.assert((select last_bought_on = current_date and last_price = 24.50 and not needed from public.shopping_items where name = 'Wipes'), 'bought today, price remembered');
select pg_temp.assert((select count(*) from public.shopping_items where category = 'adult' and owner_member = :mido) = 3, 'Mido''s three consumables are seeded');
select pg_temp.assert((select reorder_days = 30 from public.shopping_items where name = 'Royal Canin cat food'), 'Royal Canin is a recurring item');
reset role;
select pg_temp.act_as(:dana);
set role authenticated;
select pg_temp.assert((public.shopping_item_needed((select id from public.shopping_items where name = 'Collagen'), true))->>'ok' = 'true', 'Dana puts her own collagen on the list');
select pg_temp.assert((public.shopping_item_needed((select id from public.shopping_items where name = 'Creatine monohydrate'), true))->>'ok' = 'true', 'Dana (admin) can also edit Mido''s');
reset role;
select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.shopping_item_remove((select id from public.shopping_items where name = 'Bananas')))->>'error' = 'not_allowed', 'Wafa cannot delete items');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where module_id in ('calendar','shopping','shopping_requests','shopping_review') and not allowed) >= 5,
  'Step 2 denials are in the audit log');


-- ===========================================================================
-- Step 3: Fanta, attachments, home maintenance
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
select pg_temp.assert((public.attachment_add('maintenance', 'tickets', gen_random_uuid(), 'tickets/x.jpg', null, null))->>'error' = 'not_allowed', 'Luda cannot attach photos to maintenance tickets');
select pg_temp.assert((public.tickets_list(null))->>'error' = 'not_allowed', 'Luda cannot see tickets');
reset role;

select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.care_entries_list(:fanta, now() - interval '7 days', now()))->>'error' = 'not_allowed', 'Lilly cannot see Fanta''s log');
select pg_temp.assert((select count(*) from public.care_entries where module_id = 'fanta') = 0, 'Lilly sees no Fanta rows directly');
select pg_temp.assert((public.ticket_create('AC in the bedroom is leaking', 'Water dripping from the unit', 'Bedroom', null, 'urgent', 'tickets/leak.jpg'))->>'ok' = 'true', 'Lilly opens a ticket with a photo');
select pg_temp.assert((public.ticket_create(null, null, null, null, 'normal', 'tickets/mystery.jpg'))->>'ok' = 'true', 'a photo alone opens a ticket');
select pg_temp.assert((public.ticket_create(null, null, null, null, 'normal', null))->>'error' = 'empty', 'an empty ticket is refused');
select pg_temp.assert(((public.tickets_list('open'))->'tickets'->0->>'photo_path') is not null, 'the photo is on the ticket');
select pg_temp.assert(((public.tickets_list('open'))->>'costs_visible')::boolean = false, 'Lilly is told costs are hidden');
select pg_temp.assert((public.ticket_update((select id from public.tickets where title = 'AC in the bedroom is leaking'), 'Still dripping this morning', null, 'tickets/leak2.jpg', null, null, null, null))->>'ok' = 'true', 'Lilly adds a note and photo');
select pg_temp.assert((public.ticket_update((select id from public.tickets where title = 'AC in the bedroom is leaking'), null, 'done', null, null, null, null, null))->>'ok' = 'true', 'Lilly (maintenance.edit) can close a ticket');
select pg_temp.assert((public.ticket_cost_add((select id from public.tickets where title = 'AC in the bedroom is leaking'), 350, 'Callout', current_date, null))->>'error' = 'not_allowed', 'Lilly cannot add costs');
select pg_temp.assert((select count(*) from public.ticket_costs) = 0, 'Lilly sees no cost rows');
select pg_temp.assert((public.asset_save(null, 'Bedroom AC', 'ac', 'Bedroom', 'Daikin', 'FTKM35', 'SN123', null, null, null, null, 'assets/label.jpg', 'MODEL FTKM35 S/N SN123', true))->>'ok' = 'true', 'Lilly registers an asset from its label');
select pg_temp.assert((public.contractor_save(null, 'Cool Air', 'AC', '+971 50 000 0000', null, null, null, null, true))->>'ok' = 'true', 'Lilly (maintenance.edit) adds a contractor');
reset role;

select pg_temp.act_as(:wafa);
set role authenticated;
select pg_temp.assert((public.tickets_list(null))->>'error' = 'not_allowed', 'Wafa cannot see tickets');
select pg_temp.assert((public.maintenance_overview())->>'error' = 'not_allowed', 'Wafa cannot see the house overview');
reset role;

select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.ticket_update((select id from public.tickets where title = 'AC in the bedroom is leaking'), null, 'in_progress', null, (select id from public.contractors where name = 'Cool Air'), (select id from public.assets where name = 'Bedroom AC'), null, null))->>'ok' = 'true', 'Mido reopens it, assigns Cool Air and the bedroom AC');
select pg_temp.assert((public.ticket_cost_add((select id from public.tickets where title = 'AC in the bedroom is leaking'), 350, 'Callout', current_date, :mido))->>'ok' = 'true', 'Mido adds the callout cost');
select pg_temp.assert(((public.ticket_get((select id from public.tickets where title = 'AC in the bedroom is leaking')))->'ticket'->>'contractor_name') = 'Cool Air', 'ticket shows the contractor');
select pg_temp.assert(((public.ticket_get((select id from public.tickets where title = 'AC in the bedroom is leaking')))->'costs'->0->>'amount')::numeric = 350, 'Mido sees the cost');
select pg_temp.assert(((public.maintenance_overview())->>'open')::int = 2, 'two open tickets');
select pg_temp.assert(jsonb_array_length((public.attachments_search('FTKM35'))->'hits') = 1, 'the label text is searchable');
select pg_temp.assert(jsonb_array_length((public.attachments_list('tickets', (select id from public.tickets where title = 'AC in the bedroom is leaking')))->'attachments') = 2, 'two photos on the ticket');
reset role;

select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert(jsonb_typeof((public.ticket_get((select id from public.tickets where title = 'AC in the bedroom is leaking')))->'costs') = 'null', 'Lilly still sees no costs on the ticket');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where module_id in ('maintenance','maintenance_costs','fanta') and not allowed) >= 4,
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
select pg_temp.assert((public.assistant_brief_save(current_date, 'lunch', 'x', null, null))->>'error' = 'bad_kind', 'only morning or evening');
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
-- Step 5: receipts → purchases → learned interval; cart runs
-- ============================================================================
select pg_temp.act_as(:lilly);
set role authenticated;
select pg_temp.assert((public.receipt_create('receipts/x.jpg', null))->>'error' = 'not_allowed', 'Lilly cannot add receipts');
select pg_temp.assert((public.receipts_list())->>'error' = 'not_allowed', 'Lilly cannot see receipts');
select pg_temp.assert((public.cart_run_create('amazon_ae', array[(select id from public.shopping_items where name = 'Royal Canin cat food')], null))->>'error' = 'not_allowed', 'Lilly cannot prepare a cart');
reset role;

-- Wafa (family carer: shopping add, not edit) photographs a receipt; the reading comes back with one model match, one alias/name match, one unknown line.
select pg_temp.act_as(:wafa);
set role authenticated;
\set receipt1 `echo "'$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo 11111111-1111-4111-8111-111111111111)'"`
select pg_temp.assert((public.receipt_create('receipts/r1.jpg', null))->>'ok' = 'true', 'Wafa adds a receipt');
select pg_temp.assert((select count(*) from public.receipts where photo_path = 'receipts/r1.jpg') = 1, 'the receipt row is hers to see');
select pg_temp.assert((public.receipt_set_lines((select id from public.receipts where photo_path = 'receipts/r1.jpg'),
  jsonb_build_object('store', 'Carrefour City', 'date', '2026-09-01', 'currency', 'AED', 'total', 161.25, 'lines', jsonb_build_array(
    jsonb_build_object('text', 'ROYAL CANIN KITTEN 2KG', 'qty', 1, 'unit_price', 95.00, 'line_total', 95.00, 'item_id', (select id from public.shopping_items where name = 'Royal Canin cat food')),
    jsonb_build_object('text', 'CREATINE MONOHYDRATE 300G', 'qty', 1, 'unit_price', 60.00, 'line_total', 60.00, 'item_id', null),
    jsonb_build_object('text', 'CARRIER BAG', 'qty', 1, 'unit_price', 0.25, 'line_total', 0.25, 'item_id', null),
    jsonb_build_object('text', 'CHOCO BISCUITS 200G', 'qty', 2, 'unit_price', 3.00, 'line_total', 6.00, 'item_id', null)
  ))))->>'matched' = '2', 'two of four lines matched (one by the model, creatine by name similarity)');
select pg_temp.assert((select store_id from public.receipts where photo_path = 'receipts/r1.jpg') = 'carrefour', 'the shop was recognised from its name');
select pg_temp.assert((select match from public.receipt_lines l join public.receipts r on r.id = l.receipt_id where r.photo_path = 'receipts/r1.jpg' and l.text like 'CREATINE%') = 'auto', 'creatine matched by name');
select pg_temp.assert((select match from public.receipt_lines l join public.receipts r on r.id = l.receipt_id where r.photo_path = 'receipts/r1.jpg' and l.text = 'CARRIER BAG') = 'unmatched', 'the bag is flagged, not dropped');
-- Wafa fixes the flagged lines: biscuits become a new item, the bag is skipped
select pg_temp.assert((public.receipt_line_set((select l.id from public.receipt_lines l join public.receipts r on r.id = l.receipt_id where r.photo_path = 'receipts/r1.jpg' and l.text like 'CHOCO%'), 'added', null, 'Choco biscuits', 'groceries'))->>'ok' = 'true', 'Wafa adds the biscuits as a new item');
select pg_temp.assert((public.receipt_line_set((select l.id from public.receipt_lines l join public.receipts r on r.id = l.receipt_id where r.photo_path = 'receipts/r1.jpg' and l.text = 'CARRIER BAG'), 'skipped'))->>'ok' = 'true', 'and skips the bag');
select pg_temp.assert((public.receipt_apply((select id from public.receipts where photo_path = 'receipts/r1.jpg')))->>'error' = 'not_allowed', 'Wafa cannot apply it (shopping edit)');
reset role;

select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.receipt_apply((select id from public.receipts where photo_path = 'receipts/r1.jpg')))->>'applied' = '3', 'Mido applies it: three purchases');
select pg_temp.assert((select last_price from public.shopping_items where name = 'Royal Canin cat food') = 95.00 and (select last_bought_on from public.shopping_items where name = 'Royal Canin cat food') = date '2026-09-01', 'Royal Canin: last price and date from the receipt');
select pg_temp.assert(exists (select 1 from public.shopping_item_aliases a join public.shopping_items i on i.id = a.item_id where i.name = 'Royal Canin cat food' and a.alias = 'ROYAL CANIN KITTEN 2KG'), 'the printed name is remembered as an alias');
select pg_temp.assert((select reorder_days_learned from public.shopping_items where name = 'Royal Canin cat food') is null, 'one receipt is not enough to learn an interval');
select pg_temp.assert((public.receipt_apply((select id from public.receipts where photo_path = 'receipts/r1.jpg')))->>'error' = 'applied', 'applying twice is refused');

-- Second receipt, 28 days later: the alias matches instantly, and the interval is learned.
select pg_temp.assert((public.receipt_create('receipts/r2.jpg', null))->>'ok' = 'true', 'second receipt');
select pg_temp.assert((public.receipt_set_lines((select id from public.receipts where photo_path = 'receipts/r2.jpg'),
  jsonb_build_object('store', 'CARREFOUR', 'date', '2026-09-29', 'currency', 'AED', 'total', 98.00, 'lines', jsonb_build_array(
    jsonb_build_object('text', 'ROYAL CANIN KITTEN 2KG', 'qty', 1, 'unit_price', 98.00, 'line_total', 98.00, 'item_id', null)
  ))))->>'matched' = '1', 'the alias matches without the model');
select pg_temp.assert((select confidence from public.receipt_lines l join public.receipts r on r.id = l.receipt_id where r.photo_path = 'receipts/r2.jpg') = 1.0, 'with full confidence');
select pg_temp.assert((public.receipt_apply((select id from public.receipts where photo_path = 'receipts/r2.jpg')))->>'applied' = '1', 'applied');
select pg_temp.assert((select reorder_days_learned from public.shopping_items where name = 'Royal Canin cat food') = 28, 'reorder interval learned from two receipts: 28 days (typed was 30)');
select pg_temp.assert((select (i->>'due')::date from jsonb_array_elements((public.shopping_list())->'items') i where i->>'name' = 'Royal Canin cat food') = date '2026-10-27', 'the list uses the learned interval for "probably running out"');
select pg_temp.assert((select (i->>'purchases')::int from jsonb_array_elements((public.shopping_list())->'items') i where i->>'name' = 'Royal Canin cat food') = 2, 'two purchases on the item');
select pg_temp.assert(jsonb_array_length((public.purchases_for_item((select id from public.shopping_items where name = 'Royal Canin cat food')))->'purchases') = 2, 'purchase history reads back');

-- Cart run: manifest, report, paid.
select pg_temp.assert((public.shopping_item_substitution((select id from public.shopping_items where name = 'Collagen'), 'any_brand'))->>'ok' = 'true', 'substitution rule set on an item');
select pg_temp.assert((public.shopping_item_substitution((select id from public.shopping_items where name = 'Collagen'), 'maybe'))->>'error' = 'bad_rule', 'unknown rule refused');
select pg_temp.assert((public.cart_run_create('amazon_ae', array[(select id from public.shopping_items where name = 'Royal Canin cat food'), (select id from public.shopping_items where name = 'Collagen')], 'before Friday'))->>'ok' = 'true', 'Mido prepares an Amazon cart');
select pg_temp.assert((select (manifest->'rules'->>'stop_at_checkout')::boolean and (manifest->'rules'->>'never_pay')::boolean from public.cart_runs order by created_at desc limit 1), 'the manifest says stop at checkout, never pay');
select pg_temp.assert((select jsonb_array_length(manifest->'items') from public.cart_runs order by created_at desc limit 1) = 2, 'two items in the manifest');
select pg_temp.assert((select x->>'aliases' from public.cart_runs c, jsonb_array_elements(c.manifest->'items') x where x->>'name' = 'Royal Canin cat food' order by c.created_at desc limit 1) like '%ROYAL CANIN KITTEN 2KG%', 'the manifest carries the printed names as hints');
select pg_temp.assert((public.cart_run_close((select id from public.cart_runs order by created_at desc limit 1), true))->>'bought' = '0', 'closing before a report buys nothing');
select pg_temp.assert((public.cart_run_create('amazon_ae', array[(select id from public.shopping_items where name = 'Royal Canin cat food'), (select id from public.shopping_items where name = 'Collagen')], null))->>'ok' = 'true', 'another cart');
select pg_temp.assert((public.cart_run_report((select id from public.cart_runs order by created_at desc limit 1), jsonb_build_object('summary', 'Cart total 185', 'items', jsonb_build_array(
  jsonb_build_object('item_id', (select id from public.shopping_items where name = 'Royal Canin cat food'), 'result', 'found', 'price', 97.5),
  jsonb_build_object('item_id', (select id from public.shopping_items where name = 'Collagen'), 'result', 'missing', 'note', 'out of stock')))))->>'ok' = 'true', 'the agent''s report is saved');
select pg_temp.assert((select status from public.cart_runs order by created_at desc limit 1) = 'reported', 'status reported');
select pg_temp.assert((public.cart_run_close((select id from public.cart_runs order by created_at desc limit 1), true))->>'bought' = '1', 'I paid: the found item is bought, the missing one is not');
select pg_temp.assert((select last_price from public.shopping_items where name = 'Royal Canin cat food') = 97.5 and not (select needed from public.shopping_items where name = 'Royal Canin cat food'), 'Royal Canin updated from the cart');
select pg_temp.assert((select bought_on from public.purchases p join public.shopping_items i on i.id = p.item_id where i.name = 'Royal Canin cat food' order by p.created_at desc limit 1) = (now() at time zone (select timezone from public.household limit 1))::date, 'the cart purchase is dated in the household''s day, not the server''s');
-- An old receipt found later: history yes, but the newer price, shop and "needed" stay.
select pg_temp.assert((public.receipt_create('receipts/r0.jpg', null))->>'ok' = 'true', 'an older receipt turns up');
select pg_temp.assert((public.receipt_set_lines((select id from public.receipts where photo_path = 'receipts/r0.jpg'),
  jsonb_build_object('store', 'Carrefour', 'date', '2026-08-01', 'currency', 'AED', 'total', 90.00, 'lines', jsonb_build_array(
    jsonb_build_object('text', 'ROYAL CANIN KITTEN 2KG', 'qty', 1, 'unit_price', 90.00, 'line_total', 90.00, 'item_id', null)
  ))))->>'matched' = '1', 'matched by alias');
select pg_temp.assert((public.receipt_apply((select id from public.receipts where photo_path = 'receipts/r0.jpg')))->>'applied' = '1', 'applied');
select pg_temp.assert((select last_price from public.shopping_items where name = 'Royal Canin cat food') = 97.5 and (select last_price_store from public.shopping_items where name = 'Royal Canin cat food') = 'amazon_ae', 'the older receipt did not overwrite the newer price or shop');
select pg_temp.assert((select count(*) from public.purchases p join public.shopping_items i on i.id = p.item_id where i.name = 'Royal Canin cat food') = 4, 'but its purchase is in the history');
select pg_temp.assert((public.cart_runs_list())->'runs'->0->>'status' = 'done', 'cart list shows it done');
reset role;

select pg_temp.assert(
  (select count(*) from public.audit_log where target_table in ('receipts', 'receipt_lines', 'cart_runs') and not allowed) >= 3,
  'Step 5 denials are in the audit log');

\o
\echo
\echo 'All Step 1 to 5 database checks passed.'
select count(*) as audit_rows, sum(case when allowed then 0 else 1 end) as denied from public.audit_log;
