-- ============================================================================
-- Step 6 — the proactive layer
--
--   * suggestions: approve / dismiss cards per member — "Royal Canin is
--     probably running out", "Fanta's deworming was due Tuesday", and the
--     weekly plan draft. Refreshed from the data on the member's own session
--     (RLS decides what each member is offered); approving performs the
--     action through the module's own RPC.
--   * push_subscriptions + notifications: web push per phone, one row per
--     sent notification so nothing is sent twice.
--   * hub_entities: which Home Assistant entities the house screen shows.
--     The app only ever reads the hub; the token lives on the server.
-- No DELETE statements (the Supabase connector stalls on them).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.suggestions (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members (id) on delete cascade,
  kind         text not null check (kind in ('reorder', 'due', 'plan', 'request', 'ticket')),
  key          text not null,                  -- dedupe key, e.g. reorder:<item_id>
  title        text not null,
  body         text,
  href         text,
  action       jsonb,                          -- {type: item_needed|calendar_add|open|plan, ...}
  status       text not null default 'open' check (status in ('open', 'approved', 'dismissed', 'done')),
  snooze_until date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  decided_at   timestamptz,
  unique (member_id, key)
);
alter table public.suggestions enable row level security;
create policy suggestions_own on public.suggestions for select to authenticated using (member_id = public.current_member_id());
-- Members decide and close their own cards; private.suggest() (definer) is the only writer of new rows.
create policy suggestions_own_update on public.suggestions for update to authenticated
  using (member_id = public.current_member_id()) with check (member_id = public.current_member_id());
grant select, update on public.suggestions to authenticated;
grant all on public.suggestions to service_role;

-- Upsert one suggestion for the caller. Dismissed ones stay quiet until their snooze passes.
create or replace function private.suggest(p_kind text, p_key text, p_title text, p_body text, p_href text, p_action jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
begin
  if v_me is null then return; end if;
  insert into public.suggestions (member_id, kind, key, title, body, href, action)
  values (v_me, p_kind, p_key, p_title, p_body, p_href, p_action)
  on conflict (member_id, key) do update
    set title = excluded.title, body = excluded.body, href = excluded.href, action = excluded.action, updated_at = now(),
        status = case when suggestions.status = 'dismissed' and (suggestions.snooze_until is null or suggestions.snooze_until <= v_today) then 'open'
                      else suggestions.status end;
end $$;

-- Recompute the caller's suggestions from the data they may see. Cheap; called when the home screen loads.
create or replace function public.suggestions_refresh() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
  v_me uuid := public.current_member_id();
  r record;
  v_due jsonb;
  v_it jsonb;
begin
  if v_me is null then return private.denied(); end if;

  -- Reorder: items probably running out (learned interval first), not already on the list.
  if public.has_permission('shopping', 'view') then
    for r in
      select i.id, i.name, i.last_bought_on + coalesce(i.reorder_days_learned, i.reorder_days) as due_on, i.last_price, i.last_price_store
        from public.shopping_items i
       where i.deleted_at is null and not i.needed and i.last_bought_on is not null
         and coalesce(i.reorder_days_learned, i.reorder_days) is not null
         and i.last_bought_on + coalesce(i.reorder_days_learned, i.reorder_days) <= v_today + 2
    loop
      perform private.suggest('reorder', 'reorder:' || r.id, r.name || ' is probably running out',
        case when r.due_on < v_today then 'Was due ' || to_char(r.due_on, 'DD Mon') else 'Due ' || to_char(r.due_on, 'DD Mon') end
          || case when r.last_price is not null then ' · last ' || r.last_price else '' end,
        '/shopping/' || r.id, jsonb_build_object('type', 'item_needed', 'item_id', r.id));
    end loop;
    -- Close reorder suggestions for items that are back on the list.
    update public.suggestions s set status = 'done', decided_at = now()
     where s.member_id = v_me and s.kind = 'reorder' and s.status = 'open'
       and exists (select 1 from public.shopping_items i where i.id = (s.action->>'item_id')::uuid and (i.needed or i.deleted_at is not null));
  end if;

  -- Due and overdue care items (treatments, next meal/litter are too frequent: only treatments and dated things).
  v_due := public.care_due_list(7);
  for v_it in select * from jsonb_array_elements(coalesce(v_due->'items', '[]'::jsonb)) loop
    if v_it->>'kind' = 'treatment' then
      perform private.suggest('due', 'due:' || (v_it->>'subject_id') || ':' || (v_it->>'label'),
        (v_it->>'subject') || ': ' || (v_it->>'label') || case when (v_it->>'overdue')::boolean then ' is overdue' else ' is due' end,
        case when (v_it->>'overdue')::boolean then 'Was due ' else 'Due ' end || to_char((v_it->>'due_on')::date, 'DD Mon') || '. Book the vet, or log it as done.',
        '/' || (v_it->>'module_id') || '/log/' || (v_it->>'module_id') || '.treatment',
        jsonb_build_object('type', 'open', 'subject_id', v_it->>'subject_id', 'module_id', v_it->>'module_id'));
    end if;
  end loop;
  -- A treatment logged since closes its due suggestion.
  update public.suggestions s set status = 'done', decided_at = now()
   where s.member_id = v_me and s.kind = 'due' and s.status = 'open'
     and not exists (select 1 from jsonb_array_elements(coalesce(v_due->'items', '[]'::jsonb)) x
                     where x->>'kind' = 'treatment' and 'due:' || (x->>'subject_id') || ':' || (x->>'label') = s.key);

  -- Pending running-low requests, for reviewers.
  if public.has_permission('shopping_review', 'edit') then
    for r in select count(*) as n, min(created_at) as since from public.shopping_requests where status = 'pending' loop
      if r.n > 0 then
        perform private.suggest('request', 'requests:pending', r.n || ' running-low ' || case when r.n = 1 then 'request' else 'requests' end || ' to check',
          'From Lilly, since ' || to_char(r.since at time zone v_tz, 'DD Mon HH24:MI'), '/shopping/requests', jsonb_build_object('type', 'open'));
      else
        update public.suggestions set status = 'done', decided_at = now() where member_id = v_me and key = 'requests:pending' and status = 'open';
      end if;
    end loop;
  end if;

  -- Urgent open tickets, for the house people.
  if public.has_permission('maintenance', 'edit') then
    for r in select t.id, t.title, t.location from public.tickets t where t.status <> 'done' and t.priority = 'urgent' loop
      perform private.suggest('ticket', 'ticket:' || r.id, '🔥 ' || r.title || coalesce(' · ' || r.location, ''), 'Urgent and still open.', '/house/tickets/' || r.id, jsonb_build_object('type', 'open'));
    end loop;
    update public.suggestions s set status = 'done', decided_at = now()
     where s.member_id = v_me and s.kind = 'ticket' and s.status = 'open'
       and not exists (select 1 from public.tickets t where 'ticket:' || t.id = s.key and t.status <> 'done' and t.priority = 'urgent');
  end if;

  return public.suggestions_list();
end $$;

create or replace function public.suggestions_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
begin
  return jsonb_build_object('ok', true, 'suggestions', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'key', s.key, 'title', s.title, 'body', s.body, 'href', s.href, 'action', s.action,
                                        'status', s.status, 'created_at', s.created_at)
                     order by case s.kind when 'ticket' then 0 when 'request' then 1 when 'due' then 2 when 'plan' then 3 else 4 end, s.created_at)
    from public.suggestions s
    where s.member_id = public.current_member_id() and s.status = 'open' and (s.snooze_until is null or s.snooze_until <= v_today)), '[]'::jsonb));
end $$;

-- A model-written draft (the weekly plan) lands as a suggestion with its proposed entries.
create or replace function public.suggestion_put(p_kind text, p_key text, p_title text, p_body text, p_href text, p_action jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if public.current_member_id() is null then return private.denied(); end if;
  if p_kind not in ('plan') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  perform private.suggest(p_kind, p_key, p_title, p_body, p_href, p_action);
  update public.suggestions set status = 'open', snooze_until = null where member_id = public.current_member_id() and key = p_key;
  return jsonb_build_object('ok', true);
end $$;

-- Approve: perform the action with the caller's own permissions. Dismiss: quiet for N days.
create or replace function public.suggestion_decide(p_id uuid, p_decision text, p_days integer default 7, p_detail jsonb default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_s public.suggestions;
  v_res jsonb;
  v_it jsonb;
  v_n integer := 0;
  v_tz text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
begin
  select * into v_s from public.suggestions where id = p_id and member_id = public.current_member_id() for update;
  if v_s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_s.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'decided', 'message', 'Already decided.'); end if;
  if p_decision = 'dismiss' then
    update public.suggestions set status = 'dismissed', snooze_until = v_today + greatest(coalesce(p_days, 7), 1), decided_at = now() where id = p_id;
    perform private.audit_write('assistant', 'dismiss', true, 'suggestions', p_id::text, jsonb_build_object('key', v_s.key));
    return jsonb_build_object('ok', true, 'status', 'dismissed');
  end if;
  if p_decision <> 'approve' then return jsonb_build_object('ok', false, 'error', 'bad_decision'); end if;
  case v_s.action->>'type'
    when 'item_needed' then
      v_res := public.shopping_item_needed((v_s.action->>'item_id')::uuid, true, null, null);
      if not (v_res->>'ok')::boolean then return v_res; end if;
    when 'plan' then
      -- p_detail: {entries: [index, ...]} — which proposed entries to put on the calendar (default all)
      for v_it in select x from jsonb_array_elements(coalesce(v_s.action->'entries', '[]'::jsonb)) with ordinality as t(x, i)
                  where p_detail is null or p_detail->'entries' is null or (p_detail->'entries') @> to_jsonb(t.i - 1) loop
        v_res := public.calendar_save(null, v_it->>'title', coalesce(v_it->>'kind', 'plan'),
          case when v_it->>'time' is not null and v_it->>'time' <> '' then ((v_it->>'date') || ' ' || (v_it->>'time'))::timestamp at time zone v_tz
               else (v_it->>'date')::date::timestamp at time zone v_tz end,
          null, (v_it->>'time') is null or v_it->>'time' = '', 'household', null, v_it->>'note', 'none', null);
        if (v_res->>'ok')::boolean then v_n := v_n + 1; end if;
      end loop;
    else
      null; -- 'open': approving just marks it handled
  end case;
  update public.suggestions set status = 'approved', decided_at = now() where id = p_id;
  perform private.audit_write('assistant', 'approve', true, 'suggestions', p_id::text, jsonb_build_object('key', v_s.key, 'entries', v_n));
  return jsonb_build_object('ok', true, 'status', 'approved', 'entries', v_n);
end $$;

grant execute on function public.suggestions_refresh(), public.suggestions_list(), public.suggestion_put(text, text, text, text, text, jsonb),
  public.suggestion_decide(uuid, text, integer, jsonb) to authenticated, service_role;
grant execute on function private.suggest(text, text, text, text, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Push: subscriptions per phone, a log of what was sent
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  failed_at   timestamptz,
  is_active   boolean not null default true
);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for select to authenticated using (member_id = public.current_member_id());
grant select on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  kind       text not null,
  key        text not null,                  -- e.g. brief:morning:2026-10-12
  title      text not null,
  body       text,
  url        text,
  sent_at    timestamptz not null default now(),
  result     jsonb,
  unique (member_id, key)
);
alter table public.notifications enable row level security;
create policy notifications_own on public.notifications for select to authenticated using (member_id = public.current_member_id());
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid;
begin
  if v_me is null then return private.denied(); end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then return jsonb_build_object('ok', false, 'error', 'bad_subscription'); end if;
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200))
  on conflict (endpoint) do update set member_id = v_me, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, is_active = true, failed_at = null
  returning id into v_id;
  perform private.audit_write('members', 'edit', true, 'push_subscriptions', v_id::text, jsonb_build_object('member', v_me));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id();
begin
  if v_me is null then return private.denied(); end if;
  update public.push_subscriptions set is_active = false where endpoint = p_endpoint and member_id = v_me;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.push_status() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object('ok', true,
    'phones', (select count(*) from public.push_subscriptions where member_id = public.current_member_id() and is_active),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', n.kind, 'title', n.title, 'sent_at', n.sent_at) order by n.sent_at desc)
                        from (select * from public.notifications where member_id = public.current_member_id() order by sent_at desc limit 10) n), '[]'::jsonb))
$$;

grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Home Assistant: which entities the house screen shows (read-only hub)
-- ---------------------------------------------------------------------------
create table if not exists public.hub_entities (
  entity_id  text primary key,
  label      text not null,
  kind       text not null default 'sensor' check (kind in ('sensor', 'binary', 'camera', 'other')),
  sort       integer not null default 100,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.hub_entities enable row level security;
create policy hub_read on public.hub_entities for select to authenticated using (public.has_permission('maintenance', 'view'));
grant select on public.hub_entities to authenticated;
grant all on public.hub_entities to service_role;

create or replace function public.hub_entity_save(p_entity_id text, p_label text, p_kind text default 'sensor', p_sort integer default 100, p_is_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'hub_entities', p_entity_id);
    return private.denied('Only an admin can change the hub.');
  end if;
  if p_entity_id !~ '^[a-z_]+\.[a-z0-9_]+$' then return jsonb_build_object('ok', false, 'error', 'bad_entity', 'message', 'An entity id looks like sensor.living_room_temperature.'); end if;
  insert into public.hub_entities (entity_id, label, kind, sort, is_active)
  values (p_entity_id, coalesce(nullif(btrim(p_label), ''), p_entity_id), coalesce(p_kind, 'sensor'), coalesce(p_sort, 100), coalesce(p_is_active, true))
  on conflict (entity_id) do update set label = excluded.label, kind = excluded.kind, sort = excluded.sort, is_active = excluded.is_active;
  perform private.audit_write('members', 'edit', true, 'hub_entities', p_entity_id, jsonb_build_object('active', p_is_active));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.hub_entity_save(text, text, text, integer, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Household facts and routines. The assistant reads them; admins edit them.
-- "Dana works nine to five", "we aim for 400 ml in the fridge": things the
-- family knows and the app otherwise would not.
-- ---------------------------------------------------------------------------
alter table public.household add column if not exists notes text;
alter table public.household add column if not exists milk_target_ml integer not null default 400 check (milk_target_ml between 0 and 5000);
alter table public.members add column if not exists routine text;

create or replace function public.household_save(p_name text, p_notes text, p_milk_target_ml integer) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'household', 'true');
    return private.denied('Only an admin can change the household.');
  end if;
  update public.household h
     set name = coalesce(nullif(btrim(p_name), ''), h.name),
         notes = nullif(btrim(p_notes), ''),
         milk_target_ml = coalesce(p_milk_target_ml, h.milk_target_ml),
         updated_at = now()
   where h.id = true;  -- the one row; an UPDATE without WHERE stalls the Supabase connector
  perform private.audit_write('members', 'edit', true, 'household', 'true', jsonb_build_object('milk_target_ml', p_milk_target_ml));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.household_save(text, text, integer) to authenticated, service_role;

-- member_save with a routine. p_routine has no default on purpose: calls without it
-- still resolve to the seven-argument version above.
create or replace function public.member_save(
  p_id uuid, p_display_name text, p_email text, p_role_id text,
  p_birth_date date, p_relationship text, p_is_active boolean, p_routine text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v jsonb;
begin
  v := public.member_save(p_id, p_display_name, p_email, p_role_id, p_birth_date, p_relationship, p_is_active);
  if (v->>'ok')::boolean then
    update public.members set routine = nullif(btrim(p_routine), ''), updated_at = now() where id = (v->>'id')::uuid;
  end if;
  return v;
end $$;
grant execute on function public.member_save(uuid, text, text, text, date, text, boolean, text) to authenticated, service_role;

-- Routines and household notes are what the family tells the app (Members → Household,
-- or setup-household.mjs); no starting text here.
