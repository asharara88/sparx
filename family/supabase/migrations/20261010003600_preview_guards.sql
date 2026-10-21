-- "View as" is read only, everywhere. has_permission() already refuses every action
-- but 'view' while an admin previews another member, yet a handful of RPCs take an
-- "it is my own row" branch instead of a permission, and in preview "me" is the
-- previewed member. So an admin previewing Lilly could delete Lilly's notes, chats
-- and memories, change her photo, or bind their own phone to her push
-- subscriptions. One helper, one guard at the top of each of those functions.

create or replace function private.read_only_preview() returns boolean
language sql stable as $$
  select private.preview_member_id() is not null
$$;

create or replace function public.member_photo_save(p_member_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if p_member_id <> public.current_member_id() and not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'members', p_member_id::text);
    return private.denied();
  end if;
  update public.members set photo_path = nullif(btrim(p_path), ''), updated_at = now() where id = p_member_id;
  perform private.audit_write('members', 'edit', true, 'members', p_member_id::text, jsonb_build_object('photo', p_path is not null));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.note_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  select author into v_author from public.notes where id = p_id and deleted_at is null;
  if v_author is distinct from public.current_member_id() and not public.has_permission('notes', 'delete') then
    perform private.audit_write('notes', 'delete', false, 'notes', p_id::text);
    return private.denied();
  end if;
  update public.notes set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('notes', 'delete', true, 'notes', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ask_chat_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  update public.ask_chats set deleted_at = now() where id = p_id and member_id = public.current_member_id() and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.chat_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  select author into v_author from public.family_messages where id = p_id and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_author is distinct from public.current_member_id() and not public.has_permission('chat', 'delete') then
    perform private.audit_write('chat', 'delete', false, 'family_messages', p_id::text);
    return private.denied('Only the person who posted it, or an admin, can delete a message.');
  end if;
  update public.family_messages set deleted_at = now() where id = p_id and deleted_at is null;
  perform private.audit_write('chat', 'delete', true, 'family_messages', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.memory_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not public.has_permission('assistant', 'view') then return private.denied(); end if;
  update public.assistant_memories set deleted_at = now()
   where id = p_id and deleted_at is null and (created_by = public.current_member_id() or public.has_permission('members', 'edit'));
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found', 'message', 'Only whoever added a memory, or an admin, can remove it.'); end if;
  perform private.audit_write('assistant', 'edit', true, 'assistant_memories', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid;
begin
  if v_me is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
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
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  update public.push_subscriptions set is_active = false where endpoint = p_endpoint and member_id = v_me;
  return jsonb_build_object('ok', true);
end $$;
