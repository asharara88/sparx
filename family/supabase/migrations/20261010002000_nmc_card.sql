-- Lana's NMC "All About Me" record (Abu Dhabi), October 2026:
--  * the schedule in the app now matches the card's Childhood Immunization
--    Schedule (Abu Dhabi): Rotarix is two doses, oral polio at 6 and 18
--    months, no flu, MenACWY, hepatitis A or second varicella on the card;
--  * the doctor's stamp reads Dr Sameh Abdelazim, Consultant Paediatrics,
--    NMC Royal Women's Hospital, which now trades as NMC Royal Hospital Abu
--    Dhabi on Muroor Road, so the card points there;
--  * birth facts from the Child Information page go on her profile.
-- Doses given and their batch numbers are data, written to the live project
-- directly, like any other log entry.

insert into public.vaccine_schedule (id, visit, due_age_days, window_days, vaccine, dose, note, sort, is_active) values
  ('hexa_1',    '2 months',   61,  28, 'Hexavalent (Infanrix Hexa)',       1, null, 20, true),
  ('pcv_1',     '2 months',   61,  28, 'Pneumococcal (Prevenar 20)',       1, null, 21, true),
  ('rota_1',    '2 months',   61,  28, 'Rotavirus (Rotarix, oral)',        1, 'First dose before 15 weeks.', 22, true),
  ('hexa_2',    '4 months',   122, 28, 'Hexavalent (Infanrix Hexa)',       2, null, 30, true),
  ('pcv_2',     '4 months',   122, 28, 'Pneumococcal (Prevenar 20)',       2, null, 31, true),
  ('rota_2',    '4 months',   122, 28, 'Rotavirus (Rotarix, oral)',        2, 'Rotarix is two doses; last by 24 weeks.', 32, true),
  ('hexa_3',    '6 months',   183, 28, 'Hexavalent (Infanrix Hexa)',       3, null, 40, true),
  ('pcv_3',     '6 months',   183, 28, 'Pneumococcal (Prevenar 20)',       3, null, 41, true),
  ('rota_3',    '6 months',   183, 28, 'Rotavirus (oral drops)',           3, 'Not needed with Rotarix.', 42, false),
  ('flu_1',     '6 months',   183, 60, 'Flu (seasonal)',                   1, 'Not on the NMC card. Ask Dr Sameh.', 43, false),
  ('bopv_1',    '6 months',   183, 28, 'Oral polio (bOPV)',                1, null, 44, true),
  ('menacwy_1', '12 months',  365, 28, 'Meningococcal ACWY',               1, 'Not on the NMC card.', 52, false),
  ('hepa_1',    '12 months',  365, 28, 'Hepatitis A',                      1, 'Not on the NMC card.', 53, false),
  ('penta_4',   '18 months',  548, 28, 'DTaP-Hib-IPV booster',             4, null, 60, true),
  ('bopv_2',    '18 months',  548, 28, 'Oral polio (bOPV)',                2, null, 61, true),
  ('mmr_2',     '18 months',  548, 28, 'MMR (measles, mumps, rubella)',    2, null, 62, true),
  ('var_2',     '18 months',  548, 28, 'Chickenpox (varicella)',           2, 'Not on the NMC card at 18 months.', 63, false),
  ('hepa_2',    '18 months',  548, 28, 'Hepatitis A',                      2, 'Not on the NMC card.', 64, false)
on conflict (id) do update set visit = excluded.visit, due_age_days = excluded.due_age_days, window_days = excluded.window_days,
  vaccine = excluded.vaccine, dose = excluded.dose, note = excluded.note, sort = excluded.sort, is_active = excluded.is_active;

do $$
begin
  update public.care_subjects
     set profile = profile || jsonb_build_object(
       'doctor_name', 'Dr Sameh Abdelazim',
       'doctor_title', 'Consultant Paediatrics (MBBCh, MD), DoH reg. GO21165',
       'doctor_hospital', 'NMC Royal Hospital, Abu Dhabi (was NMC Royal Women''s Hospital)',
       'doctor_address', 'Tower B, Mohammed bin Zayed Stadium, Al Jazira Club, Muroor Road, Abu Dhabi',
       'doctor_phone', '+971 2 508 2000',
       'doctor_tollfree', '800 7676',
       'doctor_notes', 'Stamp on Lana''s vaccine card. NMC says bookings for this site are by phone. Lana''s hospital file: UA0900000085695.')
   where id = '00000000-0000-4000-8000-00000000a001'
     and (profile->>'doctor_hospital' is null or profile->>'doctor_hospital' = 'NMC Royal Hospital, Khalifa City');

  update public.care_subjects
     set profile = profile || jsonb_build_object(
       'hospital_number', 'UA0900000085695',
       'sex', 'Girl',
       'nationality', 'Canadian',
       'blood_group', 'O positive',
       'allergies', 'None known',
       'birth_weight_kg', '3.38',
       'birth_length_cm', '52',
       'birth_head_cm', '36',
       'gestation', '39 weeks + 2 days',
       'apgar', '8 and 9',
       'newborn_screens', 'Hearing, heart, newborn blood spot and eye check all normal. Hip screening not recorded.',
       'hearing_test', 'ABR pass, both ears, 7 June 2026',
       'insurance', 'Qatar Insurance Company, TPA NAS',
       'insurance_member_id', 'N3J3-HN3F-LFLJ-HLED',
       'insurance_note', 'Policy expiry printed as 04-07-2026. Check it is renewed.')
   where id = '00000000-0000-4000-8000-00000000a001' and not (profile ? 'blood_group');
end $$;
