-- Sprouty-inspired round: a mood tap, a fuller play library, the monthly story.

-- 1. Mood: one tap, four faces, kept as an entry so it sits on the day with sleep and feeds.
insert into public.care_entry_types (id, module_id, key, label, icon, color, sort, has_end, due_after_min, fields, show_on_home, is_active) values
  ('lana.mood', 'lana', 'mood', 'Mood', '🙂', '#f59e0b', 45, false, null,
   '[{"key":"mood","label":"How is she","type":"choice","options":["Happy","Calm","Fussy","Unsettled"],"required":true}]'::jsonb,
   false, true)
on conflict (id) do nothing;

-- 2. The monthly story is a brief kind of its own, keyed by her monthly birthday.
alter table public.assistant_briefs drop constraint if exists assistant_briefs_kind_check;
alter table public.assistant_briefs add constraint assistant_briefs_kind_check check (kind in ('morning', 'evening', 'week', 'story'));

create or replace function public.assistant_brief_save(p_day date, p_kind text, p_content text, p_model text default null, p_usage jsonb default null, p_refs jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_member uuid := public.current_member_id(); v_id uuid;
begin
  if not public.has_permission('assistant', 'view') then return private.denied('The assistant is not switched on for your role.'); end if;
  if p_kind not in ('morning', 'evening', 'week', 'story') then return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  insert into public.assistant_briefs (member_id, day, kind, content, model, usage, refs)
  values (v_member, p_day, p_kind, p_content, p_model, p_usage, p_refs)
  on conflict (member_id, day, kind) do update set content = excluded.content, model = excluded.model, usage = excluded.usage, refs = excluded.refs, created_at = now()
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- What was tried in a stretch of days: for the story and the weekly note.
create or replace function public.activity_done_list(p_subject_id uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_module text;
begin
  select module_id into v_module from public.care_subjects where id = p_subject_id;
  if v_module is null or not public.has_permission(v_module, 'view') then return private.denied(); end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'done_on', d.done_on, 'done_by', m.display_name, 'note', d.note) order by d.done_on)
    from public.activity_done d
    join public.activities a on a.id = d.activity_id
    left join public.members m on m.id = d.by_member
    where d.subject_id = p_subject_id and d.done_on between p_from and p_to), '[]'::jsonb));
end $$;
grant execute on function public.activity_done_list(uuid, date, date) to authenticated, service_role;

-- 3. The play library grows to about 150 ideas, three a day in rotation on the Today tab.
insert into public.activities (id, age_from_days, age_to_days, title, how, why, source, sort) values
  ('nb_sunset',    0,  42, 'The evening walk',           'A short walk in the pram or carrier at the start of the fussy evening hour.', 'Movement and a change of air cut the witching hour for many babies.', 'NHS', 160),
  ('w6_tummy_mirror', 42, 90, 'Mirror on the floor',       'An unbreakable mirror in front of her during tummy time.', 'A face to look at lifts her head longer.', 'AAP: tummy time', 170),
  ('m3_wrist',    90, 120, 'Wrist rattle',               'A soft rattle on her wrist or ankle for a few minutes.', 'Moving makes a sound: she learns her body causes things.', 'NHS Start for Life', 160),
  ('m4_peekcloth', 120, 180, 'Cloth over the toy',        'Half-cover a toy with a muslin while she watches; let her pull it off.', 'The start of knowing hidden things are still there.', 'CDC milestones', 170),
  ('m6_crawlhall', 180, 270, 'Hallway chase',             'Crawl beside her down the hall to a toy at the end, racing slowly.', 'Crawling for a reason, with company.', 'NHS', 190),
  ('m9_shoes',    270, 365, 'Barefoot on grass',          'Stand her barefoot on grass, sand or carpet while holding her hands.', 'Feet that feel the ground balance better.', 'NHS Start for Life', 170),
  ('m12_wipe',    365, 548, 'Wipe the table',             'A damp cloth and a job: wipe the table after lunch.', 'Real jobs are the best pretend play.', 'NHS Start for Life', 170),
  ('m18_puddles', 548, 730, 'Puddle jumping',             'Wellies, a rainy day, every puddle on the way.', 'Jumping, splashing and weather words.', 'NHS', 130),
  ('y2_memory',   730, 1095, 'What did we do today',      'At bedtime, go through the day together: first, then, and then.', 'Memory, sequence and a calm end to the day.', 'AAP HealthyChildren', 130),
  ('y2_bake',     730, 1095, 'Bake together',             'Measure, pour and stir; she licks the spoon at the end.', 'Numbers, following steps and patience.', 'NHS Start for Life', 140),
  ('y2_friend',   730, 1095, 'A friend to play',          'An hour with another child her age, with two of each toy.', 'Playing beside, then with, other children.', 'CDC milestones', 150),
  -- 0 to 6 weeks
  ('nb_hum',       0,  42, 'Hum while you hold her',     'Hum a low tune with her head against your chest so she feels it.', 'Your voice and heartbeat are what she knows; the vibration settles her.', 'NHS Start for Life', 60),
  ('nb_mirror',    0,  42, 'Copy her face',              'When she pokes her tongue out or opens her mouth, do the same back and wait.', 'Newborns copy faces from the first days; it is the first conversation.', 'AAP HealthyChildren', 70),
  ('nb_window',    0,  42, 'Window light',               'Hold her by a window in daylight for a few minutes when she is awake.', 'Daylight by day helps set her body clock.', 'NHS; Lullaby Trust', 80),
  ('nb_massage',   0,  42, 'A gentle leg rub',           'After a nappy change, stroke her legs and feet slowly with a flat hand.', 'Touch calms her and helps her learn where her body ends.', 'NHS Start for Life', 90),
  ('nb_sideview',  0,  42, 'Side to side',               'Lay her on her back and show your face on one side, then slowly the other.', 'Turning the head both ways keeps the neck even and avoids a flat spot.', 'AAP HealthyChildren', 100),
  ('nb_scent',     0,  42, 'Your T-shirt in the cot',    'A worn T-shirt of yours nearby when she sleeps in the pram or carrier by day.', 'Smell is her sharpest sense; yours is the one she looks for.', 'NHS', 110),
  ('nb_carry',     0,  42, 'A walk in the carrier',      'Ten minutes outside in the sling or carrier, talking about what you see.', 'Movement and fresh air settle most newborns; you get out too.', 'NHS; AAP', 120),
  ('nb_bw',        0,  42, 'Black and white cards',      'Prop a high-contrast card 25 cm from her face during a calm awake minute.', 'Her eyes see edges and contrast best at this age.', 'AAP HealthyChildren', 130),
  ('nb_bathtalk',  0,  42, 'Bath time talk',             'Name each part as you wash it: arm, tummy, toes. Same words each time.', 'Routine words at routine moments are how language starts.', 'NHS Start for Life', 140),
  ('nb_quiet',     0,  42, 'A quiet minute',             'Sit with her in a dim room, no toys, no talk, and let her look around.', 'Newborns tire fast; quiet looking is play too.', 'NHS', 150),
  -- 6 weeks to 3 months
  ('w6_wait',     42,  90, 'Wait for her turn',          'Say something, then pause and look at her until she moves or coos; answer that.', 'Turn-taking is the shape of every conversation she will ever have.', 'NHS Start for Life', 70),
  ('w6_rattle',   42,  90, 'Rattle to the side',         'Shake a soft rattle gently to one side, out of sight, and wait for her to turn.', 'Finding a sound with her eyes links hearing and looking.', 'AAP HealthyChildren', 80),
  ('w6_kick',     42,  90, 'Kick the blanket',           'Lay her on her back with a light blanket or crinkly paper under her feet.', 'Kicking against something teaches her that her legs do things.', 'NHS', 90),
  ('w6_dance',    42,  90, 'A slow dance',               'Hold her upright against you and sway to one song.', 'Rhythm and movement calm her and build head control.', 'AAP HealthyChildren', 100),
  ('w6_faces',    42,  90, 'Make faces',                 'Big surprised face, big smile, tongue out; wait for her to answer.', 'She is starting to smile back; faces are her favourite toy.', 'NHS Start for Life', 110),
  ('w6_pram',     42,  90, 'Look up in the pram',        'Pram walk under trees or along a wall of windows, hood down when the light is soft.', 'Moving patterns of light and leaves hold her attention.', 'NHS', 120),
  ('w6_names',    42,  90, 'Say her name',               'Say her name before you pick her up, feed her, or change her.', 'By three to four months she turns to her name if she has heard it often.', 'CDC milestones', 130),
  ('w6_hands',    42,  90, 'Hands in front',             'Hold her hands gently in front of her face so she can see them; let go.', 'Finding her hands is the step before reaching.', 'AAP HealthyChildren', 140),
  ('w6_sidelie',  42,  90, 'Side-lying play',            'Lay her on her side with a rolled towel behind her back and a toy in front for a minute or two, then the other side.', 'A break from back-lying that brings both hands together.', 'NHS', 150),
  ('w6_lullaby',  42,  90, 'The same lullaby',           'One song at every bedtime, the same one.', 'A sleep cue that works anywhere, with any carer.', 'NHS; Lullaby Trust', 160),
  -- 3 to 4 months
  ('m3_bubbles',  90, 120, 'Bubbles',                    'Blow bubbles slowly where she can watch them drift and pop.', 'Tracking slow-moving things and the surprise of the pop.', 'NHS Start for Life', 70),
  ('m3_towel',    90, 120, 'Towel roll under the chest', 'Tummy time with a rolled towel under her chest and arms forward, a toy in front.', 'Easier tummy time that gets the head up higher.', 'AAP: tummy time', 80),
  ('m3_bat',      90, 120, 'Swat the toy',               'Dangle a light toy within reach of her hands on her back; let her bat it.', 'Swiping comes before grasping.', 'CDC milestones', 90),
  ('m3_smell',    90, 120, 'What does it smell like',    'Let her smell a cut orange, a herb, your coffee, from a safe distance.', 'New smells are new information; she will show you what she thinks.', 'NHS', 100),
  ('m3_laugh',    90, 120, 'Make her laugh',             'A gentle raspberry on her tummy, a boo from behind a cloth, a silly noise.', 'First laughs come around now; find what works and repeat it.', 'CDC milestones', 110),
  ('m3_lap',      90, 120, 'Sitting on your lap',        'Sit her on your lap facing out, your hands round her ribs, and look at the room together.', 'Upright with support, she sees the world the way you do.', 'NHS Start for Life', 120),
  ('m3_cloth',    90, 120, 'Hold the muslin',            'Put a muslin in her hand and let her wave and mouth it.', 'A first thing to hold that cannot hurt her.', 'AAP HealthyChildren', 130),
  ('m3_counting', 90, 120, 'Count her toes',             'Count fingers and toes out loud, touching each one, the same rhyme every time.', 'Numbers, touch and rhythm in one.', 'NHS Start for Life', 140),
  ('m3_lights',   90, 120, 'Light and shadow',           'In a dim room, move a torch beam slowly on the wall or make hand shadows.', 'Tracking and the first idea that one thing makes another happen.', 'NHS', 150),
  -- 4 to 6 months
  ('m4_sitprop', 120, 180, 'Propped sitting',            'Sit her in the corner of the sofa or between your legs on the floor with cushions, toys in front, for a few minutes.', 'Practises the sitting balance she is working towards.', 'AAP HealthyChildren', 70),
  ('m4_feet',    120, 180, 'Find her feet',              'On her back, bring her feet up to her hands; socks with faces or bells help.', 'Grabbing feet rounds the back and stretches the hips, and leads to rolling.', 'NHS', 80),
  ('m4_tray',    120, 180, 'Water on the tray',          'A splash of water on the highchair tray or a shallow tray on the floor on her tummy; let her slap it.', 'Cause and effect and a new feeling on the hands.', 'NHS Start for Life', 90),
  ('m4_book',    120, 180, 'Cloth book',                 'A soft book with big pictures, her holding it, you naming what is there.', 'Pages, pictures and words together from the start.', 'AAP: Books Build Connections', 100),
  ('m4_roll',    120, 180, 'Roll to the toy',            'Put a toy just out of reach to her side on the floor and wait.', 'Reaching across the body is how rolling starts.', 'CDC milestones', 110),
  ('m4_sing',    120, 180, 'Action songs',               'Row the boat, wind the bobbin: move her arms gently to the words.', 'Rhythm, words and movement; she will start to anticipate the actions.', 'NHS Start for Life', 120),
  ('m4_sounds',  120, 180, 'Copy her sounds',            'When she says ah or ba, say it back and wait for more.', 'Being copied tells her that her sounds mean something.', 'CDC milestones', 130),
  ('m4_outside', 120, 180, 'Grass under the hands',      'A blanket on the grass, then her hands on the grass, leaves, bark.', 'Textures and outside air; a change of scene settles a fussy afternoon.', 'NHS', 140),
  ('m4_spoon',   120, 180, 'Hold a spoon',               'A soft spoon to hold and mouth before solids start.', 'A familiar spoon makes the first meals easier.', 'NHS weaning', 150),
  ('m4_passing', 120, 180, 'Pass hand to hand',          'Give her a small toy and offer a second to the same hand; watch her pass the first across.', 'Transferring between hands shows up around now.', 'CDC milestones', 160),
  -- 6 to 9 months
  ('m6_drop',    180, 270, 'Drop it in the box',         'Show her how to drop a block into a box, then hand her the block.', 'Letting go on purpose is a skill; so is doing it again and again.', 'AAP HealthyChildren', 80),
  ('m6_mess',    180, 270, 'Messy mealtimes',            'A spoon of yoghurt or mashed veg on the tray for her hands as well as her mouth.', 'Touching food is part of learning to eat it.', 'NHS weaning', 90),
  ('m6_name',    180, 270, 'Where is Mama',              'Ask "where is Mama?" and wait; then point and say "there she is".', 'Knowing names of people is the start of understanding words.', 'CDC milestones', 100),
  ('m6_pullup',  180, 270, 'Pull to sit',                'Hold her hands while she lies on her back and let her pull herself up to sitting.', 'Tummy and neck strength; she does the work.', 'NHS', 110),
  ('m6_tunnel',  180, 270, 'Through the tunnel',         'A big box open at both ends, or your legs as a bridge; toy at the far end.', 'Crawling practice with a reason.', 'AAP HealthyChildren', 120),
  ('m6_music',   180, 270, 'Pots and spoons',            'A wooden spoon and an upturned pot on the floor.', 'Banging is cause and effect with a loud reward.', 'NHS Start for Life', 130),
  ('m6_sand',    180, 270, 'Sand or oats tray',          'A tray of dry oats or sand on a mat, her sitting in it, a cup to fill.', 'Pouring and grabbing with both hands.', 'NHS', 140),
  ('m6_rhymes',  180, 270, 'Clap with the rhyme',        'Pat-a-cake with her hands in yours, then with her hands alone.', 'Clapping and gestures are coming; the rhyme gives them a shape.', 'CDC milestones', 150),
  ('m6_face',    180, 270, 'Point to your nose',         'Touch your nose and say nose; then hers. Eyes, mouth, ears.', 'Body words she will use for years.', 'NHS Start for Life', 160),
  ('m6_swing',   180, 270, 'Baby swing',                 'A gentle push in the baby swing at the park, once she sits steadily.', 'Balance, air and other children to watch.', 'AAP HealthyChildren', 170),
  ('m6_stand',   180, 270, 'Stand on your lap',          'Hold her under the arms and let her take her weight on your lap, bouncing if she likes.', 'Leg strength for standing and cruising.', 'NHS', 180),
  -- 9 to 12 months
  ('m9_nesting', 270, 365, 'Cups inside cups',           'A set of stacking cups to nest, knock over and bang together.', 'Sizes, order and cause and effect.', 'AAP HealthyChildren', 70),
  ('m9_bye',     270, 365, 'Bye bye, teddy',             'Hide teddy under a cloth while she watches; ask where he is; let her find him.', 'Things still exist when hidden; this is the age she works it out.', 'CDC milestones', 80),
  ('m9_push',    270, 365, 'Push the chair',             'A weighted laundry basket or a sturdy chair to push across the floor.', 'Walking practice with support she controls.', 'NHS', 90),
  ('m9_ball',    270, 365, 'Roll the ball',              'Sit facing her and roll a soft ball to her; wait for it to come back.', 'Taking turns, and the first throw.', 'NHS Start for Life', 100),
  ('m9_book',    270, 365, 'Lift the flap',              'A board book with flaps; let her lift them and name what is under.', 'Fine motor control and the joy of finding.', 'AAP: Books Build Connections', 110),
  ('m9_water',   270, 365, 'Bath pouring',               'Cups and a funnel in the bath, her pouring and you narrating: full, empty, splash.', 'Pouring, grasping, and a lot of words.', 'NHS', 120),
  ('m9_animals', 270, 365, 'Animal sounds',              'Pictures of animals and the noise each makes; wait for her to try.', 'Easy first sounds that are also first words.', 'NHS Start for Life', 130),
  ('m9_stairs',  270, 365, 'Up the stairs',              'Two or three stairs on hands and knees with you right behind her.', 'Climbing is crawling with a challenge; always with you there.', 'AAP HealthyChildren', 140),
  ('m9_dance',   270, 365, 'Dance to music',             'Put a song on and bounce, clap and sway with her.', 'Rhythm and copying you; she will start to dance on her own.', 'CDC milestones', 150),
  ('m9_help',    270, 365, 'Give it to me',              'Ask for the toy with your hand out; thank her; give it back.', 'Giving on request is a big step in understanding.', 'CDC milestones', 160),
  -- 12 to 18 months
  ('m12_books',  365, 548, 'Her choice of book',         'Two books on the floor; read the one she picks, as many times as she wants.', 'Choosing is new power; repetition is how she learns the words.', 'AAP: Books Build Connections', 70),
  ('m12_blocks', 365, 548, 'Tower of two',               'Stack one block on another and hand her the next.', 'Hand control and the idea of building.', 'CDC milestones', 80),
  ('m12_ball',   365, 548, 'Kick the ball',              'A soft ball on the floor; walk into it together and watch it roll.', 'Balance on one foot for a moment, then kicking.', 'NHS', 90),
  ('m12_brush',  365, 548, 'Brush her hair, brush teddy', 'Give her the hairbrush and ask her to brush teddy, then herself.', 'Pretend play and using things the way they are used.', 'CDC milestones', 100),
  ('m12_park',   365, 548, 'The park, on foot',          'Let her walk part of the way, holding one hand, and sit on the grass.', 'Walking on uneven ground is harder than the floor; good practice.', 'NHS Start for Life', 110),
  ('m12_bodyparts', 365, 548, 'Where is your nose',      'Ask her to point to her nose, eyes, tummy, feet.', 'By 18 months most point to at least one body part.', 'CDC milestones', 120),
  ('m12_tidy',   365, 548, 'Tidy-up song',               'Put the blocks in the box together with the same song each time.', 'Following instructions and a routine she can own.', 'NHS Start for Life', 130),
  ('m12_paint',  365, 548, 'Water painting',             'A pot of water and a fat brush on the patio or a big piece of card.', 'Mark-making with no mess.', 'NHS', 140),
  ('m12_puzzle', 365, 548, 'Peg puzzle',                 'A three-piece wooden puzzle with big pegs; hand her one piece at a time.', 'Shapes and the turning of the wrist.', 'AAP HealthyChildren', 150),
  ('m12_animals', 365, 548, 'Visit the animals',         'Ducks at the pond, a cat on the wall, the dog next door: name them and their sounds.', 'Real animals bring the picture-book words alive.', 'NHS Start for Life', 160),
  -- 18 to 24 months
  ('m18_two',    548, 730, 'Two words together',         'Add a word to hers: she says car, you say big car, red car, car gone.', 'Two-word phrases come from hearing her word stretched.', 'NHS Start for Life', 10),
  ('m18_cook',   548, 730, 'Stir the bowl',              'A bowl, a spoon and something safe to stir while you cook.', 'Doing what you do, and helping for real.', 'NHS', 20),
  ('m18_sort',   548, 730, 'Sort the socks',             'Pairs of socks in a pile; find the ones that match together.', 'Matching and sorting are early maths.', 'AAP HealthyChildren', 30),
  ('m18_run',    548, 730, 'Chase me',                   'A slow chase round the garden or the room, taking turns to be caught.', 'Running, stopping and turning; she will fall and get up.', 'CDC milestones', 40),
  ('m18_dress',  548, 730, 'Undress teddy',              'Teddy in a sock and a hat for her to take off, then put on.', 'Dressing skills start with undressing.', 'NHS Start for Life', 50),
  ('m18_crayon', 548, 730, 'Scribble with a story',      'Big paper, chunky crayons; she draws, you ask what it is and write it under.', 'Marks that mean something; the start of writing.', 'CDC milestones', 60),
  ('m18_feelings', 548, 730, 'Name the feeling',         'When she is cross or sad, say it: you are cross because the tower fell.', 'Words for feelings are the way out of tantrums.', 'NHS; AAP HealthyChildren', 70),
  ('m18_hide',   548, 730, 'Hide and seek',              'Hide behind a door, call her name; then let her hide while you count.', 'Turn-taking, listening and a lot of laughing.', 'NHS Start for Life', 80),
  ('m18_steps',  548, 730, 'Walk up the stairs',         'Up the stairs on her feet, holding the rail and your hand.', 'Big leg strength and balance.', 'CDC milestones', 90),
  ('m18_tea',    548, 730, 'Tea party',                  'Cups and a teapot for teddy and you; she pours and serves.', 'Pretend play with a story.', 'AAP HealthyChildren', 100),
  ('m18_playdough', 548, 730, 'Playdough',               'Home-made dough to squash, roll and poke, with a spoon and a cup.', 'Hand strength for everything that comes later.', 'NHS', 110),
  ('m18_songs',  548, 730, 'Finish the line',            'Sing a known song and stop before the last word; wait for her to say it.', 'Memory, rhyme and the confidence to speak up.', 'NHS Start for Life', 120),
  -- 2 to 3 years
  ('y2_jump',    730, 1095, 'Jump off the step',         'The bottom step, both feet, hands held, then not.', 'Jumping with both feet comes between two and three.', 'CDC milestones', 10),
  ('y2_shop',    730, 1095, 'Shopping helper',           'Give her two things to find in the shop and put in the basket.', 'Listening, remembering, and being useful.', 'NHS Start for Life', 20),
  ('y2_count',   730, 1095, 'Count the stairs',          'Count each step out loud going up; let her join in.', 'Number words in order, with a purpose.', 'NHS', 30),
  ('y2_story',   730, 1095, 'Tell the story back',       'After a favourite book, ask what happened first, then next.', 'Sequencing and the start of telling her own stories.', 'AAP: Books Build Connections', 40),
  ('y2_dressup', 730, 1095, 'Dressing up',               'A hat, a bag, your shoes: she becomes someone else.', 'Pretend play grows into stories with other children.', 'CDC milestones', 50),
  ('y2_scissors', 730, 1095, 'Snip with safety scissors', 'Strips of paper to snip with child scissors, you right beside her.', 'Hand control for drawing and, later, writing.', 'NHS', 60),
  ('y2_trike',   730, 1095, 'Pedal the trike',           'A trike or a balance bike on flat ground.', 'Pedalling and steering, usually by three.', 'CDC milestones', 70),
  ('y2_garden',  730, 1095, 'Plant a seed',              'A pot, soil, a bean, water each day; watch it grow.', 'Patience, care, and where food comes from.', 'NHS Start for Life', 80),
  ('y2_feelings', 730, 1095, 'Happy, sad, cross faces',  'Draw faces together and name the feelings; which one is she today?', 'Feeling words help her tell you instead of showing you.', 'AAP HealthyChildren', 90),
  ('y2_wash',    730, 1095, 'Wash her hands herself',    'A step at the sink, soap, a song for twenty seconds.', 'Self-care and a habit that lasts.', 'NHS', 100),
  ('y2_obstacle', 730, 1095, 'Obstacle course',          'Cushions to climb, a tunnel, a line to walk along, a box to jump off.', 'All the big movements in one game.', 'NHS Start for Life', 110),
  ('y2_question', 730, 1095, 'Why do you think',         'When she asks why, ask her what she thinks first; then answer.', 'Thinking out loud, and being taken seriously.', 'AAP HealthyChildren', 120)
on conflict (id) do nothing;
