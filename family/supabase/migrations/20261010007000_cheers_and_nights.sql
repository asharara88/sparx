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
--      nights go". Until she does, nothing is worked out for anyone; she is asked on her own
--      Home until she answers, and can change her mind in More, Display. With a yes, the other admin's Home
--      shows one line the next morning, with one tap to take the child and one to send a cheer.
--      The line itself is worked out in the app from the week of entries Home already holds
--      (lib/nights.ts); the database only says who has said yes, and whether the caller has
--      already cheered that night.
--
--      Her answer is hers. It lives in its own table that no signed-in role can read or
--      write: not a column on members, which every admin may edit and every carer may read.
--      Nobody but her can set it, nobody but her can read it (a no is told to no one, and
--      leaves no line in the audit log), and a yes is a yes to the parents her screen named
--      when she gave it: when another parent joins the home her yes waits, and the next time
--      she opens her Home or her Display it is ended, so that it can never come back by
--      itself; she is asked again with the new name in front of her.
--
--      "Her" has to mean her. A member row's account link (members.user_id) could be changed
--      by any admin with one direct write, which would let him sign in as her row and so set
--      or read all of the above (and her cheers, her chats, her notes). That write is refused
--      from now on: an account is linked to a row that has none, by the app's own functions,
--      and never re-pointed.
--
-- Nothing here adds a call to Home: the new facts ride in achievements_check(), which Home
-- already calls. No names: everything is by member id and role.
-- ============================================================================

-- A member row keeps the account it is linked to. Linking is done to a row that has no
-- account yet (member_save by e-mail, the sign-up trigger, an invite link); nothing in the app
-- re-points or clears one, and a signed-in role doing so directly could make itself that member.
create or replace function private.members_keep_account() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.user_id is not null and new.user_id is distinct from old.user_id and current_user in ('authenticated', 'anon') then
    raise exception 'A member''s account cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists members_keep_account on public.members;
create trigger members_keep_account before update of user_id on public.members
  for each row execute function private.members_keep_account();

-- Her answer. No row: never asked. share false: said no. share true: said yes, to the other
-- parents in `told` (the admins of her home on the day she answered).
create table if not exists public.night_shares (
  member_id uuid primary key,
  household_id uuid not null references public.household (id) on delete cascade,
  share boolean not null,
  told uuid[] not null default '{}',
  answered_at timestamptz not null default now(),
  constraint night_shares_member_home_fkey foreign key (household_id, member_id) references public.members (household_id, id) on delete cascade
);
create index if not exists night_shares_household_idx on public.night_shares (household_id);
alter table public.night_shares enable row level security;
revoke all on public.night_shares from anon, authenticated;
drop policy if exists night_shares_app on public.night_shares;
create policy night_shares_app on public.night_shares for all to app_rls using (true) with check (true);
drop policy if exists night_shares_home on public.night_shares;
create policy night_shares_home on public.night_shares as restrictive for all to authenticated, app_rls
  using (household_id = private.current_household_id()) with check (household_id = private.current_household_id());
grant select, insert, update, delete on public.night_shares to app_rls;

-- Whether a member's nights are shared right now: null when she was never asked, false after
-- a no, true after a yes. A yes counts only while every other parent in her home is one she
-- was asked about: when a new one appears it reads null again, so she is asked again and
-- until then nobody is told anything.
create or replace function private.night_share_of(p_member uuid) returns boolean
language sql stable set search_path = public as $$
  select case
    when not s.share then false
    when exists (
      select 1 from public.members o
       where o.household_id = s.household_id and o.id <> s.member_id and coalesce(o.is_active, true)
         and o.role_id = 'admin' and not (o.id = any (s.told))) then null
    else true end
  from public.night_shares s where s.member_id = p_member
$$;
alter function private.night_share_of(uuid) owner to app_rls;
revoke execute on function private.night_share_of(uuid) from public, anon, authenticated;
grant execute on function private.night_share_of(uuid) to app_rls;

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
-- viewing as her. A yes is to the parents her screen named (p_seen), and only to those of
-- them who are parents of her home now: if another joined while the screen was open, that one
-- is not in the list, so her yes waits and she is asked again. No audit line: the audit log
-- is read by every admin, and her answer, a no above all, is not theirs to read.
create or replace function public.me_night_share_set(p_on boolean, p_seen uuid[] default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
  v_told uuid[] := '{}';
begin
  if v_id is null or v_home is null then return private.denied(); end if;
  if private.read_only_preview() then return private.denied('Read only while viewing as someone else.'); end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'bad_value', 'message', 'Say yes or no.'); end if;
  if p_on then
    select coalesce(array_agg(o.id), '{}') into v_told
      from public.members o
     where o.household_id = v_home and o.id <> v_id and coalesce(o.is_active, true) and o.role_id = 'admin'
       and o.id = any (coalesce(p_seen, '{}'));
  end if;
  insert into public.night_shares (member_id, household_id, share, told, answered_at)
  values (v_id, v_home, p_on, v_told, now())
  on conflict (member_id) do update set share = excluded.share, told = excluded.told, answered_at = excluded.answered_at;
  -- What is in force may differ from what she tapped: a yes that named too few reads null.
  return jsonb_build_object('ok', true, 'night_share', private.night_share_of(v_id));
end $$;
alter function public.me_night_share_set(boolean, uuid[]) owner to app_rls;
revoke execute on function public.me_night_share_set(boolean, uuid[]) from public, anon;
grant execute on function public.me_night_share_set(boolean, uuid[]) to authenticated, service_role;

-- A yes that is waiting (a parent joined whom she was not asked about) is ended the moment she
-- sees a screen of hers that shows it as off: the stored yes is removed, so it cannot come
-- back by itself when that parent leaves again. Called by the two functions her own Home and
-- Display read, never in "view as". Returns her answer as it is afterwards.
create or replace function private.night_share_settle(p_member uuid) returns boolean
language plpgsql volatile set search_path = public as $$
declare v_share boolean := private.night_share_of(p_member);
begin
  if v_share is null then
    delete from public.night_shares where member_id = p_member and share;
  end if;
  return v_share;
end $$;
alter function private.night_share_settle(uuid) owner to app_rls;
revoke execute on function private.night_share_settle(uuid) from public, anon, authenticated;
grant execute on function private.night_share_settle(uuid) to app_rls;

-- Her own answer, for her own Display screen, with the parents it is about (the ids go back
-- with her yes, so that it names exactly those she saw). While an admin views as her it says
-- nothing and settles nothing: he is not the one to read it.
create or replace function public.me_night_share() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid := public.current_member_id();
  v_home uuid := private.current_household_id();
begin
  if v_id is null or v_home is null then return private.denied(); end if;
  return jsonb_build_object(
    'ok', true,
    'night_share', case when private.read_only_preview() then null else private.night_share_settle(v_id) end,
    'parents', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.display_name) order by o.display_name, o.id)
        from public.members o
       where o.household_id = v_home and o.id <> v_id and coalesce(o.is_active, true) and o.role_id = 'admin'), '[]'::jsonb));
end $$;
alter function public.me_night_share() owner to app_rls;
revoke execute on function public.me_night_share() from public, anon;
grant execute on function public.me_night_share() to authenticated, service_role;

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
    if p_ref_id is not null or p_ref_day is distinct from v_today - 1 or v_to.role_id <> 'admin' or private.night_share_of(p_to) is not true
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

-- achievements_check(), as migration 5900 wrote it, with three more keys in what it returns:
--   cheers       up to five cheers the caller has not opened, oldest first. Empty while an
--                admin views as someone else: the words are for the receiver alone.
--   nights       for an admin: the other active admins who share their nights, and whether
--                the caller has already cheered each for last night. Empty for anyone else
--                and in "view as". The night itself is worked out in the app (lib/nights.ts).
--   night_share  the caller's own answer (null: not asked yet, or to be asked again), so her
--                Home knows whether to ask. Null in "view as". Reading it here settles a yes
--                that was waiting, and ends one left over from when she was a parent.
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
  v_share boolean;
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
       where m.household_id = v_home and m.id <> v_me and coalesce(m.is_active, true) and m.role_id = 'admin'
         and private.night_share_of(m.id) is true;
    end if;
    if exists (select 1 from public.members m where m.id = v_me and m.role_id = 'admin') then
      v_share := private.night_share_settle(v_me);
    else
      -- Sharing is between parents: a yes she gave as one does not wait for her to be one again.
      delete from public.night_shares where member_id = v_me and share;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'new', v_new, 'numbers', v_n, 'cheers', v_cheers, 'nights', v_nights, 'night_share', v_share);
end $$;
alter function public.achievements_check() owner to app_rls;
revoke execute on function public.achievements_check() from public, anon;
grant execute on function public.achievements_check() to authenticated, service_role;
