# elnunu (النونو): the brand

elnunu is the family's app for the little one's day. "Nunu" is what the family calls a
baby; "el" is "the". It is private, used one-handed, often at night, by parents,
grandmothers and the helper in three languages. The brand has one job: feel like a calm,
capable pair of hands, never like a dashboard and never like a toy.

## Name

**elnunu** in Latin letters, **النونو** in Arabic. The name is *nunu*: big, bold, plum.
*el* (or *ال*) is small and apricot in front of it, about half the height, sitting on the
same baseline. Never bold the *el*, never set it in plum, never separate the two with a
space. In prose: "elnunu" (never "Elnunu App", never an exclamation mark after it). The
Latin wordmark is the primary one; the Arabic appears where the family reads Arabic (the
Me page footer, Arabic simple mode).

**Line:** *Care, together.* Under the wordmark on the sign-in screen and the icon tile.
**Second line:** *A shared view of your baby's day.* For descriptions and the store
listing. Neither is repeated inside the app.

## Mark

The Arabic letter **noon (ن)** drawn as an ivory cradle with the little one above it in
apricot, on a plum tile. It reads as the letter to anyone who reads Arabic, and as a cradle,
a smile or a crescent with a sun to everyone else. The tile is a squircle (radius 25%) so
every platform's icon mask leaves it whole.

- Files: `public/brand/mark.svg` (colour), `public/brand/mark-mono.svg` (single colour,
  uses `currentColor`), PNGs in `public/brand/` and `public/icons/`.
- In the app, use `Mark`, `Name`, `NameArabic` and `Wordmark` from `components/Brand.tsx`.
- Minimum size 16 px. Clear space around it equal to the dot's diameter.
- Do not recolour the tile, add eyes to the dot, or put the mark on a busy photo. The
  single-colour version is for plum-on-ivory or ivory-on-plum only.

## Colour

Each colour has one job. Light theme tokens (`app/globals.css`, the source of truth); the
dark and night themes carry the same names.

| Role | Token | Value | Use |
|---|---|---|---|
| Blush | `--bg` | `#FFF4F6` | The page. Warm, never grey. |
| Plum | `--fg` | `#4B203F` | Text and titles. |
| Rose | `--accent` | `#C2476A` | Primary buttons, the active tab, links. Rose does the work. |
| Rose soft | `--accent-soft` | `#FBE1E8` | Tinted chips and notices. |
| Apricot | `--apricot` | `#F29B78` | Decoration only: the "el", the little one on the mark. Never a button, never body text. |
| Amber | `--warn` | `#9A5B00` | Needs a look. |
| Brick | `--danger` | `#B8322F` | Stop, delete, call. |
| Feature tints | `--feed`, `--sleep`, `--diaper`, `--meds`, `--milk`, `--pump`, `--house`, `--cal`, `--notes`, `--guide` | pastel, each with its own dark `-fg` | One per feature, so a card says what it is before it is read. How to use them: `DESIGN.md`. |

Dark theme: deep plum ground (`#2A1526`), ivory text, a lighter rose accent. The night
theme (3 am, and the hours the family sets) goes darker still, with apricot as the accent.

## Type

- **Display, Latin:** Fredoka (self-hosted, `public/fonts/`), weights 300 to 700, for page
  titles and the wordmark only.
- **Display, Arabic:** Baloo Bhaijaan 2 (self-hosted, Arabic subset), the rounded Arabic
  companion to Fredoka, for the Arabic wordmark and Arabic titles.
- **Body:** the phone's system font (SF Pro, SF Arabic, Roboto). It is what the grandmothers
  can read at 19 px with large text on, and it costs nothing to load.
- Titles sit at 1.45 rem (2 rem on top-level screens). Labels in small caps spacing. Numbers
  that line up use tabular figures.

## Voice

Plain, warm, short. Second person. Say what happened and what to do next; never diagnose.
"Next nap around 11:40." "Nothing fed since 10:20. Missed one?" "Woke up, saved."
No exclamation marks, no baby-talk, no emoji in sentences. The helper speaks the same way,
in English, Arabic or Russian.

## Where it shows

Sign-in screen (mark, both wordmarks, line). Home: the mark beside the date, small; the
screen belongs to the child. Me page: a wordmark footer in both scripts. Installed app:
icon, name, splash colours, push notification title. Everywhere else the brand is the
colour and the type, not a logo.
