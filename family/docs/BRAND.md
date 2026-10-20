# Bambino: the brand

Bambino is the family's app for the little one's day. It is private, used one-handed,
often at night, by parents, grandmothers and the helper. The brand has one job: feel like a
calm, capable pair of hands, never like a dashboard and never like a toy.

## Name

**Bambino.** Always one word, lowercase in the wordmark (`bambino`), capitalised in prose.
Never "Bambino App", never an exclamation mark after it. In Arabic and Russian copy the
name stays in Latin letters.

**Line:** *The little one's day, in everyone's hands.* Used on the sign-in screen and the
app store style description. Not repeated inside the app.

## Mark

A rounded lowercase **b** with a small moon in its bowl, on a warm clay tile. The b is the
name; the moon is the night half of the care that nobody sees. The tile is a squircle
(radius 25%) so every platform's icon mask leaves it whole.

- Files: `public/brand/mark.svg` (colour), `public/brand/mark-mono.svg` (single colour,
  uses `currentColor`), PNGs in `public/brand/` and `public/icons/`.
- In the app, use the `Mark` and `Wordmark` components from `components/Brand.tsx`.
- Minimum size 16 px. Clear space around it equal to the moon's diameter.
- Do not recolour the tile, add a face, or put the mark on a busy photo.

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

- **Display:** Fredoka (self-hosted, `public/fonts/`), weights 300 to 700, for page titles
  and the wordmark only. Rounded, friendly, still legible at a glance.
- **Body:** the phone's system font (SF Pro, Roboto). It is what the grandmothers can read
  at 19 px with large text on, and it costs nothing to load.
- Titles sit at 1.45 rem (2 rem on top-level screens). Labels in small caps spacing. Numbers
  that line up use tabular figures.

## Voice

Plain, warm, short. Second person. Say what happened and what to do next; never diagnose.
"Next nap around 11:40." "Nothing fed since 10:20. Missed one?" "Woke up, saved."
No exclamation marks, no baby-talk, no emoji in sentences. The helper speaks the same way.

## Where it shows

Sign-in screen (mark, wordmark, line). Home: the mark beside the date, small; the screen
belongs to the child. Me page: a wordmark footer. Installed app: icon, name, splash colours,
push notification title. Everywhere else the brand is the colour and the type, not a logo.
