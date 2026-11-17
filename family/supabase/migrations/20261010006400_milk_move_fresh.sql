-- Milk past its time can only be binned (Mido, 16 November). milk_move used to thaw, warm, use
-- or freeze any bottle, and warming or thawing restarts the clock private.milk_expires_at
-- reads, so an expired bottle came back as fresh. The Milk screen only offers "Bin it" for one,
-- and the helper's card checks again at Confirm; this is the rule itself, for every caller.
-- A bottle already warmed is not warmed again (that too would restart its two hours).
-- Signed-in members only: execute is taken from public and anon (functions are public by default).

create or replace function public.milk_move(p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.milk_bottles;
begin
  if not private.authz('lana', 'add', 'milk_bottles', p_id::text) then return private.denied(); end if;
  select * into b from public.milk_bottles where id = p_id and deleted_at is null and used_at is null;
  if b.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_action <> 'binned' and private.milk_expires_at(b) < now() then
    return jsonb_build_object('ok', false, 'error', 'expired', 'message', 'This milk is past its time: bin it.');
  end if;
  if p_action = 'fridge' then
    update public.milk_bottles set location = 'fridge', thawed_at = case when b.location = 'freezer' then now() else thawed_at end where id = p_id;
  elsif p_action = 'freezer' then
    if b.thawed_at is not null or b.warmed_at is not null then return jsonb_build_object('ok', false, 'error', 'no_refreeze', 'message', 'Thawed or warmed milk must not go back in the freezer.'); end if;
    update public.milk_bottles set location = 'freezer' where id = p_id;
  elsif p_action = 'warmed' then
    if b.warmed_at is not null then return jsonb_build_object('ok', false, 'error', 'already_warmed', 'message', 'This bottle is already warmed: use it or bin it.'); end if;
    update public.milk_bottles set warmed_at = now(), location = 'fridge', thawed_at = coalesce(thawed_at, case when b.location = 'freezer' then now() end) where id = p_id;
  elsif p_action = 'used' then
    update public.milk_bottles set used_at = now() where id = p_id;
  elsif p_action = 'binned' then
    update public.milk_bottles set deleted_at = now() where id = p_id;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.milk_move(uuid, text) from public, anon;
grant execute on function public.milk_move(uuid, text) to authenticated, service_role;
