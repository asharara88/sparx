-- ---------------------------------------------------------------------------
-- Timers left on. A breastfeed or a sleep nobody ended stays "running" for ever:
-- the home screen showed a feed 3,000 hours long. Three rules now:
--   1. private.timers_close_forgotten(after, subject, type): ends every timer open longer than
--      `after`, at a cap that fits the kind (a breastfeed 20 min, a night wake-up 1 h,
--      a sleep 12 h), and says so in the entry's note. The daily cron runs it with
--      12 hours for every home (public.timers_close_forgotten, service role only).
--   2. home_summary does not show a timer older than a day as running.
--   3. care_entry_log closes a timer of the same type left on since yesterday before
--      it starts the new one, instead of handing the old one back as "already running".
-- ---------------------------------------------------------------------------
create or replace function private.timers_close_forgotten(p_after interval, p_subject_id uuid default null, p_type_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  -- Anyone but the server may only reach a child of the home they are in and may log for,
  -- never from a read-only preview, and only for a timer left on since yesterday: the rule
  -- care_entry_log applies.
  if coalesce(current_setting('role', true), '') <> 'service_role' then
    if p_subject_id is null or p_after < interval '24 hours' or private.read_only_preview()
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
       and e.occurred_at < now() - p_after
       and (ct.settings->'end_if' is null
            or not exists (select 1 from jsonb_each_text(ct.settings->'end_if') k where e.payload->>k.key is distinct from k.value))
  ), u as (
    update public.care_entries e
       set ended_at = e.occurred_at + t.cap,
           note = concat_ws(' ', nullif(e.note, ''), 'Timer left on; end set to ' || t.cap_text || '.'),
           updated_at = now()
      from t where e.id = t.id and e.ended_at is null -- still open: a hand that ended it meanwhile wins
    returning e.id, e.type_id, e.subject_id, e.occurred_at, e.ended_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type_id', type_id, 'subject_id', subject_id, 'occurred_at', occurred_at, 'ended_at', ended_at)), '[]'::jsonb)
    into v_rows from u;
  return jsonb_build_object('ok', true, 'closed', jsonb_array_length(v_rows), 'entries', v_rows);
end $$;
-- Stays with postgres, which owns the tables and so is not subject to the home policy: the nightly
-- job runs with the server's key and no member identity, and must visit every home. From
-- care_entry_log it only ever gets the subject the caller was just allowed to log for.
revoke all on function private.timers_close_forgotten(interval, uuid, text) from public, anon;
grant execute on function private.timers_close_forgotten(interval, uuid, text) to authenticated, service_role;

-- The nightly job, for every home. The server's own key only.
create or replace function public.timers_close_forgotten() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role' then return private.denied(); end if;
  return private.timers_close_forgotten(interval '12 hours', null);
end $$;
revoke all on function public.timers_close_forgotten() from public, anon, authenticated;
grant execute on function public.timers_close_forgotten() to service_role;

-- 2. home_summary: as before, with the day-old rule on 'ongoing'.
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
                  -- a timer open for more than a day was left on; it is not "running" (migration 5200)
                  and e.occurred_at > now() - interval '24 hours'
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

-- 3. care_entry_log: as before (migration 3400), closing a timer left on since yesterday before a new start.
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
    -- A timer of this type left on since yesterday is closed first, not handed back (migration 5200).
    perform private.timers_close_forgotten(interval '24 hours', p_subject_id, p_type_id);
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

