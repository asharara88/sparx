-- A timer ends once. care_entry_end overwrote ended_at whatever it held, so an
-- end that arrived late (a "woke up" kept on a phone with no signal, a helper
-- proposal confirmed from a chat reopened later) replaced the end another
-- carer had already set, often with an earlier time, and the nap got shorter
-- on nobody's say-so. Now an entry that already has an end answers
-- already_ended, with that end, and nothing changes; changing an end on
-- purpose is care_entry_update's job.

create or replace function public.care_entry_end(p_id uuid, p_ended_at timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
  v_row public.care_entries;
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into v_row from public.care_entries where id = p_id;
  if not (public.has_permission(v_module, 'edit') or (v_row.logged_by = public.current_member_id() and public.has_permission(v_module, 'add'))) then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text, '{"end": true}'::jsonb);
    return private.denied('You are not allowed to change this entry.');
  end if;
  if v_row.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_ended', 'ended_at', v_row.ended_at,
      'message', 'It was already ended at ' || to_char(v_row.ended_at at time zone v_tz, 'HH24:MI') || '.');
  end if;
  if coalesce(p_ended_at, now()) < v_row.occurred_at then
    return jsonb_build_object('ok', false, 'error', 'bad_time', 'message', 'The end time is before the start time.');
  end if;
  update public.care_entries set ended_at = coalesce(p_ended_at, now()) where id = p_id and deleted_at is null;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"end": true}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
