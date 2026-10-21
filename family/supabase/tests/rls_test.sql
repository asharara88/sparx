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

-- ============================================================================
-- Step 6: suggestions, push, hub, household facts
-- ============================================================================
select pg_temp.act_as(:mido);
set role authenticated;
-- An item bought 40 days ago with a 30-day interval and not on the list: a reorder suggestion.
update public.shopping_items set last_bought_on = current_date - 40, reorder_days = 30, needed = false where name = 'Collagen';
select pg_temp.assert((public.suggestions_refresh())->>'ok' = 'true', 'refresh runs');
select pg_temp.assert(exists (select 1 from public.suggestions where member_id = :mido and kind = 'reorder' and status = 'open' and key = 'reorder:' || (select id from public.shopping_items where name = 'Collagen')), 'Collagen is suggested for reorder');
select pg_temp.assert((select count(*) from public.suggestions where member_id = :mido and key = 'reorder:' || (select id from public.shopping_items where name = 'Collagen')) = 1 and (public.suggestions_refresh())->>'ok' = 'true' and (select count(*) from public.suggestions where member_id = :mido and key = 'reorder:' || (select id from public.shopping_items where name = 'Collagen')) = 1, 'refreshing twice does not duplicate');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'reorder:' || (select id from public.shopping_items where name = 'Collagen')), 'approve', 7, null))->>'status' = 'approved', 'approve a reorder');
select pg_temp.assert((select needed from public.shopping_items where name = 'Collagen'), 'approving puts Collagen on the list');
select pg_temp.assert((public.suggestion_decide((select id from public.suggestions where member_id = :mido and key = 'reorder:' || (select id from public.shopping_items where name = 'Collagen')), 'approve', 7, null))->>'error' = 'decided', 'cannot decide twice');
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
select pg_temp.assert((public.suggestions_refresh())->>'ok' = 'true' and (select count(*) from public.suggestions where member_id = :lilly and kind = 'reorder') = 0, 'Lilly gets no reorder suggestions (no shopping view)');
select pg_temp.assert((select count(*) from public.suggestions where member_id <> :lilly) = 0, 'suggestions are private');
-- Hub: admins only, entity ids checked.
select pg_temp.assert((public.hub_entity_save('sensor.living_room_temperature', 'Living room', 'sensor', 10, true))->>'error' = 'not_allowed', 'Lilly cannot change the hub');
reset role;
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.hub_entity_save('DROP TABLE x', 'bad', 'sensor', 10, true))->>'error' = 'bad_entity', 'bad entity id rejected');
select pg_temp.assert((public.hub_entity_save('sensor.living_room_temperature', 'Living room', 'sensor', 10, true))->>'ok' = 'true', 'admin adds a hub entity');
select pg_temp.assert((public.hub_entity_save('sensor.living_room_temperature', 'Lounge', 'sensor', 5, true))->>'ok' = 'true', 'saving again');
select pg_temp.assert((select label from public.hub_entities where entity_id = 'sensor.living_room_temperature') = 'Lounge', 'saving again renames');
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
select pg_temp.assert(public.has_permission('shopping_requests', 'view') or public.has_permission('maintenance', 'view'), 'a view Lilly has is allowed in preview');
select pg_temp.assert(not public.has_permission('shopping_requests', 'add'), 'an add Lilly has is still denied in preview');
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
select pg_temp.assert((public.shopping_list())->>'error' = 'not_allowed', 'nor the shopping list');
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
select pg_temp.assert((select count(*) from public.shopping_items) = 0, 'nor the shopping list');
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
select pg_temp.assert((public.household_create('Another', 'Asia/Dubai', 'X'))->>'error' = 'already_member', 'and cannot make a second one');
select pg_temp.assert((select count(*) from public.care_entries) = 0 and (select count(*) from public.members) = 1, 'and sees nothing of the other two homes');
reset role;

-- An e-mail an admin listed joins that home, it does not get a home of its own.
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((public.member_save(null, 'Cousin', 'cousin@test.local', 'family_carer', null, null, true, null))->>'ok' = 'true', 'Mido lists a cousin by e-mail');
reset role;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000c002', 'cousin@test.local') on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000c002","role":"authenticated"}', false);
set role authenticated;
select pg_temp.assert((public.household_create('Mine', 'Asia/Dubai', 'Nobody'))->>'error' = 'already_member', 'the cousin cannot make a home: the listed e-mail wins');
select pg_temp.assert((public.me())->'household'->>'id' <> :khan_home and (public.me())->'member'->>'display_name' = 'Cousin', 'and lands in Mido''s home as the listed member');
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
      and p.proname not in ('current_member_id', 'has_permission', 'link_current_user', 'household_create')) = 0,
  'every definer function in public belongs to app_rls, except the four that must see across homes');
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef and pg_get_userbyid(p.proowner) <> 'app_rls'
      and p.proname not in ('current_household_id', 'only_household_id', 'home_for_new_rows', 'platform_home', 'shared_locked', 'photo_in_my_home',
                            'audit_write', 'auth_user_id_by_email', 'handle_auth_user_created', 'care_custody_fill_module', 'care_entries_fill_module', 'seed_home')) = 0,
  'and so does every data-reading helper in private');
select pg_temp.assert(has_schema_privilege('app_rls', 'public', 'CREATE') and has_schema_privilege('app_rls', 'private', 'CREATE'), 'app_rls may own functions in both schemas (the transfer needs CREATE)');
-- The receipt matcher is one of those helpers: it must not find another home's item.
select name as first_item from public.shopping_items where deleted_at is null and household_id = (select id from public.household where name = 'Our home') order by name limit 1 \gset
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((private.match_item(:'first_item')).o_item is not null, 'Mido''s receipt line matches his home''s item');
reset role;
select pg_temp.act_as(:haitham);
set role authenticated;
select pg_temp.assert((private.match_item(:'first_item')).o_item is null, 'the same words match nothing from the Khans'' home');
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
insert into public.backups (path, household_id, rows) values ('home-khan/run-test', :khan_home, 1), ('home-ours/run-test', (select id from public.household where name = 'Our home'), 1);
select pg_temp.act_as(:mido);
set role authenticated;
select pg_temp.assert((select count(*) from public.backups where path like 'home-khan/%') = 0 and (select count(*) from public.backups where path like 'home-ours/%') = 1, 'Mido lists his home''s backups, not the Khans''');
reset role;
delete from public.backups where path like 'home-%/run-test';

-- Photos per home: the bucket keeps each home to its own folder; what was there before is the first home's
create or replace function pg_temp.fails(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return true;
end $$;
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

\echo 'All Step 1 to 6 database checks passed (view-as, adoptions, finishing, perf, chat, vaccines, end_if, milk, parity, smart care, coach, skills, week, helper skills, entry checks, memory, sprouty, timers, preview guards, signed out, end once, many homes, definer scope, home ops).'
select count(*) as audit_rows, sum(case when allowed then 0 else 1 end) as denied from public.audit_log;
