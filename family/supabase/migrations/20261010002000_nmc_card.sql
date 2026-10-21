-- The vaccine schedule matches the Abu Dhabi Childhood Immunization Schedule as
-- printed on a hospital vaccine card (October 2026): Rotarix is two doses, oral
-- polio at 6 and 18 months; flu, MenACWY, hepatitis A and the second varicella are
-- kept but switched off. A household elsewhere edits the schedule in the app.
-- The first household's doctor and birth facts that this migration also wrote are
-- in its project and no longer in the repo; setup-household.mjs writes a child's
-- profile (blood group, allergies, doctor, hospital) from the config file.

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

-- Profile keys the app reads from care_subjects.profile, for reference:
-- hospital_number, sex, nationality, blood_group, allergies, birth_weight_kg,
-- birth_length_cm, birth_head_cm, gestation, apgar, newborn_screens, hearing_test,
-- insurance, insurance_member_id, insurance_note.
