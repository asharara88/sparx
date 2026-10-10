# Family app — Step 1 + Lana log

Private family-operations app for one household. This folder is the whole app:
a Next.js PWA on Vercel talking to the household's own Supabase project.
The product brief is `../BRIEF.md`; the build plan is `../PLAN.md`.

**What is in this step**

- Foundation: members, roles, a permission matrix (role × module × action), presence
  states, staff work days, audit log. Row Level Security is derived from the permission
  table (`has_permission(module, action)`), so changing a tick in *Roles and permissions*
  changes what the database itself allows. Every write and every denied attempt made
  through the app's API lands in `audit_log`.
- Lana's log: feed / diaper / sleep / medicine given / note, each a data-driven entry type
  (`care_entry_types.fields` is the form). Home screen shows last feed / nap / diaper /
  medicine today with "next due", who has Lana, who is home and who is working today,
  big one-tap buttons (home → type → amount chip = saved in two taps), a day list, an edit
  screen, and the handover card.
- Offline: an entry made with no signal is kept on the phone and sent when back online
  (idempotent on `client_id`). Installable PWA with a small app-shell service worker.
- Plain English copy, 18px base text (21px for carers and staff), 56px tap targets.

## 1. Database (Supabase)

The household's project is **home** (Supabase organization **Lan**, project ref `qjqekazawirrpwnwgbhd`). Two ways to get the
schema in; use one.

**A. GitHub integration (connected to this repo).** In the Supabase dashboard open the
project → Integrations → GitHub and set:

- *Supabase directory path*: `family/supabase` — **not** the default `supabase`, which holds the
  old sparx pipeline schema and would create the wrong tables.
- *Production branch*: `main`. Migrations in `family/supabase/migrations` are applied when a
  change lands on `main`, so merge PR #10 (or whatever branch carries them). With Branching on,
  each PR also gets a preview database.

**B. From your machine.**

```bash
cd family
npm install
npx supabase login                      # once
npx supabase link --project-ref qjqekazawirrpwnwgbhd   # project "home" in org Lan
npx supabase db push                    # applies supabase/migrations/* in order
```

What `db push` creates: tables `household, roles, modules, permissions, members,
presence_states, presence, work_schedules, audit_log, care_subjects, care_entry_types,
care_entries, care_custody`, the RLS policies, the RPC functions the app calls, and the
seed: Mido & Dana (admin), Wafa & Luda (family carer), Lilly (home carer, works
Tue/Wed/Fri/Sat/Sun), presence, Lana (born 5 June 2026), Fanta, and Lana's entry types.

Auth settings in the Supabase dashboard (Authentication → URL configuration):
- Site URL: your Vercel URL (e.g. `https://family-xyz.vercel.app`)
- Redirect URLs: `https://<your-vercel-domain>/auth/callback` and `http://localhost:3000/auth/callback`

### Create the five sign-in accounts

```bash
cp .env.example .env.local     # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                               # SUPABASE_SERVICE_ROLE_KEY and MEMBER_EMAILS
npm run seed:accounts
```

Mido's e-mail is already in the seed. The script creates an auth user per member and the
database trigger links it to the member row by e-mail. Anyone can also just sign in with
magic link; if their e-mail matches a member row they are linked on first sign-in, if not
they see "Your e-mail is not on the household list yet" and nothing else.

### Verify the database on its own (optional, any machine with Postgres 16)

```bash
npm run db:test          # creates a scratch DB, runs migrations + supabase/tests/rls_test.sql
```

Against the real project instead: `SKIP_STUB=1 PSQL="psql '<connection string>'" ./supabase/tests/run-local.sh`
(this writes test rows; use it on a fresh project only).

## 2. App (Vercel)

The Vercel project builds this folder (`rootDirectory = family`). Set two environment
variables in Vercel (Production and Preview) and redeploy:

```
NEXT_PUBLIC_SUPABASE_URL=https://qjqekazawirrpwnwgbhd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

Until they are set the app shows a "Not connected yet" screen.

Local: `npm run dev` → http://localhost:3000.

## 3. Adding a household member

1. Members → **+ Add**. Name, e-mail, role, relationship. Save.
2. Tell them to open the app and sign in with that e-mail. That is all; the first sign-in
   links the account. (Or run `npm run seed:accounts` with their name in `MEMBER_EMAILS`.)
3. For staff, set *Work days* on their member page. For anyone, set *Presence*.

New role: Members → Roles and permissions → *Add a role*, then tick what it may do.
New kind of Lana entry (solids, teething…): insert a row in `care_entry_types` with its
`fields` JSON (a Settings screen for this is in `LATER.md`); no migration is needed.

## 4. Where things are

```
supabase/migrations/   20261010000100_foundation.sql   members, roles, permissions, presence, audit, RLS
                       20261010000200_care_log.sql     subjects, entry types, entries, custody, RPCs
                       20261010000300_seed_household.sql
supabase/tests/        rls_test.sql (Step 1 checks as SQL), run-local.sh, local auth stub
app/(app)/             home, lana/, members/, audit, me   (server components, redirect if not allowed)
components/            EntryForm (renders `fields`), LanaCard, CustodyToggle, PermissionGrid…
lib/                   supabase clients, offline queue, time helpers, types
scripts/               seed-accounts.mjs, make-icons.mjs
```

## 5. Known limits in this step

- Sign-in is magic link only. Passkeys are not a primary sign-in method in Supabase Auth
  today (see *Decisions needed* in the PR). On iPhone the link opens in Safari, not inside
  the installed app; signing in once in Safari before "Add to Home Screen" avoids that.
- A denied **direct** table read over the Supabase REST API is blocked by RLS but cannot be
  written to `audit_log` by the database itself (Postgres runs GET requests read-only and
  rolls back a denied write). Everything the app does goes through the RPC functions, which
  do audit denials. Supabase's own API logs record the raw request.
- Push notifications, calendar, Lilly's shopping queue, Fanta's log, photos, the assistant:
  later steps, per PLAN.md.
