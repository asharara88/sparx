-- Review follow-ups: an entry type keeps its colour (and icon) when an admin edits it without
-- sending one; the audit export can fetch up to 5000 rows.
create or replace function public.entry_type_save(
  p_id text, p_module_id text, p_key text, p_label text, p_icon text default null, p_color text default null, p_sort integer default 100,
  p_has_end boolean default false, p_due_after_min integer default null, p_fields jsonb default '[]'::jsonb, p_show_on_home boolean default false, p_is_active boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id text := coalesce(p_id, p_module_id || '.' || p_key);
begin
  if not public.has_permission('members', 'edit') then
    perform private.audit_write('members', 'edit', false, 'care_entry_types', v_id);
    return private.denied('Only an admin changes the entry types.');
  end if;
  if p_key !~ '^[a-z][a-z0-9_]*$' then return jsonb_build_object('ok', false, 'error', 'bad_key', 'message', 'The key is lowercase letters, digits and underscores.'); end if;
  if jsonb_typeof(p_fields) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_fields', 'message', 'Fields must be a JSON list.'); end if;
  if not exists (select 1 from public.modules where id = p_module_id) then return jsonb_build_object('ok', false, 'error', 'bad_module'); end if;
  insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active)
  values (v_id, p_module_id, p_key, btrim(p_label), nullif(btrim(p_icon), ''), nullif(btrim(p_color), ''), coalesce(p_sort, 100), coalesce(p_has_end, false), p_due_after_min, p_fields, coalesce(p_show_on_home, false), coalesce(p_is_active, true))
  on conflict (id) do update set label = excluded.label,
    icon = coalesce(excluded.icon, public.care_entry_types.icon),
    color = coalesce(excluded.color, public.care_entry_types.color),
    sort = excluded.sort, has_end = excluded.has_end,
    due_after_min = excluded.due_after_min, fields = excluded.fields, show_on_home = excluded.show_on_home, is_active = excluded.is_active;
  perform private.audit_write('members', 'edit', true, 'care_entry_types', v_id, jsonb_build_object('active', p_is_active));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.audit_recent(p_limit integer default 200) returns jsonb
language plpgsql security invoker set search_path = public as $$
begin
  if not public.has_permission('audit', 'view') then
    perform private.audit_write('audit', 'view', false, 'audit_log');
    return private.denied();
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'at', a.at, 'actor', m.display_name, 'actor_role', a.actor_role,
      'module_id', a.module_id, 'action', a.action, 'allowed', a.allowed, 'source', a.source,
      'target_table', a.target_table, 'target_id', a.target_id, 'detail', a.detail) order by a.at desc)
    from (select * from public.audit_log order by at desc limit least(coalesce(p_limit, 200), 5000)) a
    left join public.members m on m.id = a.actor_member), '[]'::jsonb));
end $$;
