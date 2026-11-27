# Step 2, the family's day: spec v2 (v1 plus the 44 review findings that survived a second reading)

Paths are under `/home/user/sparx/family`. Checked against main at 201d654 (migrations to 6700, 808 suite checks). Line numbers are today's.

**Three rules everything below follows**

- A saved day counts only from day 366, only when it reads whole, and only when it was saved on or after the child's day 366 by the birth date stored now (`day.saved_on`, the home's date as text, on or after birth + 366 days). TypeScript (`readDay`) and SQL (`private.subject_day`) answer "no day" for a baby, for no birth date, for anything malformed and for a day saved under a birth date that was later moved. The save RPC refuses a baby.
- With no day, every deciding place gets today's answer from one function whose default branch is today's expression, moved and not rewritten.
- New things are off unless a day turns them on. Potty is the only new shared row and is left out of `home_summary.types` in SQL. Cup, Cow's milk, which meal and how much was eaten are defined in `lib/day.ts` and added only for a home with a day; the Feed and Meal rows are never updated.

## 1. Where the day is stored, who writes it, what absent means

**Store:** `public.care_subjects.settings` (jsonb), beside `night_from` and `night_to`. No new table or column, so the 6600 guard's column list is not touched; that guard already refuses any change to `settings` by a non-admin.

```json
{
  "night_from": "19:30", "night_to": "06:30",
  "day": { "v": 1, "milk": "clock|drink|off", "naps": 0, "diapers": "diapers|both|potty|off",
           "stores_milk": true, "saved_on": "2027-06-06", "saved_at": "2027-06-06T08:12:00Z", "saved_by": "<member uuid>" },
  "day_asked": 12, "day_asked_on": "2027-06-06",
  "vaccines": "had_all|other_card", "vaccines_on": "2027-06-06"
}
```

`naps` is the number 0, 1 or 2. `day_asked` is the last age band (12, 18, 24, 36) settled by Save or by "Keep it as it is". Bedtime and morning stay in the existing keys, which every reader already uses. `vaccines` arrives in PR B and is absent when not answered. `saved_on`, `day_asked_on` and `vaccines_on` are the home's calendar day (`YYYY-MM-DD`, text) on which the answer was given; they are compared as text and never cast.

**`public.subject_day_save(p_subject_id uuid, p_day jsonb default null, p_night_from text default null, p_night_to text default null) returns jsonb`**
plpgsql, `security invoker`, `set search_path = public` (as `subject_profile_save`, so row security and the guard hold it too). `revoke execute ... from public, anon; grant execute ... to authenticated, service_role`. Checks, in order:

1. `private.subject_module(p_subject_id)` is null: `{ok:false, error:'not_found'}`.
2. `private.read_only_preview()`: `{ok:false, error:'preview', message:'Not while viewing the app as someone else.'}`.
3. Not `public.has_permission(module,'edit')`: audit row (refused), `private.denied()`.
4. `select * into v_old ... for no key update` (logging does not wait on it); not found: `not_found`.
5. Not `private.is_admin()`: audit row, `private.denied('Ask ' || private.admin_names() || ' to change ' || v_old.name || '''s day.')`.
6. No birth date: `no_birth_date`, "Add the date of birth first, on Doctor." `private.day_band(birth_date)` is null: `too_young`, "{Name}'s day opens at 12 months."
7. `p_day` null ("Keep it as it is"): both night arguments must be null, else `bad_input`. Only `day_asked` (the band) and `day_asked_on` (the home's date as text) are set. Audit, return `{ok:true, asked}`.
8. Shape, else `bad_input` ("That is not one of the answers."): `p_day` an object; `milk` in clock, drink, off; `p_day->'naps' in ('0'::jsonb, '1'::jsonb, '2'::jsonb)` (jsonb numbers compare by value: 1.0 passes; 1.5, 3, 99999999999 and "1" do not; it is stored as `(p_day->>'naps')::numeric::int`, never through a cast that can raise); `diapers` in diapers, both, potty, off; `jsonb_typeof(p_day->'stores_milk') = 'boolean'`.
9. `both` or `potty`: band under 18 gives `too_young_potty`, "Potty is offered from 18 months."; no active row `module || '.potty'` in `care_entry_types` gives `bad_input` (so PR A's database refuses it until PR B brings the row).
10. `stores_milk` false while a bottle is in stock (`exists (select 1 from public.milk_bottles b where b.used_at is null and b.deleted_at is null and private.milk_expires_at(b) >= now())`, the rule behind `milk_list`'s `fridge_count + freezer_count`, adopt.sql:271-279; "in stock" means not used, not binned and not past its time everywhere in this spec, as page.tsx:145 has it. Check the signed-in role may execute `private.milk_expires_at`; if not, write the same test inline): `milk_in_stock`, "Use or bin the bottles on Milk first."
11. Each time given must match `^([01]\d|2[0-3]):[0-5]\d$`; bedtime 17:00 to 23:45, morning 04:00 to 10:00; else `bad_time`. `care_daily_stats` casts the stored text to `time` and builds the night as "day + bedtime to next day + morning" (care_stats.sql:18-28), so the window must cross midnight. Null keeps what is stored.
12. Write `settings = coalesce(settings,'{}') || night keys given || {day: {v:1, the four checked answers, saved_on: the home's date as text, saved_at: now(), saved_by: current_member_id()}, day_asked: band, day_asked_on: the home's date as text}`, `updated_at = now()`. The day is rebuilt from the checked values; nothing the client sent is stored as sent; every other key is kept. `if not found then return private.denied()`.
13. Audit row; return `{ok:true, day, night_from, night_to, asked}`.

**Helpers** (sql, stable, invoker; `revoke ... from public, anon; grant ... to authenticated, service_role, app_rls`):

- `private.day_band(p_birth date) returns integer`: 12, 18, 24, 36 or null, on the home's calendar with the 30.4375 constant, as `is_toddler` counts. Edges at days 366, 548, 731, 1096, the days `stageOf().band` flips.
- `private.subject_day(p_settings jsonb, p_birth date) returns jsonb`: `p_settings->'day'` when all of these hold, else null: `private.is_toddler(p_birth)`; it is an object and `->>'v' = '1'`; `milk` is clock, drink or off; `naps` is the jsonb number 0, 1 or 2; `diapers` is diapers, both, potty or off; `stores_milk` is a jsonb boolean; `saved_on` matches `^\d{4}-\d{2}-\d{2}$` and, as text, is `>= (p_birth + 366)::text`. No stored text is ever cast (a cast could raise inside `me()`). The one SQL definition of "a day counts"; `readDay` applies exactly the same tests, so the two sides never disagree about a home.
- PR B: `private.subject_vaccines(p_settings jsonb, p_birth date) returns text`: `p_settings->>'vaccines'` when `private.is_toddler(p_birth)`, the value is had_all or other_card, and `vaccines_on` matches the date pattern and, as text, is `>= (p_birth + 366)::text`; else null.

No definer function is added in this step, so the suite's two owner lists and the "no app_rls function names the auth schema" check need no new entry.

**Absent means today.** No `day` key, `v` other than 1, a missing or bad answer, a child under day 366 or no birth date: no day, and every reader does exactly what main does. `both` or `potty` under day 548 (only a corrected birth date gets there) reads as `diapers`. An answer counts only if the child, by the birth date stored now, had reached its age on the day it was given. A day saved under a birth date that was later moved back (a mistyped year at sign-up) never comes into force by itself; `day_asked` is read as 0 unless `day_asked_on` is on or after the first day of that band (birth + 366, 548, 731 or 1096 days), so the offer comes at the true day 366; a vaccine answer is read the same way through `vaccines_on` (section 6). The bedtime and morning saved with such a day stay in force (they are the home's night keys, read at every age, and the family's own words) and can be changed again from day 366 (section 9, item 3). The four test toddler homes and Lana after 6 June 2027 keep step 1's Home until a parent saves.

**No stored milk means nothing new goes into the stash (PR A).** While the day that counts says `stores_milk` false: the helper's `propose_milk_add` (lib/assistant/tools.ts) answers `{error:'no_stored_milk', message:"{Name}'s day says no milk is stored. A parent turns it on in {Name}'s day."}` (the tool stays in the list, so a baby's tool list and the golden lines do not move); `/baby/milk` shows that line in place of MilkPutAway and MilkScan, as a link to `/baby/day` for an admin and as "Ask {admin names}" for anyone else. `propose_milk_move` and the stash list stay, so a bag already there can be used or binned. An older cached build can still put a bottle away; the next save of the day then finds stock, does not ask, and sends `stores_milk` true.

## 2. One pure function, and who reads it

New file `lib/day.ts`: pure, relative `.ts` imports only, never a "use client" file.

```ts
type Band = 12 | 18 | 24 | 36
interface SavedDay { v: 1; milk: "clock"|"drink"|"off"; naps: 0|1|2; diapers: "diapers"|"both"|"potty"|"off"; stores_milk: boolean }
bandOf(ageDays: number | null): Band | null
readDay(settings: unknown, ageDays: number | null, birthDate: string | null): SavedDay | null   // every reader below passes the birth date too
dayPlan(day: SavedDay | null, ageDays: number | null, f: DayFacts): DayPlan
homeRows(day, ageDays, f: Pick<DayFacts,"now"|"has"|"breastfeeds"|"lastPumpAt">): RowKey[]   // dayPlan().rows is this; LanaNow calls it on the phone's clock
milkTab(day: unknown): boolean                                                                // Nav: false only when a readable day says stores_milk false
suggestDay(ageDays: number, f: DayFacts, pattern: NapPattern, saved: SavedDay | null): the four answers
dayOffer(c: { settings: unknown; birthDate: string | null; createdAt: string; today: string; tz: string; name: string; their: string }): { band: Band; words: string } | null
typesForDay(types: EntryType[], plan: Pick<DayPlan,"saved"|"milk"|"storesMilk"|"on">, opts?: { keep?: Record<string, unknown> }): EntryType[]
typesOn(types: EntryType[], on: DayPlan["on"]): EntryType[]                                   // the gate only: the same objects, less a needs row that is off (the Entry types screen)
firstMilkFor(...): string | null                                                              // PR B, section 5: the milk a sheet starts on
```

`DayFacts`: `now`, `today`, `tz`, `has {meal, pump, potty}` (the type is in the home's list), `breastfeeds` (the viewer), `lastPumpAt`, `inStock`, `lastFeedAt`, `lastDiaperAt`, `lastMealAt`, `lastPottyAt` (`summary.last["lana.potty"]`), `breastLately` (a breastfeed in the last 7 days), `napExpected`, `napsToday`. "Logged lately" below is `loggedLately(at, today, tz)`: any entry in the last 7 calendar days.

| `DayPlan` key | No day (today's rule, moved) | A day |
|---|---|---|
| `saved`, `milk` | false, null | true, the answer |
| `milkClock` | `!isToddler(age)` | `milk === "clock"` and a feed logged lately: a family on a clock that stopped logging milk gets no "Feed due now" from last week |
| `storesMilk` (the Milk tab, `on.pump`, the sheet's stash options) | `!toddler \|\| inStock \|\| pumpingActive(lastPumpAt, now, age)` (page.tsx:150) | `stores_milk` |
| `milkNotices` (thaw, fridge low, the fridge plan, the countdown, `keep`, the helper's "milk kept") | the same expression as `storesMilk`'s (page.tsx:150) | `stores_milk && (inStock \|\| pumpingActive(lastPumpAt, now, age))`: the notices stop 14 days after the last pump with nothing in stock, as they do with no day |
| `rows` (four) | feed, sleep, diaper, then `solids && has.meal ? meal : breastfeeds && has.pump && pumpingActive(...) ? pump : meds` (LanaNow.tsx:359) | slot 1 `meal` (only with `has.meal`; else it is a slot not used); slot 2 sleep; slot 3 `diaper`, `diaper_potty` (both) or `potty`, each needing `has.potty`, else `diaper`; slot 4 `feed` (clock) or `milk` (drink). A slot not used (diapers off, milk off) takes `meds`, then `note`, in slot order |
| `cells` (strip) | null: `stripCells` decides as today | first four of woke; naps (`naps > 0` or one had today); feeds (`milkClock` only: a drink has no count); diapers (diapers or both, and a diaper logged lately); potty (both or potty, and a potty entry logged lately; it counts Wee and Poo only, from today's entries, over the word "potty"); meals (a meal logged lately). An answer turns a kind on; a count still needs that kind logged lately, so saving the suggested day never brings back a zero. Fewer than two: no strip |
| `tiles` | null: DayStrip's four as today | first four of sleep; breastfeeds (clock, with `breastLately`) and bottles (clock), or one `milk` tile (drink, with a feed logged lately: the day's ml when any was measured, else the number of milk entries, over the word "milk"); diapers (logged lately); potty (logged lately; Wee and Poo only, over "potty"); meals (logged lately) |
| `kinds` (Home's "since Mama left") | today's `lately()` and nap rule (page.tsx:178-179) | feeds: `milkClock`, or drink with a feed logged lately; diapers: diapers or both with a diaper logged lately; naps: `naps > 0` or had today |
| `feedCard` | null: `feedCard` decides as today | `{show: milkClock, or drink with a feed logged lately; clock: milkClock}` |
| `napsSaid`, `usualNaps` | null, null (`stage.naps`) | `naps`; `[0,1]` for none (so `napsLine` says "no nap", never "yet"), else `[n,n]` |
| `on` | potty false, extras false, pump true | potty: both or potty, from day 548, with `has.potty`; extras true; pump: `stores_milk` |

The naps answer goes through the one existing nap rule: `napPattern(entries, ageDays, nowMs, tz, fromMs, said?: 0|1|2|null)` gains an optional sixth argument. It is not read for a baby. For a toddler with an answer: `expected = said > 0`, `perDay = usualNaps = said`, and `said: true` on the result; the counts still come from the log.

**Golden-pinned signatures stay as they are** (all called through `lib/fixtures/golden-calls.ts`, which this step does not edit): `stageOf`, `awakeWindow`, `feedLateMin`, `stageFor`, `feedGapFor`, `napsLine`, `pumpingActive`, `ageInDays`, `normsForAge`, `checkDay`, `tipsFor`, `topicsFor`, `checkEntries(entries, {now, ageDays})`, `sleepCoach`, `nextNap`, `napPattern` with five arguments, `napWindow`, `forecast`, `nextFeedAt`, `shortFeedHint`, `formatSituation`, `formatMilk`, `readQuick`, `readDiaperAnswer`, `volatileSystem`, `stableSystem`, `loadSituation`, `loadContext`, `buildTools`. Inside the helper's paths: no wall clock, no `Math.random`, and only `from().select().eq().order()` and `rpc()` (the stand-in knows nothing else). A column the stand-in does not have reads as undefined and an rpc it does not know as null; both must mean "no day". A type row may have no `settings` at all (the stand-in in `toddler-helper.test.ts` has none): read `t.settings?.needs`; absent means no needs, so that file passes unedited.

**Every place that stops deciding on its own**

| # | PR | Place | Reads |
|---|---|---|---|
| 1 | A | `components/LanaNow.tsx`: `fourth` (359) and the row JSX (390-404) | `homeRows(readDay(subject.settings, age), age, ...)` on `clock`; rows drawn by key. `milk` is the Feed row named "Milk"; `meds` and `note` are link rows |
| 2 | A | `app/(app)/page.tsx` HomePage: `milkClock` (119, used at 133, 185, 187, 203, 298), `milkStored` (150), `showPump` (147), `keep` (159), `pattern` (175), `handoverKinds` (179), `fridgeLow` (215), `known` (216), the props of TodayStrip, SleepDay (301), FeedDay, LogMenu | one `dayPlan`, built once. `showPump = (breastfeeds \|\| admin) && (plan.saved ? plan.storesMilk : pumping \|\| inStock)`; `keep` only where `plan.milkNotices`; `napPattern(..., day?.naps)`. Lines 185, 186, 215 and 216 take `plan.milkNotices`, and the fridge-plan candidate (187) is `milkOk && mamaAway && plan.milkNotices` with `milkClock={plan.milkClock}`: a home on a clock that stores no milk gets no "Until {name} is back" card. With no day both keys equal today's expression |
| 3 | A | `components/TodayStrip.tsx` into `lib/logged.ts stripCells` | new optional key `plan {cells, usualNaps, meals, potty}`; absent is today |
| 4 | A | `components/FeedDay.tsx` into `lib/logged.ts feedCard` | new optional key `day {show, clock}`. A clock toddler gets the baby's headline ("Feed due now", "Next feed about 15:10") with `usual: null`. Title "Milk today" when milk is a drink |
| 5 | A | `components/DayStrip.tsx` tiles (55-60), caller `baby/page.tsx` TodayTab:119 | new optional prop `tiles` |
| 6 | A | `components/Nav.tsx:52,62` | `milkTab(child(me)?.day)`. With no Milk tab `/baby/milk` lights the child's tab |
| 7 | A | `components/LogMenu.tsx:63` | the types it is given are gated already; also no Pump when `!plan.on.pump`. Feed and Diaper stay, so nothing is ever unreachable. Its meal rule stays |
| 8 | A | `components/Backfill.tsx` choices (35-43), nudge (64-73) | no Bottle or Breastfeed when milk is off, no Diaper when diapers are potty or off, no Pump when `!on.pump`; `milkClock` from the plan. PR B: where `plan.on.potty` it gains a Potty choice (not lasting; the type's `kind` options as chips; Save waits for a kind), so a potty home's "Add to this day" holds what the family logs |
| 9 | A | `app/(app)/baby/page.tsx`: TodayTab 119, 120, 138; WeekTab 167, 201-214; AboutTab | `plan.tiles`, `plan.usualNaps ?? stage.naps`, `plan.milkClock`, `napPattern(..., day?.naps)`; the new About row |
| 10 | A | `components/LanaForecast.tsx` | new prop `only={["feed"]}` for a clock toddler (diaper, nap and wake keep no clock). `forecast()` is not touched |
| 11 | A | `app/(app)/baby/sleep/page.tsx:53`, `baby/feed/page.tsx` | `plan.usualNaps`, also for the fold's hint at sleep/page.tsx:67 (`plan.usualNaps ?? stage.naps`; left out when the answer is none); FeedDay as in 4 |
| 12 | A | `app/(app)/baby/milk/page.tsx:69,79` | `plan.milkNotices` for the notices (lines 79, 80, 82, 87), with `away && plan.milkNotices && <FridgePlan>`; `plan.milkClock`; section 1's no-stored-milk line in place of MilkPutAway and MilkScan |
| 13 | A | `components/SimpleHome.tsx:85` (hungry hint), `:115` (fridge line) | `plan.milkClock`, `plan.milkNotices`. Buttons, counts and words stay (step 3) |
| 14 | A | `lib/push/cron.ts` nap push (about 316-341) | `napPattern(entries, age, now, tz, from, readDay(sum.subject.settings, age)?.naps ?? null)` |
| 15 | A | `lib/assistant/tools.ts`: `loadContext` (1450-1452), `childNow` (1421), `milkKeptIn` (1438) | the select adds `settings`; `ChildNow` gains `day` and `milkClock`; naps through the answer; milk kept follows `milkNotices`' rule when a day says so; `ChildNow.milkClock` follows the plan's rule from its own `lately` list (no new read); `ctx.types = typesForDay(...)` for the prompt's list and `propose_care_entry`, while the list as selected is kept as `ctx.allTypes` (no new query, so the golden stand-in is untouched) for labels and edits of saved entries (tools.ts:309, :950) |
| 16 | A | `lib/assistant/tools.ts`: `careNow` 306-307, `dueSoon` 414-417 | `noClock` leaves the feed alone when `milkClock`; the "Next feed due" note for any child with a clock; at tools.ts:763, when the pattern has `said` and the answer is none, the note is 'No nap planned: the family says no nap.' (else today's words); `propose_milk_add` refuses as section 1 says |
| 17 | A | `lib/assistant/situation.ts:98`, `situation-format.ts formatToddler` | `kid.milkClock` in place of `!kid.toddler`; new optional input `milkClock`; the toddler's feed line ends ", next due about HH:MM" only when `milkClock`, `nextFeedDue` is set and the due stamp's date is the date of `nowLocal` or later (a time earlier today still prints, as on the baby's line; a due time from an earlier day prints nothing). It must not key on `nextFeedDue` alone: the existing test at `toddler-helper.test.ts:197` passes one and expects no such words |
| 18 | A | `lib/assistant/prompt.ts`: rule 6, `toddlerStage` | for a toddler who keeps the clock, the sentence "From 12 months milk feeds have no due time: never give a time for the next one." and the stage line's clause "and no gap between feeds" are left out (taken away only). when the pattern has `said`, `napsLately` returns 'the family says 2 naps a day', 'the family says 1 nap a day' or 'the family says no nap', tested before the evidence-days return (so also with nothing logged); without `said` it is today's function |
| 19 | A | SQL `public.home_summary` | `next_due` for `lana.feed` when the day says clock; `types` without a row whose `settings.needs` the day has not turned on |
| 20 | A | SQL `private.subject_names` | new key `day`: `case when public.has_permission(s.module_id, 'view') then private.subject_day(s.settings, s.birth_date) end` (a member who may not view the child gets null) |
| 21 | A | `app/(app)/baby/log/[type]/page.tsx:20`, `app/(app)/members/types/page.tsx:17` | the log form: `typesForDay`, and a kind the home has not turned on goes back to `/baby`. The Entry types screen gets the stored rows as read, less a row whose `settings.needs` is off, through the gate-only `typesOn`: the merged shape from `typesForDay` must never reach `EntryTypesAdmin` or `entry_type_save`, which would write it back to the shared row for every home. The page also hands the form the keys the gate hid, and the form refuses one of them with "That key is taken." In PR A so the gate is live before the row exists |
| 22 | B | `components/LanaNow.tsx` sheets; `components/EntryEdit.tsx:23`; `EntryList` to `EntrySheet` | section 5; `typesForDay(..., {keep: entry.payload})` on edit |
| 23 | B | `lib/assistant/quick-context.ts`, `components/Assistant.tsx` (where `readQuick`'s answer is used, about 351) | `QuickContext.potty` ('both', 'potty' or null). One pure function in `lib/assistant` decides what the phone does with a `readQuick` diaper reading whose words hold no "diaper" or "nappy": null: today's result for every phrase; 'both': the existing choice card asks "Diaper or potty?" (Diaper goes on exactly as today; Potty saves a Potty entry, Poo for a dirty reading and Wee for a wet one, through the same card, queue and Undo); 'potty': the Potty card at once. No model call; `readQuick` and `readDiaperAnswer` keep their signatures |
| 24 | B | `lib/assistant/prompt.ts` rule 7 | one sentence more, only when `ctx.types` holds a potty type |
| 25 | B | `lib/entry-checks.ts` `showsAwake` (85), rule 5; `lib/milk-take.ts milkSource`; `lib/time.ts entryDetail`, `describePayload`; `lib/tints.ts`; `components/Icon.tsx` | section 5 |
| 26 | B | SQL `vaccines_list`, `care_due_list`; `VaccineBook`, `vaccines/page.tsx`, `export/page.tsx:45,158` | section 6 |
| 27 | B | `story/page.tsx:21`, `story/[month]/page.tsx:38`, `lib/assistant/brief.ts getStory` | section 7 |
| 28 | B | `app/(app)/page.tsx:152` `firstMilk`, `components/LanaNow.tsx:88` | with a day, `firstMilkFor` (section 5); with no day line 152 stays exactly as it is |

`care_due_list`'s interval rows are left alone: no screen reads a feed's (the calendar keeps treatment and vaccine rows, `due_soon` drops every feed row, suggestions keep treatments).

**Left to step 3:** the simple screen's spoken line, counts and buttons; `/baby/handover` and `HandoverPanel`; the Week tab's "against her age" and "day by day"; Trends; Story's numbers; the printout's counts; `brief.ts loggedKinds` and `pumping()`; the snapshot line "Usual day lately (N days)" (situation-format.ts:68, :109); the shortcut's Diaper button; a running feed in a home with milk not logged; free typed meal, cup and potty lines; Arabic and Russian words for the new answers; `care_daily_stats` counts for meals, cups and potty (a cup counts with bottles until then).

## 3. The screen "{Name}'s day"

Route `/baby/day`: server page `app/(app)/baby/day/page.tsx` plus `components/DayForm.tsx` (client; exports only the component; every rule it needs is in `lib/day.ts`). The page reads `home_summary`, `milk_list` and 7 days of `care_entries_list`, and calls `suggestDay`. No model call. The helper's button is not on it (add the route to `HelperFab`'s list).

**Who sees it.** An admin (`me.role.id === "admin"`, as ChildCard) of a child of 12 months or more, not in view-as. Anyone else who opens the address goes to `/baby?tab=about`; the database refuses them too. Reached from About her (a new first row of the Care group, "{Name}'s day", with the plain pill "look" while an offer is open), from Home's line, and after sign-up.

**Layout** (the log form's pattern; nothing new): PageHeader with the title alone and back to About her; one white card with a row per question; two or three answers as a segmented control, four as chips; "Save" as the bottom button. Targets for ui-audit (add `/baby/day` to `ALL` in `scripts/ui-audit.mjs`): at most 5 blocks, 4 numbers, 100 words, 1.5 screens, every phone check zero.

| Row | Answers | Line under the chosen one |
|---|---|---|
| Milk | A drink · On a clock · Not logged (segmented) | "Milk is logged. Nothing is due." / "Home says when the next feed is due." / "No milk row on Home." |
| Naps a day | Two · One · None (segmented) | None: "No nap window and no nap reminder." |
| Diapers (under 18 months) | Diapers · Not logged (segmented) | |
| Diapers or potty (from day 548; PR B) | Diapers · Both · Potty · Not logged (chips) | |
| Bedtime, Morning | two `input type="time" step="900"`, 17:00 to 23:45 and 04:00 to 10:00 | "Sleep between these is the night, on past days too." |
| Stored milk | Yes · No (segmented). With bottles in stock (`fridge_count + freezer_count > 0`) it is not asked: the line "Stored milk: 4 bottles in Milk." links to `/baby/milk` and the form sends true | Yes: "Pumped milk in the fridge or freezer." No: "No Milk tab and no Pump in the + menu." |

One line under the title, only when the answers are a suggestion: at sign-up "A start for 13 months. Change what is different."; from an offer "From the last week. Change what is different." (or the by-age line with no log).

**Filled in** (`suggestDay`). With a day saved, every answer starts from the saved one, from About her and from an offer alike; from an offer the log may move an answer only when 3 or more of the last 7 days have entries, and Stored milk saved Yes is never pre-set to No. The table below is for a home with no day (sign-up, or an offer with no day): from the log where it says something, else by age. From an offer with a saved day and no log, the line under the title is left out (nothing was suggested).

| Answer | From the log (3 or more of the last 7 days have entries) | No log: 12 / 18 / 24 / 36 months |
|---|---|---|
| Milk | a feed in 7 days: the saved answer if it is clock or drink, else A drink; none: Not logged | A drink at every age. Never pre-set to On a clock |
| Naps | `napPattern(...)` without `said`: two, one, or None when no nap is expected | Two (One from 15 months) / One / One / None: the rule Home already uses |
| Diapers | diaper and potty in 7 days: Both; one of them: that one; neither: Not logged | Diapers / Diapers / Diapers / Not logged. Potty is never filled in unless logged |
| Stored milk | Yes with a bottle in stock or a pump in 14 days | No |
| Bedtime, Morning | the stored times | the stored times (19:00 and 07:00 in a new home). Not worked out from the log: a guessed time saved unseen would re-split past days |

**Bedtime and morning.** `care_daily_stats` reads the window when asked, so a save re-splits night sleep, naps and night feeds on every past day shown on Week, Trends, Story, the printout and the helper's "last night"; nothing stored is rewritten and saving the old times puts them back. It also moves the night screen's hours, the night-wake rule in LanaNow and the strip's "woke". The line under the boxes says so; no confirm.

**Buttons.** "Save" calls `subject_day_save`, then `window.location.assign("/")` so `me()`, the tab bar and the night screen follow. Above Save, a plain link: from an offer "Keep it as it is" (`subject_day_save(id, null)`, then Home; it settles the offer for both parents); at sign-up "Later" (no write; Home). A refusal shows the RPC's message in the card.

## 4. Sign-up, and the offer at 12, 18, 24 and 36 months

**Sign-up.** `household_create` is not touched. In `components/CreateHome.tsx submit()`, after `ok`, when `isToddler(ageInDays(born, Date.now(), tz))` the form does `window.location.assign("/baby/day?first=1")` in place of the refresh, and in the second-home branch after the switch. The screen opens filled in by age. Closing the app there loses nothing: the home runs with no day, as step 1 left it, and Home shows the line below.

**The offer** (`dayOffer`, admins only, never in view-as or on the simple screen, which returns first at page.tsx:110). It is pending when the child's band is above `settings.day_asked` (0 when absent, and 0 unless `day_asked_on` is on or after that band's first day by the birth date stored now), for 30 days from the later of the band's first day (birth + 366, 548, 731, 1096 days) and the day the child's row was made. After that it ends by itself; the About row stays.

- Words: "Lana is one. Look at her day", "Adam is 18 months. Look at his day", "Maya is two. Look at her day", "Yusuf is three. Look at his day". For a family that joined after the band began: "Set up Noor's day".
- Place: one more candidate in Home's `.now-queue` (`app/(app)/page.tsx`), a plain `.notice` link to `/baby/day?offer=1` with no tint, counted in `known`. For its first 7 days it sits after "entries to check" and before "A vaccine is due": the 12-month visit is due the same weeks, and behind it the line would sit unseen as "+1" (which opens the child's page, where the line is not). From day 8 to day 30 it sits after "A vaccine is due", so a due vaccine never waits behind a settings line for more than a week. `dayOffer` returns `{band, words, early}`; `early` is true on days 1 to 7. "Vaccine overdue" is always ahead of it. Save or "Keep it as it is" clears it in one tap. DESIGN.md gains this order with its reason.
- No new block, no push, no model call.
- Remembered per child: Save or "Keep it as it is" sets `day_asked` to the band, for both parents. A day saved at 17 months still brings the 18-month line, when potty joins the questions. From an offer the form is filled in from the log again, so a nap answer that went stale is corrected there.

**With the birthday push.** `lib/push/cron.ts:200-220` is not touched. On day 365 Lana's family gets "Lana is 12 months old today" with the Story link, to everyone who sees the log. The Home line starts on day 366, for admins only: another day, another surface, no second push.

## 5. New entries (PR B)

**Why a cup is not a third method.** About twenty places and three SQL functions split feeds into Bottle and Breast; `show_if` hides milk and amount for anything but Bottle; `isTimer` (entry-checks.ts:72) treats anything but Bottle as a timer. A cup is stored as `{method:"Bottle", vessel:"Cup", milk?, amount_ml?}`: never a timer, right in `feed_fullness`, the stash and every old build. `care_entry_log` does not check a payload against `fields`, so it saves as it is.

**Where the new answers live.** In `lib/day.ts`, added by `typesForDay` only when `plan.saved`:

- Feed: field `vessel` ("Bottle or cup": Bottle, Cup; `show_if` method Bottle). "Cow's milk" joins the milk options (first when milk is a drink, else last). In a home that stores no milk, the options that would take from the stash (`milkSource(...)` not null) are left out. The label reads "Milk" when milk is a drink.
- Meal: fields `which` ("Which meal": Breakfast, Lunch, Dinner, Snack) and `eaten` ("How much was eaten": All, Most, Some, None), both optional and `fresh`; the baby's `amount` left out; `food` not required.
- `opts.keep` (an entry being edited): a field or option the entry already holds stays, so an old `amount` or a cup is never lost on edit; and the entry's own type row is always kept, the `needs` gate included.
- **A type that an existing entry has is never dropped; the gate is for new entries only.** EntryEdit keeps the row it reads by id and runs it through `typesForDay` with `keep`; the helper labels and edits saved entries through `ctx.allTypes` (reader 15). A family that tried Potty for a month and went back to Diapers can still open, read and correct every old potty entry.
- In PR A `typesForDay` only leaves out a row whose `settings.needs` is not on and returns every other object as given. The added fields and options (vessel, Cow's milk, which, eaten), the label "Milk" and the removal of stash options arrive in PR B together with reader 25.

**The milk a sheet starts on** (`firstMilkFor`, pure, in `lib/day.ts`; reader 28). With a day, in order: the last feed's milk when it is one of the day's options; "Cow's milk" when milk is a drink; today's `defaultMilk` answer when it is one of the day's options (so a clock home that stores milk starts as a baby's does); else none. A milk that is not among the options `typesForDay` returned is never put in a payload, whatever the state holds: a home that once pumped and now stores no milk must never save "Morning pumped" from a chip that is not on screen. With no day `defaultMilk` is called as today.
- With no day: the same objects as given, less any row whose `settings.needs` is not on. A baby's forms are today's.

**Potty.** A new shared row `lana.potty`: label "Potty", icon 🚽, sort 22, `has_end` false, `due_after_min` null (a gap would make a next_due and a due row in every home), one required field `kind` ("What": Wee, Poo, Tried, Accident), `settings {"needs":"potty"}`. `entry_type_save` never writes `settings`, so the gate cannot be lost on the Entry types screen.

- Out of `home_summary.types` unless the day says both or potty from 18 months: that covers the + menu, Home and the edit sheets, old builds included.
- Out of the helper's type list, prompt and `propose_care_entry` (`typesForDay` in `loadContext`), `/baby/log/potty` (redirect) and the Entry types screen (reader 21).
- `care_entry_log` is not gated: a tap kept on a phone always saves. A potty entry already in the log always lists; `EntrySheet` given no type must still open with its time, Delete and "All details", and All details opens the entry's own form, by the rule above (check both).
- `lib/tints.ts`: potty takes the diaper's sky tint; a new line icon `potty` in `components/Icon.tsx`. No new colour token.

**Home's rows and sheets (LanaNow)**

- **Milk** (drink): the feed's icon and tint, name "Milk", sub as today's or "Cup or bottle". Sheet "Milk": When; Cup · Bottle · Breast (Breast for the member who breastfeeds) as a segmented control, opening on the last one used; the milk chips; the amount chips and "Not measured". One tap saves: "Cup 150 ml saved.", "Cup saved." The clock's row stays "Feed" and its sheet gains Cup the same way. With no day the control stays the hard-coded Breast · Bottle.
- **Potty** (day on potty): sub "40 min ago · wee", else "Wee or poo". Sheet "Potty": four tiles in two rows, each `start(pottyType, {kind}, nowIso)`: "Potty (wee) saved."
- **Diaper or potty** (day on both): one row with that name; the sub is the newer of the two. Sheet "Diaper or potty" with a segmented control Diaper · Potty, opening on the kind logged last.
- **Meal** with a day: which-meal chips (the one for the hour of When is marked), how-much chips, "What was eaten (optional)" with no keyboard opening by itself, the three baby questions behind one closed row "New food or a reaction", "Save the meal". It says "Lunch saved." The baby's four amounts leave. A baby's sheet is as today.
- **Medicine** and **Note** (a free slot): link rows to `/baby/medicine` and `/baby/log/note`.

**Offline, Undo, the helper.** Every new tap goes through `start()` and `run()`, so it queues with a client id and has Undo for half a minute, except a cup that took milk from the stash, as a bottle today. `milkSource` answers null for `/formula|cow/i`, so cow's milk never touches the fridge and keeps its Undo. The helper proposes from the same gated types and `bad_option` checks against them. Rule 7 gains, only in a potty home: "A wee or a poo on the potty, a try or an accident is a Potty entry, not a diaper; when it is not clear which, ask." No line that is free today is sent to the model: in a potty home a typed "poo" with no "diaper" in it is answered on the phone (reader 23), kept offline as today. Rule 7: with the day on `potty` the words that say a poo means a dirty diaper are left out; with `both` the new sentence stays.

**Words in lists.** `entryDetail` says "Cup" in place of "Bottle" when `vessel` is Cup and drops `vessel` otherwise; `describePayload` says "ate most". `feedWords` and `feedSub` in LanaNow and `feedCard` count cups apart from bottles ("150 ml in 1 cup"). DayStrip does not count an entry with `vessel` Cup under "bottles" (in a clock home a cup is left to the ml). The helper's two card summaries (tools.ts:501-504 and `detailWords` at :905-914) say "Cup" in place of "Bottle" when `vessel` is Cup and never print `vessel` by itself; a payload with no `vessel` prints exactly as today. Entry checks: a potty entry during a toddler's sleep counts as awake; two potty entries are a double only with the same `kind`; "Cup of 400 ml" where it said Bottle.

## 6. The vaccine question (PR B)

**Asked** in `components/VaccineBook.tsx`, of an admin of a child of 12 months or more, while no answer is stored. "{Name} had them all" is a plain button inside the existing fold "From before {Name} was on elnunu", under its one line. "We follow another card" is a plain button at the book's foot, beside the schedule line, fold or no fold: a family on another card that records each old visit loses the fold, and a family that joined at birth never had it, and both would be told "Vaccine overdue" by UAE dates for ever. One stored answer.

**`public.subject_vaccines_save(p_subject_id uuid, p_answer text) returns jsonb`**: invoker, same grants and checks 1 to 5 as `subject_day_save` (the refusal says "... to change this."); `p_answer` in had_all, other_card, none, else `bad_input`; check 6 (`no_birth_date`, `too_young`) applies to had_all and other_card only, and `none` passes at any age. had_all and other_card write `vaccines` and `vaccines_on` (the home's date as text); `none` removes both keys.

**Meaning, in SQL**

- The answer counts only as the day does: both functions read it through `private.subject_vaccines(settings, birth_date)` (section 1), never from `settings` directly, for the statuses, `due_on`, the top-level `answer` and the due-list predicate. A baby's list and due row are exactly today's whatever is stored, and an answer given under a birth date that was later moved does not count.
- had_all: a dose with no record whose window closed before the family joined (today's `earlier`) becomes `status 'given'`, `given null`, `undated true`. A dose dated before joining whose window is still open stays `due`: one tap never hides a dose that could still be given.
- other_card: every dose with no record is `unknown`, and `due_on` is null on every item; `care_due_list` makes no vaccine row for that child.
- `vaccines_list` gains the top-level key `answer`. Existing statuses are reused on purpose: every reader already treats `given` as done and `unknown` as undated, where a new status would fall through `VaccineBook.statusOf` to "upcoming" and through the printout to "due {date}".
- `care_due_list`: `subjects` selects `settings`; the vaccines CTE adds `and private.subject_vaccines(s.settings, s.birth_date) is distinct from 'other_card'`. It must be `is distinct from`: `<>` is null for every child with no answer and would drop every home's vaccine row.

**Readers**

| Reader | Change |
|---|---|
| Home's two notices, the calendar, `due_soon`, the briefs, the Sunday plan | none: they follow `care_due_list` |
| Doctor (`doctor/page.tsx:32`) | none: no dose is due or upcoming |
| VaccineBook, had_all | an undated dose reads "Given, date not recorded" with "Add the date" (the existing date form, box empty; a saved date makes a real record, and undoing it goes back to undated). At the foot, for admins: "Doses from before {Name} joined show as given." with "Undo" |
| VaccineBook, other_card | the subtitle "Dated from her birthday." and the footer naming the UAE schedule are taken away; one notice on top, "You follow another card. No due dates here.", with "Use these dates" for admins; doses with no record sit in one closed fold "Not recorded", each keeping its Given form; no pills, no dates, no "The window has closed". Under other_card (`data.answer === "other_card"`, never keyed on the status 'unknown', which a child with no birth date also has and whose form stays as today) the date box starts empty for every dose with no record, in the single-dose form and the whole-visit form alike; the existing `required` holds the save |
| Printout (`export/page.tsx:45,158`) | an undated dose prints "given, date not recorded"; with another card only recorded doses are listed |
| Helper (`propose_vaccines`, `matchVaccines`) | `propose_vaccines` reads `undated`. When a visit or a vaccine is named, an undated dose is passed to `matchVaccines` with status unknown, so it goes on the card and Confirm saves the date through `vaccine_record`, as "Add the date" does. With nothing named, undated doses stay given, so "she had her jabs" still means the visit that is due. With another card nothing is due, so it asks which visit |
| `lib/types.ts` | `VaccineItem.undated?`, `VaccinesData.answer?` |

## 7. Story from the month a family joined (PR B)

**`public.story_span(p_subject_id uuid, p_from date default null, p_to date default null) returns jsonb`**: invoker, stable, needs view; `revoke ... from public, anon`. It answers `{ok, first_day, entries}`:

- `first_day`: the earlier of the day the child's row was made and the day of the first feed, sleep or diaper logged, on the home's calendar, never before the birth. Growth points and Firsts are often typed in for the past, so they do not move it.
- `entries`: the count of the child's entries of any kind dated from `p_from` to `p_to` (null without both). Any kind, because the daily numbers do not count meals or potty until step 3.

Then:

- `lib/story.ts`: new pure `firstStoryMonth(birthDate, firstDay)`: 1 when `firstDay` is on or before the birth, else `currentMonth(birthDate, firstDay)`. `currentMonth`, `storyMonth` and `birthdayMonth` are not touched: ages everywhere rest on them.
- `story/page.tsx:21`: `max(first, m - 1)`. `story/[month]/page.tsx:38`: a month before `first` goes to the index; "Month N-1" shows only above `first`. Its last line, "Nothing was logged in this month." (never shown today, because the stats come back for every day), shows when the month's entry list and "tried" list are both empty. The footer at `story/[month]/page.tsx:187` keeps its words where `first` is 1; where `first` is above 1 its second sentence becomes "A first from before then is on Firsts."
- `lib/assistant/brief.ts getStory`: after the span, one `story_span` call. A month before `first` is refused as `bad_month`. After the kept-page check and before the allowance and the model call, a month with `entries = 0` is refused as `empty_month`. That covers the page, the API route and the monthly push, which sends nothing when the story is refused. An rpc that answers null (the golden stand-in, an older database) means first month 1 and no refusal.

Read on the live project on 23 November 2026 (select only): Lana's earliest feed, sleep or diaper is dated 10 June 2026, inside month 1, and none of her months so far is empty. Her first month stays 1 and months 1 to 4 stay. Fewer paid calls: no keepsake for a month before joining or with nothing in it.

## 8. Migrations, suite checks, unit tests

**PR A: `supabase/migrations/20261010006800_family_day.sql`** (no row is changed)

1. `private.day_band(date)`, `private.subject_day(jsonb, date)`, with revokes and grants.
2. `create or replace function private.subject_names()`: as migration 5000 plus `'day', case when public.has_permission(s.module_id, 'view') then private.subject_day(s.settings, s.birth_date) end`; then `alter function ... owner to app_rls`. The body and its comments must not hold the text "auth." (the suite greps for it).
3. `create or replace function public.home_summary(uuid)`: as 6500 with three hunks. (a) `v_day := private.subject_day(settings, birth_date)`, `v_feed_clock := coalesce(v_day->>'milk' = 'clock', false)`, `v_potty := coalesce(private.day_band(birth_date) >= 18 and v_day->>'diapers' in ('both','potty'), false)`. (b) next_due: `not (v_toddler and (t.id in ('lana.diaper','lana.sleep') or (t.id = 'lana.feed' and not v_feed_clock)))`. (c) types: `and (coalesce(t.settings->>'needs','') = '' or (t.settings->>'needs' = 'potty' and v_potty))`.
4. `public.subject_day_save`, with revoke and grants.

**PR B: `supabase/migrations/20261010006900_new_entries.sql`**

1. `insert into public.care_entry_types (...) values ('lana.potty', ...) on conflict (id) do nothing`.
2. `create or replace` of `vaccines_list` and `care_due_list`: as 6500 with section 6's changes.
3. `private.subject_vaccines`, `public.subject_vaccines_save`, `public.story_span`, with revokes and grants.
4. No update of `lana.feed` or `lana.meal`; no change to `care_entry_log`, `household_create` or the 6600 guard.

**Suite** (`supabase/tests/rls_test.sql`, one new section per migration before the closing echo, the echo's list extended; as the signed-in role, table reads after `reset role`, ages and settings put back). Every age on an edge (365/366, 547/548, 730/731, 1095/1096, and Lana "at 365 days") is written on the home's date, `(now() at time zone <the home's zone>)::date - N`, as lines 1094-1101 do, and `day_band` is called as a signed-in member so the home's zone is read; `current_date - N` only for ages well away from an edge (160, 380, 400, 600). Otherwise the suite fails for four hours of every day

A:
- The three new functions are invoker; anon cannot execute them, authenticated can; app_rls can execute the two private ones; `subject_names` is still a definer owned by app_rls; the two owner lists and the auth-schema check pass unedited.
- `day_band` at days 365/366, 547/548, 730/731, 1095/1096 and with no birth date.
- Wafa (carer with edit): refused, the message names Mido and Dana; settings unchanged; a direct `update ... set settings` fails with 42501. Lilly refused. Haitham with Lana's id: `not_found`. View-as Dana: refused, nothing saved.
- Mido with Lana at 160 and at 365 days: `too_young`. No birth date: `no_birth_date`.
- At 400 days each bad input is refused and settings stay: milk 'x'; naps 3, 1.5, 99999999999 and "1" (naps 1.0 is accepted and stored as 1); diapers 'nappy'; stores_milk "yes"; an array and a string for the day; '25:00', '7pm', bedtime 12:00, morning 19:00; both: `too_young_potty`. At 600 days both: `bad_input` while no potty row is active: inside one `begin`/`rollback`, after `reset role`, `update public.care_entry_types set is_active = false where id = 'lana.potty'` (no row in PR A, the row from PR B), so this section passes before and after 6900 and PR B does not edit it. stores_milk false with a bottle in date in the fridge: `milk_in_stock`; with only a bottle past its time: accepted.
- A good save: the stored day has exactly v, milk, naps, diapers, stores_milk, saved_on (the home's date), saved_at, saved_by; an unknown key sent is not stored; `day_asked` 12 with `day_asked_on`; night keys replaced when given and kept when null; a marker key in settings survives; name, birth date, profile and created_at unchanged; an audit row; `me()->'subjects'->0->'day'` equals it for Mido and for Wafa and is null for Lilly (who may not view the child).
- A null day: the day unchanged, `day_asked` set; with a night argument, `bad_input`.
- `home_summary`: drink and off give the feed no next_due; clock gives it one; diaper and sleep stay null. The needs gate, inside one `begin`/`rollback` after `reset role`: `insert into public.care_entry_types (...) values ('lana.potty', ...) on conflict (id) do update set is_active = true, settings = excluded.settings`; the row is in `types` only at 600 days with both or potty, and `subject_day_save` takes both then.
- A 19:30 sleep is a nap in `care_daily_stats` with bedtime 20:30 and night sleep with 19:00.
- Back at 160 days with the day still stored: `me()` gives `day` null and the feed, diaper and sleep each have their next_due.
- A day with a bad or missing answer written directly as an admin (`update ... set settings`): `me()` gives `day` null, the feed has no next_due, no needs row is in `types`.
- A day saved at 400 days; the birth date is then moved so that the save fell before the child's day 366 and the child is 400 days old again by the new date: `me()` gives `day` null (`saved_on` is before birth + 366).
- Two homes on one account: as Mido with `request.headers` x-home set to the Khans' home (as lines 2039-2046), `subject_day_save(:zayd, a valid day)` is refused with 'Ask Haitham to change Zayd''s day.'; after `reset role` Zayd's settings are unchanged; the header is set back to ''.

B:
- The potty row: exactly one `lana.potty` row, active, no end, `due_after_min` null, `settings->>'needs' = 'potty'`, its four options. `lana.feed`'s field keys are method, milk, amount_ml, side with no "Cow's milk"; the existing meal assertion (line 1056) passes unedited.
- `types` has no potty for the baby, none at 400 days, none at 600 days on diapers, one on both and on potty; `subject_day_save` now takes both at 600 days.
- `care_entry_log('lana.potty')` as Wafa in a home with potty off is saved, has no next_due and no row in `care_due_list`.
- `subject_vaccines_save`: invoker, closed to anon; Wafa refused naming the admins, Lilly, Haitham `not_found`, view-as, 'x' `bad_input`; at 160 days had_all and other_card are `too_young` and none is ok (both keys removed); the x-home refusal as in A ('Ask Haitham to change this.').
- In its own section, on a home it makes (a new account calls `household_create` for a child of 380 days, so Birth to 6 months are earlier and the 12-month doses are due with the window open; its admin removes it with `household_delete` at the end, as lines 1235-1265 do): had_all turns exactly the earlier doses into undated given, leaves open-window doses due and `care_due_list` as it was; a date then its undo goes dated and back to undated; other_card gives unknown, null dates, recorded doses still given, no vaccine row for that child, the other home untouched; none restores the list captured before. A child with no answer still has its vaccine row. With other_card stored and the child put back to 160 days, `vaccines_list` equals the list captured with no answer at that age, `answer` is null and the vaccine row is back in `care_due_list`; at 400 days by a birth date under which `vaccines_on` falls before day 366 the answer does not count.
- `story_span`: invoker, closed to anon; Lana's first day is her first feed, sleep or diaper, not her birth weight; a new home's is the day it was made; never before the birth; the count follows the span; another home's child is `not_found`.

**Unit tests** (new files; `lib/golden-baby.test.ts`, its fixture, `golden-calls.ts`, `toddler.test.ts`, `toddler-days.test.ts` and `fixtures/toddler-days.ts` are not edited)

- `lib/day.test.ts`: `readDay` is null at every age 0 to 365, with no birth date, for `v` 2, for each bad answer and for a `saved_on` before birth + 366 days; for every such age and each of the 72 possible days, `dayPlan` deep-equals the plan with none. The default plan equals today's expressions kept in the test as the oracle (LanaNow:359, page.tsx:150 for both `storesMilk` and `milkNotices`, the fridge-plan candidate at 187, and 178-179) at ages 0, 167, 168, 365, 366, 547, 548, 730, 731, 1095, 1096 and null, with and without breastfeeding, pumps and stock. The saved tables: each milk and diapers pair to rows (fillers Medicine then Note in slot order), cells (no feeds cell for a drink, four at most), tiles, kinds, `on`; potty off under day 548 and without the type. Counts need the kind logged: a day of drink and diapers with nothing logged gives no feeds or diapers cell, no Milk card and no handover tile. `milkNotices`: stores_milk true, nothing in stock, last pump 15 days ago gives false while `storesMilk` is true. `milkClock`: clock with the last feed 8 days ago gives false, and true again after a feed today. Clock with stores_milk false draws no fridge plan. `suggestDay` at 380, 563, 746 and 1111 days with no log and with the toddler seed's logs; with a saved day of potty, clock and none and an empty week at 1111 days it gives the saved answers back. `dayOffer`: the edges, `early` on days 1 to 7 and not after, day 30 and 31, joined after the edge, `day_asked`, and a `day_asked_on` before the band's first day read as not asked. `typesForDay` in PR A: the same objects with no day; a needs row is out unless on; the same objects with a day. In PR B: the merged shape; twice adds nothing; `keep` (fields, options and the entry's own needs row with potty off); a home with no stored milk; `firstMilkFor` (a home that once pumped, stores no milk, no named feed since yesterday noon gives "Cow's milk" on a drink and none on a clock, never "Morning pumped"; no day equals `defaultMilk`). `typesOn` for a saved day deep-equals the stored rows minus the hidden needs row, the same objects. `milkTab`.
- `lib/child-insights.test.ts`: `napPattern` with `said`; a baby ignores it.
- New cases: `stripCells` and `feedCard` with and without the new key (absent equals today), the clock toddler's card, cup words; `milkSource` for cow's milk; `entryDetail` and `describePayload`; the potty double and potty during a toddler's sleep; `firstStoryMonth` (Lana 1, a joiner at 20 months, a first day before the birth).
- `lib/assistant/day-helper.test.ts`, with its own stand-in in the shape of `toddler-helper.test.ts` (it registers `fixtures/golden-resolve.mjs` itself and calls `loadContext` and `buildTools` directly; `golden-calls.ts` is not used and not edited). Also: `propose_milk_add` is refused with a day on stores_milk false and not with no day; a home with potty off and one potty entry gets the label 'Potty' from `care_now` and a bad `kind` refused by `propose_entry_change`, while the prompt has no Potty; a clock toddler fed today at 14:00 gets the ', next due about' ending and one last fed on Saturday does not; `napsLately`'s three strings and the none note; after had_all, '2 months' with a date gives a card holding that visit's undated doses. The cases: a baby's home whose type table holds the potty row gives a prompt string equal to the same home without it; a toddler with no day, the same. With a day on both: potty is listed, a proposal with Wee is accepted, rule 7's sentence is there. A clock toddler: `care_now` keeps the feed's next_due, the snapshot ends ", next due about", rule 6 has no "never give a time".

## 9. The written list of exceptions

**A child under 12 months, Lana before 6 June 2027 included**

1. Story, for a baby whose family joined after the birth and logged no feed, sleep or diaper for the time before: the months before they joined are no longer offered, even where a first or a weight was typed in for them. Those firsts and their photos stay on Firsts, and the weights on Growth. Why: Story starts at the month a family joined (AGES.md), and a keepsake for such a month was a paid model call about a month the app did not see. It does not reach Lana: her log starts in her first month (read on the live project, 23 November 2026).
2. Story, a month with nothing logged in it at all: the page says "Nothing was logged in this month.", no keepsake is written or paid for, and that month's birthday push is not sent. For Lana that is only the first hours of a new month, before its first entry.

3. Only for a child whose birth date was corrected to under 12 months after a day was saved (a mistyped year at sign-up): the night hours saved with it stay and cannot be changed until day 366. A home that never saved a day is not touched.

Nothing else. `me()` carries one more key (`day`, null) that no screen shows. The Feed and Meal rows are not touched. Potty is in no list a baby's home reads, the Entry types screen included. The vaccine question is not asked. No stored golden line changes, so the fixture is not edited.

**A child of 12 months or more with no saved day** (the four test homes; Lana from 6 June 2027)

4. Admins see one line on Home for up to 30 days ("Lana is one. Look at her day"; ahead of "A vaccine is due" for its first 7 days, behind it after) and the row "{Name}'s day" under About her.
5. Admins see "{Name} had them all" in the vaccine book's fold "From before {Name} was on elnunu", where that fold shows, and "We follow another card" at the foot of the vaccine book. Lana's fold never shows: every dose due before her row was made has a record (read on the live project, 23 November 2026). So from 6 June 2027 her admins see one new button at the foot of her vaccine book.
6. A new home made for a child of 12 months or more lands on "{Name}'s day" once, after sign-up.
7. Story, as 1 and 2.

Everything else stays as today until a parent saves.

## 10. Two pull requests

**PR A, the day.** Migration 6800 and its suite section; `lib/day.ts` and its tests; readers 1 to 21; `/baby/day` with Diapers and Not logged only; the About row; the offer; the sign-up hop. Home's saved rows are Meal, Sleep, Diaper, Milk (today's Feed sheet under the name Milk) and the fillers. New seed `supabase/tests/toddler_days.sql` (each toddler parent saves a day through `subject_day_save`: Noor on a clock, two naps, diapers, stored milk yes with one bottle put away; Adam not logged, one nap, diapers; Maya a drink, one nap, diapers; Yusuf not logged, none, not logged; and Noor's home gains a carer and a simple-screen member, through the app's own RPCs, so every reader can be read as a parent, a carer and on the simple screen). The walk scripts (`db.sh`, `serve.sh`, `walk.cjs`, `judge.py`, `run.sh`, now in the session's scratchpad) are committed under `family/scripts/walk/` with a short README, and CLAUDE.md gains one line pointing to them: the step 1 copies were lost with a scratchpad and had to be rebuilt. A CI step after the suite builds a second database and loads `demo_data.sql`, `toddler_homes.sql` and `toddler_days.sql`, so a migration that breaks a seed fails the pull request. DESIGN.md: the screen, Home's rows and strip from 12 months, the tab bar.

**PR B, new entries, vaccines, Story.** Migration 6900 and its suite section; the Both and Potty answers from 18 months; readers 22 to 27; `toddler_days.sql` moves Maya to both and Yusuf to potty, with cups, meals and potty entries; `demo_data.sql` gains one imported-style feed in every month of Lana's life that ends before the 14-day log begins, in a loop counted from her birth date (a bottle with its end at its start, through `care_entry_log` as Dana), so no finished month is empty whenever the seed is run and her first day is in month 1, as on the live project; the loop is loaded on both sides of the walk. AGES.md (step 2 done, with section 9), DESIGN.md (the sheets, the vaccine book), HANDOVER.md.

Order: B after A's build is live, so the potty row never meets a build without its gates. Each opens as a draft and gets one review when marked ready; no `@codex review` comment; fewer, larger pushes.

**Checks for each**

1. `npx tsc --noEmit`, `npm test`, `npm run db:test`, the build with the two example values, then `rm -f family/AGENTS.md`.
2. Golden: `git diff --exit-code main -- family/lib/fixtures/golden-baby.json family/lib/golden-baby.test.ts family/lib/fixtures/golden-calls.ts` is empty and the 7,022 cases pass.
3. The live path: clone a database built from main's migrations and seeds (`createdb -T`), apply only the new file. As Mido and as Wafa, `home_summary` for Lana is equal before and after; `me()` differs by the one null key; the md5 of `lana.feed` and `lana.meal` rows and Lana's settings are equal. For PR B also: `care_due_list` equal, and `vaccines_list` equal but for the new key `answer`.
4. The walk, old build against new, every route plus the tab bar and the open + sheet (the walk script must capture them: they sit outside `main`), as Mido, Dana, Wafa (simple), Lilly and an account in no home on Lana's demo home, and as each parent on the four toddler homes with no saved day. The walk captures every route, the tab bar on Home, the child's page and Milk, the + sheet, and each of Home's row sheets opened by a tap on a production build. Expected: Lana's home no difference, also with her birth date moved to day 365 (set as `(now() at time zone 'Asia/Dubai')::date - 365`) and with her birth date null; at day 366 and in the toddler homes only section 9's items 4 to 7. For PR B the new demo feeds are loaded on both sides, and one more check guards the sheets PR B rewrites: Home's bottle, breastfeed, diaper and meal taps on the old and the new build as Dana (the Meal row is there from 20 November 2026), with the `care_entry_log` calls captured on the pattern of `scripts/backlog-scenario.mjs`: the payloads are equal key for key.
5. A second walk, new build only, with `toddler_days.sql` loaded: each home read against section 2's tables, as the parent and as a carer.
6. `scripts/day-scenario.mjs`, on the pattern of `backlog-scenario.mjs` (a production build, where taps work): sign up a child of 13 months, land on the day, Save, read Home's four rows and count four tabs.
7. `node family/scripts/ui-audit.mjs` before and after, in the PR body, for `/`, `/baby`, `/baby?tab=about`, `/baby/day`, and in PR B `/baby/vaccines` and `/baby/story`, as an admin, a carer and a new family, light and night. Expected: Lana's numbers equal; a saved-day Home within 6 blocks, 15 numbers, 80 words, one screen.

**What leaves for what comes.** Home: always four rows, a row is swapped and never added; the line uses the one notice slot. Strip and tiles: four at most, a kind not used gives its place. Tab bar: Milk leaves, nothing comes. The + menu: Pump leaves where no milk is stored, Potty comes where turned on. Meal sheet: the four baby amounts and three open questions leave for two chip rows and one closed row. Vaccine fold: it empties once answered. About her: one row for toddler admins and no block; nothing leaves, argued in the PR as the screen's only door. Sign-up: no field added.

Before PR B is marked ready, read again on the live project (select only) that no `lana.potty` row exists (none did on 23 November 2026: 13 `lana.*` types, none with `needs`); if one has appeared, stop and ask Mido, because neither `do nothing` (Potty ungated in every home) nor `do update` is right without him. After each merge, with the Supabase MCP (reads only): `list_migrations`; the new functions counted; after B exactly one `lana.potty` row with `settings->>'needs' = 'potty'`, and `story_span` for Lana answering a first day on or before 4 July 2026; Lana's settings as before with no `day`.

## 11. Open questions

Settled on 23 November 2026, by the standing instruction "go ahead with your recommendations" and three read-only reads of the live project:

- Lana's stored night is 19:00 to 07:00 and no day is saved. Her earliest everyday entry is 10 June 2026 and no month is empty, so Story's rule does not reach her. Every Birth, 2-month and 4-month dose has a record, so her vaccine fold never shows.
- The vaccine question stays closed under 12 months in step 2 (the SQL honours an answer only from day 366; opening it to babies later is one check and one condition, as its own listed exception).
- The new words are built as written, with light and night screenshots of `/baby/day`, the Home line, the sheets and the vaccine fold at the top of each pull request, so Mido can change any before it is marked ready.
- The offer shows for 30 days: ahead of "A vaccine is due" for 7 days, behind it after, then gone for that age (the About row stays).

## 12. What changed from v1

Every finding below was confirmed or corrected by a second reader in the code (`review.md` beside this file has each one's evidence).

- A wrong birth date at sign-up: `saved_on`, `day_asked_on`, `vaccines_on` and the rule "an answer counts only if the child had reached its age on the day it was given"; `none` for vaccines at any age; the night hours listed as exception 3 (F1, BABY-1, BABY-7, DB-1).
- Stored milk: `milkNotices` beside `storesMilk`; the fridge plan needs it; nothing new into the stash while the answer is No; "in stock" means in date; the line under No (F2, F5, H1, H2, H3, DB-2).
- No zeros after saving the suggested day: a count needs its kind logged lately; the clock needs a feed logged lately (F3, H1).
- The milk a sheet starts on, so a hidden chip is never saved (F4, H4).
- The Entry types screen never gets the merged shape (BABY-2); a hidden key is refused there (H14).
- A type an entry already has is never dropped (F12, H5); Backfill gains Potty (F9, H11).
- A typed "poo" in a potty home is answered on the phone, no model call (H6, BABY-8).
- Vaccines: "We follow another card" at the book's foot (F7); empty date box under another card (F6); the helper and undated doses (H12).
- The day screen starts from the saved answers (F10); the offer's place (F11); tiles and cells stated outright (F8).
- Story: the exception reworded, the footer (F13); live reads done (DB-9); the demo seed's loop (H15).
- SQL: `subject_day` checks the whole day (BABY-6); naps compared as jsonb (DB-7); `me()` hides the day from a member who may not view the child (DB-5); the x-home refusal checked (DB-6).
- Suite: edge ages on the home's date (BABY-3, DB-4); section A passes before and after 6900 (BABY-4, DB-3, H9); the vaccine checks on a home of their own (DB-3).
- Helper: `t.settings?.needs`, its own test stand-in (BABY-5); `typesForDay` gates only in PR A (H8); the nap words and the none note (H10); the sleep fold's hint, card words for a cup (H11); "next due" only when the due time is today or later (H13).
- Checks: the walk scripts committed, payload comparison for PR B's sheets, a pass with no birth date, the seed's carer and clock home (H7).