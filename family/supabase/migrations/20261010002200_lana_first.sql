-- Lana first: a bottle feed takes its milk out of the fridge, and the
-- emergency card has defaults (ambulance, hospital) on Lana's profile.

-- Take p_ml of pumped milk out of the stash, oldest safe bottle first
-- (warmed, then thawed, then fridge by expiry). A bottle used in part keeps
-- the remainder; under 5 ml counts as finished. Returns what was used and any
-- shortfall, so the screen can say "fridge is 40 ml short".
create or replace function public.milk_consume(p_ml integer, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_left integer := coalesce(p_ml, 0);
  b record;
  v_used jsonb := '[]'::jsonb;
begin
  if not private.authz('lana', 'add', 'milk_bottles') then return private.denied(); end if;
  if v_left <= 0 then return jsonb_build_object('ok', true, 'used', v_used, 'short_ml', 0); end if;
  for b in
    select x.*, private.milk_expires_at(x) as expires_at
      from public.milk_bottles x
     where x.used_at is null and x.deleted_at is null and x.location = 'fridge' and private.milk_expires_at(x) >= now()
     order by (x.warmed_at is null), (x.thawed_at is null), private.milk_expires_at(x), x.pumped_at
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
  perform private.audit_write('lana', 'add', true, 'milk_bottles', null, jsonb_build_object('consume_ml', p_ml, 'used', v_used));
  return jsonb_build_object('ok', true, 'used', v_used, 'short_ml', greatest(v_left, 0));
end $$;
grant execute on function public.milk_consume(integer, text) to authenticated, service_role;

do $$
begin
  update public.care_subjects
     set profile = profile || jsonb_build_object(
       'emergency_ambulance', '998',
       'emergency_hospital', 'NMC Royal Hospital, Abu Dhabi (Muroor Road)',
       'emergency_hospital_map', 'https://maps.google.com/?q=NMC+Royal+Hospital+Abu+Dhabi+Muroor+Road',
       'emergency_notes', 'Blood group O positive. No known allergies. Born 5 June 2026 at 39 weeks.')
   where id = '00000000-0000-4000-8000-00000000a001' and not (profile ? 'emergency_ambulance');
end $$;
