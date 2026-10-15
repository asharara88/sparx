-- The helper's memory, made real:
--   1. every saved chat keeps a one-line recap, so the next chat can start from
--      "last time you asked about her naps and we agreed to…" without reading
--      the whole thread;
--   2. ask_chat_recaps() hands a member their own recent recaps (RLS: only
--      their chats), which go into the prompt as episodic memory;
--   3. the coaching rule asks the helper to offer a memory when something
--      durable was decided, not only when someone says "remember".
-- Confirmed facts stay in assistant_memories (memory_add / memory_remove).

alter table public.ask_chats add column if not exists summary text check (summary is null or length(summary) <= 400);

create or replace function public.ask_chat_save(p_id uuid, p_title text, p_messages jsonb, p_summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid := p_id; v_sum text := nullif(left(btrim(coalesce(p_summary, '')), 400), '');
begin
  if v_me is null or not public.has_permission('assistant', 'view') then return private.denied(); end if;
  if private.preview_member_id() is not null and coalesce(auth.jwt()->>'preview_mode', '') <> 'full' then return private.denied('Read only while viewing as someone else.'); end if;
  if jsonb_typeof(p_messages) <> 'array' or pg_column_size(p_messages) > 400000 then return jsonb_build_object('ok', false, 'error', 'bad_messages'); end if;
  if p_id is null then
    insert into public.ask_chats (member_id, title, messages, summary) values (v_me, coalesce(nullif(left(btrim(p_title), 80), ''), 'Chat'), p_messages, v_sum) returning id into v_id;
  else
    update public.ask_chats set title = coalesce(nullif(left(btrim(p_title), 80), ''), title), messages = p_messages, summary = coalesce(v_sum, summary), updated_at = now()
     where id = p_id and member_id = v_me and deleted_at is null;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.ask_chat_save(uuid, text, jsonb, text) to authenticated, service_role;
drop function if exists public.ask_chat_save(uuid, text, jsonb);

-- A member's own recent chats, one line each: what they asked and where it ended.
create or replace function public.ask_chat_recaps(p_limit integer default 6) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id();
begin
  if v_me is null or not public.has_permission('assistant', 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'summary', c.summary, 'at', c.updated_at) order by c.updated_at desc)
    from (select * from public.ask_chats where member_id = v_me and deleted_at is null and summary is not null order by updated_at desc limit greatest(1, least(coalesce(p_limit, 6), 20))) c), '[]'::jsonb));
end $$;
grant execute on function public.ask_chat_recaps(integer) to authenticated, service_role;

-- The coaching rule, revised: offer a memory when something durable was decided.
update public.assistant_skills
   set body = replace(body,
     'When someone shares a durable fact or preference (what helped or did not, the family''s approach such as no cry-it-out, a new tooth), call propose_memory with one short sentence; not one-off chit-chat or what the log already holds.',
     'When someone shares a durable fact or preference (what helped or did not, the family''s approach such as no cry-it-out, a new tooth, how they like answers), call propose_memory with one short sentence; not one-off chit-chat or what the log already holds. At the end of a coaching exchange where something was decided (a routine change, a plan, what to try), offer one memory that captures the decision so the next chat and the other carers start from it. If a remembered fact is wrong or out of date, call forget_memory with its id. The EARLIER CHATS lines are your own memory of what this person asked before: build on them ("last time we moved bedtime earlier; how did it go?") instead of starting over.'),
       version = version + 1, updated_at = now()
 where id = 'coaching';
