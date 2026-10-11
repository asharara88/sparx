-- ============================================================================
-- Step 5 — the shopping loop
--
--   * Receipts: a photo is read into lines (by the model, server side); each
--     line is matched to a list item (by a remembered alias, then by name
--     similarity), the rest are flagged, never dropped. Applying a receipt
--     records purchases and updates last bought / last price on the items.
--   * Purchases → a learned reorder interval per item (median gap between
--     purchase dates), which takes over from the typed one.
--   * Substitution rule per item, for the cart agent.
--   * Cart runs: a manifest of what to put in a cart at one shop, handed to
--     the agent, which stops at checkout and reports found / substituted /
--     missing.
-- No DELETE statements (the Supabase connector stalls on them).
-- ============================================================================

create extension if not exists pg_trgm with schema public;

-- ---------------------------------------------------------------------------
-- 1. Items: substitution rule, learned interval
-- ---------------------------------------------------------------------------
alter table public.shopping_items
  add column if not exists substitution text not null default 'same_brand'
    check (substitution in ('none', 'same_brand', 'any_brand')),
  add column if not exists reorder_days_learned integer;

create table if not exists public.shopping_item_aliases (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.shopping_items (id) on delete cascade,
  alias      text not null,
  created_at timestamptz not null default now(),
  unique (item_id, alias)
);
create index if not exists shopping_item_aliases_alias_idx on public.shopping_item_aliases (lower(alias));

-- ---------------------------------------------------------------------------
-- 2. Receipts, lines, purchases, cart runs
-- ---------------------------------------------------------------------------
create table if not exists public.receipts (
  id          uuid primary key default gen_random_uuid(),
  store_id    text references public.stores (id),
  store_name  text,
  bought_on   date,
  total       numeric(10, 2),
  currency    text,
  photo_path  text not null,
  ocr_text    text,
  extracted   jsonb,
  status      text not null default 'new' check (status in ('new', 'read', 'applied', 'discarded')),
  note        text,
  created_by  uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  applied_at  timestamptz
);

create table if not exists public.receipt_lines (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts (id) on delete cascade,
  line_no     integer not null,
  text        text not null,
  qty         numeric(10, 3),
  unit_price  numeric(10, 2),
  line_total  numeric(10, 2),
  item_id     uuid references public.shopping_items (id) on delete set null,
  match       text not null default 'unmatched' check (match in ('auto', 'confirmed', 'added', 'skipped', 'unmatched')),
  confidence  numeric(4, 3),
  unique (receipt_id, line_no)
);

create table if not exists public.purchases (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.shopping_items (id) on delete cascade,
  receipt_id  uuid references public.receipts (id) on delete set null,
  line_id     uuid references public.receipt_lines (id) on delete set null,
  bought_on   date not null,
  store_id    text references public.stores (id),
  qty         numeric(10, 3),
  price       numeric(10, 2),
  created_at  timestamptz not null default now()
);
create index if not exists purchases_item_idx on public.purchases (item_id, bought_on desc);

create table if not exists public.cart_runs (
  id          uuid primary key default gen_random_uuid(),
  store_id    text not null references public.stores (id),
  status      text not null default 'prepared' check (status in ('prepared', 'reported', 'done', 'cancelled')),
  manifest    jsonb not null,
  report      jsonb,
  note        text,
  created_by  uuid references public.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  reported_at timestamptz,
  done_at     timestamptz
);

-- RLS: reading needs the shopping list; writing goes through the RPCs below
-- (security invoker), so the write policies mirror the module's add / edit.
alter table public.shopping_item_aliases enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_lines enable row level security;
alter table public.purchases enable row level security;
alter table public.cart_runs enable row level security;

create policy aliases_read  on public.shopping_item_aliases for select to authenticated using (public.has_permission('shopping', 'view'));
create policy aliases_write on public.shopping_item_aliases for all    to authenticated using (public.has_permission('shopping', 'edit')) with check (public.has_permission('shopping', 'edit'));
create policy receipts_read on public.receipts for select to authenticated using (public.has_permission('shopping', 'view'));
create policy receipts_add  on public.receipts for insert to authenticated with check (public.has_permission('shopping', 'add'));
create policy receipts_edit on public.receipts for update to authenticated using (public.has_permission('shopping', 'add')) with check (public.has_permission('shopping', 'add'));
create policy lines_read    on public.receipt_lines for select to authenticated using (public.has_permission('shopping', 'view'));
create policy lines_write   on public.receipt_lines for all    to authenticated using (public.has_permission('shopping', 'add')) with check (public.has_permission('shopping', 'add'));
create policy purchases_read  on public.purchases for select to authenticated using (public.has_permission('shopping', 'view'));
create policy purchases_write on public.purchases for insert to authenticated with check (public.has_permission('shopping', 'edit'));
create policy cart_runs_read  on public.cart_runs for select to authenticated using (public.has_permission('shopping', 'view'));
create policy cart_runs_write on public.cart_runs for all    to authenticated using (public.has_permission('shopping', 'add')) with check (public.has_permission('shopping', 'add'));

grant select, insert, update on public.shopping_item_aliases, public.receipts, public.receipt_lines, public.purchases, public.cart_runs to authenticated;
grant all on public.shopping_item_aliases, public.receipts, public.receipt_lines, public.purchases, public.cart_runs to service_role;

-- ---------------------------------------------------------------------------
-- 3. The list, now with substitution, learned interval and purchases
-- ---------------------------------------------------------------------------
create or replace function public.shopping_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not (public.has_permission('shopping', 'view') or public.has_permission('shopping_requests', 'add')) then
    perform private.audit_write('shopping', 'view', false, 'shopping_items');
    return private.denied('You are not allowed to see the shopping list.');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'name', i.name, 'category', i.category, 'needed', i.needed,
        'owner_member', i.owner_member, 'owner_name', m.display_name,
        'store_id', i.store_id, 'store_label', s.label, 'product_url', i.product_url,
        'quantity_on_hand', i.quantity_on_hand, 'size', i.size, 'size_changed_on', i.size_changed_on,
        'last_bought_on', i.last_bought_on, 'last_price', i.last_price, 'last_price_store', i.last_price_store,
        'reorder_days', i.reorder_days, 'reorder_days_learned', i.reorder_days_learned,
        'substitution', i.substitution, 'note', i.note, 'photo_path', i.photo_path,
        'purchases', (select count(*) from public.purchases p where p.item_id = i.id),
        'aliases', (select coalesce(jsonb_agg(a.alias order by a.alias), '[]'::jsonb) from public.shopping_item_aliases a where a.item_id = i.id),
        'due', case when coalesce(i.reorder_days_learned, i.reorder_days) is not null and i.last_bought_on is not null
                    then i.last_bought_on + coalesce(i.reorder_days_learned, i.reorder_days) end
      ) order by i.needed desc, i.category, i.name)
      from public.shopping_items i
      left join public.members m on m.id = i.owner_member
      left join public.stores s on s.id = i.store_id
      where i.deleted_at is null), '[]'::jsonb),
    'shelf', coalesce((select jsonb_agg(to_jsonb(sh) order by sh.sort, sh.name) from public.shelf_items sh where sh.is_active), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(st) order by st.sort) from public.stores st), '[]'::jsonb),
    'pending_requests', (select count(*) from public.shopping_requests r where r.status = 'pending'),
    'receipts_to_check', (select count(*) from public.receipts r where r.status in ('new', 'read')),
    'open_carts', (select count(*) from public.cart_runs c where c.status in ('prepared', 'reported'))
  );
end $$;

create or replace function public.shopping_item_substitution(p_id uuid, p_rule text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_owner uuid;
begin
  select owner_member into v_owner from public.shopping_items where id = p_id and deleted_at is null;
  if not (public.has_permission('shopping', 'edit') or v_owner = public.current_member_id()) then
    perform private.audit_write('shopping', 'edit', false, 'shopping_items', p_id::text);
    return private.denied();
  end if;
  if p_rule not in ('none', 'same_brand', 'any_brand') then return jsonb_build_object('ok', false, 'error', 'bad_rule'); end if;
  update public.shopping_items set substitution = p_rule where id = p_id and deleted_at is null;
  perform private.audit_write('shopping', 'edit', true, 'shopping_items', p_id::text, jsonb_build_object('substitution', p_rule));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.purchases_for_item(p_item_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'purchases', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'bought_on', p.bought_on, 'store', coalesce(s.label, r.store_name), 'qty', p.qty, 'price', p.price,
                                        'receipt_id', p.receipt_id, 'line', l.text) order by p.bought_on desc, p.created_at desc)
    from public.purchases p
    left join public.stores s on s.id = p.store_id
    left join public.receipts r on r.id = p.receipt_id
    left join public.receipt_lines l on l.id = p.line_id
    where p.item_id = p_item_id), '[]'::jsonb));
end $$;

-- Learned interval: the median gap between distinct purchase dates, needs 2+.
create or replace function private.learn_reorder(p_item_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_days integer;
begin
  select percentile_cont(0.5) within group (order by gap)::integer into v_days
  from (
    select d - lag(d) over (order by d) as gap
    from (select distinct bought_on as d from public.purchases where item_id = p_item_id) x
  ) g where gap is not null and gap > 0;
  update public.shopping_items set reorder_days_learned = v_days where id = p_item_id;
  return v_days;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Receipts
-- ---------------------------------------------------------------------------
create or replace function public.receipt_create(p_photo_path text, p_ocr_text text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'receipts');
    return private.denied();
  end if;
  if nullif(btrim(coalesce(p_photo_path, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'no_photo', 'message', 'Take a photo of the receipt.'); end if;
  insert into public.receipts (photo_path, ocr_text, created_by) values (p_photo_path, p_ocr_text, public.current_member_id()) returning id into v_id;
  perform private.audit_write('shopping', 'add', true, 'receipts', v_id::text);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Match one line of text to an item: remembered alias first, then name similarity.
create or replace function private.match_item(p_text text, out o_item uuid, out o_confidence numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_t text := lower(btrim(p_text));
begin
  select a.item_id, 1.0 into o_item, o_confidence
    from public.shopping_item_aliases a join public.shopping_items i on i.id = a.item_id and i.deleted_at is null
   where lower(a.alias) = v_t limit 1;
  if o_item is not null then return; end if;
  select i.id, round(greatest(public.similarity(lower(i.name), v_t), public.word_similarity(lower(i.name), v_t))::numeric, 3)
    into o_item, o_confidence
    from public.shopping_items i
   where i.deleted_at is null
   order by greatest(public.similarity(lower(i.name), v_t), public.word_similarity(lower(i.name), v_t)) desc
   limit 1;
  if o_confidence is null or o_confidence < 0.45 then o_item := null; end if;
end $$;

-- The model's reading of the receipt lands here: header + lines, each line matched.
-- p_extracted: {store, date, currency, total, lines: [{text, qty, unit_price, line_total, item_id}]}
create or replace function public.receipt_set_lines(p_id uuid, p_extracted jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_r public.receipts;
  v_line jsonb;
  v_n integer := 0;
  v_item uuid;
  v_conf numeric;
  v_store text;
  v_matched integer := 0;
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'receipt_lines', p_id::text);
    return private.denied();
  end if;
  select * into v_r from public.receipts where id = p_id;
  if v_r.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_r.status = 'applied' then return jsonb_build_object('ok', false, 'error', 'applied', 'message', 'This receipt was already applied.'); end if;

  -- store: the model's name against our stores, loosely
  select s.id into v_store from public.stores s
   where s.id <> 'other' and lower(coalesce(p_extracted->>'store', '')) like '%' || split_part(lower(s.label), '.', 1) || '%'
   order by s.sort limit 1;

  update public.receipts
     set extracted = p_extracted,
         store_id = v_store,
         store_name = nullif(btrim(p_extracted->>'store'), ''),
         bought_on = case when (p_extracted->>'date') ~ '^\d{4}-\d{2}-\d{2}$' then (p_extracted->>'date')::date else bought_on end,
         total = case when (p_extracted->>'total') ~ '^-?\d+(\.\d+)?$' then (p_extracted->>'total')::numeric else total end,
         currency = nullif(btrim(p_extracted->>'currency'), ''),
         status = 'read'
   where id = p_id;

  -- a re-read overwrites line by line (no deletes); leftover lines are skipped below
  for v_line in select * from jsonb_array_elements(coalesce(p_extracted->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_item := null; v_conf := null;
    if (v_line->>'item_id') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.shopping_items i where i.id = (v_line->>'item_id')::uuid and i.deleted_at is null) then
      v_item := (v_line->>'item_id')::uuid; v_conf := 0.9;
    else
      select o_item, o_confidence into v_item, v_conf from private.match_item(v_line->>'text');
    end if;
    if v_item is not null then v_matched := v_matched + 1; end if;
    insert into public.receipt_lines (receipt_id, line_no, text, qty, unit_price, line_total, item_id, match, confidence)
    values (p_id, v_n, coalesce(nullif(btrim(v_line->>'text'), ''), '(unreadable line)'),
            case when (v_line->>'qty') ~ '^\d+(\.\d+)?$' then (v_line->>'qty')::numeric else 1 end,
            case when (v_line->>'unit_price') ~ '^-?\d+(\.\d+)?$' then (v_line->>'unit_price')::numeric end,
            case when (v_line->>'line_total') ~ '^-?\d+(\.\d+)?$' then (v_line->>'line_total')::numeric end,
            v_item, case when v_item is null then 'unmatched' else 'auto' end, v_conf)
    on conflict (receipt_id, line_no) do update
      set text = excluded.text, qty = excluded.qty, unit_price = excluded.unit_price, line_total = excluded.line_total,
          item_id = excluded.item_id, match = excluded.match, confidence = excluded.confidence;
  end loop;
  -- lines beyond this reading (from an earlier, longer reading) are marked skipped
  update public.receipt_lines set match = 'skipped', item_id = null where receipt_id = p_id and line_no > v_n;
  perform private.audit_write('shopping', 'add', true, 'receipt_lines', p_id::text, jsonb_build_object('lines', v_n, 'matched', v_matched));
  return jsonb_build_object('ok', true, 'id', p_id, 'lines', v_n, 'matched', v_matched);
end $$;

create or replace function public.receipt_get(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'view') then return private.denied(); end if;
  return (select jsonb_build_object('ok', true,
    'receipt', jsonb_build_object('id', r.id, 'store_id', r.store_id, 'store_name', r.store_name, 'store_label', s.label, 'bought_on', r.bought_on,
                                  'total', r.total, 'currency', r.currency, 'photo_path', r.photo_path, 'status', r.status, 'note', r.note,
                                  'created_at', r.created_at, 'created_by_name', m.display_name, 'applied_at', r.applied_at),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'text', l.text, 'qty', l.qty, 'unit_price', l.unit_price,
                                                         'line_total', l.line_total, 'item_id', l.item_id, 'item_name', i.name, 'match', l.match, 'confidence', l.confidence)
                                       order by l.line_no)
                       from public.receipt_lines l left join public.shopping_items i on i.id = l.item_id where l.receipt_id = r.id), '[]'::jsonb))
    from public.receipts r left join public.stores s on s.id = r.store_id left join public.members m on m.id = r.created_by where r.id = p_id);
end $$;

create or replace function public.receipts_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'receipts', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'store', coalesce(s.label, r.store_name), 'bought_on', r.bought_on, 'total', r.total, 'currency', r.currency,
                                        'status', r.status, 'created_at', r.created_at, 'photo_path', r.photo_path,
                                        'lines', (select count(*) from public.receipt_lines l where l.receipt_id = r.id and l.match <> 'skipped'),
                                        'unmatched', (select count(*) from public.receipt_lines l where l.receipt_id = r.id and l.match = 'unmatched'))
                     order by r.created_at desc)
    from public.receipts r left join public.stores s on s.id = r.store_id
    where r.status <> 'discarded'), '[]'::jsonb));
end $$;

-- Fix a line by hand: match it to an item, add it as a new item, or skip it.
create or replace function public.receipt_line_set(p_line_id uuid, p_action text, p_item_id uuid default null, p_name text default null, p_category text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_l public.receipt_lines; v_item uuid := p_item_id; v_status text;
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'receipt_lines', p_line_id::text);
    return private.denied();
  end if;
  select l.* into v_l from public.receipt_lines l where l.id = p_line_id;
  if v_l.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select status into v_status from public.receipts where id = v_l.receipt_id;
  if v_status = 'applied' then return jsonb_build_object('ok', false, 'error', 'applied', 'message', 'This receipt was already applied.'); end if;
  if p_action = 'confirmed' then
    if v_item is null or not exists (select 1 from public.shopping_items where id = v_item and deleted_at is null) then
      return jsonb_build_object('ok', false, 'error', 'no_item', 'message', 'Pick an item from the list.');
    end if;
  elsif p_action = 'added' then
    if not public.has_permission('shopping', 'add') then return private.denied(); end if;
    insert into public.shopping_items (name, category, needed, created_by)
    values (coalesce(nullif(btrim(p_name), ''), v_l.text), coalesce(p_category, 'groceries'), false, public.current_member_id())
    returning id into v_item;
  elsif p_action = 'skipped' then
    v_item := null;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  update public.receipt_lines set item_id = v_item, match = p_action, confidence = case when p_action = 'skipped' then null else 1.0 end where id = p_line_id;
  perform private.audit_write('shopping', 'add', true, 'receipt_lines', p_line_id::text, jsonb_build_object('action', p_action, 'item', v_item));
  return jsonb_build_object('ok', true, 'id', p_line_id, 'item_id', v_item);
end $$;

-- Apply: purchases + last bought / last price + aliases + learned interval.
create or replace function public.receipt_apply(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_r public.receipts;
  v_l record;
  v_price numeric;
  v_applied integer := 0;
  v_flagged integer := 0;
  v_items uuid[] := '{}';
begin
  if not public.has_permission('shopping', 'edit') then
    perform private.audit_write('shopping', 'edit', false, 'receipts', p_id::text);
    return private.denied('Only Mido or Dana can apply a receipt to the list.');
  end if;
  -- Lock the receipt: a double tap or a retry waits here, then sees 'applied' and is refused.
  select * into v_r from public.receipts where id = p_id for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_r.status = 'applied' then return jsonb_build_object('ok', false, 'error', 'applied', 'message', 'Already applied.'); end if;
  if v_r.bought_on is null then return jsonb_build_object('ok', false, 'error', 'no_date', 'message', 'Set the receipt date first.'); end if;

  for v_l in select * from public.receipt_lines where receipt_id = p_id order by line_no loop
    if v_l.item_id is not null and v_l.match in ('auto', 'confirmed', 'added') then
      v_price := coalesce(v_l.unit_price, case when coalesce(v_l.qty, 0) > 0 then round(v_l.line_total / v_l.qty, 2) end);
      insert into public.purchases (item_id, receipt_id, line_id, bought_on, store_id, qty, price)
      values (v_l.item_id, p_id, v_l.id, v_r.bought_on, v_r.store_id, v_l.qty, v_price);
      -- An older receipt entered later adds history but must not overwrite a newer price, shop or "needed".
      update public.shopping_items
         set last_bought_on = greatest(coalesce(last_bought_on, v_r.bought_on), v_r.bought_on),
             last_price = case when v_price is not null and v_r.bought_on >= coalesce(last_bought_on, v_r.bought_on) then v_price else last_price end,
             last_price_store = case when v_price is not null and v_r.bought_on >= coalesce(last_bought_on, v_r.bought_on)
                                     then coalesce(v_r.store_id, v_r.store_name, last_price_store) else last_price_store end,
             needed = case when v_r.bought_on >= coalesce(last_bought_on, v_r.bought_on) then false else needed end
       where id = v_l.item_id;
      insert into public.shopping_item_aliases (item_id, alias) values (v_l.item_id, btrim(v_l.text)) on conflict do nothing;
      v_items := array_append(v_items, v_l.item_id);
      v_applied := v_applied + 1;
    elsif v_l.match = 'unmatched' then
      v_flagged := v_flagged + 1;
    end if;
  end loop;
  update public.receipts set status = 'applied', applied_at = now() where id = p_id;
  perform private.learn_reorder(x) from unnest(v_items) as x;
  perform private.audit_write('shopping', 'edit', true, 'receipts', p_id::text, jsonb_build_object('applied', v_applied, 'flagged', v_flagged));
  return jsonb_build_object('ok', true, 'id', p_id, 'applied', v_applied, 'flagged', v_flagged);
end $$;

create or replace function public.receipt_update(p_id uuid, p_bought_on date default null, p_store_id text default null, p_total numeric default null, p_status text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'receipts', p_id::text);
    return private.denied();
  end if;
  if p_status is not null and p_status not in ('new', 'read', 'discarded') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  update public.receipts
     set bought_on = coalesce(p_bought_on, bought_on), store_id = coalesce(p_store_id, store_id), total = coalesce(p_total, total),
         status = coalesce(p_status, status)
   where id = p_id and status <> 'applied';
  perform private.audit_write('shopping', 'add', true, 'receipts', p_id::text);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Cart runs: manifest out, report back, done
-- ---------------------------------------------------------------------------
create or replace function public.cart_run_create(p_store_id text, p_item_ids uuid[], p_note text default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_manifest jsonb; v_store public.stores;
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'cart_runs');
    return private.denied();
  end if;
  select * into v_store from public.stores where id = p_store_id;
  if v_store.id is null then return jsonb_build_object('ok', false, 'error', 'bad_store'); end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Pick at least one item.'); end if;
  select jsonb_build_object(
    'store', jsonb_build_object('id', v_store.id, 'label', v_store.label, 'url', v_store.url),
    'currency', (select currency from public.household limit 1),
    'rules', jsonb_build_object('stop_at_checkout', true, 'never_pay', true, 'report', 'found / substituted / missing, with the price of each'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'name', i.name, 'size', i.size, 'quantity', 1, 'product_url', i.product_url,
        'last_price', i.last_price, 'substitution', i.substitution, 'note', i.note,
        'aliases', (select coalesce(jsonb_agg(a.alias), '[]'::jsonb) from public.shopping_item_aliases a where a.item_id = i.id))
      order by i.category, i.name)
      from public.shopping_items i where i.id = any(p_item_ids) and i.deleted_at is null), '[]'::jsonb))
  into v_manifest;
  insert into public.cart_runs (store_id, manifest, note, created_by) values (p_store_id, v_manifest, nullif(btrim(p_note), ''), public.current_member_id()) returning id into v_id;
  perform private.audit_write('shopping', 'add', true, 'cart_runs', v_id::text, jsonb_build_object('store', p_store_id, 'items', array_length(p_item_ids, 1)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- p_report: {summary, items: [{item_id, result: found|substituted|missing, product, price, note}]}
create or replace function public.cart_run_report(p_id uuid, p_report jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_status text;
begin
  if not public.has_permission('shopping', 'add') then
    perform private.audit_write('shopping', 'add', false, 'cart_runs', p_id::text);
    return private.denied();
  end if;
  select status into v_status from public.cart_runs where id = p_id;
  if v_status is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_status in ('done', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  update public.cart_runs set report = p_report, status = 'reported', reported_at = now() where id = p_id;
  perform private.audit_write('shopping', 'add', true, 'cart_runs', p_id::text, jsonb_build_object('reported', true));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- Done = you checked out yourself. Found and substituted items are bought today at the reported price.
create or replace function public.cart_run_close(p_id uuid, p_paid boolean) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_run public.cart_runs; v_it jsonb; v_n integer := 0; v_price numeric;
  v_today date := (now() at time zone coalesce((select timezone from public.household limit 1), 'UTC'))::date;
begin
  if not public.has_permission('shopping', 'edit') then
    perform private.audit_write('shopping', 'edit', false, 'cart_runs', p_id::text);
    return private.denied('Only Mido or Dana can close a cart.');
  end if;
  select * into v_run from public.cart_runs where id = p_id for update;
  if v_run.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_run.status in ('done', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
  if p_paid then
    for v_it in select * from jsonb_array_elements(coalesce(v_run.report->'items', '[]'::jsonb)) loop
      if (v_it->>'result') in ('found', 'substituted') and (v_it->>'item_id') ~ '^[0-9a-f-]{36}$' then
        v_price := case when (v_it->>'price') ~ '^\d+(\.\d+)?$' then (v_it->>'price')::numeric end;
        insert into public.purchases (item_id, bought_on, store_id, qty, price) values ((v_it->>'item_id')::uuid, v_today, v_run.store_id, 1, v_price);
        update public.shopping_items
           set needed = false, last_bought_on = v_today, last_price = coalesce(v_price, last_price),
               last_price_store = case when v_price is not null then v_run.store_id else last_price_store end
         where id = (v_it->>'item_id')::uuid;
        perform private.learn_reorder((v_it->>'item_id')::uuid);
        v_n := v_n + 1;
      end if;
    end loop;
  end if;
  update public.cart_runs set status = case when p_paid then 'done' else 'cancelled' end, done_at = now() where id = p_id;
  perform private.audit_write('shopping', 'edit', true, 'cart_runs', p_id::text, jsonb_build_object('paid', p_paid, 'bought', v_n));
  return jsonb_build_object('ok', true, 'id', p_id, 'bought', v_n);
end $$;

create or replace function public.cart_run_get(p_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'view') then return private.denied(); end if;
  return (select jsonb_build_object('ok', true, 'run', jsonb_build_object(
    'id', c.id, 'store_id', c.store_id, 'store_label', s.label, 'store_url', s.url, 'status', c.status, 'manifest', c.manifest, 'report', c.report,
    'note', c.note, 'created_at', c.created_at, 'created_by_name', m.display_name, 'reported_at', c.reported_at, 'done_at', c.done_at))
    from public.cart_runs c join public.stores s on s.id = c.store_id left join public.members m on m.id = c.created_by where c.id = p_id);
end $$;

create or replace function public.cart_runs_list() returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('shopping', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'runs', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'store_label', s.label, 'status', c.status, 'created_at', c.created_at,
                                        'items', jsonb_array_length(coalesce(c.manifest->'items', '[]'::jsonb)),
                                        'found', (select count(*) from jsonb_array_elements(coalesce(c.report->'items', '[]'::jsonb)) x where x->>'result' = 'found'),
                                        'substituted', (select count(*) from jsonb_array_elements(coalesce(c.report->'items', '[]'::jsonb)) x where x->>'result' = 'substituted'),
                                        'missing', (select count(*) from jsonb_array_elements(coalesce(c.report->'items', '[]'::jsonb)) x where x->>'result' = 'missing'))
                     order by c.created_at desc)
    from public.cart_runs c join public.stores s on s.id = c.store_id), '[]'::jsonb));
end $$;

grant execute on function
  public.shopping_item_substitution(uuid, text), public.purchases_for_item(uuid),
  public.receipt_create(text, text), public.receipt_set_lines(uuid, jsonb), public.receipt_get(uuid), public.receipts_list(),
  public.receipt_line_set(uuid, text, uuid, text, text), public.receipt_apply(uuid), public.receipt_update(uuid, date, text, numeric, text),
  public.cart_run_create(text, uuid[], text), public.cart_run_report(uuid, jsonb), public.cart_run_close(uuid, boolean),
  public.cart_run_get(uuid), public.cart_runs_list()
  to authenticated, service_role;
grant execute on function private.learn_reorder(uuid), private.match_item(text) to authenticated, service_role;
