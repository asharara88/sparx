-- This week for Lana: a weekly brief kind, and age-matched play ideas with a
-- tick. Content is seeded here with its source named; the family can switch
-- items off from the database later without a code change.

-- 1. The weekly brief is a third brief kind, keyed by the week's Sunday.
alter table public.assistant_briefs drop constraint if exists assistant_briefs_kind_check;
alter table public.assistant_briefs add constraint assistant_briefs_kind_check check (kind in ('morning', 'evening', 'week'));

create or replace function public.assistant_brief_save(p_day date, p_kind text, p_content text, p_model text default null, p_usage jsonb default null, p_refs jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_member_id(); v_id uuid;
begin
  if v_me is null or not public.has_permission('assistant', 'view') then
    perform private.audit_write('assistant', 'brief', false, 'assistant_briefs', null, null, 'agent');
    return private.denied('The assistant is not switched on for your role.');
  end if;
  if p_kind not in ('morning', 'evening', 'week') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  insert into public.assistant_briefs (member_id, day, kind, content, model, usage, refs)
  values (v_me, p_day, p_kind, p_content, p_model, p_usage, p_refs)
  on conflict (member_id, day, kind) do update
    set content = excluded.content, model = excluded.model, usage = excluded.usage, refs = excluded.refs, created_at = now()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- 2. Play ideas by age, with a tick per child.
create table if not exists public.activities (
  id            text primary key,
  age_from_days integer not null,
  age_to_days   integer not null,
  title         text not null,
  how           text not null,
  why           text not null,
  source        text not null,
  sort          integer not null default 100,
  is_active     boolean not null default true
);
alter table public.activities enable row level security;
create policy activities_read on public.activities for select to authenticated using (public.current_member_id() is not null);
grant select on public.activities to authenticated;
grant all on public.activities to service_role;

create table if not exists public.activity_done (
  subject_id  uuid not null references public.care_subjects (id) on delete cascade,
  activity_id text not null references public.activities (id) on delete cascade,
  done_on     date not null,
  by_member   uuid references public.members (id) on delete set null,
  note        text check (note is null or length(note) <= 200),
  primary key (subject_id, activity_id)
);
alter table public.activity_done enable row level security;
grant all on public.activity_done to service_role;

insert into public.activities (id, age_from_days, age_to_days, title, how, why, source, sort) values
  -- 0 to 6 weeks
  ('nb_face',    0,   42, 'Face time',           'Hold her 20 to 30 cm from your face, talk softly and let her study you.', 'Newborns see best at this distance; faces are what they look for.', 'NHS Start for Life; AAP HealthyChildren', 10),
  ('nb_tummy',   0,   42, 'Tiny tummy time',     'A minute or two on your chest or across your lap, a few times a day, when she is awake and content.', 'Builds neck and shoulder strength and starts the habit.', 'AAP: tummy time; NHS', 20),
  ('nb_talk',    0,   42, 'Narrate the day',     'Tell her what you are doing: the nappy, the bath, the walk. Pause as if she answers.', 'Language starts with hearing a voice that responds to her.', 'NHS Start for Life', 30),
  ('nb_track',   0,   42, 'Follow the toy',      'Move a bright or black-and-white toy slowly side to side about 25 cm away.', 'Practises tracking with her eyes.', 'AAP HealthyChildren', 40),
  ('nb_skin',    0,   42, 'Skin to skin',        'Cuddle her against your bare chest after a feed.', 'Calms her, steadies her breathing and temperature, and helps bonding.', 'NHS; WHO', 50),
  ('nb_song',    0,   42, 'One song',            'Sing the same short song at the same moment each day, for example after the bath.', 'Repetition is how she learns to expect what comes next.', 'NHS Start for Life', 60),
  -- 6 to 12 weeks
  ('w6_smile',   42,  84, 'Smile back',          'When she smiles or coos, copy it and wait for her turn.', 'The first conversation: taking turns.', 'CDC milestones; NHS', 10),
  ('w6_tummy',   42,  84, 'Tummy time with a mirror', 'Tummy time on a mat with a baby-safe mirror or a toy in front, building to 15 minutes a day in short goes.', 'Head control and, later, rolling.', 'AAP: tummy time', 20),
  ('w6_reach',   42,  84, 'Something to bat',    'Dangle a soft toy within reach of her hands while she lies on her back.', 'She starts to swipe, then to reach.', 'AAP HealthyChildren', 30),
  ('w6_out',     42,  84, 'A walk outside',      'A daily walk in daylight, pram or carrier, pointing out what you see.', 'Daylight helps set her day and night; the world is interesting.', 'NHS', 40),
  ('w6_book',    42,  84, 'A board book',        'Read a page or two with big pictures, close to her face.', 'Looking, listening and the sound of your voice.', 'AAP: Books Build Connections', 50),
  ('w6_sounds',  42,  84, 'Where is the sound?', 'Shake a rattle gently to one side, then the other, and wait for her to turn.', 'Hearing and turning toward sound.', 'CDC milestones', 60),
  -- 3 to 4 months
  ('m3_grab',    84,  120, 'Grab and hold',      'Put a light rattle in her hand and let her hold and shake it.', 'Grasping and bringing hands to the middle.', 'CDC milestones', 10),
  ('m3_roll',    84,  120, 'Roll practice',      'On the mat, put a toy just out of reach to one side so she twists toward it.', 'The lead-up to rolling.', 'AAP HealthyChildren', 20),
  ('m3_chat',    84,  120, 'Babble back',        'When she makes a sound, answer with the same sound, then a word.', 'Turn-taking and the rhythm of talk.', 'NHS Start for Life', 30),
  ('m3_peek',    84,  120, 'Peekaboo',           'Cover your face with your hands, then show it with a smile.', 'Attention, anticipation and laughter.', 'NHS', 40),
  ('m3_sit',     84,  120, 'Supported sitting',  'Sit her on your lap facing out, hands around her chest, and look at things together.', 'Trunk strength and a new view.', 'AAP HealthyChildren', 50),
  ('m3_textures', 84, 120, 'Feel the fabrics',   'Let her touch a soft blanket, a cotton towel, a wooden spoon.', 'Touch and curiosity.', 'NHS Start for Life', 60),
  -- 4 to 6 months
  ('m4_mirror',  120, 180, 'Mirror play',        'Sit with her in front of a mirror and name what she sees: nose, hands, Lana.', 'She starts to notice herself and copies faces.', 'AAP HealthyChildren', 10),
  ('m4_reach',   120, 180, 'Reach across',       'Hold a toy slightly to one side so she has to reach across her body for it.', 'Two-handed play and crossing the middle.', 'CDC milestones', 20),
  ('m4_drop',    120, 180, 'Drop and look',      'Let her drop a soft toy from the high chair and watch it; pick it up with a smile. Repeat.', 'Cause and effect; later, she will do it on purpose.', 'NHS Start for Life', 30),
  ('m4_names',   120, 180, 'Name everything',    'Point and name: cup, cat, light, Mama. Short words, slowly.', 'Words she hears often are the first she understands.', 'NHS', 40),
  ('m4_tummyreach', 120, 180, 'Tummy time, toys in a circle', 'Toys around her on the mat so she pivots and reaches during tummy time.', 'Pivoting is the step before crawling.', 'AAP: tummy time', 50),
  ('m4_bounce',  120, 180, 'Stand and bounce',   'Hold her under the arms standing on your lap and let her push with her legs.', 'Leg strength and balance, on her terms.', 'AAP HealthyChildren', 60),
  ('m4_rhymes',  120, 180, 'Action rhymes',      'Round and round the garden, or a clapping song, with her hands.', 'Rhythm, touch and anticipation.', 'NHS Start for Life', 70),
  -- 6 to 9 months
  ('m6_sitplay', 180, 270, 'Sit and play',       'Sit her on the floor with cushions behind and a basket of safe things to take out.', 'Sitting balance and exploring.', 'CDC milestones', 10),
  ('m6_hide',    180, 270, 'Hide the toy',       'Cover a toy with a cloth while she watches, then ask where it went.', 'Object permanence: things still exist when hidden.', 'AAP HealthyChildren', 20),
  ('m6_crawl',   180, 270, 'Crawl toward it',    'Put a favourite toy just out of reach when she is on her tummy or hands and knees.', 'Motivation to move.', 'NHS', 30),
  ('m6_cup',     180, 270, 'Open cup practice',  'A few sips of water from a small open cup at mealtimes, with help.', 'Drinking from a cup is a skill that starts now.', 'NHS weaning', 40),
  ('m6_finger',  180, 270, 'Finger foods',       'Soft strips she can hold: steamed carrot, banana, toast fingers. Always sitting, always watched.', 'Self-feeding, chewing and hand control.', 'NHS weaning; AAP', 50),
  ('m6_bang',    180, 270, 'Bang two things',    'Give her two wooden spoons or blocks and show her how to bang them together.', 'Two-handed coordination.', 'CDC milestones', 60),
  ('m6_books',   180, 270, 'Books with flaps',   'Lift-the-flap books; let her turn the pages even if clumsily.', 'Attention and the beginning of pointing.', 'AAP: Books Build Connections', 70),
  -- 9 to 12 months
  ('m9_cruise',  270, 365, 'Cruise along the sofa', 'Put toys along the sofa seat so she pulls up and sidesteps to reach them.', 'Pulling to stand and cruising.', 'CDC milestones', 10),
  ('m9_contain', 270, 365, 'In and out',         'A box and some blocks: show her putting them in and tipping them out.', 'Early problem solving and fine motor control.', 'AAP HealthyChildren', 20),
  ('m9_wave',    270, 365, 'Wave and clap',      'Wave bye-bye at the door, clap when she does something; wait for her to copy.', 'Gestures come before words.', 'CDC milestones', 30),
  ('m9_point',   270, 365, 'Point and name',     'Follow where she points and name it; point at things yourself.', 'Shared attention, the root of talking.', 'NHS Start for Life', 40),
  ('m9_stack',   270, 365, 'Knock the tower',    'Build a tower of two or three blocks and let her knock it down. Again.', 'Cause and effect, and fun.', 'AAP HealthyChildren', 50),
  ('m9_spoon',   270, 365, 'Her own spoon',      'A preloaded spoon at mealtimes to practise with, mess allowed.', 'Self-feeding and hand-eye coordination.', 'NHS weaning', 60),
  -- 12 to 18 months
  ('m12_walk',   365, 548, 'Push-along walking', 'A sturdy push toy or a box to push across the room.', 'Walking practice with support she controls.', 'NHS', 10),
  ('m12_words',  365, 548, 'First words, repeated', 'Pick five words you use all day and say them clearly in context: more, milk, cat, up, all done.', 'Understanding comes first; the words follow.', 'NHS Start for Life', 20),
  ('m12_sort',   365, 548, 'Posting box',        'A shape sorter or a box with a slot for posting lids.', 'Fine motor skills and problem solving.', 'AAP HealthyChildren', 30),
  ('m12_pretend', 365, 548, 'Pretend to drink',  'Give a toy cup and pretend to drink; offer it to her teddy.', 'The start of pretend play.', 'CDC milestones', 40),
  ('m12_scribble', 365, 548, 'Scribble',         'A thick crayon and big paper, taped to the table.', 'Grip and mark-making.', 'CDC milestones', 50),
  ('m12_help',   365, 548, 'Little jobs',        'Let her put the socks in the basket or hand you the spoon.', 'Following simple instructions and feeling useful.', 'NHS Start for Life', 60)
on conflict (id) do nothing;

-- Age-matched ideas: the band she is in now, plus the next band marked "coming".
create or replace function public.activities_list(p_subject_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_subject uuid := coalesce(p_subject_id, private.default_subject('child'));
  v_module  text := private.subject_module(v_subject);
  v_tz      text := coalesce((select timezone from public.household limit 1), 'UTC');
  v_today   date := (now() at time zone v_tz)::date;
  v_age     int;
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not public.has_permission(v_module, 'view') then return private.denied(); end if;
  select v_today - birth_date into v_age from public.care_subjects where id = v_subject;
  if v_age is null then return jsonb_build_object('ok', true, 'age_days', null, 'items', '[]'::jsonb); end if;
  return jsonb_build_object('ok', true, 'age_days', v_age, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'how', a.how, 'why', a.why, 'source', a.source,
      'band', case when v_age between a.age_from_days and a.age_to_days then 'now' else 'coming' end,
      'from_days', a.age_from_days, 'to_days', a.age_to_days,
      'done_on', d.done_on, 'done_by', m.display_name) order by (v_age between a.age_from_days and a.age_to_days) desc, a.age_from_days, a.sort)
    from public.activities a
    left join public.activity_done d on d.activity_id = a.id and d.subject_id = v_subject
    left join public.members m on m.id = d.by_member
    where a.is_active and (v_age between a.age_from_days and a.age_to_days
       or a.age_from_days = (select min(x.age_from_days) from public.activities x where x.is_active and x.age_from_days > v_age))), '[]'::jsonb));
end $$;
grant execute on function public.activities_list(uuid) to authenticated, service_role;

create or replace function public.activity_tick(p_subject_id uuid, p_activity_id text, p_done boolean default true, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_module text := private.subject_module(p_subject_id);
  v_tz     text := coalesce((select timezone from public.household limit 1), 'UTC');
begin
  if v_module is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.authz(v_module, 'add', 'activity_done', p_activity_id) then return private.denied(); end if;
  if not exists (select 1 from public.activities where id = p_activity_id and is_active) then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if coalesce(p_done, true) then
    insert into public.activity_done (subject_id, activity_id, done_on, by_member, note)
    values (p_subject_id, p_activity_id, (now() at time zone v_tz)::date, public.current_member_id(), nullif(btrim(coalesce(p_note, '')), ''))
    on conflict (subject_id, activity_id) do update set done_on = excluded.done_on, by_member = excluded.by_member, note = coalesce(excluded.note, public.activity_done.note);
  else
    delete from public.activity_done where subject_id = p_subject_id and activity_id = p_activity_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.activity_tick(uuid, text, boolean, text) to authenticated, service_role;
