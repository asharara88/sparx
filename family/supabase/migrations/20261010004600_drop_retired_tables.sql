-- The retired areas leave the database: the shopping loop (list, shelf, requests,
-- receipts, purchases, cart runs, stores), the house (tickets, their updates and
-- costs, assets, contractors) and the Home Assistant hub. Their screens left the
-- app earlier; their tables, functions, modules and permission rows stayed, and
-- nothing read them. The roles matrix still showed their modules, and the backup
-- still exported them.
--
-- Nothing is thrown away blind: every row of every dropped table is copied, as
-- JSON, into public.retired_rows first, with the table it came from and its home.
-- That table is the server's (row security on, no policies, no grants to
-- signed-in members); the nightly backup exports each home's share of it, so the
-- history survives a restore too. Drop it once nobody wants the history at all.
-- The pet stays: its subject, entry types and entries are part of the
-- child-and-pet setup and are a separate decision.

-- ---------------------------------------------------------------------------
-- 1. Keep the rows
-- ---------------------------------------------------------------------------
create table if not exists public.retired_rows (
  id            bigserial primary key,
  -- The home the row belonged to, so a home's share goes with the home when it is deleted (shared rows go to the first home).
  household_id  uuid references public.household (id) on delete cascade,
  table_name    text not null,
  row           jsonb not null,
  retired_at    timestamptz not null default now()
);
create index if not exists retired_rows_home on public.retired_rows (household_id);
alter table public.retired_rows enable row level security;
revoke all on public.retired_rows from public, anon, authenticated;
grant select, insert, update, delete on public.retired_rows to service_role;

-- stores was a shared table (no home of its own): its rows go to the first home, which owns what every home shares, so a backup carries them.
insert into public.retired_rows (household_id, table_name, row) select private.platform_home(), 'stores', to_jsonb(t) from public.stores t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'shelf_items', to_jsonb(t) from public.shelf_items t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'shopping_items', to_jsonb(t) from public.shopping_items t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'shopping_item_aliases', to_jsonb(t) from public.shopping_item_aliases t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'shopping_requests', to_jsonb(t) from public.shopping_requests t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'receipts', to_jsonb(t) from public.receipts t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'receipt_lines', to_jsonb(t) from public.receipt_lines t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'purchases', to_jsonb(t) from public.purchases t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'cart_runs', to_jsonb(t) from public.cart_runs t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'tickets', to_jsonb(t) from public.tickets t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'ticket_updates', to_jsonb(t) from public.ticket_updates t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'ticket_costs', to_jsonb(t) from public.ticket_costs t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'assets', to_jsonb(t) from public.assets t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'contractors', to_jsonb(t) from public.contractors t;
insert into public.retired_rows (household_id, table_name, row) select (to_jsonb(t)->>'household_id')::uuid, 'hub_entities', to_jsonb(t) from public.hub_entities t;
-- The house's photo attachments point at tickets and assets; they go with them.
insert into public.retired_rows (household_id, table_name, row) select t.household_id, 'attachments', to_jsonb(t) from public.attachments t where t.module_id in ('maintenance', 'maintenance_costs');
delete from public.attachments where module_id in ('maintenance', 'maintenance_costs');

-- ---------------------------------------------------------------------------
-- 2. The functions
-- ---------------------------------------------------------------------------
drop function if exists public.shopping_list();
drop function if exists public.shopping_item_save(uuid, text, text, uuid, text, text, text, text, date, numeric, integer, boolean, text);
drop function if exists public.shopping_item_needed(uuid, boolean, numeric, text);
drop function if exists public.shopping_item_remove(uuid);
drop function if exists public.shopping_item_substitution(uuid, text);
drop function if exists public.shopping_request_create(uuid, text, text, text);
drop function if exists public.shopping_request_review(uuid, boolean, text);
drop function if exists public.shopping_requests_list(text);
drop function if exists public.receipt_create(text, text);
drop function if exists public.receipt_get(uuid);
drop function if exists public.receipt_set_lines(uuid, jsonb);
drop function if exists public.receipt_line_set(uuid, text, uuid, text, text);
drop function if exists public.receipt_update(uuid, date, text, numeric, text);
drop function if exists public.receipt_apply(uuid);
drop function if exists public.receipts_list();
drop function if exists public.purchases_for_item(uuid);
drop function if exists public.cart_run_create(text, uuid[], text);
drop function if exists public.cart_run_get(uuid);
drop function if exists public.cart_run_report(uuid, jsonb);
drop function if exists public.cart_run_close(uuid, boolean);
drop function if exists public.cart_runs_list();
drop function if exists public.ticket_create(text, text, text, uuid, text, text);
drop function if exists public.ticket_get(uuid);
drop function if exists public.ticket_update(uuid, text, text, text, uuid, uuid, text, text);
drop function if exists public.tickets_list(text);
drop function if exists public.ticket_cost_add(uuid, numeric, text, date, uuid);
drop function if exists public.asset_save(uuid, text, text, text, text, text, text, date, date, text, text, text, text, boolean);
drop function if exists public.assets_list();
drop function if exists public.contractor_save(uuid, text, text, text, text, text, text, smallint, boolean);
drop function if exists public.contractors_list();
drop function if exists public.maintenance_overview();
drop function if exists public.hub_entity_save(text, text, text, integer, boolean);
drop function if exists private.match_item(text);
drop function if exists private.learn_reorder(uuid);

-- Approving a card: the "put it on the list" action went with the list; only plans do anything now.
create or replace function public.suggestion_decide(p_id uuid, p_decision text, p_days integer default 7, p_detail jsonb default null) returns jsonb
language plpgsql set search_path = public as $$
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
      null; -- 'open', or an action of a retired kind: approving just marks it handled
  end case;
  update public.suggestions set status = 'approved', decided_at = now() where id = p_id;
  perform private.audit_write('assistant', 'approve', true, 'suggestions', p_id::text, jsonb_build_object('key', v_s.key, 'entries', v_n));
  return jsonb_build_object('ok', true, 'status', 'approved', 'entries', v_n);
end $$;

-- A new home used to get a shelf of usual items; there is no shelf now, so household_create's seed is empty.
create or replace function private.seed_home(p_home uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Nothing per home to seed since the shopping loop left (migration 4600). Kept for household_create.
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The tables, their modules and permission rows
-- ---------------------------------------------------------------------------
drop table if exists public.purchases;
drop table if exists public.receipt_lines;
drop table if exists public.receipts;
drop table if exists public.cart_runs;
drop table if exists public.shopping_item_aliases;
drop table if exists public.shopping_requests;
drop table if exists public.shelf_items;
drop table if exists public.shopping_items;
drop table if exists public.stores;
drop table if exists public.ticket_costs;
drop table if exists public.ticket_updates;
drop table if exists public.tickets;
drop table if exists public.assets;
drop table if exists public.contractors;
drop table if exists public.hub_entities;

-- The modules leave the roles matrix (their permission rows go by cascade); audit rows keep the module id as text.
delete from public.modules where id in ('shopping', 'shopping_requests', 'shopping_review', 'maintenance', 'maintenance_costs');
-- Nothing left to hide.
update public.household set hidden_modules = array_remove(hidden_modules, 'shopping') where 'shopping' = any(hidden_modules);
