# Handover: elnunu

Written 21 October 2026. Everything a new person (or a new session) needs to pick
this up. Read `../README.md` for setup steps and `BRAND.md` for the look; this file
is the state of play and the things only someone with the accounts can do.

## What it is

A private app for a household's day: the baby's log (feeds, sleep, nappies,
growth, medicine), who is home, the helper, the milk stash, and a Claude-powered
assistant that answers questions and proposes entries. In the first household five
people use it: two parents, two grandmothers and the home carer. It is a Next.js 16
PWA on Vercel with a Supabase Postgres behind it. It is not a product with sign-up or
marketing; it is one deployment per family. Since migration 3500 the code knows no
family: a household (its name, members, the child, a pet) is written to its own
Supabase project by `scripts/setup-household.mjs` from a `household.json`, and every
screen takes the names from the data. A second family gets its own Supabase project
and Vercel project from the same repo (README, "A copy for another family").

## Where everything lives

| Thing | Where |
|---|---|
| Code | `asharara88/sparx`, folder `family` (the repo root holds unrelated pipeline work) |
| Hosting | Vercel project `sparx-tsom`, team `ahmedmsharara-4731s-projects`, root directory `family` |
| Address | `https://elnunu.com` (attached in Vercel; `sparx-tsom.vercel.app` still works) |
| Database | Supabase project `home`, ref `qjqekazawirrpwnwgbhd` |
| Migrations | `supabase/migrations`, 46 files, applied in filename order |
| Brand page | https://claude.ai/artifact/9nf3jNvH7sNWoF34YTPZcA |

## How changes reach production

1. Branch from `main`, change files under `family`, open a pull request.
2. Vercel builds a preview; the `family` GitHub check runs the typecheck, the unit tests
   and the whole migrations folder plus the database checks against a fresh Postgres
   (`test` is the unrelated pipeline at the repo root).
3. Merge to `main`. Vercel deploys production.
4. On that same push the **Supabase GitHub integration** applies any new file in
   `supabase/migrations` to the live database. The check is called
   *Supabase Preview*. Watch it: a green merge with a failed Supabase check means
   the code shipped and the schema did not.

The repo root has a `supabase` symlink pointing at `family/supabase`. The
integration only reads the root path, and this is what makes it find the right
migrations. Do not replace that symlink with a directory.

## Database shape, in one paragraph

One deployment holds many homes (migration 3900, `docs/MULTI_HOME.md`): `household`
has a uuid id and many rows, every home-scoped table carries `household_id` with a
restrictive row-security policy on top of its permission policies, and the helpers
definer functions trust (`private.subject_module`, `entry_module`, `default_subject`,
`admin_names`, `subject_names`) answer only for the caller's home. Every definer
function belongs to `app_rls`, a role row security applies to, so a function cannot
reach another home by accident (4000); backups, push notifications and the photos
bucket are per home, and the roles, matrix, entry types and helper skills every home
shares change only from the first home (4100). One account can be in several homes,
one member row in each; every request names the home its screen shows (the
`elnunu_home` cookie, sent as the `x-home` header) and the database honours it only
for a home the account is in, with the account's chosen home (`home_switch`; the
switcher on the Me screen) as what a new device starts from (4300, 4500);
`household_create` makes a home, from the "Create your home" screen or "Create
another home"; an admin deletes a home by typing its name, and the file cleanup is
a retried job (`home_cleanups`, the daily cron).
Permissions are data, not code. `members` have a `role`, roles have rows in
`permissions` (module, action), and every policy calls `has_permission`. To give
someone access to something, insert a permission row; no deploy needed. Writes go
through security-definer RPCs (`care_entry_log`, `activity_tick`,
`assistant_brief_save` and so on) so the client never writes tables directly. The
baby's log is `care_entries`, keyed by `client_id` so a retry or an import can
never double-insert. `household.hidden_modules` switches whole sections off; it
currently holds `{fanta}`, though Fanta's screens have since been deleted outright.

## State as of this handover

Done and live:

- All features through the Sprouty set (next nap, leaps, WHO growth curves, mood,
  activities, the monthly story), retrospective logging, entry checks, the
  assistant with skills and memory, push notifications, the daily cron.
- Branding as elnunu, plum and ivory, self-hosted fonts, icons and manifest.
- The full Lovable history, 5 June to 20 October, imported as real entries
  (migration `…3200` at the time; the data is in the project and its nightly
  backups, the file is now a stub). The family's earlier playground app can be closed.
- Shopping switched off for the household (migration `…3300`), and on 22 October
  its code (the list, the staff's running-low requests, receipts, the cart
  hand-off, the assistant's shopping tools) taken out of the app. The carer's
  `/send` screen is now "Today": clock-in and the day's events. Later that day
  the tables and functions were dropped too (migration 4600, rows archived).
- Fanta the cat, the house (tickets, appliances, contractors) and the Home Assistant
  hub are **deleted from the app**. The app is baby care only. The house's and the
  hub's tables are dropped (4600, rows archived); the cat's rows are still there.
- elnunu.com attached. CI runs the database checks on every pull request.
- Timers go through the offline queue; one open timer per type; custody expires
  after 12 hours (migration `…3400`).
- Any household: the first family's rows were taken out of the migrations (members,
  the child, the doctor, the history, the shopping list, routines) and the
  schema seeds only shared data. The live project still holds all of it, because
  those migrations had already run there. Editing applied migrations is otherwise
  never done; this was the one deliberate exception, to get personal data out of
  the repo. Git history still contains the old files: if the repo is ever shared
  with another family, rewrite history or start a fresh repo.
- Many homes in one deployment, phases 1 to 5 (migrations 3900 to 4300,
  `docs/MULTI_HOME.md`): scoping, the create-home screen, the definer audit,
  per-home backups, pushes and photos, one account in several homes, deleting a
  home. The live project holds the first family as its one home, the platform
  home.
- The setup script checks the whole file before writing anything, matches members
  by id, then e-mail, then name, and never relinks an account by accident
  (`lib/setup/plan.mjs`, unit-tested; `household.example.json` documents the keys).
- A timer ends once under a row lock; End on the phone stops the model on the
  server; the helper's spoken readback is in the member's language with the day;
  the wake-up eval checks the record.

Open:

- **Cron runs once a day.** Vercel's free plan allows one daily schedule. The
  "often" cron (nap reminders through the day) exists in the code and needs Pro.
- **The assistant eval has never been run** against the deployed app. It costs
  real model calls: `EVAL_URL=… npm run eval:assistant` with `CRON_SECRET` set.
- **Confirm e-mail.** The sign-up trigger links an auth user to a member row by
  e-mail at the moment the auth row is created, before any confirmation. Keep
  "Confirm email" on in Supabase Auth, or switch public sign-ups off and create
  accounts with `setup-household.mjs --accounts`. Not yet confirmed in the dashboard.
- **View-as** is read only everywhere since migration `…3600` (the own-row RPCs
  carry `private.read_only_preview()`), a preview token the database stops
  accepting ends the preview instead of looking like a sign-out, and the
  sign-out and view-as form posts refuse cross-site requests. The database still
  honours a `preview_mode: 'full'` claim in `has_permission` that nothing mints;
  harmless, and a candidate for removal.
- The retired tables are gone (migration 4600): the shopping set, the house
  (tickets, assets, contractors) and the hub, with their functions, modules and
  permission rows. Every row they held is kept as JSON in `private.retired_rows`
  (service role only); drop that table once nobody wants the history at all.
  The pet's subject, entry types and entries are still in the database under the
  hidden `fanta` module; removing them is a separate decision, since the setup
  script and the names helper still know about a pet.

## Access, and what is currently broken

This matters more than it looks, because it decides what an assistant session can
do on its own.

| Route | State |
|---|---|
| GitHub | Works. Branches, pull requests, merges, check statuses. |
| Supabase GitHub integration | Works. This is how migrations reach the live database. |
| Supabase connector (direct SQL) | Works again since 21 October (reconnected to the organisation that owns `home`): read-only checks of the live schema and data. Migrations still travel through the GitHub integration, never by hand. |
| Vercel connector | Lists the team's projects, deployments, logs and the names of environment variables. Changing an environment variable is still done by a person in the dashboard. |
| Browser control | Not available. Sessions run in a cloud container with no connection to anyone's browser. |

If a connector stops working: claude.ai, Settings, Connectors, reconnect Supabase
choosing the organisation that owns `home`, and reconnect Vercel granting the team.

The Supabase integration also failed for several days with "organization members
have reached their maximum limits for the number of active free projects". Two
migrations sat merged but unapplied until a project slot was freed. If that message
returns, pause or delete an unrelated free project; the pending migrations then
apply on the next push to `main`.

## Running it locally

```bash
cd family
cp .env.example .env.local      # fill the two NEXT_PUBLIC_SUPABASE_* values
npm install
npm run dev                     # http://localhost:3000
```

Checks before any push:

```bash
npm test                        # unit tests, no network
npx tsc --noEmit
npx next build
```

Database tests need Postgres 16 running locally:

```bash
service postgresql start
su postgres -c "cd $PWD && ./supabase/tests/run-local.sh"
```

They build a scratch database called `family_test`, apply every migration, load the
test household (`supabase/tests/01_test_household.sql`: Mido, Dana, Wafa, Luda, Lilly,
Lana and Fanta with fixed ids, the household every check acts as), then assert the
permission rules by acting as each member. The same run is the `family` CI job.

Note for migration authors: bulk data does not belong in a migration. A household's
own data goes through `setup-household.mjs`; the test household lives in `tests/`.

## Conventions worth keeping

- No names of family members, the child or the pet in code or in migrations. Members
  and care subjects are rows written by `setup-household.mjs`; screens take names
  from `me.subjects` through `lib/names.ts` (`childName`, `petName`, `possessive`,
  `childPronouns`), and the simple screen's strings take `{child}` from `t(lang, key,
  vars)` with gendered Arabic and Russian variants. The internal module ids `lana`
  (child) and `fanta` (pet) and the entry-type ids `lana.feed` and so on are keys,
  not names; they stay.
- Every schema change is a new migration file. Never edit an applied one.
- New writes get an RPC with a permission check, not a table policy alone.
- Pure logic goes in `lib/` with a `.test.ts` beside it and no `@/` imports, so the
  node test runner can execute it directly.
- Text in the app follows `BRAND.md`: plain, warm, short, no exclamation marks.

## If you are an assistant session picking this up

Work in `family`. Open a draft pull request, wait for the Vercel status and the
`family` check on the head commit, then merge and confirm the *Supabase Preview*
check on the merge commit. The owner's standing instruction is to merge without
asking once both are green, and not to paste preview links into replies.
