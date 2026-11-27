# PR B: what PR A actually built (read with SPEC-v2.md; the code wins)

PR A is asharara88/sparx#158 (migration 20261010006800_family_day.sql). Where it differs from the
spec's text, PR B builds on the code, not on the spec:

## lib/day.ts as built
- `readDay(settings, ageDays, birthDate)`: three arguments everywhere.
- `dayFacts(summary | null, { now, today, tz, breastfeeds, inStock, week, pattern })`: the ONE place
  that reads home_summary into `DayFacts`. Every page calls it; do not write a facts object by hand.
  `DayFacts.has` is `{ meal, pump, potty, note? }` (Note fills a free slot only where the Note type is on).
  It already reads `lastPottyAt` from `summary.last["lana.potty"]` and `has.potty` from the types.
- `DayPlan` has one key the spec does not list: `diapers` (the answer in force; both and potty read
  as diapers under day 548 or without the Potty type; null with no day). Backfill and LogMenu read it.
- `suggestDay(ageDays, facts, pattern, saved, logged)` returns `DaySuggestion` = the four answers plus
  `from: "saved" | "log" | "age"`; `logged` is `loggedDays(week, today, tz)` or null from About.
- `dayOffer({ settings, birthDate, createdAt, today, tz, name, their })` returns `{ band, words, early }`.
- `pottyCount(entries)`: Wee and Poo only (for the strip and the tiles).
- `typesForDay(types, plan, { keep })` is the gate alone in PR A: with `keep` it returns every row
  given; otherwise `typesOn(types, plan.on)`. PR B adds the merged shape here (vessel, Cow's milk,
  which, eaten, the label "Milk", stash options left out where no milk is stored) and `firstMilkFor`.
  `typesOn` must stay the gate alone: the Entry types screen saves what it is given back to the
  shared row.
- `/baby/log/[type]` and `/members/types` build their plan with no log and no stock facts
  (`dayFacts({ types: stored, last: {} }, { ..., inStock: false, week: [] })`): when `typesForDay`
  starts reading `plan.storesMilk`, read it only where `plan.saved` (it is the stored answer then,
  not a guess from stock).

## Database as built (6800)
- `private.subject_day(settings, birth)`: null for null or infinite birth date; compares `v` as the
  JSON number 1 or the text "1"; the date as text with collate "C".
- `private.day_band(birth)`: null for null or infinite birth date.
- `home_summary`: `v_day`, `v_feed_clock`, `v_potty` exist; a type row whose `settings->>'needs'` is
  'potty' is listed only when `v_potty`. The join that labels today's entries is not gated, so a
  potty entry keeps its label in a home with potty off.
- `subject_day_save`: answers `bad_input` for both/potty while no active `lana.potty` row exists,
  `too_young_potty` under band 18. A save onto settings that are not an object replaces them.
- `milk_add` refuses with `no_stored_milk` while the day that counts says no milk is stored (added
  after Vercel's review). PR B's cup: a cup of cow's milk or formula never calls milk_consume or
  milk_add; nothing to change there.
- Suite: the 6800 section's potty checks are written to pass before and after the real row exists
  (they switch `lana.potty` off, or insert it `on conflict do update`, inside begin/rollback). Do not
  edit them; add PR B's section after it and extend the closing echo.
- The suite's test home: a home carer may view the child by the end of the run (rls_test.sql:1436),
  so a check that needs "Lilly may not view" must set that permission itself and put it back.

## Helper as built
- `ToolContext.types` (gated, for new entries and the prompt's list) and `ToolContext.allTypes`
  (as selected, for labels and edits of saved entries: care_now, propose_end_timer, entryById).
- `ChildNow` has `day` and `milkClock`. `propose_milk_add` refuses with the same words as SQL.
- `lib/push/cron.ts`: `napPushPattern` and `napPushNext` (the decision, tested).
- `lib/assistant/day-helper.test.ts` has its own stand-in (with `.is()` and `.maybeSingle()`); add
  PR B's helper cases there. `toddler-helper.test.ts`, the golden files and `toddler*.test.ts` stay
  unedited.

## Screens as built
- Home: `components/LanaNow.tsx` draws rows by key from `homeRows`; keys `potty` and `diaper_potty`
  exist in `RowKey` but have no row drawn yet (PR B). `milk` is the Feed row named "Milk".
- `/baby/day` + `components/DayForm.tsx`: the Diapers row has two answers; PR B makes it four
  (Diapers, Both, Potty, Not logged; chips) from day 548 where the Potty type exists.
- `scripts/ui-audit.mjs` holds `/baby/day` to 5 · 4 · 100 · 1.5.
- `scripts/walk/` (run.sh, db.sh, serve.sh, walk.cjs, judge.py): `DAYS=1` loads
  `supabase/tests/toddler_days.sql`; the judge knows noorcarer and noorsimple and treats Noor's own
  answers as hers. `scripts/day-scenario.mjs` is the pattern for a tap scenario with RPCs routed to
  the local database.
- `supabase/tests/toddler_days.sql`: Noor clock/2/diapers/stores milk (one bottle), Adam off/1/diapers,
  Maya drink/1/diapers with three bottles logged, Yusuf off/0/off; Mona (carer) and Salma (simple) in
  Noor's home. PR B moves Maya to both and Yusuf to potty, with cups, meals and potty entries.

## Known and left for later (do not fix in PR B unless the spec says so)
- A brand-new toddler home with nothing logged shows "— woke" and a zero nap count (main does too).
- The Pumping bar shows "0 / 400 ml" in a toddler home that stores milk and does not pump.
- `milk_add` and one other milk function are executable while signed out (they refuse inside).
- With a saved day the strip's meals cell takes two toddler Homes one or two numbers over 15.
