-- Lana's paediatrician on her profile card. Plain keys in care_subjects.profile
-- so the family can correct them from the app (lana.edit). Starting values:
-- Dr Sameh Abdelazim Mohamed, HOD & Consultant Paediatrics, NMC Royal Hospital
-- Khalifa City, Abu Dhabi (NMC doctor directory and Okadoc, October 2026).
do $$
begin
  update public.care_subjects
     set profile = profile || jsonb_build_object(
       'doctor_name', 'Dr Sameh Abdelazim Mohamed',
       'doctor_title', 'HOD & Consultant Paediatrics',
       'doctor_hospital', 'NMC Royal Hospital, Khalifa City',
       'doctor_address', '16th St, Khalifa City A, Abu Dhabi',
       'doctor_phone', '+971 2 203 5000',
       'doctor_tollfree', '800 1122',
       'doctor_booking_url', 'https://www.okadoc.com/en-ae/doctor/paediatrics/abu-dhabi/sameh-abdelazim-mohamed',
       'doctor_profile_url', 'https://nmc.ae/en/doctors/dr-sameh-abdelazim-mohamed',
       'doctor_notes', 'NMC''s own booking site says this hospital takes bookings by phone; Okadoc lists him for online booking. Paediatric outpatients runs 24/7.')
   where id = '00000000-0000-4000-8000-00000000a001' and not (profile ? 'doctor_name');
end $$;
