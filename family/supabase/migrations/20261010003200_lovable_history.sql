-- The first household's history from its earlier app (2,461 log entries from birth
-- to 20 October 2026, the milk bags in the fridge, the vaccinations given) was
-- imported by this migration. That data is in the household's own project and its
-- nightly backups, and is no longer in the repo, so the schema can serve another
-- family. The file stays so the applied version is still listed.
update public.care_entry_types set is_active = true where id = 'lana.growth';
