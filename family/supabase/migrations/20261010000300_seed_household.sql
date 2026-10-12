-- ============================================================================
-- Family app — seed data (idempotent). Everything here is editable from the
-- app afterwards; this is only the starting state named in BRIEF.md.
-- ============================================================================

insert into public.household (id, name, timezone, currency)
values (true, 'Our home', 'Asia/Dubai', 'AED')
on conflict (id) do nothing;

-- Roles -----------------------------------------------------------------------
insert into public.roles (id, label, description, sort) values
  ('admin',        'Admin',        'Full access to every module. Manages members and roles.', 10),
  ('family_carer', 'Family carer', 'Logs and views Lana and Fanta, uses the calendar and shopping list.', 20),
  ('home_carer',   'Home carer',   'Household staff: shopping requests, maintenance tickets, today''s calendar.', 30)
on conflict (id) do nothing;

-- Modules ---------------------------------------------------------------------
insert into public.modules (id, label, description, sort) values
  ('members',           'Members & roles',        'Who is in the household, roles, presence, work days.', 10),
  ('lana',              'Lana''s log',            'Feeds, diapers, sleep, medication given, notes.', 20),
  ('fanta',             'Fanta''s log',           'Food, litter, weight, vet and treatment due dates.', 30),
  ('calendar',          'Calendar',               'Household events, plans, staff schedule, presence.', 40),
  ('shopping',          'Shopping list',          'The shared list and running-low requests.', 50),
  ('shopping_review',   'Shopping review queue',  'Approve or reject staff requests before they join the list.', 55),
  ('maintenance',       'Home maintenance',       'Tickets, assets, contractors (without costs).', 60),
  ('maintenance_costs', 'Costs & finances',       'Ticket costs, invoices, spend history.', 65),
  ('photos',            'Photos',                 'Attach and view photos on entries.', 70),
  ('assistant',         'Assistant',              'Chat and voice assistant.', 80),
  ('audit',             'Audit log',              'Who did and tried what.', 90)
on conflict (id) do nothing;

-- Permission matrix: role × module × action ------------------------------------
insert into public.permissions (role_id, module_id, action, allowed)
select r.id, m.id, a.action,
  case r.id
    when 'admin' then true
    when 'family_carer' then
      (m.id in ('lana', 'fanta')  and a.action in ('view', 'add', 'edit')) or
      (m.id = 'calendar'          and a.action in ('view', 'add')) or
      (m.id = 'shopping'          and a.action in ('view', 'add')) or
      (m.id = 'members'           and a.action = 'view') or
      (m.id = 'photos'            and a.action in ('view', 'add')) or
      (m.id = 'assistant'         and a.action = 'view')
    when 'home_carer' then
      (m.id = 'shopping'          and a.action = 'add') or
      (m.id = 'maintenance'       and a.action in ('view', 'add', 'edit')) or
      (m.id = 'calendar'          and a.action = 'view') or
      (m.id = 'photos'            and a.action in ('view', 'add')) or
      (m.id = 'assistant'         and a.action = 'view')
    else false
  end
from public.roles r
cross join public.modules m
cross join (values ('view'), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role_id, module_id, action) do nothing;

-- Presence states ---------------------------------------------------------------
insert into public.presence_states (id, label, counts_as_in_house, sort) values
  ('lives_here',      'Lives here',      true,  10),
  ('staying_with_us', 'Staying with us', true,  20),
  ('visiting_today',  'Visiting today',  true,  30),
  ('away',            'Away',            false, 40)
on conflict (id) do nothing;

-- Members (fixed ids so later seeds and scripts can refer to them) --------------
insert into public.members (id, email, display_name, role_id, birth_date, relationship) values
  ('00000000-0000-4000-8000-000000000001', 'mido.m.sharara@gmail.com', 'Mido',  'admin',        null,         'Parent'),
  ('00000000-0000-4000-8000-000000000002', null,                       'Dana',  'admin',        null,         'Parent'),
  ('00000000-0000-4000-8000-000000000003', null,                       'Wafa',  'family_carer', '1956-01-01', 'Mido''s mother'),
  ('00000000-0000-4000-8000-000000000004', null,                       'Luda',  'family_carer', '1956-01-01', 'Dana''s mother'),
  ('00000000-0000-4000-8000-000000000005', null,                       'Lilly', 'home_carer',   null,         'Household staff')
on conflict (id) do nothing;

-- Presence (today's starting state; change it from Members) ---------------------
insert into public.presence (member_id, state_id, starts_on, ends_on, note)
select v.member_id, v.state_id, current_date, v.ends_on, v.note
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, 'lives_here',      null::date, null::text),
  ('00000000-0000-4000-8000-000000000002'::uuid, 'lives_here',      null,       null),
  ('00000000-0000-4000-8000-000000000003'::uuid, 'staying_with_us', null,       null),
  ('00000000-0000-4000-8000-000000000004'::uuid, 'away',            null,       null),
  ('00000000-0000-4000-8000-000000000005'::uuid, 'away',            null,       null)
) as v(member_id, state_id, ends_on, note)
where not exists (select 1 from public.presence p where p.member_id = v.member_id);

-- Lilly works Tue, Wed, Fri, Sat, Sun (0 = Sunday) ------------------------------
insert into public.work_schedules (member_id, weekday)
select '00000000-0000-4000-8000-000000000005', d from unnest(array[0, 2, 3, 5, 6]) d
on conflict do nothing;

-- Care subjects ---------------------------------------------------------------------
insert into public.care_subjects (id, module_id, kind, name, birth_date, profile, settings, sort) values
  ('00000000-0000-4000-8000-00000000a001', 'lana',  'child', 'Lana',  '2026-06-05',
   '{}'::jsonb, '{}'::jsonb, 10),
  ('00000000-0000-4000-8000-00000000a002', 'fanta', 'pet',   'Fanta', null,
   '{"species":"cat","colour":"ginger","sex":"female","spayed":true,"indoor":true,"approx_age_years":3,"food":"Royal Canin"}'::jsonb,
   '{}'::jsonb, 20)
on conflict (id) do nothing;

-- Lana's entry types (a form definition each; the app renders `fields`) -------------
insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('lana.feed', 'lana', 'feed', 'Feed', '🍼', '#2563eb', 10, false, 180,
   '[{"key":"method","label":"How","type":"choice","options":["Bottle","Breast"],"required":true},
     {"key":"amount_ml","label":"Amount (ml)","type":"number","quick":[60,90,120,150,180],"show_if":{"method":"Bottle"}},
     {"key":"side","label":"Side","type":"choice","options":["Left","Right","Both"],"show_if":{"method":"Breast"}},
     {"key":"duration_min","label":"Minutes","type":"number","quick":[10,15,20,30],"show_if":{"method":"Breast"}}]'::jsonb,
   true, true),
  ('lana.diaper', 'lana', 'diaper', 'Diaper', '🧷', '#16a34a', 20, false, 180,
   '[{"key":"kind","label":"What","type":"choice","options":["Wet","Dirty","Both"],"required":true}]'::jsonb,
   true, true),
  ('lana.sleep', 'lana', 'sleep', 'Sleep', '😴', '#7c3aed', 30, true, 120,
   '[{"key":"place","label":"Where","type":"choice","options":["Cot","Pram","Arms","Car"]}]'::jsonb,
   true, true),
  ('lana.medication', 'lana', 'medication', 'Medicine given', '💊', '#dc2626', 40, false, null,
   '[{"key":"name","label":"Medicine","type":"text","required":true},
     {"key":"dose","label":"Dose, as written on the pack","type":"text","required":true}]'::jsonb,
   true, true),
  ('lana.note', 'lana', 'note', 'Note', '📝', '#525252', 50, false, null, '[]'::jsonb, false, true),
  -- Ready for later. Switch is_active on from Settings when needed; no migration.
  ('lana.growth', 'lana', 'growth', 'Growth', '📏', '#0891b2', 60, false, null,
   '[{"key":"weight_kg","label":"Weight (kg)","type":"number","step":0.01},
     {"key":"length_cm","label":"Length (cm)","type":"number","step":0.5}]'::jsonb,
   false, false),
  ('lana.milestone', 'lana', 'milestone', 'Milestone', '⭐', '#ca8a04', 70, false, null,
   '[{"key":"what","label":"What happened","type":"text","required":true}]'::jsonb,
   false, false),
  ('lana.appointment', 'lana', 'appointment', 'Appointment', '🏥', '#0d9488', 80, false, null,
   '[{"key":"clinic","label":"Clinic","type":"text"},{"key":"reason","label":"Reason","type":"text"}]'::jsonb,
   false, false)
on conflict (id) do nothing;
