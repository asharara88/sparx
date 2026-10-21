-- A timer ends once, even when two phones end it in the same second.
--
-- Migration 3800 refused an end for an entry that already had one, but it read
-- the row and then updated it in two steps, so two ends in flight could both
-- pass the check and the later write won. The row is locked before the check
-- now (select … for update): the second caller waits for the first to commit,
-- then reads the end it set and answers already_ended. The update itself also
-- insists on ended_at still being null, and says so if it was not.
--
-- The function runs as app_rls from here. As an invoker function its update
-- went through the entries policy, which needs "edit"; a member with "add"
-- only, ending her own timer (the branch the function allows on purpose), had
-- the update silently change nothing while the answer said ok. The permission
-- checks are the function's own and stay exactly as they were; in "view as"
-- has_permission refuses every write, so the preview stays read only.

create or replace function public.care_entry_end(p_id uuid, p_ended_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
  v_row public.care_entries;
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_end timestamptz := coalesce(p_ended_at, now());
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- The lock: whoever comes second waits here and then sees the end the first one set.
  select * into v_row from public.care_entries where id = p_id and deleted_at is null for update;
  if v_row.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (public.has_permission(v_module, 'edit') or (v_row.logged_by = public.current_member_id() and public.has_permission(v_module, 'add'))) then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text, '{"end": true}'::jsonb);
    return private.denied('You are not allowed to change this entry.');
  end if;
  if v_row.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_ended', 'ended_at', v_row.ended_at,
      'message', 'It was already ended at ' || to_char(v_row.ended_at at time zone v_tz, 'HH24:MI') || '.');
  end if;
  if v_end < v_row.occurred_at then
    return jsonb_build_object('ok', false, 'error', 'bad_time', 'message', 'The end time is before the start time.');
  end if;
  update public.care_entries set ended_at = v_end where id = p_id and deleted_at is null and ended_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_ended', 'message', 'It was already ended.');
  end if;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"end": true}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id, 'ended_at', v_end);
end $$;
alter function public.care_entry_end(uuid, timestamptz) owner to app_rls;
