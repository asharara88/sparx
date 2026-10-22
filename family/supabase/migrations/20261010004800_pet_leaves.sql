-- The pet leaves the database, and the routines that only it had.
--
-- The app has been the baby's day for a while: the pet's screens went, and its
-- module was hidden. Its subject, entry types, entries and routines stayed, and
-- the routines feature (care_routines, routine_save, routine_done, routines_list)
-- had no screen left at all. All of it goes now. As with the shopping and house
-- tables (4600), every row is kept first in public.retired_rows, stamped with its
-- home, which the nightly backup exports. A care subject is a child from here on.

-- ---------------------------------------------------------------------------
-- 1. Keep the rows
-- ---------------------------------------------------------------------------
-- (a plain temp table: the local runner applies a file statement by statement, so nothing may depend on one transaction)
create temp table pet_subjects as
  select id, household_id from public.care_subjects where module_id = 'fanta' or kind = 'pet';

insert into public.retired_rows (household_id, table_name, row) select household_id, 'care_subjects', to_jsonb(t) from public.care_subjects t where id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'care_entries', to_jsonb(t) from public.care_entries t where module_id = 'fanta' or subject_id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'care_custody', to_jsonb(t) from public.care_custody t where module_id = 'fanta' or subject_id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'attachments', to_jsonb(t) from public.attachments t where module_id = 'fanta';
insert into public.retired_rows (household_id, table_name, row) select household_id, 'medicines', to_jsonb(t) from public.medicines t where subject_id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'vaccinations', to_jsonb(t) from public.vaccinations t where subject_id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'coach_plans', to_jsonb(t) from public.coach_plans t where subject_id in (select id from pet_subjects);
-- A plan's check-ins would go by cascade with the plan; keep them first.
insert into public.retired_rows (household_id, table_name, row) select c.household_id, 'coach_checkins', to_jsonb(c) from public.coach_checkins c where c.plan_id in (select id from public.coach_plans where subject_id in (select id from pet_subjects));
insert into public.retired_rows (household_id, table_name, row) select household_id, 'activity_done', to_jsonb(t) from public.activity_done t where subject_id in (select id from pet_subjects);
insert into public.retired_rows (household_id, table_name, row) select household_id, 'care_routines', to_jsonb(t) from public.care_routines t;
-- Shared definitions have no home of their own: filed under the first home, like the archived stores (4600), so a backup carries them.
insert into public.retired_rows (household_id, table_name, row) select private.platform_home(), 'care_entry_types', to_jsonb(t) from public.care_entry_types t where module_id = 'fanta';
insert into public.retired_rows (household_id, table_name, row) select private.platform_home(), 'vaccine_schedule', to_jsonb(t) from public.vaccine_schedule t where kind = 'pet';

-- ---------------------------------------------------------------------------
-- 2. The rows, the routines, the module
-- ---------------------------------------------------------------------------
delete from public.attachments where module_id = 'fanta';
delete from public.care_custody where module_id = 'fanta' or subject_id in (select id from pet_subjects);
delete from public.care_entries where module_id = 'fanta' or subject_id in (select id from pet_subjects);
delete from public.medicines where subject_id in (select id from pet_subjects);
delete from public.vaccinations where subject_id in (select id from pet_subjects);
delete from public.coach_plans where subject_id in (select id from pet_subjects);
delete from public.activity_done where subject_id in (select id from pet_subjects);

drop function if exists public.routine_done(uuid, date);
drop function if exists public.routine_save(uuid, uuid, text, integer, text, jsonb, date, integer, boolean);
drop function if exists public.routines_list(uuid);
drop table if exists public.care_routines;

delete from public.care_subjects where id in (select id from pet_subjects);
delete from public.care_entry_types where module_id = 'fanta';
-- A deployment may have added pet rows to the shared vaccine schedule; they must go before the check below narrows.
delete from public.vaccine_schedule where kind = 'pet';
-- The module leaves the roles matrix; its permission rows go by cascade. Audit rows keep the id as text.
delete from public.modules where id = 'fanta';
update public.household set hidden_modules = array_remove(hidden_modules, 'fanta') where 'fanta' = any(hidden_modules);

-- ---------------------------------------------------------------------------
-- 3. A care subject is a child
-- ---------------------------------------------------------------------------
alter table public.care_subjects drop constraint if exists care_subjects_kind_check;
alter table public.care_subjects add constraint care_subjects_kind_check check (kind = 'child');
alter table public.vaccine_schedule drop constraint if exists vaccine_schedule_kind_check;
alter table public.vaccine_schedule add constraint vaccine_schedule_kind_check check (kind = 'child');

drop table pet_subjects;
