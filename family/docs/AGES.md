# Growing with the child: 12 months to 3 years

Written on 17 November 2026. elnunu was built around one baby. This is the plan for making it
right for a child of any age up to three, for Lana as she grows and for families who join with an
older child. `HANDOVER.md` says what is built; this file says what was decided and what comes next.

## What was found

Four test families (12, 18, 24 and 36 months) were signed up on local copies and given a normal
week. The app showed each the Home of a six-month-old, and judged a toddler's day by a baby's
rules: "Feed due now" five hours after any milk, "0 feeds in 24 h", "Only 0 wet diapers ... call
the doctor" for a child out of diapers, "Awake for 9 h ... try a nap now" for a child with no nap,
"Vaccine overdue" on the first day for every dose since birth, and an "entry to check" after every
normal night. About 200 findings, each checked by a second reader, sit behind this plan.

## The rule

**Age sets what is usual. The log shows what a family follows. The family can say what age and
the log cannot. Nothing from before a family joined is called missing.**

- From 12 months the app raises no alarm from a daily count. No source gives a daily milk-feed or
  diaper number for a well child after the first year; sleep is judged on a week, never a day.
- A kind of entry a family does not log is not shown as a zero and is never judged.
- The app goes quiet by itself. It rearranges itself (Home's rows, the tab bar) only when the
  family says so; at 12, 18, 24 and 36 months it asks once, with the answers filled in from the log.
- Under 12 months nothing changes unless a step says so.

## Decisions (Mido, 17 November: "go ahead with your recommendations")

| Question | Decision |
|---|---|
| Up to what age? | Guidance to the third birthday. The log, growth, vaccines, medicine and When to call carry on. The day after, one plain line says the age guide has ended. |
| Milk after the first birthday | A drink with meals: no clock, no "feed due", no counts, in every home, Lana's from 6 June 2027. A family can keep the feed clock (step 2). |
| Does Home change by itself? | No. Alarms stop by themselves; rows and tabs move only when the family changes "{Name}'s day". |
| A toddler's four rows | Meal, Sleep, Diaper or Potty, Milk. Medicine, then Note, take a slot the family does not use. |
| The Milk tab | Only in a home that stores milk. Otherwise four tabs. |
| Vaccines from before a family joined | A dose whose window closed before the family joined sits in a closed fold, "From before {Name} was on elnunu", marked "not recorded", never overdue; a dose dated shortly before joining stays "due" and never turns red. Step 2 adds one question ("had them all": shown as given, date not recorded) and "we follow another card" (no due dates worked out). |
| Potty | Its own entry (Wee, Poo, Tried, Accident), offered from 18 months, only in homes that turn it on. |
| Who changes a child's day | Parents (admins). |
| Birth date | Required at sign-up; the child's card can correct the name, the date and girl or boy. |
| Boys' growth | No percentile until the WHO boys' tables are added from the WHO files, checked by a script. |
| New health text | None until a paediatrician has read it. Until then lines that are wrong for a toddler are only taken away. **Open: Mido names the reader.** |
| The helper's daily limit | Stays 40 a home and 20 a member; everyday lines (a meal, a cup, the potty) become free on the phone. |

Not doing for now: siblings in one home, a vaccine schedule per country, milestone checklists, a
behaviour tracker, vitamin or tooth-brushing ticks, translating every screen (only the simple
screen and the helper's voice), achievements for families that do not pump.

## Steps

0. **Done (17 November, #152).** The database suite no longer depends on today's date; it would
   have failed on every pull request from 5 December.
1. **Say nothing false.** From 12 months: the guide is silent, milk has no clock, long nights and
   big cups are not "entries to check", the nap card follows the child's own days, stored-milk
   notices show only where milk is stored, zero cells and the Feeds card go when not logged. For
   every age: past vaccine visits from before joining are not overdue, the birth date is required
   and the child's facts can be corrected, fixed "she" follows the child, the age reads in years
   from two. For Lana only the listed exceptions show: her admins can correct her name, birth date
   and girl or boy; the mood field reads "Mood"; the When to call feeding line follows her age band;
   her age is counted by calendar month (on a few days in 2027 it turns a day earlier or later than
   before).
2. **The family's day.** One screen, "{Name}'s day" (milk: feeds with a clock, a drink, not logged;
   naps: two, one, none; diapers, both, potty, not logged; bedtime and morning; stored milk), asked
   at sign-up for a child of 12 months or more with the answers filled in by age, and offered once
   at 12, 18, 24 and 36 months. Home's rows, the strip, the child's tiles, the tab bar and the + menu
   follow it. New entries: Cup and Cow's milk on a feed, which meal and how much was eaten on a meal,
   Potty. The vaccine question. Story starts at the month a family joined. **Must be live before 5
   June 2027, when Lana turns one.**
   *First half built (23 November, migration 6800):* the day itself. It is stored on the child's
   row and saved by a parent through `subject_day_save`; `lib/day.ts` answers for Home's rows, the
   strip, the tiles, the tab bar, the + menu, the stored-milk notices, the helper and the nap
   push; the screen is `/baby/day`; a new home for a child of 12 months or more lands on it once;
   Home offers it at 12, 18, 24 and 36 months for 30 days (ahead of "A vaccine is due" for the
   first 7, behind it after). What the review added to the plan: an answer counts only if the
   child, by the birth date stored now, was already 12 months on the day it was given (a year
   mistyped at sign-up never rearranges a baby's home later); an answer turns a kind on, but a
   count shows only once that kind was logged in the last 7 days; nothing new goes into the milk
   stash while the day says no milk is stored. Until a parent saves, every home is as step 1
   left it. *Second half, next:* Potty, Cup and Cow's milk, which meal and how much, the vaccine
   question, Story from the month a family joined.
3. **Everyone reads the same day.** The simple screen, Handover, the Week tab, Trends, Story and the
   doctor's printout count meals, snacks and potty (the daily numbers gain them). Typed and spoken
   meal, cup and potty lines save on the phone at no cost. The helper's prompt and briefs are built
   from the child's day. A second eval home (a boy of 20 months).
4. **Nanny languages.** The simple screen and the helper's voice exist in English, Arabic and
   Russian. Most nannies here are Filipino, Ugandan, Kenyan or Ethiopian. Filipino, Kenyan and
   Ugandan nannies were schooled in English; Ethiopian nannies are the group English serves least.
   Add Amharic first, then Filipino (Tagalog) and Swahili; Luganda and Oromo only if a family asks.
   Same places as Arabic and Russian (`lib/i18n.ts`), after step 3, which rewrites the simple
   screen's words. Before it ships: read-aloud and speech recognition checked in each language
   (Amharic has its own script), and each translation read by a native speaker.
5. **Growing on.** Growth by sex to five years from the WHO files, "height" from two. Week by week:
   stretches named by their months, months instead of weeks after the first year, a plain end at
   three. Play: about 20 ideas for each half year to three and a last list that stays. Pronoun
   tokens in the shared text. Suggestions on Firsts, never ticks.
6. **Health text by age** (needs the paediatrician's read): When to call the doctor per age band,
   red flags and sleep safety by age, toddler skills for the helper (food and milk, tantrums, potty,
   talking, changes, safety), a register of every health claim with its source and who checked it.

Each step is one or two pull requests, checked the same way: the golden test that pins a baby's
results (`lib/golden-baby.test.ts`; its fixture is never regenerated), the database suite, and a
side-by-side walk of every route for Lana's demo home and four toddler homes
(`supabase/tests/toddler_homes.sql`) on the old and the new build.

## Lana's dates

- 20 November 2026: the Meal row (already built).
- 5 December 2026 (6 months): the feed gap goes to 4 h and the 6 to 9 month numbers apply (already
  built). From this plan, the When to call feeding line moves to the 6 to 12 month row that day.
- 6 June 2027 (day 366, the day after her first birthday): the toddler rules start. Step 2 adds one
  line then: "Lana is one. Look at her day".
- 5 December 2027 (18 months), 5 June 2028 (2 years), 5 June 2029 (3 years: the guide ends).
