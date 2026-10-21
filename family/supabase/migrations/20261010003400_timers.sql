-- Timers that survive a double tap, a second phone and a night with no signal.
--
-- 1. One open timer per type. A second "fell asleep" (another phone, a double tap, an
--    offline queue replayed twice) returns the timer already running instead of opening a
--    second sleep that double-counts minutes and confuses "next nap". Starts of one type
--    for one subject are serialised with an advisory lock, so two phones in the same
--    second cannot both pass the check.
-- 2. "Who has her" expires. Custody set more than 12 hours ago no longer attributes new
--    entries to that member; the person logging is attributed instead. A toggle that was
--    forgotten three days ago used to put every entry in the wrong name.
-- 3. care_entry_end_client: end a timer by the client_id it was started with. The phone's
--    offline queue starts a sleep it has no server id for yet; when the end comes while the
--    start is already sent, this is how it finds it.

create or replace function public.care_entry_log(
  p_subject_id uuid, p_type_id text,
  p_occurred_at timestamptz default now(), p_ended_at timestamptz default null,
  p_payload jsonb default '{}'::jsonb, p_note text default null, p_client_id uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_me     uuid := public.current_member_id();
  v_holder uuid;
  v_id     uuid;
  v_open   uuid;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'add') then
    perform private.audit_write(v_module, 'add', false, 'care_entries', null, jsonb_build_object('type', p_type_id));
    return private.denied('You are not allowed to add to this log.');
  end if;
  if p_client_id is not null then
    select id into v_id from public.care_entries where client_id = p_client_id;
    if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  end if;
  if not exists (select 1 from public.care_entry_types where id = p_type_id and module_id = v_module and is_active) then
    return jsonb_build_object('ok', false, 'error', 'bad_type', 'message', 'That kind of entry does not exist.');
  end if;
  -- 1. A timer of this type is already running: hand it back rather than start a second one.
  --    "Timer" follows the type's end_if rule, as home_summary does: a bottle feed with no end
  --    time is a plain entry, only a breastfeed is timed.
  if p_ended_at is null and exists (
       select 1 from public.care_entry_types t where t.id = p_type_id and t.has_end
          and (t.settings->'end_if' is null
               or not exists (select 1 from jsonb_each_text(t.settings->'end_if') k where coalesce(p_payload, '{}'::jsonb)->>k.key is distinct from k.value))) then
    -- Two phones in the same second: serialise starts of this type for this subject so the
    -- second one sees the first (transaction-scoped advisory lock).
    perform pg_advisory_xact_lock(hashtext(p_subject_id::text || ':' || p_type_id));
    select e.id into v_open from public.care_entries e
      join public.care_entry_types t on t.id = e.type_id
     where e.subject_id = p_subject_id and e.type_id = p_type_id and e.ended_at is null and e.deleted_at is null
       and (t.settings->'end_if' is null
            or not exists (select 1 from jsonb_each_text(t.settings->'end_if') k where e.payload->>k.key is distinct from k.value))
     order by e.occurred_at desc limit 1;
    if v_open is not null then
      return jsonb_build_object('ok', true, 'id', v_open, 'open', true, 'message', 'That timer was already running.');
    end if;
  end if;
  -- 2. Custody counts for 12 hours; after that the logger is the carer on record.
  select member_id into v_holder from public.care_custody
   where subject_id = p_subject_id and since > now() - interval '12 hours'
   order by since desc limit 1;
  insert into public.care_entries (client_id, subject_id, module_id, type_id, occurred_at, ended_at, payload, note, logged_by, attributed_to)
  values (p_client_id, p_subject_id, v_module, p_type_id, coalesce(p_occurred_at, now()), p_ended_at,
          coalesce(p_payload, '{}'::jsonb), nullif(btrim(p_note), ''), v_me, coalesce(v_holder, v_me))
  returning id into v_id;
  perform private.audit_write(v_module, 'add', true, 'care_entries', v_id::text, jsonb_build_object('type', p_type_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 3. End by client_id (same checks as care_entry_end, which it calls).
create or replace function public.care_entry_end_client(p_client_id uuid, p_ended_at timestamptz default now()) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if p_client_id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select id into v_id from public.care_entries where client_id = p_client_id and deleted_at is null;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That entry has not arrived yet.'); end if;
  return public.care_entry_end(v_id, p_ended_at);
end $$;
grant execute on function public.care_entry_end_client(uuid, timestamptz) to authenticated, service_role;
