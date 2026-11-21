-- Who the child is belongs to the parents: the name, the birth date, girl or boy (docs/AGES.md:
-- the child's card can correct them, and that form is an admin's). Only the screen held that.
-- subject_profile_save asked for "may edit the log" and then wrote the name, the birth date and
-- the whole profile for anyone, and the table's own write policy (care_subjects_write, "for
-- all") let the same member change, add or remove the child's row straight through the API.
-- The birth date drives everything that goes by age. This is the rule itself, for every caller.
--
--   1. private.is_admin(): the caller's member in the home on screen is an active admin. An
--      admin of one home who is a carer in another is not an admin there.
--   2. A guard on public.care_subjects, for the signed-in roles. Someone who is not an admin
--      may change the health card (profile) and nothing else on the row: not the name, the
--      birth date, profile.sex or profile.names (the name in other languages), not the day the
--      row was made (vaccines from before a family joined count from it, migration 6500), its
--      order, its settings or whether it is active; may not turn the card into anything but a
--      card (a JSON object); and may neither add a child nor remove one.
--      A second row with a lower sort would be shown as the child, and removing the row takes
--      the whole log with it, so a guard on an update of three columns would not hold the rule.
--      Database roles (a migration, the SQL editor, the server's service role, a definer
--      function) are not held, as with household_settings_guard (migration 5700).
--   3. subject_profile_save, same signature, still running as the caller, so the guard holds it
--      too. From someone who is not an admin a new name or birth date is refused, saying who to
--      ask. Girl or boy and the other names travel inside the profile, which every screen sends
--      back whole as it was when the page opened: a difference there is an old page, not a
--      wish, so the stored value is kept, the rest is saved, and the answer says what was kept.
--      An admin's save is as before. The row is locked while it is read; a row the caller
--      cannot see is not_found, not a silent "ok"; the audit row names the facts that changed
--      or were kept.
-- Signed-in members only: execute is taken from public and anon (functions are public by default).

-- ---------------------------------------------------------------------------
-- 1. An admin of the home on screen
-- ---------------------------------------------------------------------------
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
     where m.id = public.current_member_id() and m.is_active and m.role_id = 'admin')
$$;
alter function private.is_admin() owner to app_rls;
revoke execute on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role, app_rls;

-- ---------------------------------------------------------------------------
-- 2. The guard on the child's row
-- ---------------------------------------------------------------------------
create or replace function private.care_subjects_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if not private.is_admin() then
      if tg_op <> 'UPDATE' then
        raise exception 'Only an admin can add or remove a child.' using errcode = '42501';
      end if;
      if new.name is distinct from old.name
         or new.birth_date is distinct from old.birth_date
         or (new.profile->'sex') is distinct from (old.profile->'sex')
         or (new.profile->'names') is distinct from (old.profile->'names') then
        raise exception 'Only an admin can change the name, the birth date or girl or boy.' using errcode = '42501';
      end if;
      -- Every other column, compared whole. A stored generated column added to this table later
      -- must join the list below: a before trigger sees it as null in the new row.
      if jsonb_typeof(new.profile) is distinct from 'object'
         or (to_jsonb(new) - array['name', 'birth_date', 'profile', 'updated_at'])
         is distinct from (to_jsonb(old) - array['name', 'birth_date', 'profile', 'updated_at']) then
        raise exception 'Only an admin can change this part of the child''s record.' using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke execute on function private.care_subjects_guard() from public, anon;
drop trigger if exists care_subjects_guard on public.care_subjects;
create trigger care_subjects_guard before insert or update or delete on public.care_subjects
  for each row execute function private.care_subjects_guard();

-- ---------------------------------------------------------------------------
-- 3. subject_profile_save: as in migration 0700, with the facts kept for admins
-- ---------------------------------------------------------------------------
create or replace function public.subject_profile_save(p_subject_id uuid, p_profile jsonb, p_birth_date date default null, p_name text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module  text := private.subject_module(p_subject_id);
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_name    text := nullif(btrim(p_name), '');
  v_old     public.care_subjects;
  v_facts   text[] := '{}';
  v_kept    text[] := '{}';
  k         text;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_subjects', p_subject_id::text);
    return private.denied('You are not allowed to change this profile.');
  end if;
  if jsonb_typeof(v_profile) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad_profile'); end if;
  -- Locked while it is read, so the facts compared here are the facts the write meets. The lock
  -- an update of these columns takes anyway: "for update" would make every new log entry for the
  -- child (its foreign key reads this row) wait for a save.
  select * into v_old from public.care_subjects where id = p_subject_id for no key update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  if v_name is not null and v_name is distinct from v_old.name then v_facts := array_append(v_facts, 'name'); end if;
  if p_birth_date is not null and p_birth_date is distinct from v_old.birth_date then v_facts := array_append(v_facts, 'birth_date'); end if;
  if private.is_admin() then
    foreach k in array array['sex', 'names'] loop
      if (v_profile->k) is distinct from (v_old.profile->k) then v_facts := array_append(v_facts, k); end if;
    end loop;
  else
    if cardinality(v_facts) > 0 then
      perform private.audit_write(v_module, 'edit', false, 'care_subjects', p_subject_id::text, jsonb_build_object('facts', to_jsonb(v_facts)));
      return private.denied('Ask ' || private.admin_names() || ' to change the name or the birth date.');
    end if;
    -- Girl or boy and the other names stay as stored, whatever the profile sent back says.
    foreach k in array array['sex', 'names'] loop
      if (v_profile->k) is distinct from (v_old.profile->k) then v_kept := array_append(v_kept, k); end if;
      v_profile := case when (v_old.profile->k) is not null then jsonb_set(v_profile, array[k], v_old.profile->k) else v_profile - k end;
    end loop;
  end if;

  update public.care_subjects
     set profile = v_profile,
         birth_date = coalesce(p_birth_date, birth_date),
         name = coalesce(v_name, name),
         updated_at = now()
   where id = p_subject_id;
  perform private.audit_write(v_module, 'edit', true, 'care_subjects', p_subject_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'keys', (select jsonb_agg(x) from jsonb_object_keys(v_profile) x),
      'facts', nullif(to_jsonb(v_facts), '[]'::jsonb),
      'kept', nullif(to_jsonb(v_kept), '[]'::jsonb))));
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'kept', nullif(to_jsonb(v_kept), '[]'::jsonb)));
end $$;
revoke execute on function public.subject_profile_save(uuid, jsonb, date, text) from public, anon;
grant execute on function public.subject_profile_save(uuid, jsonb, date, text) to authenticated, service_role;
-- The refusal names who to ask: said in a grant, not left to the default.
revoke execute on function private.admin_names() from public, anon;
grant execute on function private.admin_names() to authenticated, service_role, app_rls;
