-- ---------------------------------------------------------------------------
-- Six functions read the sign-in token themselves and fail on the live project.
--
-- Migration 4000 gave every definer function to app_rls and wrote
-- "grant usage on schema auth to app_rls". On a Supabase project that grant is a
-- silent no-op: postgres holds USAGE on auth without the grant option, so it cannot
-- pass it on (the local test database, where postgres is a superuser, applied it).
-- The functions below call auth.jwt() inline for the view-as check and have
-- therefore failed live with "permission denied for schema auth" since 4000:
-- preferences, large text, saving a helper chat, clocking in, starting a coach
-- plan, teaching the helper a memory. The others reach the token only through
-- private.preview_member_id() and public.current_member_id(), which stayed with
-- postgres, and work.
--
-- The check they wanted is private.read_only_preview() (migration 3600): a view-as
-- session is read only. Nothing mints a 'full' preview mode, so the behaviour is
-- the same and app_rls no longer needs the auth schema at all. The database check
-- (rls_test.sql) now asserts that no app_rls function names the auth schema.
-- ---------------------------------------------------------------------------

create or replace function public.me_prefs_save(p_lang text default null, p_simple_mode boolean default null, p_photo_path text default null, p_clear_photo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.current_member_id();
begin
  if v_id is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if p_lang is not null and p_lang not in ('en', 'ar', 'ru') then return jsonb_build_object('ok', false, 'error', 'bad_lang'); end if;
  update public.members m
     set lang = coalesce(p_lang, m.lang),
         simple_mode = coalesce(p_simple_mode, m.simple_mode),
         photo_path = case when p_clear_photo then null else coalesce(p_photo_path, m.photo_path) end,
         updated_at = now()
   where m.id = v_id;
  perform private.audit_write('members', 'edit', true, 'members', v_id::text, jsonb_build_object('prefs', true));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.me_large_text_set(p_large_text boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := public.current_member_id();
begin
  if v_id is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  update public.members set large_text = p_large_text, updated_at = now() where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ask_chat_save(p_id uuid, p_title text, p_messages jsonb, p_summary text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid := p_id; v_sum text := nullif(left(btrim(coalesce(p_summary, '')), 400), '');
begin
  if v_me is null or not public.has_permission('assistant', 'view') then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
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

create or replace function public.attendance_toggle(p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_target uuid := coalesce(p_member_id, public.current_member_id()); v_open uuid;
begin
  if v_me is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not exists (select 1 from public.members where id = v_target and is_active) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_target <> v_me and not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'attendance', v_target::text);
    return private.denied();
  end if;
  select id into v_open from public.attendance where member_id = v_target and out_at is null order by in_at desc limit 1;
  if v_open is not null then
    update public.attendance set out_at = now() where id = v_open;
    perform private.audit_write('members', 'view', true, 'attendance', v_open::text, jsonb_build_object('out', true, 'member', v_target));
    return jsonb_build_object('ok', true, 'state', 'out', 'id', v_open);
  end if;
  insert into public.attendance (member_id, logged_by) values (v_target, v_me) returning id into v_open;
  perform private.audit_write('members', 'view', true, 'attendance', v_open::text, jsonb_build_object('in', true, 'member', v_target));
  return jsonb_build_object('ok', true, 'state', 'in', 'id', v_open);
end $$;

create or replace function public.coach_plan_start(p_subject_id uuid, p_goal text, p_steps jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz     text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today  date := (now() at time zone v_tz)::date;
  v_steps  jsonb;
  v_n      int;
  v_id     uuid;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'coach_plans') then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if nullif(btrim(coalesce(p_goal, '')), '') is null or length(btrim(p_goal)) > 120 then return jsonb_build_object('ok', false, 'error', 'bad_goal', 'message', 'Give the plan a short goal.'); end if;
  if jsonb_typeof(p_steps) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_steps'); end if;
  select jsonb_agg(jsonb_build_object('day', rn, 'step', left(btrim(s->>'step'), 300)) order by rn) into v_steps
    from (select s, row_number() over () as rn from jsonb_array_elements(p_steps) s where nullif(btrim(coalesce(s->>'step', '')), '') is not null) x(s, rn);
  v_n := coalesce(jsonb_array_length(v_steps), 0);
  if v_n < 1 or v_n > 14 then return jsonb_build_object('ok', false, 'error', 'bad_steps', 'message', 'A plan has 1 to 14 days, one step each.'); end if;
  update public.coach_plans set status = 'replaced' where subject_id = p_subject_id and status = 'active';
  insert into public.coach_plans (subject_id, member_id, goal, steps, starts_on, ends_on)
  values (p_subject_id, public.current_member_id(), btrim(p_goal), v_steps, v_today, v_today + (v_n - 1))
  returning id into v_id;
  perform private.audit_write(v_module, 'add', true, 'coach_plans', v_id::text, jsonb_build_object('goal', btrim(p_goal), 'days', v_n));
  return jsonb_build_object('ok', true, 'id', v_id, 'days', v_n);
end $$;

create or replace function public.memory_add(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.authz('assistant', 'view', 'assistant_memories') then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if length(v_body) < 2 or length(v_body) > 300 then return jsonb_build_object('ok', false, 'error', 'bad_body', 'message', 'Keep a memory between 2 and 300 characters.'); end if;
  if (select count(*) from public.assistant_memories where deleted_at is null) >= 200 then return jsonb_build_object('ok', false, 'error', 'full', 'message', 'The helper already remembers 200 things. Remove some first.'); end if;
  select id into v_id from public.assistant_memories where deleted_at is null and lower(body) = lower(v_body);
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'duplicate', true); end if;
  insert into public.assistant_memories (body, created_by) values (v_body, public.current_member_id()) returning id into v_id;
  perform private.audit_write('assistant', 'add', true, 'assistant_memories', v_id::text, jsonb_build_object('body', left(v_body, 80)));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

