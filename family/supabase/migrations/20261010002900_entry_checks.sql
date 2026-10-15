-- Entry checks: one RPC for the three honest answers to "this entry looks
-- wrong": it was real (never ask again), end it at a given time (a timer
-- left on; the raw length is kept on the entry), or delete it (a double tap).
-- Audited like every edit. Generalises care_feed_trim, which stays for callers.

create or replace function public.care_entry_check(p_id uuid, p_action text, p_ended_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.care_entries;
  v_raw_min integer;
begin
  select * into e from public.care_entries where id = p_id and deleted_at is null;
  if e.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action = 'delete' then
    if not private.authz(e.module_id, 'delete', 'care_entries', p_id::text) then return private.denied('You are not allowed to delete this entry.'); end if;
    update public.care_entries set deleted_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'deleted', true);
  end if;
  if not private.authz(e.module_id, 'edit', 'care_entries', p_id::text, jsonb_build_object('check', p_action)) then return private.denied('You are not allowed to change this entry.'); end if;
  if p_action = 'ok' then
    update public.care_entries set payload = payload || '{"checked": true}'::jsonb where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'kept', true);
  end if;
  if p_action = 'end' then
    if p_ended_at is null or p_ended_at < e.occurred_at or p_ended_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'error', 'bad_end', 'message', 'The end must be after the start and not in the future.');
    end if;
    v_raw_min := case when e.ended_at is not null then round(extract(epoch from e.ended_at - e.occurred_at) / 60)::int else round(extract(epoch from now() - e.occurred_at) / 60)::int end;
    update public.care_entries
       set ended_at = p_ended_at,
           payload = payload || jsonb_build_object('checked', true, 'timer_capped', true, 'raw_minutes', v_raw_min, 'duration_min', round(extract(epoch from p_ended_at - e.occurred_at) / 60)::int)
     where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'ended_at', p_ended_at);
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_action');
end $$;
grant execute on function public.care_entry_check(uuid, text, timestamptz) to authenticated, service_role;
