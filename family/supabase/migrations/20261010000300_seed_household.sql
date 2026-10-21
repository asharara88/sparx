-- ============================================================================
-- Family app — seed data (idempotent). Everything here is editable from the
-- app afterwards. Only what every household shares: roles, modules, the
-- permission matrix, presence states and the child's entry types. The
-- household itself (its name, members, the child, a pet) is written by
-- scripts/setup-household.mjs from a config file, so this schema serves any
-- family. The module ids `lana` (the child) and `fanta` (the pet) are internal
-- keys kept from the first household; the labels carry the real names.
-- ============================================================================

insert into public.household (id, name, timezone, currency)
values (true, 'Our home', 'Asia/Dubai', 'AED')
on conflict (id) do nothing;

-- Roles -----------------------------------------------------------------------
insert into public.roles (id, label, description, sort) values
  ('admin',        'Admin',        'Full access to every module. Manages members and roles.', 10),
  ('family_carer', 'Family carer', 'Logs and views the child and the pet, uses the calendar and shopping list.', 20),
  ('home_carer',   'Home carer',   'Household staff: shopping requests, maintenance tickets, today''s calendar.', 30)
on conflict (id) do nothing;

-- Modules ---------------------------------------------------------------------
insert into public.modules (id, label, description, sort) values
  ('members',           'Members & roles',        'Who is in the household, roles, presence, work days.', 10),
  ('lana',              'The child''s log',       'Feeds, diapers, sleep, medication given, notes.', 20),
  ('fanta',             'The pet''s log',         'Food, litter, weight, vet and treatment due dates.', 30),
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

-- Members, presence, work days and the care subjects: scripts/setup-household.mjs
-- (the first household's rows were here until migration 3500 and are in its project).
-- The test suite loads its own in supabase/tests/01_test_household.sql.

-- The child's entry types (a form definition each; the app renders `fields`) --------
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
