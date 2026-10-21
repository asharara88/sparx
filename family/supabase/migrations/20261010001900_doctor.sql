-- The paediatrician lives on the child's profile card (care_subjects.profile:
-- doctor_name, doctor_title, doctor_hospital, doctor_address, doctor_phone,
-- doctor_tollfree, doctor_booking_url, doctor_profile_url, doctor_notes), edited
-- from the app (child module, edit) or written by setup-household.mjs. This
-- migration wrote the first household's doctor; that data is in its project and
-- no longer in the repo.
select 1;
