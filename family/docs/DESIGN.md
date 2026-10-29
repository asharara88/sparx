# elnunu design bible

Read this before changing anything a person sees. It was written on 29 October 2026, after
everyone who tried the app said the same thing as Dana: too many things happening, too many
numbers, too many cards on one screen. Every rule below exists to stop that coming back.
`BRAND.md` covers the name, mark, colours and voice; this file covers what goes on a screen
and how much of it.

## Who it is for

A parent at 3 am with the baby in one arm. A grandmother reading at 19 px. A helper who
reads English as a second language. Each of them opens the app for one reason, taps once or
twice, and puts the phone down. Design for that person, not for someone exploring the app.

## The rules

1. **One screen, one question.** Home answers *what does she need now, and what do I tap?*
   The child's page answers *how is her day going?* Milk answers *what is in the fridge?*
   If a block does not help answer its screen's question, it belongs on another screen.
2. **Now beats later; later goes one tap away.** Home shows what matters in the next hour.
   Patterns, history, advice, settings and anything weekly live one tap deeper.
3. **One alert at a time.** Show the single most important thing; the rest wait behind
   "2 more ›". Order: safety (call the doctor, medicine due) > due now (feed, nap) > a
   check (an entry that looks wrong) > a tip.
4. **One number per card.** A card has one headline number with its unit and one word
   under it ("150 ml / 2 bottles"). No second row of figures, no computed metric nobody
   acts on ("1099 min past the window" helped no one).
5. **Fewer words than you think.** A card's text is at most 12 words. Explanations go
   behind "Why?" or onto the detail screen, never under the headline.
6. **Never show a wrong or stale fact.** If the log has a gap (nothing for 12 hours), say
   nothing rather than "awake 122 h". An open timer older than a day is not "running".
7. **Colour says what, not how much.** Each feature has its tint (feed pink, sleep lilac,
   nappy sky, medicine butter, milk mint, pumping peach…). Amber means *needs a look*,
   red means *act now*; neither is decoration. Green is not used to mean "fine": fine is
   the absence of colour.
8. **Big targets, few of them.** Every tap target is at least 44 px tall. A card has at
   most two buttons; a third action goes in a menu or on the detail screen. Destroying
   something is a word ("Bin", "Delete"), never a lone ×, and never the first button.
9. **The same thing looks the same everywhere.** A feed is pink with the bottle icon on
   Home, on the child's page, in the day list and in a push. Reuse the components below;
   do not invent a new card for one screen.
10. **Plain words, the family's words.** "Nappy", "Pumped today 08:00", "3 days left".
    No jargon, no percentages, no "entries", no exclamation marks (see `BRAND.md`, Voice).

## Budgets

Measured by `scripts/ui-audit.mjs` at 390 × 844 (an iPhone), as an admin with a normal
day logged. A screen over budget does not merge until it is cut back or the budget is
argued for in the PR.

| Screen | Top-level blocks | Numbers on screen | Words | Screens tall |
|---|---|---|---|---|
| Home | 6 | 8 | 80 | 1.5 |
| Every other screen | 8 | 12 | 150 | 2.5 |

A *block* is a direct child of the page column: the hero, a notice, a grid of tiles, a
card, a fold. A grid of four tiles is one block; four cards in a row are four.

Where things stood on 29 October 2026, before the first pass:

| Screen | Blocks | Cards | Numbers | Words | Screens tall |
|---|---|---|---|---|---|
| Home | 11 | 27 | 33 | 243 | 2.5 |
| The child's page | 16 | 37 | 3 | 124 | 2.2 |
| Milk | 4 | 9 | 41 | 247 | 2.8 |
| Calendar, Notes, Members, More, Chat | 2–5 | 0–8 | 0–5 | 29–121 | 1–1.7 |

## What lives where

Three levels, no more.

| Level | Screen | Holds |
|---|---|---|
| **Now** | Home | Who has her and since when; the one thing that matters now; the four log buttons; today's four totals. |
| **Today** | The child's page (Today tab) | The day's totals and every entry; logging anything less common than the four. |
| **Deeper** | The child's other tabs, Milk, Calendar, More | Patterns, the week, growth, vaccines, the guide's advice, the helper's brief, medicine, play ideas, doctor, handover, settings. |

The bottom bar has five places (Home, the child, Milk, Calendar, Chat) and More. Anything
else is reached from one of them; Home does not repeat the bottom bar as a grid of tiles.

### Home, as this bible wants it

1. **Hero**: the child's name, age and who has her. *Say it* (the microphone) and
   *Emergency* (red) are two icon buttons in the hero, always in the same place.
2. **Now**: one notice, the top of the order in rule 3, or nothing. "2 more ›" opens the rest.
3. **Log**: the four big tiles (Feed, Asleep/Woke up, Nappy, Pump or Medicine). A timer
   that is running replaces its tile's subtitle ("Asleep 42 min · tap when she wakes").
4. **Today**: the four totals from the day card, tapping through to the child's page.

That is all. Off Home: the "Say it / Emergency / Vaccines" chips (the first two move into
the hero, a vaccine that is due becomes a Now item); the
right-now carousel (its one useful line becomes the Now notice); the next-nap line (a Now
item when the window is close); the milk card (a Now item only when the fridge will not
cover today); the guide's four warnings (one Now item at most, the rest on the child's
page); Pumping (Milk); Day so far (the totals row); the eight shortcut tiles (the bottom
bar and More); the helper's arrived/left buttons (Members).

### The child's page, as this bible wants it

Tabs (Today, Patterns, Week, Handover, Ask), the day switcher, the totals, the day's
entries, then **Log something else** (six common types, "More" for the rest). Coming up,
medicine, play, "against her age", the helper's brief, mood and checks become at most two
folds, or move to the Patterns and Week tabs. "More about her" is a list on its own tab, not
twelve tiles under the log.

### Milk, as this bible wants it

Two totals (fridge, freezer), *Put a bottle away*, the fridge and freezer lists (one bottle
= amount and time left, when pumped, the buttons). The forecasts and thaw advice fold into
one "Plan" card that is shown only on a day someone is away. The keeping rules sit behind
"How long does milk keep?".

## The parts to build with

Use these; extend one before adding a new one, and add any new one here.

| Part | Class or component | Use it for | Rules |
|---|---|---|---|
| Hero | `LanaHero` | The top of Home and the child's page | One per screen. |
| Log tile | `.action` in `LanaNow` | The four things logged most | Icon, one word, one short subtitle. Tint = the feature. |
| Tile grid | `.tile .tile-sm` | A set of places to go | Four across, one word each, at most eight. |
| Card | `.card` | One subject with one headline | Title, one number or sentence, at most two buttons. |
| Totals | `DayStrip` tiles | A day's sums | Four at most, 2 × 2, a dash for none. |
| Row list | `.row` | Entries, bottles, people | First line: what and when. Second line: detail, muted. Buttons on their own row if more than one. |
| Notice | `.notice`, `.notice-warn` | The one Now item | One sentence and a link. One on screen. |
| Fold | `Fold` | Anything useful but not now | Closed by default. Title and a short hint ("3 to check"). |
| Sheet | `.sheet` | Logging with choices | Opens from a tile; Save says what is missing. |
| Pill | `.pill` | A state next to a headline | "use first", "expired". Not for numbers that are fine. |

## Colour, type and space

- **Tokens only.** Every colour comes from `app/globals.css` (light, dark and night all
  carry the same names). No hex values in components.
- **Text on a tint uses that tint's `-fg`.** Check every new surface in the night theme:
  pale text on a pale chip (a yellow banner, a green pill) disappears there. Contrast at
  least 4.5 : 1 in all three themes.
- **Three text sizes per card**: the headline (1.25 rem bold), the body (1 rem), the small
  muted line (0.85 rem). Titles of screens use the display font; nothing else does.
- **Space, not lines.** Separate blocks with the column gap (16 px); separate rows in a
  list with a hairline. No card inside a card.

## Numbers, times and dates

- Durations: "45 min", "1 h 20 min", "3 days left". Never more than 120 minutes written
  as minutes (`fmtDuration` in `lib/time.ts`).
- Times: 24-hour, the household's time zone. Today and yesterday by name ("today 08:00",
  "yesterday 23:10"); older as "Sat 19 Sept".
- Nothing logged: a dash ("—"), not "0 min" and not a sentence.
- No charts on Home. Elsewhere a chart answers one question, has a title that states the
  answer ("Sleeping more at night this week"), and labels its own axes in words.

## Before a change to a screen merges

1. Run the screen in screenshot mode (root `CLAUDE.md`, "The app") and
   `node scripts/ui-audit.mjs <route>`; the PR body gives the before and after numbers.
2. Look at the light and night screenshots it saves, at phone size. Read every word out
   loud as the grandmother would; cut what she would not need.
3. Check the screen as an admin, a carer and a brand-new family with nothing logged
   (empty states say one plain sentence and offer the first tap).
4. Say in the PR which block was removed or folded for each one added. A screen does not
   grow without something leaving it.
