-- Lana's log, after four months of real notes: the kinds of things Dana
-- actually writes down. Data only; the app renders `fields`.

-- Where Lana sleeps, as it happens in this house.
update public.care_entry_types
   set fields = '[{"key":"place","label":"Where","type":"choice","options":["Cot","Baby nest","Bed","Arms","Carrier","Pram","Car"]}]'::jsonb
 where id = 'lana.sleep';

-- Weight, length and head circumference; milestones. Both used from day one.
update public.care_entry_types
   set is_active = true,
       fields = '[{"key":"weight_kg","label":"Weight (kg)","type":"number","step":0.01},
                  {"key":"length_cm","label":"Length (cm)","type":"number","step":0.1},
                  {"key":"head_cm","label":"Head (cm)","type":"number","step":0.1}]'::jsonb
 where id = 'lana.growth';
update public.care_entry_types set is_active = true where id in ('lana.milestone', 'lana.appointment');

insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('lana.pump', 'lana', 'pump', 'Pumped', '🫙', '#0e7490', 15, false, null,
   '[{"key":"amount_ml","label":"Amount (ml)","type":"number","quick":[30,60,90,120,150]},
     {"key":"side","label":"Side","type":"choice","options":["Left","Right","Both"],"default":"Both"}]'::jsonb,
   false, true),
  ('lana.routine', 'lana', 'routine', 'Activity', '🧸', '#65a30d', 45, false, null,
   '[{"key":"activity","label":"What","type":"choice","options":["Walk","Bath","Tummy time","Playtime","Reading","Outing"],"required":true}]'::jsonb,
   false, true)
on conflict (id) do nothing;
