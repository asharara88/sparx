-- The rows every home shares (modules, roles, play ideas, the helper's skills) were
-- written for the first family and named its child, mother and pet, or features since
-- removed (shopping requests, maintenance tickets: migration 4600). A new family read
-- them in their own app. Same meaning, no one's name, nothing that is gone. The ids
-- stay ("lana" is the module id and the entry types' prefix; no screen shows it).

update public.modules set label = 'The child''s log' where id = 'lana';

update public.roles set description = 'Logs and views the child, uses the calendar and the chat.' where id = 'family_carer';
update public.roles set description = 'Household staff: clocks in and out, sees today''s calendar and the chat.' where id = 'home_carer';
update public.roles set description = 'Logs and views the child only, can chat and ask the helper. Nothing else in the house.' where id = 'sitter';

update public.activities
   set how = 'Sit with her in front of a mirror and name what she sees: nose, hands, her own name.'
 where id = 'm4_mirror';

update public.assistant_skills set body = replace(body, '/lana/activities', '/baby/activities') where body like '%/lana/activities%';
update public.assistant_skills set triggers = array_remove(triggers, 'while dana') where 'while dana' = any(triggers);
