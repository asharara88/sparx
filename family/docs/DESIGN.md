# elnunu design bible

Read this before changing anything a person sees. It was written on 29 October 2026, after
everyone who tried the app said the same thing as Dana: too many things happening, too many
numbers, too many cards on one screen. The cause was not only how much was on each screen
but its shape: the app was built like a web page and squeezed onto a phone. Every rule below
exists to stop that coming back. `BRAND.md` covers the name, mark, colours and voice; this
file covers what goes on a screen, how it is laid out, and how much of it there is.

The agreed layout, drawn at phone size, is the mockup at
https://claude.ai/artifact/MQAgj2evxRmakpFRnud8MA (Home, logging a feed, the child's day,
Milk, More, with today's Home beside it). When this file and the mockup disagree, ask Mido.

## Who it is for

A parent at 3 am with the baby in one arm. A grandmother reading at 19 px. A helper who
reads English as a second language. Since 17 November 2026, also the family of a toddler of
one to three, who may log a nap, meals and bedtime and no milk or diapers at all: from 12
months the app never holds a day against a baby's numbers, and never shows a kind the family
does not log (`docs/AGES.md`). Each of them opens the app for one reason, taps once or
twice, and puts the phone down. Design for that person, holding a phone in one hand, not for
someone exploring the app on a desk.

## Built for a phone

### The shape of every screen

From top to bottom, always in this order:

1. **The title**, on one line, with the whole width to itself (a back arrow before it on a
   screen you drilled into). A button never sits beside the title and squeezes it.
2. **The content**, one column, the full width of the phone less a 20 px margin each side.
3. **The main action**, if the screen has one, as one wide button at the bottom, just above
   the tab bar, where the thumb already is ("Put a bottle away", "+ Log", "Save").
4. **The tab bar**: Home, the child, a round ＋ (log), Milk, More. Four tabs, without Milk, only
   where the child's day says no milk is stored (`milkTab` in `lib/day.ts`, 23 November); nothing
   takes its place, and `/baby/milk` then lights the child's tab. Nothing else is fixed to the
   screen but **the helper's button** (Mido, 12 November): round, plum, above the tab bar on the
   right, on every screen but Home (its "Tell me" is in the log card), the helper's own screen,
   the family chat and More (its helper rows come first). It opens the helper in a sheet over the
   screen; it steps aside while a sheet is open or the keyboard is up, and moves up clear of a
   screen's bottom button and then of any words or taps under it, when a clear spot is within
   160 px (12 November: it sat on Milk's "Put a bottle away" and Members' invite buttons); in a
   dense list it stays put (`components/HelperFab.tsx`, `lib/fab-place.ts`).

The thumb reaches the bottom half of the phone easily and the top corners hardly at all.
What people tap often lives low; what they tap rarely (or must not tap by accident, like
Emergency) lives high.

**Home's first screen holds what is needed now, without scrolling**: her state, the day in
up to four numbers, one alert and the log rows at the thumb. The day's picture (what the dashboard
held until 7 November) sits below the log card, for whoever scrolls. Every other screen should
fit in two; a reference page that is longer is split into rows that open their own screen.

### The patterns we use

| Pattern | Use it for | Instead of |
|---|---|---|
| **List rows** (`.row` in a white group) | Entries, bottles, people, measures, settings, any set of like things | A card per item; a table; a grid of tiles |
| **Sheet** (slides up from the bottom) | Logging, editing, choosing; anything with options and a Save | A new page; a form in the middle of a screen |
| **Segmented control** | Two or three views of the same thing (Breast / Bottle, Today / Week) | Tabs that scroll sideways; a row of chips |
| **One bottom button** | The screen's main action | Buttons scattered through the page |
| **Stat strip** | Two to four numbers in one white bar, each a value over one word; one number alone is not a strip | A grid of number cards |
| **Log row** (Huckleberry's) | The few things logged all day: icon, name, how long ago, and a round start/stop/+ button on the right | A grid of tiles; a button per option |
| **Timer sheet** | Starting something now or saying it already happened: a big round *now* button, then "or it already happened" and clock times | A form with a time field first |

A list row's first line says what and when ("13:08 · Bottle 60 ml"), its second line, muted,
says the detail; the number sits on the right. Tapping a row opens it or opens a sheet of
its actions; a row carries a button only as Home's log rows do (one round start or stop).

### What a phone screen never has

- **A table.** Four columns do not fit a phone: headers break ("THE / BABY"), labels wrap.
  Turn each row into a list row: the name and its range on the left, the value on the right.
- **Anything wider than the phone**, and no strip that scrolls sideways. If it does not fit,
  it goes in a list.
- **A card inside a card**, or a card inside a fold. One box deep, never two.
- **A label that breaks onto two lines**: chips, pills, tabs, buttons and headers stay on one
  line. If the words do not fit, use fewer words.
- **Text under 13 px**, and **tap targets under 44 px** tall.
- **A legend or footnote you must read to understand what is above it.** Say the answer in
  the title ("Sleeping more at night this week"); sources go in one short line or behind
  "Where these come from".

The worked example: "Today against her age" was a table inside a white card inside a lilac
fold: MEASURE / THE BABY / TYPICAL headers, a "so far" pill wrapping on every row, "5.7 h",
and a four-line footnote. As a phone screen it is one list: "Feeds · Usually 6 to 8" on the
left, "1" on the right, a red "short" pill only when a finished day fell short, one line of
sources at the bottom.

## The rules

1. **One screen, one question.** Home answers *what does she need now, and what do I tap?*
   The child's page answers *how is her day going?* Milk answers *what is in the fridge?*
   If a block does not help answer its screen's question, it belongs on another screen.
2. **Now beats later; later goes one tap away.** Home shows what matters in the next hour.
   Patterns, history, advice, settings and anything weekly live one tap deeper.
3. **One alert at a time.** Show the single most important thing; the rest wait behind
   "2 more ›". Order: safety (call the doctor, medicine due) > due now (feed, nap) > a
   check (an entry that looks wrong) > a tip.
4. **One number per card or row.** One headline number with its unit and one word under it
   ("150 ml / 2 bottles"). No second row of figures, no computed metric nobody acts on
   ("1099 min past the window" helped no one).
5. **Fewer words than you think.** A card's text is at most 12 words. Explanations go
   behind "Why?" or onto the detail screen, never under the headline.
6. **Never show a wrong or stale fact.** If the log has a gap (nothing for 12 hours), say
   nothing rather than "awake 122 h". An open timer older than a day is not "running".
7. **Colour says what, not how much.** Each feature has its tint (feed pink, sleep lilac,
   diaper sky, medicine butter, milk mint, pumping peach, food yellow…). Every card, row
   and notice about sleep is lilac and every one about feeds is pink, wherever it sits
   (Mido, 7 November): Sleep today, sleep tips, the sleep bar and the pattern's sleep bands;
   Feeds today, "feed due", feed tips and the pattern's feed ticks. A card about several
   things (Coming up) takes none of theirs. The freezer is sky beside the mint fridge, so the
   two read apart at a glance (the one exception: Milk and the freezer stash). Amber means *needs a look*,
   red means *act now*; neither is decoration. Green is not used to mean "fine": fine is
   the absence of colour. Grey (muted words, a plain pill) means *nothing to do now*: the
   vaccine book's doses from before the family joined, "not recorded" (17 November).
8. **Big targets, few of them.** Every tap target is at least 44 px tall. A card has at
   most two buttons; a third action goes in a sheet or on the detail screen. Destroying
   something is a word ("Bin", "Delete"), never a lone ×, and never the first button.
9. **The same thing looks the same everywhere.** A feed is pink with the bottle icon on
   Home, on the child's page, in the day list and in a push. Reuse the parts below; do not
   invent a new card for one screen.
10. **Plain words, the family's words.** "Diaper", "Pumped today 08:00", "3 days left".
    No jargon, no percentages, no "entries", no exclamation marks (see `BRAND.md`, Voice; a
    badge's title is the one exception).
    Diaper, never nappy (Mido, 13 November), on every screen and in the helper's answers;
    the helper still understands nappy.

9. **A tap answers at once.** The screen changes the instant a tap is made (the row's
   button, the card, "40 min ago" becomes "just now") and the server catches up behind
   it; a refused tap puts the screen back and says why. Nothing on screen waits for a
   round trip: a tap that waits for the server feels like a tap that did nothing.
   The same for a tab: the loading skeleton shows the moment it is tapped (`PageSwap`), and
   no link prefetches: each prefetch was a whole server render with its own sign-in checks,
   six of them on every open of Home and thirteen on More, for a skeleton the phone can show
   by itself. Measured 1 November 2026 with the server 600 ms away: tap to skeleton 90 ms;
   server requests on opening Home 6 → 1, More 13 → 1, Week 6 → 2.

## Budgets and phone checks

Measured by `scripts/ui-audit.mjs` at 390 × 844 (an iPhone), as an admin with a normal
day logged. It opens every fold before checking, and saves light and night screenshots.
Every digit group counts as a number ("1 h 5 min" is two); Home's 15 is what the agreed
mockup uses, mostly the tiles' "40 min ago".

| Screen | Top-level blocks | Numbers on screen | Words | Screens tall |
|---|---|---|---|---|
| Home, first screen (`.screen-fill`) | 6 | 15 | 80 | 1 (no scroll) |
| Home, the day's cards below (`#today`) | 8 | 12 | 150 | 2.5 |
| Every other screen | 8 | 12 | 150 | 2.5 |
| The child's day (`/baby/day`) | 5 | 4 | 100 | 1.5 |

A group that is one thing to a person but is built of several counts as one block when its
wrapper is marked `data-block`: the simple Home's four big tiles (bottle, diaper, sleep,
note) are its log, as Home's log card is, and the screen read 8 blocks against a budget of 6
until they were marked (25 November; it reads 5, with Ask outside the mark as a block of its
own, and nothing on that screen changed). Mark sparingly, and say here what was marked.

The phone checks must all read zero: *wide* (anything past the screen's edge), *sideways*
(a strip that scrolls sideways), *tables*, *wrapped labels* (a chip, pill, tab, button or
header of up to 24 characters breaking onto two lines), *card in card*, *small taps* (under
44 px), *tiny text* (under 13 px). A screen over budget or failing a check does not merge
until it is fixed or the exception is argued for in the PR.

How the audit reads three things (25 November; each was a screen flagged for what a person
does not see):

- **A closed menu is the one option it shows.** Create another home read 468 words: 419 of
  them were time zones in a menu nobody had opened. It reads 50.
- **A tick box or a radio is as tall as the label it sits in**, which is what the finger meets.
  The label must still be 44 px (`min-h-[44px]`): on Display and Entry types it was 24.
- **The wordmark is a picture of letters**: its small "el" (`.wordmark`, `.wordmark-ar`) is
  not counted as tiny text. Nothing else is let off: a chart's labels still count.

`AUDIT_CUT=1` also lists the one-line labels that end in "…". It is not a check (a list row's
detail is cut on purpose); it is the list to compare before and after a change to margins or
type, at 320, 360, 375 and 390 px.

Where things stood on 29 October 2026, before the phone passes (every screen was swept):

| Screen | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Home | 10 | 28 | 224 | 2.4 | sideways, wrapped labels, card in card, small taps, tiny text |
| The child's page, Today | 16 | 3 | 124 | 2.2 | a table, wrapped labels, card in card |
| The child's page, Patterns | 9 | 66 | 358 | 3.1 | 31 elements wider than the phone, a table |
| Trends | 3 | 236 | 621 | 5.6 | 31 wider than the phone, 2 tables, "1.4285714285714286 wet diapers" |
| Milk | 4 | 41 | 247 | 2.8 | small taps |
| When to call | 8 | 32 | 576 | 3.7 | 10 cards in cards |
| Weeks, Activities | | | 744–1277 | 4.9–5.6 | |
| Calendar, Notes, Chat, More, settings screens | 2–5 | 0–5 | 24–121 | 1–1.7 | mostly fine |

After phone pass 3 (the child's page, Milk, More; same demo day). Numbers run over only on
screens that are lists: each row carries its time or amount, and a list of rows is the
pattern this bible asks for, so that overrun is the accepted exception.

| Screen | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| The child's page, Today | 8 | 25 | 146 | 1.6 | none |
| The child's page, Week | 8 | 23 | 95 | 1.4 | none |
| The child's page, About her | 6 | 1 | 39 | 1.7 | none |
| Milk | 8 | 23 | 93 | 1.5 | none |
| More | 7 | 1 | 48 | 1.5 | the photo link, the email line (as before) |

More's header, 12 November (Mido: "the profile pic and the text near it are working against
ux"): the photo spilled past the left edge and a loose "Change photo" link pushed the name
aside. Now the photo with a camera badge, as on the child's page, then the name and role;
rows in medium weight with 32 px discs. As Dana: taps 18 → 17, words 50 → 47, 1.7 → 1.6
screens; phone checks: wide and the small photo link gone, the email line as before.

Home, re-measured on 29 October 2026 (pass 3 never did), at 390 × 844 as Dana on a normal
day with one Now notice, before and after the backlogging pass:

| Home | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Awake | 6 → 6 | 16 → 14 | 62 → 58 | 1 → 1 | none |
| Asleep | 6 → 6 | 12 → 13 | 44 → 53 | 1 → 1 | none |
| Feed timer running | 6 → 6 | 10 → 12 | 46 → 51 | 1 → 1 | none |
| Simple mode | 5 → 5 | 5 → 6 | 33 → 35 | 1 → 1 | none (unchanged; the clock moved) |

After the Huckleberry pass (30 October 2026; the same four states, the log 40 minutes old).
The Today row went (the rows carry how long ago), the tiles became rows, the nap notice went
into the card at the top:

| Home | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Awake | 6 → 5 | 14 → 14 | 58 → 57 | 1 → 1 | none |
| Asleep | 6 → 5 | 13 → 10 | 53 → 44 | 1 → 1 | none |
| Feed timer running | 6 → 5 | 12 → 9 | 51 → 43 | 1 → 1 | none |
| Simple mode | 5 → 5 | 6 → 5 | 35 → 33 | 1 → 1 | none |

The other screens it touched, on the demo day: the child's page Today 8 → 7 blocks, 25 → 22
numbers, 1.6 → 1.3 screens (a list: the accepted exception); Week 8 → 8 blocks, 23 → 11
numbers, 95 → 69 words (the columns replace the bars and their figures); More and Milk as
before, More one row longer (Chat).

Awake was one number over: the Asleep tile repeated "awake 2 h 6 min" from the big line.
Asleep and a running feed went up a little because they now show the last diaper and sleep
too (the four tiles while she sleeps; "Woke 14:29 · diaper 1 h 38 min ago" during a feed),
and the feed card's own "Feeding, left · 9 min" header went.

Home, 24 November 2026 ("Same screen, calmer": the first of three screens redrawn with the
feel of Huckleberry and Sprouty in mind, the brand and these rules kept). The strip and the
notice had been added since the table above, and the first screen had drifted to 20 numbers.
Measured as an admin on a normal afternoon (four feeds, three naps, one notice with two more
waiting), before → after; a family carer with large text reads the same counts:

| Home, first screen | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Awake | 6 → 6 | 20 → 14 | 69 → 64 | 0.9 → 0.9 | none |
| Asleep | 6 → 6 | 17 → 11 | 56 → 56 | 0.8 → 0.8 | none |
| Feed timer running | 6 → 6 | 15 → 10 | 55 → 55 | 0.8 → 0.8 | none |
| The day's cards below (awake) | 5 → 5 | 12 → 12 | 63 → 59 | 0.7 → 0.7 | none |

What left the first screen: her age under the name (it is on her own screen), "06:10 woke"
and "of 3–4" from the strip (when she woke moved to the Sleep today card below), "Last sleep
15 min" on the Sleep row (the row now says what its button does), and the "+2" that led to
the child's screen. Below, "Usual at this age" left the Feeds today card (the Feeds section
says it). Nothing was added that is not one of these moved or reworded. The counts move by
one with the clock: "52 min ago" is one number and "1 h 1 min ago" two; both sides of the
table were read with the diaper an hour old.

## What lives where

Three levels, no more.

| Level | Screen | Holds |
|---|---|---|
| **Now** | Home | Her state (the next-nap window while awake, the running time while asleep or feeding); the one thing that matters now; the four log rows. |
| **Today** | The child's page | Today / Week / About her. Today: the totals strip and every entry as a list, "+ Log" at the bottom for anything less common than the four. |
| **Deeper** | Milk, More | Milk: the fridge and freezer as two cards that open to their bottles. More: one grouped list: Family (chat, members and who's here, calendar, notes, audit log), The helper (ask, what it remembers: suggestions to keep or drop first, then one line to teach it, then the list; what it can do), You (settings). Health and growth live under About her on the child's page. |

The bottom bar has Home, the child, a round **＋** in the middle, Milk and More (Huckleberry's
centre button). ＋ opens the child's log sheet (every kind of entry, *From earlier*) from any
screen: in place on Home and the child's page, so it never moves the person; from anywhere else
on the child's page, and closing the sheet goes back (13 November, `lib/log-bus.ts`). Its rows
use Home's line icons and names. Chat and Calendar live in More. Simple mode has no Milk. Home does not repeat the
bottom bar as a grid of tiles.

### Home

1. **Header**: the child's initial, name and who has her; on the right, the round
   *Emergency* button (phone, red). The microphone moved down into *Tell me* (item 5). Her
   age left Home on 24 November: it is on her own screen.
2. **Her state**, one card in big type. Awake: the **next-nap window** (Huckleberry's
   SweetSpot): "Next nap" or "Bedtime", how long she has been awake, the window as
   "11:20 – 11:50" (the forecast ± 15 minutes, on five-minute marks), a bar filling towards
   it, and one line: "In 25 min. Start winding down.", "Now.", or "Past the window by 20 min".
   Over an hour past it a nap was most likely not logged, so the card says when she last
   woke instead. Asleep: "Asleep 42 min, since 13:10". Feeding: "Feeding 9 min, since
   14:16". A running timer has a dot beside its word and, at the foot of the card, "All
   sleep ›" or "All feeds ›": the whole card opens that section, and now says so. With no
   sleep in 12 hours, plain "Awake for", or nothing (rule 6).
   From 12 months the window follows the child's own week (`napPattern` in
   `lib/child-insights.ts`, 17 November): one nap a day gives one window, then **Bedtime**
   once today's naps are done, whatever the hour. A child who has stopped napping gets no
   window at all, only "Awake for 5 h 20 min, since 07:00", held for 16 hours instead of 12
   (a child with no nap is up 12 to 13 hours); never "Past the window". More than an hour past
   a bedtime window it is the plain "Awake for", never "if she napped since".
3. **Today strip**: up to three counts in one white bar, one number over one word (3 naps ›
   · 4 feeds › · 3 diapers). "naps ›" opens the Sleep section and "feeds ›" the Feeds section:
   they are links and are drawn as links (rose, with the arrow); diapers is plain. Until 24
   November the bar scrolled to the day's cards and the way to the two sections was below the
   first screen. The last of each is on the rows, so the strip gives the day's totals instead.
   When she woke is on the Sleep today card below; what is usual at her age ("of 3–4") is on
   the Sleep section. From 12 months it holds only what the family logs (17 November,
   `stripCells` in `lib/logged.ts`): feeds and diapers only when that kind was logged in the
   last 7 days (today and the 6 days before); naps while a nap is expected or one was had
   today. `stripCells` still counts "woke" towards its rule (fewer than two cells, no strip);
   the strip draws the others, three at most.
   Once a parent has saved the child's day (`dayPlan().cells` in `lib/day.ts`), an answer turns
   a kind on and its count still needs that kind logged in the last 7 days, so saving the
   suggested day never brings a zero back. Milk as a drink has no count; meals or the potty
   may take a place (plain, not links); and the naps are held against the family's own answer
   ("1 of 2" over "naps ›"): what a family said itself stays, what is only usual at an age
   went to the Sleep section.
4. **Now**: one notice on one slim line (48 px, words cut with … rather than wrapping), the top
   of the order in rule 3, or nothing. Beside it, **More** opens every notice that applies in a
   sheet over Home (`NowMore`, 24 November; "+2" was a link to the child's screen, which did
   not show the two things it counted); never a link on a line of its own.
   The guide's most pressing tip is a candidate: a red one right after an overdue vaccine, a
   yellow one after "feed due". The nap is no longer a notice: the card says it.
   From 12 months there is no "feed due" and no guide tip (the guide is silent: no usual
   number of feeds or diapers to hold the day against). A toddler's slot keeps rule 3's order
   without them: an overdue vaccine first, then the plan or the handover, entries to check and
   a vaccine that is due; the thaw reminder and "Fridge is low" only where milk is kept. A dose
   from before the home began (the vaccine book's grey "not recorded") is never a notice.
   Two candidates come from "Cheers and shared nights" (below), both for a parent only: the
   other parent's night ("Sara was up twice in the night", lilac, a moon), from the night's end
   until noon, after entries to check and ahead of whatever can wait all day; and her own
   question ("Tell Omar how your nights go?"), asked until answered, last but the pumping nudge.
   The day's line ("Lana is one. Look at her day", or "Set up Noor's day" for a family that
   joined later; `dayOffer` in `lib/day.ts`) is one more candidate, for a parent only, plain
   with no tint. For its first 7 days it sits after entries to check and before a vaccine that
   is due: the 12-month visit is due the same weeks, and behind it the line would never be
   seen. From day 8 it sits behind the due vaccine, so a vaccine never waits behind a settings
   line for more than a week; after 30 days it is gone for that age. An overdue vaccine is
   always ahead of it. Saving the day, or "Keep it as it is", clears it for both parents.
5. **Log**, one white card at the thumb (Mido, 9 November: the helper is becoming the main
   way to log). On top, four **rows** (Feed, Sleep, Diaper, and a fourth that grows with
   the child: Meal once she eats, from 24 weeks; before that Pump while the parent who pumps
   still does (a pump in the last two weeks), else Medicine; `lib/stage.ts` decides). Each
   row: the tinted icon, the name, one line under it ("40 min ago · 90 ml"), and the round
   button on the right; a running timer tints its row and puts a dot before its line. The
   button's look says what a tap does (24 November: one solid ▶ used to start sleep at once
   and open a sheet for a feed): **solid rose ▶** starts the Sleep timer at once, the **dark
   ■** stops a running timer at once, a **soft ＋** opens the row's sheet (Feed, Diaper, the
   fourth row). The Sleep row's line says so in words, "Asleep? Tap to start" and "Awake? Tap
   to stop"; someone who may not log reads "Last sleep 15 min" or "since 13:10" there
   instead. Tapping the row opens its sheet. Rows, not a grid of four tiles: the tiles (9 to
   12 November) cut every line to "2 h 41 min ago · 13…" and read as clutter (Mido, 12
   November: "too messy and text heavy"). Under the rows, a hairline, then **Tell me**: a box and a
   microphone. Typing or saying "120 ml bottle", "wet diaper", "fell asleep 10 min ago" or
   "woke up" saves it at once on the phone, with Undo (`lib/assistant/quick-log.ts`, no model
   call, works offline); "changed a diaper" asks Wet / Dirty / Both as buttons; anything else
   goes to the helper. It all opens in a sheet over Home, never a new screen; *Open the full
   chat* goes to Ask. At night while she sleeps, *Up for the day* is in the sleep sheet.
   **From 12 months Home never rearranges itself**: the alarms stop by age (17 November), but
   the rows stay as above until a parent saves the child's day. Then (`homeRows` in
   `lib/day.ts`, 23 November) the four are Meal, Sleep, Diaper and Milk: the Feed row is named
   "Milk" where milk is a drink with meals, and stays "Feed" where the family keeps the clock.
   A row the family does not use (diapers or milk "Not logged") gives its slot to Medicine,
   then Note (only where the Note type is on), as rows that open their screens. A row is
   swapped, never added: four rows, or three in a home that logs neither and has no Note.
6. **Below the log card** (`#today`, Mido, 7 November: Home and the dashboard are one): Sleep
   today (the bar from midnight and one short line, "up at 06:10 · 3 naps", which left the
   strip on 24 November), Feeds today (when the next is due and what went in; what is usual
   at her age is on the Feeds section), Food today once she eats, and pumping for the member
   who breastfeeds and admins while it goes on.
   From 12 months Feeds today shows only when a milk feed was logged in the last 7 days
   (`feedCard` in `lib/logged.ts`), and says no time and no usual number: "Feeding now"; fed
   today, the day's sum ("180 ml in 1 bottle", "2 breastfeeds") over "Last at 18:40."; none
   today, "None today" over "Last: yesterday 18:40.". Never "yet", "due" or "usual". Food
   today is the count alone ("4 meals"): a snack logged as a meal is not a fourth of three.

**Timer sheets.** Feed: *When*, then Breast / Bottle as a segmented control (it opens on the
method of the last feed). Breast: Left and Right as two big buttons, the running side marked,
and Done. Bottle: which milk and the amounts as chips, the usual one marked. Sleep: a big
round *Asleep now* (or *Woke up now*, *Back to sleep*) button, then "or it already happened"
with the clock times already open; picking one asks *Still asleep* or when she woke, as
clock times ("13:45 · 45 min"). A feed timer runs an hour at most and a sleep a day: past that it was
left on, so it stops by itself at the usual length (a feed 20 min, a sleep 12 h), says so in
its note, and *To check* shows it. Home never shows a timer past its limit as running.

**Edit an entry** (the child's page): tapping an entry opens a sheet, not a page: when it
started (typed, on the entry's day; *Yesterday* moves it back), when it ended as clock-time
chips or typed (an end before the start is the next day's), its choices and amounts
as chips, Save, and *Delete this sleep* (a second tap confirms). *All details ›* opens the
full form for a note or a photo.

**Fix it from Home** (Mido, 7 November: a bottle logged twice, a sleep ended at the wrong
time). Every tap that logs something says so with **Undo** beside it for half a minute; Undo
deletes what that tap logged, once the server has it (a tap kept on the phone with no signal
has none: it is fixed from Recent once it lands). The Feed
and Sleep sheets end with **Recent feeds / Recent sleeps**: the last four, each one tap from
the same edit sheet, so a wrong time or a double is fixed without leaving Home. The checks'
buttons say what they do ("Delete this one", "Both were real"), and after a decision the card
says how to change it later.

### Logging what already happened

Dana's second ask. The yardstick is Huckleberry's "Set time" and BabyLog's two or three taps:

- **When** is one line on every log sheet: "When: now · earlier?". Earlier opens clock times
  on a ten-minute grid for the last two hours (13:50, 13:40, …) and a box to **type the time**
  (Mido, 7 November): "2130", "21:30", "930", "9pm", read back as "= yesterday 21:30". It is
  the most recent such time; *Yesterday* moves it a day back; a time after now is refused in
  words. Clock times, never only "80 min ago". Picking a chip folds the line. A sleep from
  earlier takes its end the same way: the length chips, or "or woke at" typed.
- **The time carries over for a minute.** After an entry from earlier, the next sheet opened
  within a minute starts on that time (a bottle and a diaper from the same moment). A round
  ▶ or ■ never uses it, so a direct tap is never quietly backdated.
- **No keyboard on Home's sheets.** Every amount is a chip; the last bottle's amount is marked
  as the usual one (and added as a chip if it is not one).
- **A sleep from earlier** is the Sleep row → a time → "Still asleep" or when she woke (20 min to 2 h after).
  One landing on a sleep already logged says so in the sheet ("On top of a sleep from 13:00
  to 13:45") with *Change it* and *Log anyway*, never a silent stack.
- **Anything else from earlier** (a breastfeed with its length, a pump, a past day) is the
  ＋ → *From earlier*. It stays off Home: Home's four rows already take
  their own entries from earlier, and another row would break Home's one screen.
- Measured (`scripts/backlog-scenario.mjs`): at 14:00, a 90 ml bottle at 12:40 is 4 taps from
  Home (Feed ▶, When, 12:40, 90 ml) and a 13:00–13:45 nap is 3 (the Sleep row, 13:00, 13:45).
- **A tap answers at once** (rule 9), measured by the same script with the server 600 ms
  away (`SCENARIO_LAG=600`: a phone in Dubai and a cold server): from tapping *Asleep now*
  to the Sleep row offering *Woke up* was 1.86 s and is 61 ms; *Woke up* back to *Asleep
  now* was 1.83 s and is 43 ms. The rows are never locked while a request is out, so a
  correcting tap right after a wrong one works. Home's four states measured the same
  before and after (31 October 2026).

Off Home: the "Say it / Emergency / Vaccines" chips (the first two move into the header, a
vaccine that is due becomes a Now item); the right-now carousel; the milk card (a Now item
only when the fridge will not cover today); the guide's warnings (one Now item at most, the
rest on the child's page); Pumping (Milk); Day so far (the Today row); the eight shortcut
tiles (the bottom bar and More); the helper's arrived/left buttons (Who's home); the Today
row (the log rows say how long ago); the nap notice (the card at the top).

### The child's page

The photo, name and age (tap the photo to change it), then a segmented control: Today /
Week / About her.

- **Today**: the pager Feeds and Sleep use ("Today" over "Wed 25 Nov", two arrows, a swipe).
  It says "Today" under the Today tab: the tab is the tab's name and stays lit on any day, the
  pager says which day, and a weekday there means a day past. Here the pager has no first
  day: the arrow back always works, as the old one did. Then the totals strip, *To check* as a yellow fold
  when it has something (the one bar on the tab that asks for action, so it keeps its
  colour), then what there is to read as rows of one white list (the guide; *Suggested*),
  the day's entries as a timeline list (time,
  icon, what and how long, who; a tap opens its edit sheet), and **Add to this day** as the
  bottom button on a past day (today, the bar's ＋ does it). The log sheet: how she is right
  now (one tap), every kind of entry as a row, and *From earlier* for something missed.
  With a saved day the totals are the day's (`dayPlan().tiles`): up to four of sleep,
  breastfeeds and bottles (on a clock) or one milk tile (a drink: the day's ml, else how many),
  diapers and meals, each only when logged in the last 7 days; the log sheet leaves out Pump
  where no milk is stored, and *From earlier* leaves out what the family does not log.
- **Week**: the last seven days as **24-hour columns** (Huckleberry's schedule view):
  midnight at the top, sleep as lilac blocks, feeds as ticks, a line for now, today outlined.
  The title is the answer ("Longest sleep 6 h 40 min, up from 5 h") and sits in the chart's
  card. A whole day's column is
  the tap target and opens that day (feed ticks and short naps are far under 44 px, so they
  are not taps of their own). Mood, when it was tapped, is a card under the columns. Then one
  white list whose rows open in place: against her age (a day's average over the days
  logged, each kind over the days it was logged: `dayAverages` in `lib/norms.ts`), coming up,
  sleep rhythm, day by day, the helper. From 12 months a kind
  shows in "against her age" and "day by day" only when it was logged that week, and with
  nothing to list the fold is not drawn. "Coming up" lists no feed, diaper, nap or wake (milk
  has no clock): it holds the plan card only, and is not drawn without a plan.
- **About her**: three groups of rows: Health (doctor,
  when to call, vaccines, medicine, emergency, for the doctor), Growing (what this age brings,
  a row that opens where it stands; growth and trends,
  firsts, week by week, play, story), Care (handover, ask about her). The name, the birth date
  and girl or boy are changed on Doctor, in the health card's edit form, by an admin; a new
  birth date asks once before saving, since everything that goes by age changes with it.
  For a parent of a child of 12 months or more, Care begins with "{Name}'s day", with the
  plain pill "look" while Home offers it.


"Quieter lists", 25 November 2026 (Mido's pick of three options; "To check" kept yellow at
his word). Every tab was over on blocks: a stack of tinted bars is a block each. What opens
in place is now a row of one white list (`Fold flat`): the row keeps its tinted disc, its
words, its hint and what it opens, and loses the bar. Red is the one colour that still
crosses a row (the guide when it says to call the doctor, which also opens by itself). As
an admin at 390 px, before → after; a family carer in large text reads the same counts and
2.2, 1.5 and 1.4 screens:

| The child's page | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Today | 9 → 8 | 41 | 149 → 150 | 2.0 | none |
| Week | 10 → 4 | 10 | 65 | 1.5 → 1.4 | none |
| About her | 9 → 8 | 1 | 39 | 1.4 → 1.3 | none |

Today stays over on numbers (a list of entries, the accepted exception), and it sits at the
word budget: each entry of the day is a row of about five words, so the count read in the
afternoon (150, with 11 entries) is passed by the evening. What left: the old
arrow-and-date pager, the five fold bars on Week, the yellow or lilac bar of the guide and the
blue one of Suggested, and "What this age brings" as a block of its own.

### The child's day (`/baby/day`)

What a parent says about a child of 12 months or more that age and the log cannot
(`docs/AGES.md`, step 2). One screen, built as the log form is: the title alone ("Lana's
day"), one white card with a row per question, Save as the bottom button. No helper button.

- **Milk**: A drink · On a clock · Not logged. **Naps a day**: Two · One · None.
  **Diapers**: Diapers · Not logged. **Bedtime** and **Morning** as two time boxes.
  **Stored milk**: Yes · No; with bottles in stock it is not asked, and the row says
  "Stored milk: 4 bottles in Milk." and opens Milk.
- Under a chosen answer, one muted line only where the answer changes a screen ("Milk is
  logged. Nothing is due.", "No milk row on Home.", "No nap window and no nap reminder.", "No
  Milk tab and no Pump in the + menu.", "Sleep between these is the night, on past days too.").
- The answers come filled in (`suggestDay`): a saved day as it is; else from the last week
  where three or more of its days have entries; else by age. Milk is never pre-set to "On a
  clock", and bedtime is never guessed from the log (a guessed time saved unseen would
  re-split past days). One line under the title only when the answers are a suggestion.
- Beside Save, a plain word: "Later" once after sign-up, "Keep it as it is" from Home's line.
  A refusal shows the database's own words in the card.
- A parent's screen: anyone else, and a baby's family, are sent to About her, and the
  database refuses them too (`subject_day_save`). Budget: 5 blocks, 4 numbers, 100 words, 1.5
  screens (`scripts/ui-audit.mjs` holds it; measured 3 blocks, 1 number, 47 to 59 words, 1.1).

### The vaccine book (`/baby/vaccines`)

One card per visit. A visit takes the first state that fits: every dose given, *given*; any
dose overdue, *overdue* (red); any due, *due*; the rest from before the family joined, with
or without some recorded, *earlier*; then *unknown* and *upcoming*. A dose whose window closed
before the child's row was made (migration 6500, 17 November) is earlier: never due, never
overdue, never a Now notice, a push or a line in the helper's due list. Earlier visits sit last,
in one closed fold, "From before {Name} was on elnunu", hint "3 visits", with one line inside:
"Not recorded here. Tap Given for any {Name} had." Each card has the plain pill "not recorded"
and no sentence; its all-given button is a plain button, and the date box starts empty, never
on the scheduled date. Earlier visits are never "now", and the next upcoming visit ignores
them. The doctor's printout says "not recorded" for such a dose, never "due {date}". Grey
here means nothing to do now (rule 7).

Handover is its own screen (`/baby/handover`); old links to the Patterns, Handover and Ask
tabs go to Week, that screen and Ask.

### Milk

Fridge and Freezer are one card each, closed, saying how many and how much ("2 bottles ·
270 ml"); tapping one opens its bottles in place (Mido, 9 November: a long list of bottle
cards was a mess to the eye). What is past its time is a third card, open by itself. Each
bottle is a row ("90 ml · use first", "Pumped today 08:00", "3 days left" on the right; a
pill only when under a day or past); tapping a bottle opens a sheet with Warmed (or Thaw), Used and
Bin. "Put a bottle away" is the bottom button and opens a sheet: fridge or freezer, the
usual amounts, another amount, a photo of the label, and one line on how long milk keeps.
A bottle given takes its milk out of the stash, however it was logged (Home's sheet, the
helper, Tell me; `lib/milk-take.ts`, Mido, 10 November): "Freezer" milk takes the oldest bag
out of the freezer, a pumped milk comes out of the fridge, formula or no milk named takes
nothing. Such a bottle has no Undo (deleting it would not put the milk back); it is fixed
from its entry. The plan for the day shows only on a day someone is away; how long the fridge will last
is a fold. Pumping is a bar like Fridge and Freezer (`FoldLink`: "Pumping · 250 / 400 ml ›") that
opens Home's day cards; the forecast bar gives its answer in the hint ("Fridge lasts · till Sat").
From 12 months, in a home with no bottle in stock and no pump in 14 days, neither the fold nor
the bar shows, and a toddler's Milk screen never says supply is lower than last week.
Where the child's day says no milk is stored, the tab is gone and "Put a bottle away" gives way
to one line that leads a parent to the day and tells anyone else whom to ask; a bag already in
the stash can still be used or binned. Nothing new goes into the stash while the answer is No.

### The day's cards (Home, below the log card; `/baby/dashboard` goes there)

The dashboard Mido asked for (3 and 4 November) is Home's lower half since 7 November:
Sleep today, Feeds today, Food today, then pumping: the goal card (pumped since last
evening, the bar to the goal, how many pumps), the bottles at home as two tiles (fridge,
freezer: bottles and ml), and "A usual day" (the average of the last seven days' pumping
days, one small bar per day with today beside them, one line on how today compares). The
pumping part shows to the member who breastfeeds and to admins, and fades two weeks after
the last pump unless bottles are in stock. A baby's home that never pumped still sees it (a
new parent may start). From 12 months it needs a pump in the last two weeks or bottles in
stock; without either there is no pumping part, no bottle tiles and no "Fridge is low".

### The Sleep and Feeds sections (`/baby/sleep`, `/baby/feed`)

Mido, 7 November: tapping any sleep card lands in one place that gathers all sleep, and the
same for feeds. Reached from Home's strip ("naps ›", "feeds ›"), its state card (feeding:
Feeds; otherwise Sleep), "All sleep ›" and "All feeds ›" under Sleep today and Feeds today,
"Feed due" and the guide's sleep or feed tip.

**Both are one day at a time** (24 November, "The day, swiped": the second and third screens
redrawn with Huckleberry and Sprouty in mind), in one frame, so the two work as one place.
Feeds, top to bottom:

1. **Feeds | Sleep**, a segmented control of two links: one tap across to the other section,
   on the day this one shows.
2. **Now**, on today only: Breast and Bottle side by side for the parent who breastfeeds
   (one word each: "Log a bottle" broke in two at 320 px), Log a bottle alone for everyone
   else. Both open
   Home's feed sheet over this screen, already on the right half; nobody leaves the section to
   log (until now each button went to another page). While a feed runs they give way to a
   pink card: "Feeding, left", since when, the running time, and one dark **Done feeding**;
   tapping the words opens the sheet (to switch sides). It is `LanaNow` with `section="feed"`,
   so the taps, Undo and Recent are Home's own.
3. **The day pager**: "Today" over "Tue 24 Nov" between two arrows. A swipe across the screen
   does what the arrows do. Today and the six days before; `?day=2026-11-23` names a day
   (`lib/day-nav.ts`), anything else is today.
4. **The day's card**: on today the next feed ("Next feed about 16:25", exactly as before); on
   an earlier day the count ("7 feeds"). Then the **day bar** from midnight to midnight, the
   feeds as strong pink marks over the sleep drawn faint, so "fed after the nap" can be seen;
   then what went in ("4 feeds · 250 ml in 2 bottles · 2 breastfeeds") and the night that
   ended that morning ("Last night: 3 feeds").
5. **That day's feeds**, nothing else; tapping one opens the edit sheet. A feed still running
   says "now" on the right.
6. **The week** against what is usual at her age, folded.

What left the screen: the six folds of "Earlier this week" (each earlier day is a swipe away,
as a whole screen), the "Last night" card (one line on the day's card), "Usual at this age"
on the card (the week's fold says it), the "Today, 4 feeds" heading (the pager names the day,
the card counts it), and the trips to the two logging pages. A day before today has no
buttons: it is for reading and fixing.

A list page: its numbers are the entries'. As an admin on a normal afternoon, before → after:
10 → 7 blocks, 26 → 19 numbers, 106 → 81 words, 1.6 → 1.2 screens, 50 → 11 things to tap;
while a feed runs 10 → 7, 26 → 21, 110 → 89, 1.6 → 1.4, 51 → 12; a family carer with large
text 9 → 7, 26 → 19, 105 → 80, 1.7 → 1.3. Phone checks pass. The bend, named: a swipe between
days is a sideways gesture. Nothing on the screen is wider than the phone and nothing scrolls
sideways, so the audit's check reads zero, and the arrows do the same job; while the section
is open the browser's own sideways "back" is switched off (`DaySwipe`), or Chrome would leave
the app on the first swipe.

From 12 months the Feeds section's fold has no "usually" hint, and the night's line shows only
when a night feed was logged.

**Sleep** has the same frame: Feeds | Sleep, now (on today only), the day pager, the day's
card, that day's sleeps, the week folded. What is its own:

- **One timer.** Now is the big round button and, under "or it already happened", the three
  latest clock times and **Other** (which opens the twelve and the box to type one). It is
  Home's Sleep sheet drawn on the screen (`LanaNow` with `section="sleep"`), so it says and
  does what Home's does: "Asleep now", "Woke up now" over "asleep 26 min", "Back to sleep"
  after a night wake, "Up for the day" at night, "Still asleep" or when she woke for a sleep
  from earlier, the warning when it lands on one already logged, Undo. Until now this screen
  had a second timer (`QuickSleep`) with other words ("since 14:04" on the button, the time
  behind a small "earlier?" chip).
- **The day's card** is `SleepDay` without its title row: what she is doing or, on an earlier
  day, when she got up; the bar with the day's feeds as thin pink marks; the sums; and the
  night that ended that morning as one line ("Last night: 9 h 50 min · longest 5 h 5 min",
  with the wake-ups when there were any).

What left the screen: the six folds of "Earlier this week", the "Last night" card (one line),
the "Sleep today" label with "awake 17 min" beside it (the pager names the day, the headline
says "Up from a nap at 14:12"), "since 14:04" on the button (said once, on the card), and the
"Today, 4 sleeps" heading. As an admin on a normal afternoon, before → after: 10 → 7 blocks,
30 → 26 numbers, 107 → 85 words, 1.9 → 1.4 screens, 44 → 14 things to tap; asleep 10 → 7,
32 → 26, 113 → 85, 1.9 → 1.4, 45 → 14; a family carer with large text 10 → 7, 30 → 26,
107 → 85, 2.0 → 1.5. Phone checks pass. The same bend as Feeds: the swipe.

### Week by week (`/baby/weeks`)

One stretch is one card (24 November, "Cards you swipe": the fourth screen redrawn, with
Sprouty's cards in mind, in the frame Feeds and Sleep got). The words are the twenty stretches
of `lib/leaps.ts`, written per stretch (2 to 26 weeks long), not per week. Top to bottom:

1. **The pager**: "Now" over "Weeks 21 to 25" between two arrows; a swipe does what the arrows
   do. It opens on the stretch she is in; the one after reads "Next", the rest "Later" or
   "Earlier". `?stretch=26` (a stretch's first week) names one (`stretchNav`), anything else
   in the address is the one it opens on. With no birth date it opens on the first stretch
   and past three years on the last, and the pager shows the weeks alone.
2. **The card**, in the guide's lilac: "Week 24" and "week 4 of 5" over a bar that shows how
   far through the stretch she is (her own stretch only); the title; "often a harder
   stretch" where it is; **What it brings**; **Try**; the source. A stretch still to come says
   how far off it is ("starts in 2 weeks", "in about 6 months", "in about 2 and a half years":
   to the half year, since the last stretch begins at two and a half).
3. **Where it is**: a line of twenty marks from birth to three years. The stretches behind
   her are filled, hers is dark, and a ring marks the one the card shows. Past three years
   all twenty are filled and none is hers; with no birth date none is filled.
4. **All the stretches**, one fold: the twenty by name with their weeks, hers marked "now";
   tapping one opens its card.

What left the screen: "Mia is in week 24" under the title (the card says it), the Coming up
list, and the "Later" and "Earlier weeks" folds, which held titles only: until now four
stretches could be read (hers and the next three) and sixteen could not. As an admin with a
five-month-old, before → after: 7 → 6 blocks, 6 → 10 numbers, 135 → 112 words, 1.3 → 1.1
screens; a family carer with large text 1.5 → 1.3 screens. Phone checks pass. The bend is the
one Feeds and Sleep made: the swipe.

### Trends (`/baby/trends`, About her → Growing)

How has she been doing, for us and for the doctor? One chart a screen (Mido's pick of three
options, 25 November: "Charts you swipe"). The long page it replaces held the same charts
under one another and was the screen furthest over every budget.

- **The pager** names the chart and its place ("Sleep" over "3 of 11"); its arrows and a
  swipe go to the one before and after. The screen opens on the first, the 14-day picture;
  `?chart=sleep` names another, and anything else in the address is the first.
- **The charts**, in the order the long page had them, each only when this child has it:
  Patterns, Against her age, Sleep, Longest stretch, Feeds, Bottles, Diapers, Weight,
  Length, Head, Firsts. A baby's kind is listed when it was logged at any time in the year
  read, so the list does not change with the range; a range with none of it says so in one
  line. From 12 months a kind is listed only while the range has it (what the family stopped
  logging is left out, not said), except the chart the address names: the range switch
  never pulls a chart out from under the person.
- **The range** (2 weeks, 6 weeks, Since birth) is one segmented switch over the five
  charts it drives, and is not drawn on the others. It changes at once and is written into
  the address (`?range=6w`), so the next chart, a reload and the way back from "For the
  doctor" all find the range last picked.
- **One fold**, "All the charts", lists them by name with "here" on the one showing; a row
  opens its chart and the fold shuts.
- **Back** leaves Trends in one tap however many charts were paged through: a step replaces
  the address instead of adding to the history. The same now holds on every pager (days on
  Feeds, Sleep and the child's Today tab, stretches on Week by week), where Back used to
  undo one step a tap.
- The wet-diaper warning in "Against her age" is a line of its card, not a box in it. A
  child with no birth date gets the plain weight line, with its axis words in the page at
  13 px as on every other chart (they were 9 and 10 px in the drawing).
- "For the doctor" stays the header's button on every chart.

As an admin at 390 px, the long page → one chart of the new one:

| Trends | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Before, one page | 16 | 139 | 457 | 5.1 | card in card |
| Sleep (a bar chart) | 5 | 15 | 46 | 1.0 | none |
| Patterns | 4 | 22 | 71 | 1.1 | none |
| Against her age | 4 | 23 | 125 | 1.3 | none |
| Weight (the chart and six rows) | 5 | 33 | 111 | 1.3 | none |

Every chart passes the phone checks at 390 and 320 px, as an admin, in large text and in
the toddler homes; none is over on blocks, words or screens. Numbers stay over on most: a
chart's own numbers are its axis and its dates, and Against her age and Weight are lists of
figures. That is the same exception a list of entries has. What a chart says besides was
trimmed: the fold carries no count, because the pager says it. What left: seeing two charts
at once. Rules named as bent: "nothing scrolls sideways" (the swipe, with the arrows as the
way around it).

### Sleep today (Home's day cards and the child's Today tab)

First among Home's day cards and under the Today tab's day strip, a `SleepDay` card: "Woke up at 07:10 · awake 2 h 15 min" (after a nap,
"Up from a nap at 14:10"; asleep, "Nap since 13:00 · 45 min"), the day's sleep path as one bar
from midnight to midnight with the night she woke from, each nap and a mark at now, then
"up at 07:10 · 2 naps, 1 h 30 min · night 11 h 40 min". Home's state card says "up since
07:10" beside the next-nap window and "since 07:10" under "Awake for", so the morning wake
Dana taps is read back on both screens (Mido, 4 November).

### Achievements (`/achievements`, More → Family)

Badges for what the grown-ups do, never for the baby's own numbers (Mido, 9 November: "mainly
designed to motivate Dana and the rest, not Lana"; how much she drinks or sleeps is hers to set).
A run of N days on the pumping goal (first, bronze 3, silver 7, gold 14, diamond 30), days well
over the goal (110% or more: 1, 5, 15), and the freezer stash (500 ml, 1 l, 2 l, the family's).
The database awards them from the log (migration 5900); the client never writes one.

Rewards lift, they do not add guilt (Mido, 26 November). Three rules follow, for every reward
the app gives:

- **A run forgives one day off a week** (migration 6900). A bad night, a low day or a day out
  is stepped over: it adds nothing to the count and does not end it. A second day off in the
  same week does end it. The shelf says so in one line under the track.
- **The app never says a run was lost.** A run that ended is simply not spoken of, and the
  medals already won stay. Home's nudge names what today would add ("makes it 5 days on
  goal"), never what a short day would cost (it read "keeps your 4-day run" until then).
- **The small moment on every save.** A medal is rare; a save is many times a day. Every log
  that is saved, sent or kept on the phone, gives a soft buzz (`lib/moment.ts`, called where
  every save passes, `lib/offline.ts`) and a tick that fills beside the words that say what
  was saved (`SavedTick`: Home, Feeds, Sleep, the two quick screens, the simple screen).
  About a third of a second, nothing to dismiss, nothing in the way at 3 am, and never beside
  an error. No buzz and a still tick for someone who asked for less motion. The web cannot
  buzz an iPhone: there the tick is the whole moment.

- **The moment**: it never stands between a parent and the log (12 November: at 3 am the
  medal covered Home before a feed could be tapped). Home opens as usual with one slim line
  over the tab bar, "You won Bronze ›", and × for not now; left alone it slips away after 12
  seconds, and either way it comes back on the next open until seen (until 26 November the ×
  marked it seen for good, against its own label). Tapping it plays the moment: the screen dims,
  confetti bursts, the medal spins in, the phone buzzes; the title says the tier ("Silver!"),
  one line says what it took, "and 3 more on your shelf" counts the rest. Lovely closes it;
  See the shelf opens the shelf. Once per person per badge, on every phone. No motion for
  someone who asked for less.
- **Home** gains no block. While a pumping run is going and today is short of the goal, the
  pumping parent's one notice slot may say "190 ml more today makes it 5 days on goal", last in
  rule 3's order, so anything that matters more wins.
- **The shelf**: one card per kind, every medal in a row (won in its metal, the rest a grey
  outline to aim for), what the next needs with a bar, and the latest won.

### Cheers and shared nights (26 November)

Rewards, step 2. A medal is the app speaking; a cheer is a person. And the heaviest thing a
mother carries is the night, which nobody sees. So: one member can send another a short line
about something they did, and a parent who chooses to can let the other parent see, the next
morning, how her night went, with one tap to take the child and one to send a cheer.

**A cheer** (migration 7000: `cheers`, `cheer_send`, `cheers_seen`; `lib/cheers.ts`)

- From anyone who can see the child's log, to anyone else in the home who can. About one of
  four things, each of which must be real and theirs: an entry they saved, a medal that is
  theirs, their night (see below), or a day they saved something on (the database takes it;
  its door comes with the weekly recap).
- **Sending** (`CheerSheet`): "A cheer for Sara", one muted line saying what for, then three
  set lines, one tap each: "Thank you", "Proud of you", "You are doing so much". Or the
  sender's own words, 80 characters. Then a tick and "Sent to Sara." The words thank and
  notice; none measures, compares or asks for more (a unit test holds them to it).
- One cheer from a person about a thing: again says "You cheered this already." A dozen a
  day from one person is the most ("That is plenty for today. They all arrived."): a cheer
  is worth something because it is not a stream.
- **The doors**, each a few words on a line that already names what was done: the night sheet;
  the shelf's "Latest: Bronze · Sara · 24 Nov · Cheer ›", when the medal is someone else's;
  the entry sheet's "Logged by Sara" with "Cheer" at its right, when that is not me.
- **Receiving**: the medal's slim line over the tab bar, on Home: "Omar sent you a cheer ›".
  Cheers come before medals, oldest first, and there is never more than one line. Tapping it
  shows the words on the medal's card, with a heart where the medal would be (the medal
  itself for a medal cheer), who sent it, what for, and "and 2 more". No confetti: it is a
  person speaking, not a prize. "Lovely" brings the next, and only "Lovely" closes it: a
  tap beside the card does nothing, and the card holds for a moment after it opens, because
  there is no list to find the words in again. Opening is reading, so it is marked seen, on
  every phone; × is "not now" and marks nothing, so a cheer is never lost unread. Only the two of them ever read it: the table has no direct read for anyone, and an
  admin viewing as her is not handed it.
- Someone on the simple screen cannot be cheered yet: that screen has no place for the line
  and one spare database call, and the sender is told so in plain words.

**A night that may be shared** (`night_shares`, `me_night_share_set`, `me_night_share`; `lib/nights.ts`)

- **Off until she says yes.** Nothing is worked out for anyone before that. She is asked on
  her own Home, in the Now slot (`NightAsk`), until she answers: "Tell Omar how your nights go?", only
  where there is another parent to tell, in the daytime, and only once a real night of hers
  would give a line. The sheet shows her the very words he would read, made from that night,
  and says what it is: a guess from what she saved, seen by him and nobody else, until noon,
  after a night with two wakings or more. It also says what the switch does not hide: the
  log still shows who saved each entry, as it always has. "Yes, tell Omar" or "No thanks";
  either ends the asking, closing the sheet does not.
- **Hers to change**: More, Display, "Tell Omar about my nights". Nobody can turn it on or off
  for her, and not while viewing as her.
- **Hers to read.** Her answer is not on her member row, which every admin may edit and
  every carer may read: it is in a table no signed-in role can touch, behind functions that
  answer only her. A no is told to no one, and neither answer leaves a line in the audit log,
  which every admin reads. (The first draft kept it on the member row; a review caught that
  the other parent could have switched it on himself.)
- **A yes is to the names she saw.** The parents her screen named go with her yes, and only
  they are told. When another parent joins the home her yes waits, for everyone; the next
  time she opens her Home or her Display that waiting yes is ended for good, so it cannot
  come back by itself if the newcomer leaves, and she is asked again with both names. A yes
  she gave as a parent also ends if she stops being one. A no stays a no.
- **"Her" has to mean her.** An admin could once re-point a member row's account with one
  direct write and then sign in as that member. A member row now keeps the account it is
  linked to (`members_keep_account`), which protects her answer, her cheers and everything
  else that is hers alone.
- **The rule**, each figure a constant at the top of `lib/nights.ts`: the night runs from
  23:00 to 06:00 at home (or to the child's morning when that is earlier); only what she
  saved herself counts, never what was saved in her name; a timed entry (a breastfeed) is
  time awake from start to end, at most 90 minutes, and a sleep or a timer the app closed
  is one moment; saves within 30 minutes are one time up; what is saved in the first hour,
  before midnight, is the end of the evening and not a time up (a last feed at 23:05 and the
  child's sleep at 23:40 are bedtime); under two times up, nothing is said at all.
- **The morning line** (`NightNotice`): on the other parent's Home, from the night's end
  until noon: "Sara was up twice in the night" (twice has no digit; from three, one number,
  as rule 4 asks). It is a Now-slot candidate, after entries to check and ahead of what can
  wait all day, because it ends at noon. Only parents see it, never in "view as", never on
  the simple screen, and she is never shown it about herself.
- **The sheet behind it**: "Up 3 times." and "Longest quiet stretch: about 2 h." (rounded
  down to the half hour: an estimate should not look exact), then "Sara chose to share this.
  It is a guess from what was saved." Two things to do: **I have Mia now** (the header's
  "with ..." switch, in one tap) and **Send a cheer**. Taking the child keeps the sheet open
  so a cheer can follow, and only then is "Rest, I have the morning" offered, because only
  then is it true. Once he has cheered that night or taken the child, the line has done its
  work and is gone.
- It never judges: no "only", no "bad night", no comparison with other nights or other
  people. She sees her own night's two lines only inside the question, each time she is
  asked, so that she knows exactly what she is saying yes to; nowhere else is a number about
  her night ever shown to her.

**What it costs the screens.** Home gains no block and no database call: the cheers and who
shares ride in `achievements_check()`, which Home already calls, as does her own answer,
and the night is read from the week of entries Home already holds. Measured as an admin at
390 px on a morning with a broken night, before → after:

| Screen | Blocks | Numbers | Words | Screens tall |
|---|---|---|---|---|
| Home, first screen, his (the line waiting behind More) | 6 → 6 | 14 → 14 | 65 → 65 | 0.9 → 0.9 |
| Home, first screen, hers (the question waiting behind More) | 6 → 6 | 14 → 14 | 65 → 65 | 0.9 → 0.9 |
| Display, hers | 2 → 2 | 2 → 2 | 58 → 75 | 1 → 1 |
| Achievements, his | 4 → 4 | 10 → 10 | 95 → 98 | 1.2 → 1.2 |

In the demo home three notices outrank the line, so it waits behind More and the first screen
reads the same. When it wins the slot it takes the place of the notice that would have
shown: eight words and at most one number on the one line. Phone checks pass on all four.
Display makes one more call for a parent (her own answer and the other parent's name); it is
not an everyday screen.

**Left out on purpose**: a push (the line is there when he opens the app, and a buzz at 6 am
is nobody's gift); a list of past cheers (the moment is the point); the simple screen;
any promise about tonight.

### Effort, counted (`/achievements/effort`, 28 November)

A medal is rare and a cheer needs someone to send it. This is what the log itself can say,
any day, to whoever did the work: how much was given. "Since Mia was born", reached from the
first line of Achievements and from Home at each monthly birthday.

- **What it shows**: one white list, one number a row (rule 4): Days of care, Feeds, Hours at
  the breast, Litres pumped, Diapers, Times settled to sleep, Meals. A kind with nothing
  saved is left out, never a zero: a home that does not pump is not told "0 litres".
- **Whose**: a two-way switch, **You** and **Everyone**. A person sees their own sums and the
  whole home's, and never another member's: the database function answers those two and no
  more (`effort_totals`, migration 7050), so no screen can set one person's numbers beside
  another's. Rewards lift; they do not compare.
- **Nothing to reach.** No target, no bar, no "this month against last", no streak. The
  numbers only ever grow. Under the list, one line: "Counted from what was saved, since
  6 July 2026. What was not saved was still done."
- **Credited as the app shows it**: an entry counts for the member it was saved for when
  there is one, else for whoever saved it, the same name the entry's sheet shows. A
  breastfeed counts for as long as it ran, at most 90 minutes.
- **On Home**: for three days from each monthly birthday, one line in the Now slot, "5 months
  with Mia, counted", last but her own question and the pumping nudge, so anything that asks
  for something comes first. It needs no database call: the birth date and today. No push.
- Measured as an admin at 390 px: the new screen 4 blocks, 7 numbers, 49 words, 1 screen.
  Achievements gains its first line: blocks 4 → 5, numbers 9 → 9, words 88 → 92, screens
  1.1 → 1.2. Home's first screen is unchanged in the demo home (the line waits behind More).
  Phone checks pass on all three.
- **Left out on purpose**: the other parent's sums (her effort is hers to show; a cheer is how
  he answers it), nights (a count of broken nights is not a gift), and anything by month.

### The small screens brought inside the budget (25 November)

Seven screens were over a budget or failed a phone check after the three redrawn ones; each
was mended to the rules above, with nothing new on any of them. As an admin at 390 px,
before → after:

| Screen | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| More (`/me`) | 9 → 8 | 1 | 45 | 1.5 | tiny text → none |
| Display (`/me/display`) | 2 | 2 | 58 | 1 | small taps → none |
| Entry types (`/members/types`) | 3 | 3 | 152 → 105 | 2.5 → 1.6 | small taps → none |
| Create another home (`/me/homes/new`) | 3 | 0 | 468 → 50 | 1.2 | none (the count was wrong, not the screen) |
| Calendar (`/calendar`) | 13 → 4 | 16 | 68 | 1.1 → 1.2 | none |
| Play (`/baby/activities`) | 4 | 4 | 406 → 126 | 2.8 → 2.1 | none |
| Helper skills (`/ask/skills`) | 4 → 3 | 17 → 0 | 324 → 67 | 2.3 → 1.6 | none |

- **More**: Sign out is the last row of "You", with its icon, not a button of its own under
  the list.
- **Entry types**: the list comes first. "New entry type" is a fold under it; Edit on a row
  opens that type's form at the top. The open form for a type nobody asked to make was a
  third of the screen.
- **Calendar**: the fortnight is one white list. A day is a small label inside it over its
  rows, with a hairline between days. Something due (a vaccine, a medicine) is a row with
  its tinted disc and "Due" or "Overdue" under its name, not a yellow box between the
  cards. Numbers stay over (a list: each row carries its time).
- **Play**: the screen is every idea for the age, so a row is the idea's name with its tick;
  a tap opens how to do it, why it helps and the source. (The three-a-day card on the
  child's page left on 29 October; the code that drew it left now.)
- **Helper skills**: a row is the topic's name (and "always on"). When it is used, the ages,
  the version and who saved it are in the form the row opens. The guidance on what a skill
  may hold sits beside the field it is about.

### The landing page (`/welcome`)

What someone who is not in a home sees at elnunu.com (signed out, `/` goes there; deeper links
still go to sign-in). It is the one page that is not a phone screen of the app: it explains,
so it may scroll and run long, but it keeps the app's voice and tokens. One column on a phone,
copy beside a phone picture from 840 px. Each feature block is: a tinted label, a title that
says the benefit, at most two short paragraphs, one real screen. Two buttons only, the same
two everywhere: "Start your family's home" and "Sign in".

The pictures are real screens taken in screenshot mode on a made-up family (Mia, Sara, Omar),
never the live family. Retake them when a screen they show changes: rename the demo family in
a copy of the database, shift the demo day so it ends mid-afternoon, and match the server and
browser clocks (`scripts/fake-clock.cjs`, Playwright's `clock.install`).

## The parts to build with

Use these; extend one before adding a new one, and add any new one here.

| Part | Class or component | Use it for | Rules |
|---|---|---|---|
| Page header | `PageHeader` | The top of every screen | Title alone on its line; subtitle and any action on the line under it. The back arrow goes back to the screen the person came from in the app (`BackLink`, `lib/nav-history.ts`); `back` is only where it goes when the screen was opened from outside (a push, a link, a reload). A title says what the row that opened it says ("Doctor", "Vaccines"). |
| List row | `.row` in a white `ul` | Any set of like things | First line what and when, second line muted detail, number on the right. |
| Sheet | `Sheet` (`.sheet`) | Logging, editing, choosing | Opens from a tile, a row or the bottom button; Escape or a tap outside closes it; Save at the bottom says what is missing. |
| Bottom button | `.bottom-action` around a `.btn-lg` | The screen's one main action | Last thing on the page; held just above the tab bar while the page scrolls; on a short screen it rests at the bottom by the thumb, not mid-screen (13 November: Milk, the nanny's Today). |
| Log row | `.log-row` in `LanaNow` | The four things logged most | Icon, name, how long ago and one detail; a round `.round-go` on the right, sized in rem so large text grows it; the row opens its sheet. Solid ▶ and the dark ■ (`.round-go-stop`) act at once; a soft ＋ (`.round-go-open`) opens the sheet. Tint = the feature. |
| Big timer | `.big-timer` | Start or end something now, in a timer sheet and the Sleep section | One per sheet, 188 px round, tinted; clock times for "it already happened" under a `.divider-label`. There is one Sleep timer (`LanaNow`'s): Home draws it in the sheet, the Sleep section on the screen. |
| Segmented control | `.segmented` | Two ways of the same entry (Breast / Bottle); two sections that are one place (`SectionSwitch`: Feeds / Sleep) | Two or three words; the chosen one raised. Made of links when it changes the page. |
| Pager | `Pager` (`DayPager` for days), `DaySwipe`, `lib/day-nav.ts`, `stretchNav` in `lib/leaps.ts` | One of a row of screens: the day a section shows, the stretch Week by week shows, the day on the child's Today tab, the chart Trends shows | A name over a smaller line between two arrows; a swipe does the same; the arrow at either end is faint and does nothing (the child's Today tab has no first day). Which one is in the address (`?day=`, `?stretch=`, `?d=`, `?chart=`); the one the screen opens on has none. A step replaces the address, so the header's Back leaves the screen in one tap. |
| Day bar | `DayBar` (draws with `SleepBar`) | One day from midnight to midnight on a section | Sleep and feeds on one bar; `lead` says which the screen is about and draws the other faint. No numbers on it: the times are in the list. Not on Home. |
| Stop button | `.btn-stop` | Ending a timer from a wide button | The dark square's colours, the same on every screen; start wears the feature's own colour. |
| Nap window | `HomeState`, `napWindow()` | The next nap while she is awake | A clock-time window, a bar, one line. Only on Home. From 12 months only while a nap is expected (`topCard`). |
| Week columns | `WeekColumns` | The shape of a week | Seven columns, midnight at the top; a column is one tap target. |
| Log form | `EntryForm` (`/baby/log/…`, `/baby/entry/…`) | Anything less common than Home's rows, and editing in full | One card, a row per question, the When line first; two or three answers as a segmented control, a question with one possible answer not asked; photo and note in a second card; Save as the bottom button; Delete a word that asks twice. No helper button on it. The child's day (`/baby/day`, `DayForm`) is built the same way. |
| Edit sheet | `EntrySheet` from `EntryList` | Changing or deleting an entry | Time picker, end chips, field chips, Save, Delete with a second tap. |
| Stat strip | `TodayStrip` (Home), `DayStrip` tiles (the child's page) | A day's sums | Four at most, a dash for none. Home's: naps, feeds and diapers as plain counts, the first two linking to their sections; from 12 months only the kinds the family logs. |
| Sleep today | `SleepDay` | The day's sleep on the child's Today tab | Headline: what she is doing and since when (woke at 07:10, awake 2 h; nap since 13:00). One bar from midnight: the night she woke from, each nap, where now is. One line of sums. The naps' times stay in the list. |
| Notice | `.notice`, `.notice-warn` | The one Now item | One sentence and at most one button. One on screen; the rest wait behind **More** (`NowMore`), a sheet that lists them. |
| Fold | `Fold` | Something useful but not now, on a deeper screen | Closed by default. Never on Home. Whatever is inside sits flat: no card in it. The title keeps its words and the grey hint is cut first. `flat` makes folds the rows of one white list (the child's page, 25 November): the row wears its colour on its disc, not as a bar, and only red still crosses the row. A row among links that opens where it stands is `details.row-fold` (About her, "What this age brings"). |
| Chip | `.chip` | A choice among a few | 44 px tall, one line, a word or two. |
| When | `WhenChips` | The time of anything logged | One line until tapped; clock times on a ten-minute grid, then the picker. On a screen (`short`): one row of the three latest times and "Other". |
| Pill | `.pill` | A state beside a headline | "use first", "short", "expired". One line. Not for numbers that are fine. |
| Cheer sheet | `CheerSheet`, opened by `CheerButton` or the night sheet | Sending a cheer | Three set lines, one tap each, or 80 characters of the sender's own. A door is a few words on a line that already names what was done, 44 px tall, never a block of its own. |
| Slim line over the tab bar | `Celebration` (`.celebrate-peek`) | Something given to this person: a cheer, a medal | One line whatever waits, cheers before medals; × is "not now" and marks nothing; it steps aside for a sheet or the keyboard. Outside the page's flow, so it is not a block. |
| Tick | `.tick` | Marking a thing done (Activities, the bag list) | 44 px round; an empty ring until done, then a filled disc with a tick. |

## Colour, type and space

- **Tokens only.** Every colour comes from `app/globals.css` (light, dark and night all
  carry the same names). No hex values in components.
- **Text on a tint uses that tint's `-fg`.** Check every new surface in the night theme:
  pale text on a pale chip (a yellow banner, a green pill) disappears there. Contrast at
  least 4.5 : 1 in all three themes.
- **Three text sizes per card**: the headline (1.25 rem bold), the body (1 rem), the small
  muted line (0.85 rem). Screen titles use the display font; nothing else does. A card's
  headline is `.card-head`, one class, so no card sets a size of its own (the day cards and
  the fridge tiles carried 1.5 rem until 25 November, the pumping goal and "A usual day"
  1.875 rem).
- **Space, not boxes.** 20 px side margins, 16 px between blocks, a hairline between rows.
  The margins are one rule on `main`, and were 16 px until 25 November. Eight pixels less
  for every screen: at 390 px nothing changed in the phone checks, at 320 px five short
  labels broke in two and were mended where they stood (Feeds' two buttons say "Breast" and
  "Bottle"; a medicine's Given button sits under its name; "All 3 given" in the vaccine
  book; "Who's home Thursday?" among the helper's suggestions). After a change to margins or
  type, sweep at 320 px as well: `AUDIT_W=320 node scripts/ui-audit.mjs`.
  The audit counts labels that break in two, not lines cut with "…", and the margins cut a
  letter off a few of those at 360 and 375 px in large text ("Tell me what happene…"). So the
  bars that hold one line gave the 8 px back inside: a log row's left padding and its gap, the
  Tell me box, a fold's bar, and the gap in an entry's and a member's row. The four things
  fixed over the page (the "heard" toast, the badge line, the helper's button, Home's "who
  has her" menu) write the margin again, as 20 px: change them with it.
- **Large text** (More → Display, on by default for everyone but admins) makes
  the root 19 px instead of 17, so every rem grows, sheets included. Until 13 November it only
  reached the shell's own text and left titles, folds, buttons and sheets at normal size.
- **Every rule in `app/globals.css` sits in a layer**: element defaults in `@layer base`, part
  and feature classes in `@layer components`. A rule outside the layers beats every Tailwind
  utility on the element whatever its specificity, so `p-0`, `text-sm`, `min-h-[60px]` or
  `ring-2` written on a card or a button silently did nothing: More's photo, the bottle amounts,
  the "When" line and two dozen list cards broke that way until 13 November. Only the print rules,
  the iPhone no-zoom rule and the screen states (a sheet open, the keyboard up: they must beat
  the utilities on what they move) stay outside, on purpose.

## Numbers, times and dates

- Durations: "45 min", "1 h 20 min", "3 days left". How long ago, from six hours on, in whole
  hours ("15 h ago"), so a row's detail after it still fits at 320 px. Never "5.7 h", and never more than 120
  minutes written as minutes (`fmtDuration` in `lib/time.ts`).
- Counts are whole numbers; a per-day average keeps one decimal at most ("1.4 a day").
  Never print a raw computed number.
- Times: 24-hour, the household's time zone. Today and yesterday by name ("today 08:00",
  "yesterday 23:10"); older as "Sat 19 Sept".
- Nothing logged: a dash ("—"), not "0 min" and not a sentence. From 12 months a kind the
  family does not log at all (milk, diapers) is left out, not shown as a dash or a zero.
- No charts on Home. Elsewhere a chart answers one question, has a title that states the
  answer, and labels itself in words, not a colour legend.

## Before a change to a screen merges

1. Run the screen in screenshot mode (root `CLAUDE.md`, "The app") and
   `node scripts/ui-audit.mjs <route>`; the PR body gives the before and after numbers and
   the phone checks.
2. Look at the light and night screenshots at phone size. Hold the phone in one hand: can
   the thumb reach what is tapped most? Read every word out loud as the grandmother would;
   cut what she would not need.
3. Check the screen as an admin, a carer and a brand-new family with nothing logged
   (empty states say one plain sentence and offer the first tap).
4. Say in the PR which block was removed or folded for each one added. A screen does not
   grow without something leaving it.
