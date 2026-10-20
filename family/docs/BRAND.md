# elnunu (النونو): the brand

elnunu is the family's app for the little one's day. "Nunu" is what the family calls a
baby; "el" is "the". It is private, used one-handed, often at night, by parents,
grandmothers and the helper in three languages. The brand has one job: feel like a calm,
capable pair of hands, never like a dashboard and never like a toy.

## Name

**elnunu** in Latin letters, **النونو** in Arabic. Both lowercase in the wordmark, both
with the weight on the name: *el* and *ال* are light and muted, *nunu* and *نونو* are
bold. In prose: "elnunu" (never "Elnunu App", never an exclamation mark after it). The
two scripts sit side by side where there is room (sign-in, the Me page); elsewhere the
Latin name alone.

**Line:** *The little one's day, in everyone's hands.* Used on the sign-in screen and the
app store style description. Not repeated inside the app.

## Mark

The Arabic letter **noon (ن)** drawn as a cradle with the little one above it, on a warm
clay tile. It reads as the letter to anyone who reads Arabic, and as a cradle, a smile or a
crescent with a dot to everyone else. The tile is a squircle (radius 25%) so every
platform's icon mask leaves it whole.

- Files: `public/brand/mark.svg` (colour), `public/brand/mark-mono.svg` (single colour,
  uses `currentColor`), PNGs in `public/brand/` and `public/icons/`.
- In the app, use `Mark`, `Name`, `NameArabic` and `Wordmark` from `components/Brand.tsx`.
- Minimum size 16 px. Clear space around it equal to the dot's diameter.
- Do not recolour the tile, add eyes to the dot, or put the mark on a busy photo.

## Colour

Light theme tokens (`app/globals.css`); the dark and night themes carry the same roles.

| Role | Token | Value | Use |
|---|---|---|---|
| Cream | `--bg` | `#FBF6F0` | The page. Warm, never pink. |
| Ink | `--fg` | `#2A211C` | Text. Warm near-black, not pure black. |
| Clay | `--accent` | `#CF5A32` | One accent: primary buttons, the active tab, links. |
| Clay soft | `--accent-soft` | `#FBE6DC` | Tinted chips and notices. |
| Plum | `--night` | `#6B5B95` | Sleep and night: pills and notices about naps and bedtime. |
| Sage | `--ok` | `#2E7D4F` | Done, on track. |
| Amber | `--warn` | `#9A5B00` | Needs a look. |
| Brick | `--danger` | `#C62B2B` | Stop, delete, call. |

Semantic colours are not accents: a green tick and a clay button never compete. Dark theme
keeps the same roles with lighter clay (`#F08C66`) on warm charcoal (`#1C1714`). The Ask
screen's night mode goes darker still for 3 am.

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
