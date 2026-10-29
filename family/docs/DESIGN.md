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
reads English as a second language. Each of them opens the app for one reason, taps once or
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
4. **The tab bar**: Home, the child, Milk, Chat, More. Nothing else is fixed to the screen.

The thumb reaches the bottom half of the phone easily and the top corners hardly at all.
What people tap often lives low; what they tap rarely (or must not tap by accident, like
Emergency) lives high.

**Home fits on one screen without scrolling.** Every other screen should fit in two; a
reference page that is longer is split into rows that open their own screen.

### The patterns we use

| Pattern | Use it for | Instead of |
|---|---|---|
| **List rows** (`.row` in a white group) | Entries, bottles, people, measures, settings, any set of like things | A card per item; a table; a grid of tiles |
| **Sheet** (slides up from the bottom) | Logging, editing, choosing; anything with options and a Save | A new page; a form in the middle of a screen |
| **Segmented control** | Two or three views of the same thing (Breast / Bottle, Today / Week) | Tabs that scroll sideways; a row of chips |
| **One bottom button** | The screen's main action | Buttons scattered through the page |
| **Stat strip** | Up to four numbers in one white bar, each a value over one word | A grid of number cards |

A list row's first line says what and when ("13:08 · Bottle 60 ml"), its second line, muted,
says the detail; the number sits on the right. Tapping a row opens it or opens a sheet of
its actions; a row carries buttons only when there is no room for a sheet.

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
   nappy sky, medicine butter, milk mint, pumping peach…). Amber means *needs a look*,
   red means *act now*; neither is decoration. Green is not used to mean "fine": fine is
   the absence of colour.
8. **Big targets, few of them.** Every tap target is at least 44 px tall. A card has at
   most two buttons; a third action goes in a sheet or on the detail screen. Destroying
   something is a word ("Bin", "Delete"), never a lone ×, and never the first button.
9. **The same thing looks the same everywhere.** A feed is pink with the bottle icon on
   Home, on the child's page, in the day list and in a push. Reuse the parts below; do not
   invent a new card for one screen.
10. **Plain words, the family's words.** "Nappy", "Pumped today 08:00", "3 days left".
    No jargon, no percentages, no "entries", no exclamation marks (see `BRAND.md`, Voice).

## Budgets and phone checks

Measured by `scripts/ui-audit.mjs` at 390 × 844 (an iPhone), as an admin with a normal
day logged. It opens every fold before checking, and saves light and night screenshots.
Every digit group counts as a number ("1 h 5 min" is two); Home's 15 is what the agreed
mockup uses, mostly the tiles' "40 min ago".

| Screen | Top-level blocks | Numbers on screen | Words | Screens tall |
|---|---|---|---|---|
| Home | 6 | 15 | 80 | 1 (one screen, no scroll) |
| Every other screen | 8 | 12 | 150 | 2.5 |

The phone checks must all read zero: *wide* (anything past the screen's edge), *sideways*
(a strip that scrolls sideways), *tables*, *wrapped labels* (a chip, pill, tab, button or
header of up to 24 characters breaking onto two lines), *card in card*, *small taps* (under
44 px), *tiny text* (under 13 px). A screen over budget or failing a check does not merge
until it is fixed or the exception is argued for in the PR.

Where things stood on 29 October 2026, before the phone passes (every screen was swept):

| Screen | Blocks | Numbers | Words | Screens tall | Phone checks failing |
|---|---|---|---|---|---|
| Home | 10 | 28 | 224 | 2.4 | sideways, wrapped labels, card in card, small taps, tiny text |
| The child's page, Today | 16 | 3 | 124 | 2.2 | a table, wrapped labels, card in card |
| The child's page, Patterns | 9 | 66 | 358 | 3.1 | 31 elements wider than the phone, a table |
| Trends | 3 | 236 | 621 | 5.6 | 31 wider than the phone, 2 tables, "1.4285714285714286 wet nappies" |
| Milk | 4 | 41 | 247 | 2.8 | small taps |
| When to call | 8 | 32 | 576 | 3.7 | 10 cards in cards |
| Weeks, Activities | | | 744–1277 | 4.9–5.6 | |
| Calendar, Notes, Chat, More, settings screens | 2–5 | 0–5 | 24–121 | 1–1.7 | mostly fine |

## What lives where

Three levels, no more.

| Level | Screen | Holds |
|---|---|---|
| **Now** | Home | Her state (asleep or awake, for how long, the last feed); the one thing that matters now; today in one line; the four log buttons. |
| **Today** | The child's page | Today / Week / About her. Today: the totals strip and every entry as a list, "+ Log" at the bottom for anything less common than the four. |
| **Deeper** | Milk, Chat, More | Milk: the fridge and freezer as lists. More: one grouped list (family, health, you) with everything else: who's home, calendar, notes and handover, doctor and when to call, vaccines, medicine, growth and firsts, the helper, settings. |

The bottom bar has Home, the child, Milk, Chat and More. Calendar lives in More. Home does
not repeat the bottom bar as a grid of tiles.

### Home

1. **Header**: the child's initial, name, age and who has her; on the right, two round
   buttons: *Say it* (microphone, rose) and *Emergency* (phone, red).
2. **Her state**, large: "Awake for 1 h 50 min" or "Asleep 42 min", and under it the last
   feed ("Last feed 10:20, bottle 90 ml").
3. **Now**: one notice, the top of the order in rule 3, or nothing ("Nap due around 11:30"
   with a "She's asleep" button). "2 more ›" opens the rest.
4. **Today**, one row: "5 feeds · 1 h 20 sleep · 4 nappies ›", opening the child's page.
5. **Log**: the four big tiles at the bottom (Feed, Asleep/Woke up, Nappy, Pump or Medicine),
   each with how long ago it last happened. Tapping one opens its sheet; Save is at the bottom.

Off Home: the "Say it / Emergency / Vaccines" chips (the first two move into the header, a
vaccine that is due becomes a Now item); the right-now carousel; the milk card (a Now item
only when the fridge will not cover today); the guide's warnings (one Now item at most, the
rest on the child's page); Pumping (Milk); Day so far (the Today row); the eight shortcut
tiles (the bottom bar and More); the helper's arrived/left buttons (Who's home).

### The child's page

Title, then a segmented control: Today / Week / About her. Today: the day switcher, the
totals strip, the day's entries as a timeline list (time, feature icon, what), and a
"+ Log" button at the bottom right that opens a sheet of every entry type. Week holds the
patterns, the age check, mood and sleep, coming up. About her holds what was "More about
her": growth, firsts, vaccines, medicine, story, doctor, as one list.

### Milk

The two totals (fridge, freezer) as two tinted blocks; then FRIDGE and FREEZER as list
rows ("90 ml · use first", "Pumped today 08:00", "3 days" on the right); tapping a bottle
opens a sheet with Warmed (or Thaw), Used and Bin. "Put a bottle away" is the bottom button
and opens a sheet. The thaw plan shows only on a day someone is away; how long milk keeps
sits behind "How long does milk keep?".

## The parts to build with

Use these; extend one before adding a new one, and add any new one here.

| Part | Class or component | Use it for | Rules |
|---|---|---|---|
| Page header | `PageHeader` | The top of every screen | Title alone on its line; subtitle and any action on the line under it. |
| List row | `.row` in a white `ul` | Any set of like things | First line what and when, second line muted detail, number on the right. |
| Sheet | `.sheet` | Logging, editing, choosing | Opens from a tile or a row; Save at the bottom says what is missing. |
| Log tile | `.action` in `LanaNow` | The four things logged most | Icon, one word, how long ago. Tint = the feature. |
| Stat strip | `DayStrip` tiles | A day's sums | Four at most, a dash for none. |
| Notice | `.notice`, `.notice-warn` | The one Now item | One sentence and at most one button. One on screen. |
| Fold | `Fold` | Something useful but not now, on a deeper screen | Closed by default. Never on Home. Whatever is inside sits flat: no card in it. |
| Chip | `.chip` | A choice among a few | 44 px tall, one line, a word or two. |
| Pill | `.pill` | A state beside a headline | "use first", "short", "expired". One line. Not for numbers that are fine. |

## Colour, type and space

- **Tokens only.** Every colour comes from `app/globals.css` (light, dark and night all
  carry the same names). No hex values in components.
- **Text on a tint uses that tint's `-fg`.** Check every new surface in the night theme:
  pale text on a pale chip (a yellow banner, a green pill) disappears there. Contrast at
  least 4.5 : 1 in all three themes.
- **Three text sizes per card**: the headline (1.25 rem bold), the body (1 rem), the small
  muted line (0.85 rem). Screen titles use the display font; nothing else does.
- **Space, not boxes.** 20 px side margins, 16 px between blocks, a hairline between rows.

## Numbers, times and dates

- Durations: "45 min", "1 h 20 min", "3 days left". Never "5.7 h", and never more than 120
  minutes written as minutes (`fmtDuration` in `lib/time.ts`).
- Counts are whole numbers; a per-day average keeps one decimal at most ("1.4 a day").
  Never print a raw computed number.
- Times: 24-hour, the household's time zone. Today and yesterday by name ("today 08:00",
  "yesterday 23:10"); older as "Sat 19 Sept".
- Nothing logged: a dash ("—"), not "0 min" and not a sentence.
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
