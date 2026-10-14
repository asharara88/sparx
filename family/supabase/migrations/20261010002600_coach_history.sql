-- Coach plan history: what was tried, how many days were ticked, and the
-- check-in notes, so the helper never re-proposes a plan that failed unchanged.
create or replace function public.coach_plan_history(p_subject_id uuid default null, p_limit integer default 8) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'plans', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'goal', p.goal, 'from', p.starts_on, 'to', p.ends_on, 'status', p.status,
      'days', jsonb_array_length(p.steps),
      'done', (select count(*) from public.coach_checkins c where c.plan_id = p.id and c.done),
      'notes', (select coalesce(jsonb_agg(c.note order by c.day), '[]'::jsonb) from public.coach_checkins c where c.plan_id = p.id and c.note is not null),
      'by', m.display_name) order by p.created_at desc)
    from (select * from public.coach_plans where subject_id = v_subject order by created_at desc limit least(greatest(coalesce(p_limit, 8), 1), 30)) p
    left join public.members m on m.id = p.member_id), '[]'::jsonb));
end $$;
grant execute on function public.coach_plan_history(uuid, integer) to authenticated, service_role;
