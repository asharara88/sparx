# Handover: elnunu

Written 21 October 2026. Everything a new person (or a new session) needs to pick
this up. Read `../README.md` for setup steps and `BRAND.md` for the look; this file
is the state of play and the things only someone with the accounts can do.

## What it is

A private app for one household's day: the baby's log (feeds, sleep, nappies,
growth, medicine), who is home, the helper, the milk stash, and a Claude-powered
assistant that answers questions and proposes entries. Five people use it: two
parents, two grandmothers and the home carer. It is a Next.js 16 PWA on Vercel with
a Supabase Postgres behind it. It is not a product; there is no sign-up, no
marketing, no second household.

## Where everything lives

| Thing | Where |
|---|---|
| Code | `asharara88/sparx`, folder `family` (the repo root holds unrelated pipeline work) |
| Hosting | Vercel project `sparx-tsom`, team `ahmedmsharara-4731s-projects`, root directory `family` |
| Current address | `https://sparx-tsom.vercel.app` |
| Intended address | `https://elnunu.com` (registered, not yet attached) |
| Database | Supabase project `home`, ref `qjqekazawirrpwnwgbhd` |
| Migrations | `supabase/migrations`, 33 files, applied in filename order |
| Brand page | https://claude.ai/artifact/9nf3jNvH7sNWoF34YTPZcA |

## How changes reach production

1. Branch from `main`, change files under `family`, open a pull request.
2. Vercel builds a preview; the `test` GitHub check runs the unit tests.
3. Squash-merge to `main`. Vercel deploys production.
4. On that same push the **Supabase GitHub integration** applies any new file in
   `supabase/migrations` to the live database. The check is called
   *Supabase Preview*. Watch it: a green merge with a failed Supabase check means
   the code shipped and the schema did not.

The repo root has a `supabase` symlink pointing at `family/supabase`. The
integration only reads the root path, and this is what makes it find the right
migrations. Do not replace that symlink with a directory.

## Database shape, in one paragraph

Permissions are data, not code. `members` have a `role`, roles have rows in
`permissions` (module, action), and every policy calls `has_permission`. To give
someone access to something, insert a permission row; no deploy needed. Writes go
through security-definer RPCs (`care_entry_log`, `activity_tick`,
`assistant_brief_save` and so on) so the client never writes tables directly. The
baby's log is `care_entries`, keyed by `client_id` so a retry or an import can
never double-insert. `household.hidden_modules` switches whole sections off; it
currently holds `{shopping,fanta}`, though Fanta's screens have since been deleted outright.

## State as of this handover

Done and live:

- All features through the Sprouty set (next nap, leaps, WHO growth curves, mood,
  activities, the monthly story), retrospective logging, entry checks, the
  assistant with skills and memory, push notifications, the daily cron.
- Branding as elnunu, plum and ivory, self-hosted fonts, icons and manifest.
- The full Lovable history, 5 June to 20 October, imported as real entries
  (migration `…3200`). The family's earlier playground app can be closed.
- Shopping switched off for the household (migration `…3300`). The code is still
  there; only the switch is off.
- Fanta the cat, the house (tickets, appliances, contractors) and the Home Assistant
  hub are **deleted from the app**. The app is baby care only. Their database tables
  still exist and hold the old rows; nothing reads them.

Open:

- **elnunu.com is not attached.** Steps are in `../README.md` under
  "Domain: elnunu.com". Needs the Vercel dashboard, the registrar's DNS, and the
  Supabase auth URL settings. Nothing in the code hard-codes a host.
- **Cron runs once a day.** Vercel's free plan allows one daily schedule. The
  "often" cron (nap reminders through the day) exists in the code and needs Pro.
- **The assistant eval has never been run** against the deployed app. It costs
  real model calls: `EVAL_URL=… npm run eval:assistant` with `CRON_SECRET` set.
- **No CI job runs the database tests.** They pass locally
  (`supabase/tests/run-local.sh`, needs Postgres 16 and a `postgres` user) but
  nothing runs them on a pull request.
- Groceries (the shopping list, receipts, the cart, Lilly's requests) is the last
  non-baby area still in the code. Removing it is entangled with the Send screen and
  the assistant's shopping tools, so it was left for a second pass.
- The dropped tables (tickets, assets, contractors, Fanta's subject and entries,
  hub entities) could be removed with a new migration once nobody wants the history.

## Access, and what is currently broken

This matters more than it looks, because it decides what an assistant session can
do on its own.

| Route | State |
|---|---|
| GitHub | Works. Branches, pull requests, merges, check statuses. |
| Supabase GitHub integration | Works. This is how migrations reach the live database. |
| Supabase connector (direct SQL) | **Broken.** Every call returns "You do not have permission to perform this action". The connected account no longer sees the organisation that owns `home`. |
| Vercel connector | **Broken for this project.** The token's account lists zero teams, so the team holding `sparx-tsom` returns 403. Domains, env vars and logs cannot be read or changed. |
| Browser control | Not available. Sessions run in a cloud container with no connection to anyone's browser. |

To repair the two connectors: claude.ai, Settings, Connectors, reconnect Supabase
choosing the organisation that owns `home`, and reconnect Vercel granting the team.
Until then, anything that needs the Supabase or Vercel dashboard has to be done by
a person, and migrations must travel through the GitHub integration.

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
npm test                        # 56 unit tests, no network
npx tsc --noEmit
npx next build
```

Database tests need Postgres 16 running locally:

```bash
service postgresql start
su postgres -c "cd $PWD && ./supabase/tests/run-local.sh"
```

They build a scratch database called `family_test`, apply every migration, then
assert the permission rules by acting as each member. The last line prints the
number of assertions and the number of policies exercised.

Note for migration authors: `…3200` is guarded by
`if current_database() = 'family_test' then return;` so the half-megabyte history
import does not slow the test run. Follow that pattern for any other bulk data.

## Conventions worth keeping

- No names of family members in code. Members are rows; the seed names them once.
- Every schema change is a new migration file. Never edit an applied one.
- New writes get an RPC with a permission check, not a table policy alone.
- Pure logic goes in `lib/` with a `.test.ts` beside it and no `@/` imports, so the
  node test runner can execute it directly.
- Text in the app follows `BRAND.md`: plain, warm, short, no exclamation marks.

## If you are an assistant session picking this up

Work in `family`. Open a draft pull request, wait for the Vercel status and the
`test` check on the head commit, then squash-merge and confirm the *Supabase
Preview* check on the merge commit. The owner's standing instruction is to merge
without asking once both are green, and not to paste preview links into replies.
