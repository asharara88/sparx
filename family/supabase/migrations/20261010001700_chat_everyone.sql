-- Family chat for everyone (text and photos), the assistant switched on for
-- every role. Mirrors the "family chat" the Lovable prototype had: one shared
-- stream, anyone at home can read it, post to it and delete their own posts.

-- ---------------------------------------------------------------------------
-- 1. Module + permissions: every role reads and posts; only admins delete others'.
-- ---------------------------------------------------------------------------
insert into public.modules (id, label, description, sort) values
  ('chat', 'Family chat', 'Messages and photos between everyone at home.', 49)
on conflict (id) do nothing;
insert into public.permissions (role_id, module_id, action, allowed)
select r.id, 'chat', a.action,
  case when r.id = 'admin' then true
       when a.action in ('view', 'add') then true
       else false end
from public.roles r cross join (values ('view'), ('add'), ('edit'), ('delete')) as a(action)
on conflict (role_id, module_id, action) do update set allowed = excluded.allowed;

-- Everyone can chat with the assistant and attach photos.
insert into public.permissions (role_id, module_id, action, allowed)
select r.id, m.module_id, m.action, true
from public.roles r cross join (values ('assistant', 'view'), ('photos', 'view'), ('photos', 'add')) as m(module_id, action)
on conflict (role_id, module_id, action) do update set allowed = true;

-- ---------------------------------------------------------------------------
-- 2. Messages
-- ---------------------------------------------------------------------------
create table if not exists public.family_messages (
  id         uuid primary key default gen_random_uuid(),
  author     uuid references public.members (id) on delete set null,
  body       text not null default '' check (length(body) <= 2000),
  photo_path text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint family_messages_has_content check (length(btrim(body)) > 0 or photo_path is not null)
);
create index if not exists family_messages_live_idx on public.family_messages (created_at desc) where deleted_at is null;
alter table public.family_messages enable row level security;
create policy family_messages_read on public.family_messages for select to authenticated
  using (deleted_at is null and public.has_permission('chat', 'view'));
grant select on public.family_messages to authenticated;
grant all on public.family_messages to service_role;

create or replace function public.chat_send(p_body text, p_photo_path text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_body text := coalesce(btrim(p_body), '');
begin
  if not private.authz('chat', 'add', 'family_messages') then return private.denied(); end if;
  if v_body = '' and nullif(btrim(p_photo_path), '') is null then
    return jsonb_build_object('ok', false, 'error', 'empty', 'message', 'Write something or add a photo.');
  end if;
  if p_photo_path is not null and p_photo_path !~ '^chat/[0-9a-f-]{36}\.[a-z0-9]{1,5}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_photo', 'message', 'That photo path is not allowed.');
  end if;
  insert into public.family_messages (author, body, photo_path)
  values (public.current_member_id(), v_body, nullif(btrim(p_photo_path), ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.chat_send(text, text) to authenticated, service_role;

create or replace function public.chat_remove(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
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
grant execute on function public.chat_remove(uuid) to authenticated, service_role;

create or replace function public.chat_list(p_limit integer default 100, p_before timestamptz default null) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not private.authz('chat', 'view', 'family_messages') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', f.id, 'body', f.body, 'photo_path', f.photo_path, 'created_at', f.created_at,
             'author', f.author, 'author_name', coalesce(m.display_name, 'Someone'), 'author_photo', m.photo_path,
             'mine', f.author = public.current_member_id()) order by f.created_at asc)
      from (select * from public.family_messages
             where deleted_at is null and (p_before is null or created_at < p_before)
             order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) f
      left join public.members m on m.id = f.author), '[]'::jsonb));
end $$;
grant execute on function public.chat_list(integer, timestamptz) to authenticated, service_role;
