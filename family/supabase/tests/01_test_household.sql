-- The test household: the five members, the child and the pet the checks in
-- rls_test.sql act as. Loaded by run-local.sh after the migrations, before the
-- checks. The live project gets its household from scripts/setup-household.mjs
-- instead; nothing here is a migration.

-- The home is the one the migrations seeded (migration 3900 gave it an id). While
-- it is the only one, every row below lands in it without saying so, as a script
-- with the service role would.
update public.household set name = 'Our home', timezone = 'Asia/Dubai', currency = 'AED';

insert into public.members (id, email, display_name, role_id, birth_date, relationship) values
  ('00000000-0000-4000-8000-000000000001', 'mido@test.local', 'Mido',  'admin',        null,         'Parent'),
  ('00000000-0000-4000-8000-000000000002', null,              'Dana',  'admin',        null,         'Parent'),
  ('00000000-0000-4000-8000-000000000003', null,              'Wafa',  'family_carer', '1956-01-01', 'Mido''s mother'),
  ('00000000-0000-4000-8000-000000000004', null,              'Luda',  'family_carer', '1956-01-01', 'Dana''s mother'),
  ('00000000-0000-4000-8000-000000000005', null,              'Lilly', 'home_carer',   null,         'Household staff')
on conflict (id) do nothing;

update public.members set breastfeeds = true, work_from = '08:30', work_to = '17:30'
 where id = '00000000-0000-4000-8000-000000000002';

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

-- Lilly works Tue, Wed, Fri, Sat, Sun (0 = Sunday)
insert into public.work_schedules (member_id, weekday)
select '00000000-0000-4000-8000-000000000005', d from unnest(array[0, 2, 3, 5, 6]) d
on conflict do nothing;

insert into public.care_subjects (id, module_id, kind, name, birth_date, profile, settings, sort) values
  ('00000000-0000-4000-8000-00000000a001', 'lana',  'child', 'Lana',  '2026-06-05',
   '{"sex": "Girl", "emergency_ambulance": "998"}'::jsonb, '{"night_from": "19:00", "night_to": "07:00"}'::jsonb, 10),
  ('00000000-0000-4000-8000-00000000a002', 'fanta', 'pet',   'Fanta', null,
   '{"species": "cat", "sex": "Female", "colour": "Ginger", "spayed": true, "indoor": true, "food": "Royal Canin", "age_note": "About 3 years old"}'::jsonb,
   '{}'::jsonb, 20)
on conflict (id) do nothing;

update public.modules set label = 'Lana''s log' where id = 'lana';
update public.modules set label = 'Fanta''s log' where id = 'fanta';

insert into public.medicines (subject_id, name, dose, min_gap_hours, note) values
  ('00000000-0000-4000-8000-00000000a001', 'Vitamin D drops', '1 drop (400 IU)', 20, 'Once a day.'),
  ('00000000-0000-4000-8000-00000000a001', 'Paracetamol (infant)', 'As the doctor wrote', 6, 'Only if the doctor said so. Never more than 4 doses in 24 hours.')
on conflict do nothing;

insert into public.care_routines (id, subject_id, label, every_days, type_id, payload, sort) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a002', 'Litter full change', 7,  'fanta.litter',    '{"kind":"Full change"}', 10),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000a002', 'Brush',              3,  null,              '{}',                     20),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000a002', 'Flea and tick',      30, 'fanta.treatment', '{"kind":"Flea & tick"}', 30),
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000a002', 'Deworming',          90, 'fanta.treatment', '{"kind":"Deworming"}',   40),
  ('00000000-0000-4000-8000-00000000c005', '00000000-0000-4000-8000-00000000a002', 'Weigh her',          14, null,              '{}',                     50)
on conflict (id) do nothing;
