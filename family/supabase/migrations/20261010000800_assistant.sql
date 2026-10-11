-- ============================================================================
-- Step 4 — the assistant
--
-- The assistant runs on the server with the *member's own* Supabase session,
-- so every tool it uses is an existing RPC under the same RLS the screens use.
-- This migration adds only what the assistant itself needs:
--   * assistant_audit(): one audit row per agent call (source 'agent'), with
--     the question, the tools it used, what it answered and what it proposed.
--   * assistant_briefs: the morning brief / evening digest, one per member per
--     day, generated on demand and kept so it is not paid for twice.
--   * 'assistant' / 'add' for the carer roles: the assistant may *propose* a
--     write for them (log a feed, add an event, flag an item). The write itself
--     still goes through the module's RPC and that module's permission.
-- No DELETE statements (the Supabase connector stalls on them).
-- ============================================================================

-- Carers may ask the assistant to log for them; admins already can.
update public.permissions set allowed = true
 where module_id = 'assistant' and action = 'add' and role_id in ('family_carer', 'home_carer');

-- ---------------------------------------------------------------------------
-- 1. Audit of every agent call
-- ---------------------------------------------------------------------------
create or replace function public.assistant_audit(
  p_kind text,                       -- 'ask' | 'brief'
  p_question text default null,
  p_answer text default null,
  p_tools jsonb default '[]'::jsonb, -- [{name, input, ok}]
  p_proposals jsonb default '[]'::jsonb,
  p_usage jsonb default null,        -- {model, input_tokens, output_tokens, cache_read, ms}
  p_allowed boolean default true
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_ok boolean := public.has_permission('assistant', 'view');
begin
  perform private.audit_write('assistant', coalesce(p_kind, 'ask'), v_ok and coalesce(p_allowed, true), 'assistant', null,
    jsonb_strip_nulls(jsonb_build_object(
      'question', left(p_question, 2000),
      'answer', left(p_answer, 4000),
      'tools', p_tools,
      'proposals', p_proposals,
      'usage', p_usage)),
    'agent');
  if not v_ok then return private.denied('The assistant is not switched on for your role.'); end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.assistant_audit(text, text, text, jsonb, jsonb, jsonb, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Briefs: morning brief and evening digest, one per member per day
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_briefs (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references public.members (id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('morning', 'evening')),
  content    text not null,
  model      text,
  usage      jsonb,
  refs       jsonb,            -- citation id -> {href, label}, so links survive the cache
  created_at timestamptz not null default now(),
  unique (member_id, day, kind)
);
alter table public.assistant_briefs enable row level security;

-- A brief is private to the member it was written for.
drop policy if exists assistant_briefs_read on public.assistant_briefs;
create policy assistant_briefs_read on public.assistant_briefs for select to authenticated
  using (member_id = public.current_member_id() and public.has_permission('assistant', 'view'));
grant select on public.assistant_briefs to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.assistant_briefs from authenticated;
grant all on public.assistant_briefs to service_role;

create or replace function public.assistant_brief_get(p_day date, p_kind text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_row public.assistant_briefs;
begin
  if not public.has_permission('assistant', 'view') then return private.denied('The assistant is not switched on for your role.'); end if;
  select * into v_row from public.assistant_briefs
   where member_id = public.current_member_id() and day = p_day and kind = p_kind;
  if v_row.id is null then return jsonb_build_object('ok', true, 'brief', null); end if;
  return jsonb_build_object('ok', true, 'brief', jsonb_build_object(
    'id', v_row.id, 'day', v_row.day, 'kind', v_row.kind, 'content', v_row.content,
    'created_at', v_row.created_at, 'model', v_row.model, 'refs', coalesce(v_row.refs, '{}'::jsonb)));
end $$;

create or replace function public.assistant_brief_save(p_day date, p_kind text, p_content text, p_model text default null, p_usage jsonb default null, p_refs jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid;
begin
  if v_me is null or not public.has_permission('assistant', 'view') then
    perform private.audit_write('assistant', 'brief', false, 'assistant_briefs', null, null, 'agent');
    return private.denied('The assistant is not switched on for your role.');
  end if;
  if p_kind not in ('morning', 'evening') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  insert into public.assistant_briefs (member_id, day, kind, content, model, usage, refs)
  values (v_me, p_day, p_kind, p_content, p_model, p_usage, p_refs)
  on conflict (member_id, day, kind) do update
    set content = excluded.content, model = excluded.model, usage = excluded.usage, refs = excluded.refs, created_at = now()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

grant execute on function public.assistant_brief_get(date, text), public.assistant_brief_save(date, text, text, text, jsonb, jsonb) to authenticated, service_role;
