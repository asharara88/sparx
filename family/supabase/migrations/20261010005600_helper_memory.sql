-- The helper's memory, second pass: memories know what they are about, can
-- expire, can be edited, and the helper may suggest them itself.
--
--   1. assistant_memories gets a kind (home, child, person), an "about" link
--      (a member or a child), an optional expiry, a status (kept or suggested)
--      and the chat it came from. memory_list groups by these; expired ones
--      never reach a prompt.
--   2. memory_add takes the kind and the link (the one-argument form stays for
--      older clients and means "about the home"); memory_update edits a kept
--      memory in place; memory_keep turns a suggestion into a memory; a
--      suggestion can be dropped by anyone who may see it.
--   3. memory_suggest stores what the helper noticed in one of the member's own
--      chats, as suggestions nobody has to act on; the chat remembers how far
--      it was read (mined_turns), so the same chat is not read twice.
--   4. ask_chat_recaps can leave out the chat in progress, which used to show
--      up in its own "earlier chats".
-- A memory is live while it is not deleted and not expired: an expired one is
-- out of every list, duplicate check and cap, so the same sentence can be
-- remembered again. A suggestion the family dropped stays dropped: the same
-- sentence is never suggested again, and memory_list hands the reader those
-- dropped lines so it does not offer them either.
-- All of it under the home policy, owned by app_rls like the rest.

alter table public.assistant_memories
  add column if not exists kind            text not null default 'home' check (kind in ('home', 'child', 'person')),
  add column if not exists about_member_id uuid references public.members (id) on delete set null,
  add column if not exists subject_id      uuid references public.care_subjects (id) on delete set null,
  add column if not exists expires_at      timestamptz,
  add column if not exists status          text not null default 'kept' check (status in ('kept', 'suggested')),
  add column if not exists source_chat_id  uuid references public.ask_chats (id) on delete set null,
  add column if not exists updated_at      timestamptz not null default now();
create index if not exists assistant_memories_home_live_idx on public.assistant_memories (household_id, status, created_at desc) where deleted_at is null;

alter table public.ask_chats add column if not exists mined_turns integer not null default 0;

-- ---------------------------------------------------------------------------
-- A memory's "about" must be in this home; the kind decides which link it needs.
-- ---------------------------------------------------------------------------
create or replace function private.memory_check(p_kind text, p_about_member_id uuid, p_subject_id uuid, p_expires_at timestamptz) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('home', 'child', 'person') then return 'bad_kind'; end if;
  if p_kind = 'person' and (p_about_member_id is null or not exists (select 1 from public.members where id = p_about_member_id and is_active)) then return 'bad_about'; end if;
  if p_kind = 'child' and (p_subject_id is null or not exists (select 1 from public.care_subjects where id = p_subject_id and is_active)) then return 'bad_about'; end if;
  if p_kind = 'home' and (p_about_member_id is not null or p_subject_id is not null) then return 'bad_about'; end if;
  if p_expires_at is not null and p_expires_at <= now() then return 'bad_expiry'; end if;
  return null;
end $$;
revoke execute on function private.memory_check(text, uuid, uuid, timestamptz) from public, anon;
grant execute on function private.memory_check(text, uuid, uuid, timestamptz) to authenticated, service_role;

create or replace function public.memory_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('assistant', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', a.id, 'body', a.body, 'kind', a.kind, 'status', a.status,
        'about', case when a.about_member_id is not null then jsonb_build_object('id', a.about_member_id, 'name', am.display_name) end,
        'subject', case when a.subject_id is not null then jsonb_build_object('id', a.subject_id, 'name', s.name) end,
        'expires_at', a.expires_at, 'source_chat_id', a.source_chat_id,
        'created_at', a.created_at, 'by', m.display_name, 'mine', a.created_by = public.current_member_id())
      order by (a.status = 'suggested') desc, a.created_at desc)
    from public.assistant_memories a
    left join public.members m on m.id = a.created_by
    left join public.members am on am.id = a.about_member_id
    left join public.care_subjects s on s.id = a.subject_id
    where a.deleted_at is null and (a.expires_at is null or a.expires_at > now())), '[]'::jsonb),
  'dropped', coalesce((
    select jsonb_agg(d.body order by d.deleted_at desc) from (
      select body, deleted_at from public.assistant_memories where status = 'suggested' and deleted_at is not null order by deleted_at desc limit 50) d), '[]'::jsonb));
end $$;

create or replace function public.memory_add(p_body text, p_kind text, p_about_member_id uuid, p_subject_id uuid, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_body text := btrim(coalesce(p_body, '')); v_kind text := coalesce(nullif(btrim(p_kind), ''), 'home'); v_bad text;
begin
  if not private.authz('assistant', 'view', 'assistant_memories') then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if length(v_body) < 2 or length(v_body) > 300 then return jsonb_build_object('ok', false, 'error', 'bad_body', 'message', 'Keep a memory between 2 and 300 characters.'); end if;
  v_bad := private.memory_check(v_kind, p_about_member_id, p_subject_id, p_expires_at);
  if v_bad is not null then return jsonb_build_object('ok', false, 'error', v_bad, 'message', case v_bad when 'bad_expiry' then 'The date to forget it on must be in the future.' else 'Say who or what the memory is about.' end); end if;
  if (select count(*) from public.assistant_memories where deleted_at is null and (expires_at is null or expires_at > now()) and status = 'kept') >= 200 then return jsonb_build_object('ok', false, 'error', 'full', 'message', 'The helper already remembers 200 things. Remove some first.'); end if;
  select id, status into v_id, v_status from public.assistant_memories where deleted_at is null and (expires_at is null or expires_at > now()) and lower(body) = lower(v_body) limit 1;
  if v_id is not null and v_status = 'kept' then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  if v_id is not null then
    -- The same thing the helper had suggested: keeping it by hand is the confirmation.
    update public.assistant_memories
       set status = 'kept', kind = v_kind, about_member_id = p_about_member_id, subject_id = p_subject_id, expires_at = p_expires_at,
           created_by = public.current_member_id(), created_at = now(), updated_at = now()
     where id = v_id;
    perform private.audit_write('assistant', 'add', true, 'assistant_memories', v_id::text, jsonb_build_object('body', left(v_body, 80), 'kept_suggestion', true));
    return jsonb_build_object('ok', true, 'id', v_id, 'kept_suggestion', true);
  end if;
  insert into public.assistant_memories (body, kind, about_member_id, subject_id, expires_at, created_by)
  values (v_body, v_kind, p_about_member_id, p_subject_id, p_expires_at, public.current_member_id()) returning id into v_id;
  perform private.audit_write('assistant', 'add', true, 'assistant_memories', v_id::text, jsonb_build_object('body', left(v_body, 80), 'kind', v_kind));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
-- The one-argument form, for older clients and the Ask screen's "remember that…": about the home.
create or replace function public.memory_add(p_body text) returns jsonb
language sql security definer set search_path = public as $$ select public.memory_add(p_body, 'home', null, null, null); $$;

create or replace function public.memory_update(p_id uuid, p_body text, p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(coalesce(p_body, '')); v_row public.assistant_memories;
begin
  if not private.authz('assistant', 'view', 'assistant_memories', p_id::text) then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if length(v_body) < 2 or length(v_body) > 300 then return jsonb_build_object('ok', false, 'error', 'bad_body', 'message', 'Keep a memory between 2 and 300 characters.'); end if;
  if p_expires_at is not null and p_expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'bad_expiry', 'message', 'The date to forget it on must be in the future.'); end if;
  select * into v_row from public.assistant_memories where id = p_id and deleted_at is null and status = 'kept';
  if v_row.id is null or not (v_row.created_by = public.current_member_id() or public.has_permission('members', 'edit')) then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Only whoever added a memory, or an admin, can change it.');
  end if;
  if exists (select 1 from public.assistant_memories where deleted_at is null and (expires_at is null or expires_at > now()) and id <> p_id and lower(body) = lower(v_body)) then
    return jsonb_build_object('ok', false, 'error', 'duplicate', 'message', 'It already remembers that.');
  end if;
  update public.assistant_memories set body = v_body, expires_at = p_expires_at, updated_at = now() where id = p_id;
  perform private.audit_write('assistant', 'edit', true, 'assistant_memories', p_id::text, jsonb_build_object('body', left(v_body, 80)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

create or replace function public.memory_keep(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not private.authz('assistant', 'view', 'assistant_memories', p_id::text) then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if (select count(*) from public.assistant_memories where deleted_at is null and (expires_at is null or expires_at > now()) and status = 'kept') >= 200 then return jsonb_build_object('ok', false, 'error', 'full', 'message', 'The helper already remembers 200 things. Remove some first.'); end if;
  update public.assistant_memories set status = 'kept', created_by = public.current_member_id(), created_at = now(), updated_at = now()
   where id = p_id and deleted_at is null and status = 'suggested';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'That suggestion is gone.'); end if;
  perform private.audit_write('assistant', 'add', true, 'assistant_memories', p_id::text, '{"kept_suggestion": true}'::jsonb);
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- As before for a kept memory (its author or an admin); a suggestion can be dropped by anyone who sees it.
create or replace function public.memory_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not public.has_permission('assistant', 'view') then return private.denied(); end if;
  update public.assistant_memories set deleted_at = now()
   where id = p_id and deleted_at is null and (status = 'suggested' or created_by = public.current_member_id() or public.has_permission('members', 'edit'));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Only whoever added a memory, or an admin, can remove it.'); end if;
  perform private.audit_write('assistant', 'edit', true, 'assistant_memories', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- What the helper noticed in one of the caller's own chats: up to three suggestions per read,
-- at most twelve waiting per home, never one that is already remembered or suggested. The
-- chat records how many of the member's turns were read, so a later save reads only new ones.
create or replace function public.memory_suggest(p_chat_id uuid, p_turns integer, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_added integer := 0; v_item jsonb; v_body text; v_kind text; v_about uuid; v_subject uuid; v_waiting integer;
begin
  if v_me is null or not private.authz('assistant', 'view', 'assistant_memories', p_chat_id::text) then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not exists (select 1 from public.ask_chats where id = p_chat_id and member_id = v_me and deleted_at is null) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_items'); end if;
  update public.ask_chats set mined_turns = greatest(mined_turns, coalesce(p_turns, 0)) where id = p_chat_id;
  select count(*) into v_waiting from public.assistant_memories where deleted_at is null and status = 'suggested';
  for v_item in select * from jsonb_array_elements(p_items) limit 3 loop
    if v_waiting + v_added >= 12 then exit; end if;
    v_body := btrim(coalesce(v_item->>'body', ''));
    v_kind := coalesce(nullif(v_item->>'kind', ''), 'home');
    v_about := case when v_kind = 'person' then nullif(v_item->>'about_member_id', '')::uuid end;
    v_subject := case when v_kind = 'child' then nullif(v_item->>'subject_id', '')::uuid end;
    if length(v_body) < 2 or length(v_body) > 300 then continue; end if;
    if private.memory_check(v_kind, v_about, v_subject, null) is not null then continue; end if;
    if exists (select 1 from public.assistant_memories where lower(body) = lower(v_body)
                  and ((deleted_at is null and (expires_at is null or expires_at > now())) or (status = 'suggested' and deleted_at is not null))) then continue; end if;
    insert into public.assistant_memories (body, kind, about_member_id, subject_id, status, source_chat_id, created_by)
    values (v_body, v_kind, v_about, v_subject, 'suggested', p_chat_id, null);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then perform private.audit_write('assistant', 'add', true, 'assistant_memories', p_chat_id::text, jsonb_build_object('suggested', v_added)); end if;
  return jsonb_build_object('ok', true, 'added', v_added);
exception when invalid_text_representation then
  return jsonb_build_object('ok', false, 'error', 'bad_items');
end $$;

-- A member's own recent recaps, leaving out the chat in progress.
create or replace function public.ask_chat_recaps(p_limit integer, p_exclude uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.has_permission('assistant', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'summary', c.summary, 'at', c.updated_at) order by c.updated_at desc)
    from (select * from public.ask_chats where member_id = v_me and deleted_at is null and summary is not null and (p_exclude is null or id <> p_exclude)
          order by updated_at desc limit greatest(1, least(coalesce(p_limit, 6), 20))) c), '[]'::jsonb));
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('memory_list', 'memory_add', 'memory_update', 'memory_keep', 'memory_remove', 'memory_suggest', 'ask_chat_recaps'))
        or (n.nspname = 'private' and p.proname = 'memory_check')
  loop
    execute format('alter function %s owner to app_rls', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
