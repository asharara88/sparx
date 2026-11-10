-- The feed gap by age (migration 5800) counted the child's age from the server's date,
-- which is UTC: in the Gulf her age went up at 04:00, not at midnight, and from midnight
-- to 04:00 on the day she turned 6 or 12 months, home_summary's next feed used the old gap
-- while the screen (lib/stage.ts, ageInDays) already used the new one. Her age is now
-- counted on the home's own calendar, as on the screen. Same thresholds, same grants.
create or replace function private.feed_every_min(p_birth date) returns integer
language sql stable set search_path = public as $$
  with home as (
    select (now() at time zone coalesce(
              (select h.timezone from public.household h where h.id = private.current_household_id()), 'UTC'))::date as today)
  select case
    when p_birth is null then 180
    when (home.today - p_birth) < 6 * 30.4375 then 180
    when (home.today - p_birth) < 12 * 30.4375 then 240
    else 300 end
    from home
$$;
revoke execute on function private.feed_every_min(date) from public, anon;
grant execute on function private.feed_every_min(date) to authenticated, service_role, app_rls;
