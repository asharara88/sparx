# Step 2 of the plan by age: the spec and what was built

Step 2 of `docs/AGES.md` ("The family's day") is built in two pull requests. The first half
(the day itself, migration 6800) is merged: asharara88/sparx#158. The second half (PR B) is not
built yet: Potty, Cup and Cow's milk, which meal and how much was eaten, the vaccine question,
and Story from the month a family joined.

- `SPEC.md`: the reviewed spec for both halves, as it stood when the first half was built (v2:
  v1 plus the 44 review findings that survived a second reading). Sections 1 to 4 and readers 1 to
  21 are the first half; PR B is sections 5, 6 and 7, the B parts of 8, 9 and 10, readers 22 to 28
  in section 2's table, the "Diapers or potty" row of the day screen (section 3) and the Potty
  choice in Backfill (reader 8).
- `BUILT.md`: what the first half actually built where it differs from the spec. The code wins.

## Read these first (27 November 2026)

- **Migration number.** The spec names PR B's migration 6900; #168 took that number
  (`kinder_runs`), and #169 took 7000 (`cheers_and_nights`). PR B's is
  `20261010007100_new_entries.sql`.
- **The suite and Home moved again in #169.** `rls_test.sql` gained a block "Cheers and shared
  nights" after the medals' checks; it sets the home carer's permissions itself and puts them
  back, so it does not lean on the state `BUILT.md` warns about. Home's notice slot gained two
  candidates for parents (the other parent's night, after "entries to check"; her own
  question, last but the pumping nudge): `DESIGN.md`, "Cheers and shared nights". A member
  row's account link can no longer be changed by a signed-in role (`members_keep_account`).
- **The screens moved on.** The spec was written against main 201d654. #159 to #168 redrew Home
  (the strip holds three counts, a More sheet), Feeds and Sleep (one day at a time), Week, Trends
  and the child's page, set new budgets in `DESIGN.md` and added the weekly speed check. The
  spec's line numbers and some screen details are out of date: for anything a person sees,
  `DESIGN.md` as it is now wins.
- **Live, read 26 November (select only).** Migrations to 6900 applied; no `lana.potty` row (13
  `lana.*` types, none with `settings.needs`); Lana's settings hold only `night_from` and
  `night_to`. Before PR B is marked ready, read again that no `lana.potty` row exists; if one has
  appeared, stop and ask Mido (spec, section 10).
- **Pinned, never edited:** `lib/fixtures/golden-baby.json`, `lib/golden-baby.test.ts`,
  `lib/fixtures/golden-calls.ts`, `lib/toddler.test.ts`, `lib/toddler-days.test.ts`,
  `lib/assistant/toddler-helper.test.ts`. New helper cases go in `lib/assistant/day-helper.test.ts`.
- **Tools the first half left in the repo:** `scripts/walk/` (the side-by-side walk the spec
  calls "the walk scripts"; `DAYS=1` loads `supabase/tests/toddler_days.sql`) and
  `scripts/day-scenario.mjs` (the pattern for a tap scenario).
- The spec's section 12 points to a `review.md` with each finding's evidence; it stayed in the
  building session's scratch folder and is not kept.
- Still open with Mido: who reads new health text (a paediatrician) before it ships.
