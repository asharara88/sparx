-- A bottle given comes out of the right place (Mido, 10 November: the helper said a freezer
-- bottle "doesn't come off any freezer total, because there isn't one" — wrong, and the log
-- was just as wrong: Home took every bottle out of the fridge, a freezer one too, and a
-- bottle logged through the helper took nothing out at all). milk_consume gains where it
-- comes from: the fridge (as before) or the freezer, oldest bag first. The client decides
-- from the bottle's milk (lib/milk-take.ts): "Freezer" → freezer, a pumped milk → fridge,
-- formula or none named → nothing.

drop function if exists public.milk_consume(integer, text);
create or replace function public.milk_consume(p_ml integer, p_note text default null, p_location text default 'fridge') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_left integer := coalesce(p_ml, 0);
  b record;
  v_used jsonb := '[]'::jsonb;
begin
  if not private.authz('lana', 'add', 'milk_bottles') then return private.denied(); end if;
  if p_location not in ('fridge', 'freezer') then return jsonb_build_object('ok', false, 'error', 'bad_location'); end if;
  if v_left <= 0 then return jsonb_build_object('ok', true, 'used', v_used, 'short_ml', 0, 'location', p_location); end if;
  for b in
    select x.*, private.milk_expires_at(x) as expires_at
      from public.milk_bottles x
     where x.used_at is null and x.deleted_at is null and x.location = p_location and private.milk_expires_at(x) >= now()
     -- The fridge: warmed, then thawed, then whatever goes off first. The freezer: oldest bag first.
     order by (x.warmed_at is null), (x.thawed_at is null), case when p_location = 'freezer' then x.pumped_at end, private.milk_expires_at(x), x.pumped_at
  loop
    exit when v_left <= 0;
    if b.amount_ml <= v_left + 4 then
      update public.milk_bottles set used_at = now(), note = coalesce(p_note, note) where id = b.id;
      v_used := v_used || jsonb_build_object('id', b.id, 'ml', b.amount_ml);
      v_left := v_left - b.amount_ml;
    else
      update public.milk_bottles set amount_ml = amount_ml - v_left where id = b.id;
      v_used := v_used || jsonb_build_object('id', b.id, 'ml', v_left, 'left_ml', b.amount_ml - v_left);
      v_left := 0;
    end if;
  end loop;
  perform private.audit_write('lana', 'add', true, 'milk_bottles', null, jsonb_build_object('consume_ml', p_ml, 'from', p_location, 'used', v_used));
  return jsonb_build_object('ok', true, 'used', v_used, 'short_ml', greatest(v_left, 0), 'location', p_location);
end $$;
alter function public.milk_consume(integer, text, text) owner to app_rls;
revoke execute on function public.milk_consume(integer, text, text) from public, anon;
grant execute on function public.milk_consume(integer, text, text) to authenticated, service_role;
