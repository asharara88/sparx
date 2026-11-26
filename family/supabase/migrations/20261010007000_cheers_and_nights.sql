-- ============================================================================
-- A cheer from one member to another, and a night that may be shared.
--
-- Rewards, step 2 (26 November 2026). Two things, built together because the second leads to
-- the first:
--
--   1. A cheer: one member of a home sends another a short line about something that member
--      did (a log, a day, a medal, a night). The receiver gets it once, as a small moment on
--      Home (the medal's slim line over the tab bar). Only the two of them ever read it: the
--      table has no direct read for anyone, and an admin viewing as her is not handed it.
--
--   2. A night that may be shared: a member can say yes to "tell the other parent how my
--      nights go". Until she does, nothing is worked out for anyone; she is asked once, on her
--      own Home, and can change her mind in More, Display. With a yes, the other admin's Home
--      shows one line the next morning, with one tap to take the child and one to send a cheer.
--      The line itself is worked out in the app from the week of entries Home already holds
--      (lib/nights.ts); the database only says who has said yes, and whether the caller has
--      already cheered that night.
--
-- Nothing here adds a call to Home: the two new facts ride in achievements_check(), which
-- Home already calls, and her own switch reaches her in me(), which returns her row.
-- No names: everything is by member id and role.
-- ============================================================================

-- null: never asked. true: shared. false: said no. Only she can set it (me_night_share_set).
alter table public.members add column if not exists night_share boolean;

create table if not exists public.cheers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.household (id) on delete cascade,
  from_member uuid not null,
  to_member uuid not null,
  about text not null check (about in ('log', 'day', 'medal', 'night')),
  ref_id uuid,     -- the entry (log) or the medal
  ref_day date,    -- the home's day (day), or the day the night started (night)
  words text not null check (char_length(btrim(words)) between 1 and 80),
  sent_at timestamptz not null default now(),
  seen_at timestamptz,
  constraint cheers_not_self check (from_member <> to_member),
  constraint cheers_ref check (
    (about in ('log', 'medal') and ref_id is not null and ref_day is null)
    or (about in ('day', 'night') and ref_day is not null and ref_id is null)),
  -- A cheer cannot name a member of another home, whoever writes it (as migration 4000, part 5).
  constraint cheers_from_member_home_fkey foreign key (household_id, from_member) references public.members (household_id, id) on delete cascade,
  constraint cheers_to_member_home_fkey foreign key (household_id, to_member) references public.members (household_id, id) on delete cascade
);
-- One cheer from a person about a thing: sending it again changes nothing.
create unique index if not exists cheers_once on public.cheers
  (from_member, to_member, about, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(ref_day, '0001-01-01'::date));
create index if not exists cheers_unseen on public.cheers (to_member) where seen_at is null;
create index if not exists cheers_household_idx on public.cheers (household_id);

-- Nobody reads or writes the table directly: the words are for two people, and the functions
-- below are the only way in.
alter table public.cheers enable row level security;
revoke all on public.cheers from anon, authenticated;
drop policy if exists cheers_app on public.cheers;
create policy cheers_app on public.cheers for all to app_rls using (true) with check (true);
drop policy if exists cheers_home on public.cheers;
create policy cheers_home on public.cheers as restrictive for all to authenticated, app_rls
  using (household_id = private.current_household_id()) with check (household_id = private.current_household_id());
grant select, insert, update, delete on public.cheers to app_rls;

-- Her own switch. No member id: nobody can turn it on or off for someone else, and not while
-- viewing as her.
create or replace function public.me_night_share_set(p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := public.current_member_id();
begin
  if v_id is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value', 'message', 'Say yes or no.'); end if;
  update public.members set night_share = p_on, updated_at = now() where id = v_id;
  perform private.audit_write('members', 'edit', true, 'members', v_id::text, jsonb_build_object('night_share', p_on));
  return jsonb_build_object('ok', true, 'night_share', p_on);
end $$;
alter function public.me_night_share_set(boolean) owner to app_rls;
revoke execute on function public.me_night_share_set(boolean) from public, anon;
grant execute on function public.me_night_share_set(boolean) to authenticated, service_role;

-- Send a cheer. The receiver must be someone else in the home who can see the child's log
-- (the moment shows on Home), and not on the simple screen, which has no place for it yet.
-- What it is about must be real and theirs:
--   log    an entry they saved, or one saved in their name;
--   medal  a medal that is theirs;
--   day    one of the last seven days, on which they saved something;
--   night  last night, between two admins, and only when the receiver shares her nights.
-- A night cheer to someone who does not share answers like any other refusal.
create or replace function public.cheer_send(p_to uuid, p_about text, p_ref_id uuid default null, p_ref_day date default null, p_words text default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_words text := btrim(coalesce(p_words, ''));
  v_to public.members%rowtype;
  v_tz text;
  v_today date;
  v_id uuid;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if not public.has_permission('lana', 'view') then return private.denied(); end if;
  if p_to is null or p_to = v_me then return private.denied('A cheer is for someone else.'); end if;
  select * into v_to from public.members where id = p_to and household_id = v_home and coalesce(is_active, true);
  if not found then return private.denied(); end if;
  if not exists (select 1 from public.permissions p where p.role_id = v_to.role_id and p.module_id = 'lana' and p.action = 'view' and p.allowed) then
    return private.denied();
  end if;
  if coalesce(v_to.simple_mode, false) then
    return jsonb_build_object('ok', false, 'error', 'simple_screen', 'message', 'A cheer cannot show on the simple screen yet.');
  end if;
  if char_length(v_words) < 1 or char_length(v_words) > 80 then
    return jsonb_build_object('ok', false, 'error', 'bad_words', 'message', 'A cheer is one short line.');
  end if;
  select timezone into v_tz from public.household where id = v_home;
  v_today := (now() at time zone v_tz)::date;

  if p_about = 'log' then
    if p_ref_id is null or p_ref_day is not null or not exists (
      select 1 from public.care_entries e
       where e.id = p_ref_id and e.household_id = v_home and e.deleted_at is null and (e.logged_by = p_to or e.attributed_to = p_to)) then
      return private.denied();
    end if;
  elsif p_about = 'medal' then
    if p_ref_id is null or p_ref_day is not null or not exists (
      select 1 from public.achievements a where a.id = p_ref_id and a.household_id = v_home and a.member_id = p_to) then
      return private.denied();
    end if;
  elsif p_about = 'night' then
    if p_ref_id is not null or p_ref_day is distinct from v_today - 1 or v_to.role_id <> 'admin' or v_to.night_share is not true
       or not exists (select 1 from public.members m where m.id = v_me and m.role_id = 'admin') then
      return private.denied();
    end if;
  elsif p_about = 'day' then
    if p_ref_id is not null or p_ref_day is null or p_ref_day > v_today or p_ref_day < v_today - 6 or not exists (
      select 1 from public.care_entries e
       where e.household_id = v_home and e.deleted_at is null and (e.logged_by = p_to or e.attributed_to = p_to)
         and (e.occurred_at at time zone v_tz)::date = p_ref_day) then
      return private.denied();
    end if;
  else
    return private.denied();
  end if;

  -- The same cheer again changes nothing, and says so.
  if exists (
    select 1 from public.cheers c
     where c.from_member = v_me and c.to_member = p_to and c.about = p_about
       and c.ref_id is not distinct from p_ref_id and c.ref_day is not distinct from p_ref_day) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  -- A dozen in a day is plenty: a cheer is worth something because it is not a stream.
  if (select count(*) from public.cheers c where c.from_member = v_me and c.sent_at >= (v_today::timestamp at time zone v_tz)) >= 12 then
    return jsonb_build_object('ok', false, 'error', 'plenty', 'message', 'That is plenty for today. They all arrived.');
  end if;
  insert into public.cheers (household_id, from_member, to_member, about, ref_id, ref_day, words)
  values (v_home, v_me, p_to, p_about, p_ref_id, p_ref_day, v_words)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'already', true); end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
alter function public.cheer_send(uuid, text, uuid, date, text) owner to app_rls;
revoke execute on function public.cheer_send(uuid, text, uuid, date, text) from public, anon;
grant execute on function public.cheer_send(uuid, text, uuid, date, text) to authenticated, service_role;

-- The receiver opened it. Only her own, and not while an admin views as her: that would take
-- her moment from her.
create or replace function public.cheers_seen(p_ids uuid[]) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_n integer;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  update public.cheers set seen_at = now()
   where household_id = v_home and to_member = v_me and seen_at is null and id = any (coalesce(p_ids, '{}'));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'seen', v_n);
end $$;
alter function public.cheers_seen(uuid[]) owner to app_rls;
revoke execute on function public.cheers_seen(uuid[]) from public, anon;
grant execute on function public.cheers_seen(uuid[]) to authenticated, service_role;

-- achievements_check(), as migration 5900 wrote it, with two more keys in what it returns:
--   cheers  up to five cheers the caller has not opened, oldest first. Empty while an admin
--           views as someone else: the words are for the receiver alone.
--   nights  for an admin: the other active admins who share their nights, and whether the
--           caller has already cheered each for last night. Empty for anyone else and in
--           "view as". The night itself is worked out in the app (lib/nights.ts).
-- Everything about medals is unchanged, line for line.
create or replace function public.achievements_check() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_me uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_n jsonb;
  v_pumpers uuid[];
  v_new jsonb;
  v_cheers jsonb := '[]'::jsonb;
  v_nights jsonb := '[]'::jsonb;
  v_tz text;
  v_today date;
begin
  if v_me is null or v_home is null then return private.denied(); end if;
  if not public.has_permission('lana', 'view') then return jsonb_build_object('ok', true, 'new', '[]'::jsonb); end if;
  v_n := private.achievement_numbers(v_home);
  select coalesce(array_agg(id), '{}') into v_pumpers
    from public.members where household_id = v_home and breastfeeds and coalesce(is_active, true);
  if cardinality(v_pumpers) = 0 then v_pumpers := array[null::uuid]; end if;

  if not private.read_only_preview() then
  insert into public.achievements (household_id, member_id, badge, tier, detail)
  select v_home, p.m, t.badge, t.tier, jsonb_build_object('need', t.need)
    from private.achievement_tiers() t
    cross join unnest(v_pumpers) as p(m)
   where (t.badge = 'pump_goal' and (v_n->>'best_run')::integer >= t.need)
      or (t.badge = 'pump_beat' and (v_n->>'beat_days')::integer >= t.need)
  on conflict do nothing;

  insert into public.achievements (household_id, member_id, badge, tier, detail)
  select v_home, null, t.badge, t.tier, jsonb_build_object('need', t.need)
    from private.achievement_tiers() t
   where t.badge = 'stash' and (v_n->>'freezer_ml')::integer >= t.need
  on conflict do nothing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'badge', a.badge, 'tier', a.tier, 'need', a.detail->'need',
           'mine', a.member_id is not distinct from v_me, 'earned_at', a.earned_at) order by a.tier desc, a.earned_at desc), '[]'::jsonb)
    into v_new
    from public.achievements a
   where a.household_id = v_home
     and (a.member_id = v_me or a.member_id is null)
     and not (v_me = any (a.seen_by));

  if not private.read_only_preview() then
    select coalesce(jsonb_agg(x.j order by x.sent_at, x.id), '[]'::jsonb) into v_cheers
      from (
        select c.sent_at, c.id,
               jsonb_build_object('id', c.id, 'from_name', f.display_name, 'about', c.about, 'ref_day', c.ref_day, 'words', c.words,
                 'sent_at', c.sent_at, 'badge', a.badge, 'tier', a.tier, 'type_label', t.label, 'occurred_at', e.occurred_at) as j
          from public.cheers c
          join public.members f on f.id = c.from_member
          left join public.achievements a on c.about = 'medal' and a.id = c.ref_id
          left join public.care_entries e on c.about = 'log' and e.id = c.ref_id
          left join public.care_entry_types t on t.id = e.type_id
         where c.household_id = v_home and c.to_member = v_me and c.seen_at is null
         order by c.sent_at, c.id
         limit 5) x;
    if exists (select 1 from public.members m where m.id = v_me and m.role_id = 'admin') then
      select timezone into v_tz from public.household where id = v_home;
      v_today := (now() at time zone v_tz)::date;
      select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id,
               'cheered', exists (select 1 from public.cheers c
                                   where c.from_member = v_me and c.to_member = m.id and c.about = 'night' and c.ref_day = v_today - 1))
               order by m.created_at, m.id), '[]'::jsonb)
        into v_nights
        from public.members m
       where m.household_id = v_home and m.id <> v_me and coalesce(m.is_active, true) and m.role_id = 'admin' and m.night_share is true;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'new', v_new, 'numbers', v_n, 'cheers', v_cheers, 'nights', v_nights);
end $$;
alter function public.achievements_check() owner to app_rls;
revoke execute on function public.achievements_check() from public, anon;
grant execute on function public.achievements_check() to authenticated, service_role;
