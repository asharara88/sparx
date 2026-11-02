-- ---------------------------------------------------------------------------
-- Timer limits (Mido, 2 November 2026). A feed timer runs an hour at most, a sleep a
-- day (a night wake-up an hour); past that it was left on. Until now that was decided
-- overnight (migration 5200: the nightly job, 12 hours for everything) and Home showed
-- a feed "running" for 9 hours in the meantime. Now:
--   1. private.timer_limit(kind): the limit per kind.
--   2. private.timers_close_overdue(subject, type): ends every timer past its limit at the
--      kind's usual length (a feed 20 min, a sleep 12 h, a wake-up 1 h), noted as before.
--      The nightly job runs it for every home; home_summary runs it for the child when
--      the caller may log for them; care_entry_log runs it for the type being started.
--   3. home_summary never lists a timer past its limit as running.
--   4. An end the limit guessed is marked (payload auto_end) and gives way to a real end that
--      arrives later, from a phone that stopped the timer with no signal and synced after
--      the hour; an end a hand set stays locked (migration 4200). A hand that edits or checks
--      the entry clears the mark, so its correction is not replaced by a stop syncing later.
-- ---------------------------------------------------------------------------
create or replace function private.timer_limit(p_key text) returns interval
language sql immutable as $$
  select case p_key when 'feed' then interval '1 hour' when 'wake' then interval '1 hour' else interval '24 hours' end
$$;

create or replace function private.timers_close_overdue(p_subject_id uuid default null, p_type_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  -- Anyone but the server may only reach a child of the home they are in and may log for,
  -- never from a read-only preview.
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    if p_subject_id is null or private.read_only_preview()
       or not exists (select 1 from public.care_subjects s where s.id = p_subject_id and s.household_id = private.current_household_id())
       or not private.authz(private.subject_module(p_subject_id), 'add', 'care_entries', p_subject_id::text) then
      return private.denied();
    end if;
  end if;
  with t as (
    select e.id, ct.key,
           case ct.key when 'feed' then interval '20 minutes' when 'wake' then interval '60 minutes' else interval '12 hours' end as cap,
           case ct.key when 'feed' then '20 min' when 'wake' then '1 h' else '12 h' end as cap_text
      from public.care_entries e
      join public.care_entry_types ct on ct.id = e.type_id
     where e.ended_at is null and e.deleted_at is null and ct.has_end
       and (p_subject_id is null or e.subject_id = p_subject_id)
       and (p_type_id is null or e.type_id = p_type_id)
       and e.occurred_at < now() - private.timer_limit(ct.key)
       and (ct.settings->'end_if' is null
            or not exists (select 1 from jsonb_each_text(ct.settings->'end_if') k where e.payload->>k.key is distinct from k.value))
  ), u as (
    update public.care_entries e
       set ended_at = e.occurred_at + t.cap,
           payload = e.payload || '{"auto_end": true}'::jsonb, -- a guess: a real end may still replace it
           note = concat_ws(' ', nullif(e.note, ''), 'Timer left on; end set to ' || t.cap_text || '.'),
           updated_at = now()
      from t where e.id = t.id and e.ended_at is null -- still open: a hand that ended it meanwhile wins
    returning e.id, e.type_id, e.subject_id, e.occurred_at, e.ended_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type_id', type_id, 'subject_id', subject_id, 'occurred_at', occurred_at, 'ended_at', ended_at)), '[]'::jsonb)
    into v_rows from u;
  return jsonb_build_object('ok', true, 'closed', jsonb_array_length(v_rows), 'entries', v_rows);
end $$;
-- With postgres, like timers_close_forgotten: the nightly job visits every home with no member behind it.
revoke all on function private.timers_close_overdue(uuid, text) from public, anon;
grant execute on function private.timers_close_overdue(uuid, text) to authenticated, service_role;

-- The nightly job, for every home, now by the limits. The server's own key only.
create or replace function public.timers_close_forgotten() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then return private.denied(); end if;
  return private.timers_close_overdue(null);
end $$;

-- 2. care_entry_log: as in migration 5200, closing a timer of the type past its limit first.
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
    -- A timer of this type past its limit is closed first, not handed back (migration 5500).
    perform private.timers_close_overdue(p_subject_id, p_type_id);
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

-- 3. home_summary: as in migration 5200, closing timers past their limit and never listing one as running.
create or replace function public.home_summary(p_subject_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  v_usual   numeric;
begin
  if v_module is null then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Nobody to show yet.');
  end if;
  if not private.authz(v_module, 'view', 'care_entries', v_subject::text) then
    return private.denied('You are not allowed to see this log.');
  end if;
  -- A timer past its limit (a feed an hour, a sleep a day) is closed now, by whoever may
  -- log for the child, so Home never shows it as running (migration 5500).
  if not private.read_only_preview() and private.authz(v_module, 'add', 'care_entries', v_subject::text) then
    perform private.timers_close_overdue(v_subject);
  end if;
  v_usual := private.usual_bottle_ml(v_subject);
  return jsonb_build_object(
    'ok', true, 'today', v_today, 'timezone', v_tz,
    'subject', (select to_jsonb(s) from public.care_subjects s where s.id = v_subject),
    'custody', (select jsonb_build_object('member_id', c.member_id, 'name', m.display_name, 'since', c.since)
                from public.care_custody c left join public.members m on m.id = c.member_id
                where c.subject_id = v_subject order by c.since desc limit 1),
    'types', (select coalesce(jsonb_agg(to_jsonb(t) order by t.sort), '[]'::jsonb)
              from public.care_entry_types t where t.module_id = v_module and t.is_active),
    'ongoing', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', e.id, 'type_id', e.type_id, 'occurred_at', e.occurred_at, 'payload', e.payload,
                  'by', m.display_name) order by e.occurred_at), '[]'::jsonb)
                from public.care_entries e
                join public.care_entry_types t on t.id = e.type_id
                left join public.members m on m.id = coalesce(e.attributed_to, e.logged_by)
                where e.subject_id = v_subject and e.deleted_at is null and t.has_end and e.ended_at is null
                  -- a timer past its kind's limit was left on; it is not "running" (migration 5500)
                  and e.occurred_at > now() - private.timer_limit(t.key)
                  and (t.settings->'end_if' is null
                       or not exists (select 1 from jsonb_each_text(t.settings->'end_if') k where e.payload->>k.key is distinct from k.value))),
    'last', (select coalesce(jsonb_object_agg(l.type_id, l.row), '{}'::jsonb) from (
               select distinct on (e.type_id) e.type_id,
                 jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'ended_at', e.ended_at,
                   'payload', e.payload, 'note', e.note, 'by', m.display_name,
                   'fullness', case when t.key = 'feed' then private.feed_fullness(e.payload, e.occurred_at, e.ended_at, v_usual) end,
                   'next_due', case when t.due_after_min is not null
                                    then coalesce(e.ended_at, e.occurred_at)
                                         + make_interval(mins => case when t.key = 'feed'
                                             then greatest(60, round(t.due_after_min * (0.5 + 0.5 * private.feed_fullness(e.payload, e.occurred_at, e.ended_at, v_usual))))::int
                                             else t.due_after_min end) end) as row
               from public.care_entries e
               join public.care_entry_types t on t.id = e.type_id
               left join public.members m on m.id = coalesce(e.attributed_to, e.logged_by)
               where e.subject_id = v_subject and e.deleted_at is null
               order by e.type_id, e.occurred_at desc) l),
    'today_counts', (select coalesce(jsonb_object_agg(c.type_id, c.n), '{}'::jsonb) from (
                       select type_id, count(*) as n from public.care_entries
                       where subject_id = v_subject and deleted_at is null
                         and (occurred_at at time zone v_tz)::date = v_today
                       group by type_id) c),
    'today_entries', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', e.id, 'type_id', e.type_id, 'type_label', t.label, 'icon', t.icon,
                        'occurred_at', e.occurred_at, 'ended_at', e.ended_at, 'payload', e.payload, 'note', e.note,
                        'by', coalesce(ab.display_name, lb.display_name)) order by e.occurred_at desc), '[]'::jsonb)
                      from public.care_entries e
                      join public.care_entry_types t on t.id = e.type_id
                      left join public.members lb on lb.id = e.logged_by
                      left join public.members ab on ab.id = e.attributed_to
                      where e.subject_id = v_subject and e.deleted_at is null
                        and (e.occurred_at at time zone v_tz)::date = v_today)
  );
end $$;

-- 4. care_entry_end: as in migration 4200, letting a real end replace a guessed one.
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
  if v_end < v_row.occurred_at then
    return jsonb_build_object('ok', false, 'error', 'bad_time', 'message', 'The end time is before the start time.');
  end if;
  -- An end the limit guessed (migration 5500) gives way to the real one, which may arrive
  -- later from a phone that had no signal; an end a hand set stays, as before.
  if v_row.ended_at is not null and v_row.payload->>'auto_end' = 'true' then
    update public.care_entries
       set ended_at = v_end, payload = payload - 'auto_end',
           note = nullif(btrim(regexp_replace(coalesce(note, ''), 'Timer left on; end set to [^.]*\.', '')), ''),
           updated_at = now()
     where id = p_id and deleted_at is null;
    perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"end": true, "replaced_auto_end": true}'::jsonb);
    return jsonb_build_object('ok', true, 'id', p_id, 'ended_at', v_end);
  end if;
  if v_row.ended_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_ended', 'ended_at', v_row.ended_at,
      'message', 'It was already ended at ' || to_char(v_row.ended_at at time zone v_tz, 'HH24:MI') || '.');
  end if;
  update public.care_entries set ended_at = v_end where id = p_id and deleted_at is null and ended_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_ended', 'message', 'It was already ended.');
  end if;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text, '{"end": true}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id, 'ended_at', v_end);
end $$;

-- 5. care_entry_update and care_entry_check: as in migrations 0200 and 2900, clearing the guess mark.
create or replace function public.care_entry_update(
  p_id uuid, p_occurred_at timestamptz, p_ended_at timestamptz, p_payload jsonb, p_note text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_module text := private.entry_module(p_id);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'edit') then
    perform private.audit_write(v_module, 'edit', false, 'care_entries', p_id::text);
    return private.denied('You are not allowed to change this entry.');
  end if;
  -- A hand that saves the sheet has decided the end: the limit's guess flag goes (migration
  -- 5500), and its note goes when the end changed, so a stop syncing later cannot replace it.
  update public.care_entries
     set occurred_at = coalesce(p_occurred_at, occurred_at),
         ended_at    = p_ended_at,
         payload     = coalesce(p_payload, payload) - 'auto_end',
         note        = case when payload->>'auto_end' = 'true' and p_ended_at is distinct from ended_at
                            then nullif(btrim(regexp_replace(coalesce(p_note, ''), 'Timer left on; end set to [^.]*\.', '')), '')
                            else nullif(btrim(p_note), '') end
   where id = p_id and deleted_at is null;
  perform private.audit_write(v_module, 'edit', true, 'care_entries', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

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
    update public.care_entries set payload = (payload || '{"checked": true}'::jsonb) - 'auto_end' where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'kept', true);
  end if;
  if p_action = 'end' then
    if p_ended_at is null or p_ended_at < e.occurred_at or p_ended_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'error', 'bad_end', 'message', 'The end must be after the start and not in the future.');
    end if;
    v_raw_min := case when e.ended_at is not null then round(extract(epoch from e.ended_at - e.occurred_at) / 60)::int else round(extract(epoch from now() - e.occurred_at) / 60)::int end;
    update public.care_entries
       set ended_at = p_ended_at,
           payload = (payload || jsonb_build_object('checked', true, 'timer_capped', true, 'raw_minutes', v_raw_min, 'duration_min', round(extract(epoch from p_ended_at - e.occurred_at) / 60)::int)) - 'auto_end',
           note = nullif(btrim(regexp_replace(coalesce(note, ''), 'Timer left on; end set to [^.]*\.', '')), '')
     where id = p_id;
    return jsonb_build_object('ok', true, 'id', p_id, 'ended_at', p_ended_at);
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_action');
end $$;
