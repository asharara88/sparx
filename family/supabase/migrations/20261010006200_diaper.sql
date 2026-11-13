-- Diaper, never nappy (Mido, 13 November): every screen says diaper, so the helper's skills
-- and the play ideas do too. Whole words only ("snappy" stays), case kept. The illness skill
-- also wakes for "dry diapers" and "fewer diapers"; its nappy triggers stay, since people
-- still say nappy and the helper still understands it.

update public.assistant_skills
   set body = regexp_replace(regexp_replace(regexp_replace(regexp_replace(body,
                '\mNappies\M', 'Diapers', 'g'), '\mnappies\M', 'diapers', 'g'),
                '\mNappy\M', 'Diaper', 'g'), '\mnappy\M', 'diaper', 'g'),
       "when" = regexp_replace(regexp_replace(regexp_replace(regexp_replace("when",
                '\mNappies\M', 'Diapers', 'g'), '\mnappies\M', 'diapers', 'g'),
                '\mNappy\M', 'Diaper', 'g'), '\mnappy\M', 'diaper', 'g'),
       version = version + 1, updated_at = now()
 where body ~* '\mnapp(y|ies)\M' or "when" ~* '\mnapp(y|ies)\M';

update public.assistant_skills
   set triggers = triggers || array(select t from unnest(array['dry diapers', 'fewer diapers']) t where not t = any(triggers)),
       version = version + 1, updated_at = now()
 where id = 'illness' and not (triggers @> array['dry diapers', 'fewer diapers']);

update public.activities
   set title = regexp_replace(regexp_replace(regexp_replace(regexp_replace(title,
                 '\mNappies\M', 'Diapers', 'g'), '\mnappies\M', 'diapers', 'g'), '\mNappy\M', 'Diaper', 'g'), '\mnappy\M', 'diaper', 'g'),
       how   = regexp_replace(regexp_replace(regexp_replace(regexp_replace(how,
                 '\mNappies\M', 'Diapers', 'g'), '\mnappies\M', 'diapers', 'g'), '\mNappy\M', 'Diaper', 'g'), '\mnappy\M', 'diaper', 'g'),
       why   = regexp_replace(regexp_replace(regexp_replace(regexp_replace(why,
                 '\mNappies\M', 'Diapers', 'g'), '\mnappies\M', 'diapers', 'g'), '\mNappy\M', 'Diaper', 'g'), '\mnappy\M', 'diaper', 'g')
 where title ~* '\mnapp(y|ies)\M' or how ~* '\mnapp(y|ies)\M' or why ~* '\mnapp(y|ies)\M';
