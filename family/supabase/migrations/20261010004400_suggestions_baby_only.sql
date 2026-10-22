-- Suggestions for the baby's day only.
--
-- The shopping screens left the app (the house's and the pet's went earlier), but
-- suggestions_refresh still made "probably running out", "requests to check" and
-- "urgent ticket" cards whose links pointed at screens that no longer exist, and
-- approving a reorder still wrote to the shopping list nobody sees. The generator
-- keeps only the due-care cards (the weekly plan draft arrives through
-- suggestion_put); the open cards of the retired kinds are closed. The kinds stay
-- allowed on the table so the history keeps its rows.

update public.suggestions set status = 'done', decided_at = now()
 where kind in ('reorder', 'request', 'ticket') and status in ('open', 'dismissed');

create or replace function public.suggestions_refresh() returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_due jsonb;
  v_it jsonb;
begin
  if v_me is null then return private.denied(); end if;

  -- Due and overdue care items (treatments and dated things; the next feed is too frequent to be a card).
  v_due := public.care_due_list(7);
  for v_it in select * from jsonb_array_elements(coalesce(v_due->'items', '[]'::jsonb)) loop
    if v_it->>'kind' = 'treatment' then
      perform private.suggest('due', 'due:' || (v_it->>'subject_id') || ':' || (v_it->>'label'),
        (v_it->>'subject') || ': ' || (v_it->>'label') || case when (v_it->>'overdue')::boolean then ' is overdue' else ' is due' end,
        case when (v_it->>'overdue')::boolean then 'Was due ' else 'Due ' end || to_char((v_it->>'due_on')::date, 'DD Mon') || '. Book the doctor, or log it as done.',
        '/' || (v_it->>'module_id') || '/log/' || (v_it->>'module_id') || '.treatment',
        jsonb_build_object('type', 'open', 'subject_id', v_it->>'subject_id', 'module_id', v_it->>'module_id'));
    end if;
  end loop;
  -- A treatment logged since closes its due suggestion.
  update public.suggestions s set status = 'done', decided_at = now()
   where s.member_id = v_me and s.kind = 'due' and s.status = 'open'
     and not exists (select 1 from jsonb_array_elements(coalesce(v_due->'items', '[]'::jsonb)) x
                     where x->>'kind' = 'treatment' and 'due:' || (x->>'subject_id') || ':' || (x->>'label') = s.key);

  return public.suggestions_list();
end $$;
