-- ---------------------------------------------------------------------------
-- The child's night window travels with me(): the app darkens every screen during
-- the night (NightScreen) and must know the hours on every page without a second
-- query. Defaults as everywhere else (care_stats): 19:00 to 07:00.
-- ---------------------------------------------------------------------------
create or replace function private.subject_names() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'module_id', s.module_id, 'kind', s.kind, 'name', s.name,
           'birth_date', s.birth_date, 'names', coalesce(s.profile->'names', '{}'::jsonb),
           'sex', s.profile->>'sex',
           'night_from', coalesce(nullif(s.settings->>'night_from', ''), '19:00'),
           'night_to', coalesce(nullif(s.settings->>'night_to', ''), '07:00')) order by s.sort, s.name), '[]'::jsonb)
    from public.care_subjects s
   where s.is_active and s.household_id = private.current_household_id()
$$;
