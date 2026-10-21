# elnunu (النونو) — Steps 1 to 5

Private family-operations app for one household. This folder is the whole app:
a Next.js PWA on Vercel talking to the household's own Supabase project.
The product brief is `../BRIEF.md`; the build plan is `../PLAN.md`.

The walkthrough below uses the first household's names as examples: Lana the baby,
Dana and Mido her parents, Lilly the home carer, Wafa and Luda the grandmothers. The app
itself takes every name, role and routine from the household you set up (see *Set up the
household*); nothing in the code is tied to these people.

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

**Step 2 (this release)**

- Lana's medicine list with a safe gap between doses: "Given" logs it, and asks twice when it
  is too early (`/lana/medicine`). Her next 12 hours (feeds, nappies, naps) estimated from the
  last week, on Lana's Today tab, the Home screen and today's calendar. Her firsts with photos
  (`/lana/milestones`). A photo of a milk bag label or a bottle fills in the amount and date.
- Smart care: the next feed depends on how much she took (ten minutes on one side comes back
  sooner than a full feed on both; same rule in the database and the app), with a short-feed hint on
  Home. A breastfeed over 45 minutes gets a "Timer left on?" card with trim or keep. The Milk page
  forecasts when the fridge runs out, compares morning and night pumps week on week, and on the
  evening before a workday says which freezer bags to bring down. Lana's guide adds "likely hungry
  soon" and a possible growth spurt; Patterns gets a sleep coach. "Say it to log" on Home sends
  what you said to Ask for a one-tap Confirm.
- This week for Lana: a weekly note (what her age brings this week, last week in numbers, one
  thing to try, what is due), written on Sunday and pushed, with "Write it again" on the Lana page.
  Play ideas by age with a tick (`/lana/activities`, NHS, AAP and CDC sourced), a "what to expect"
  card on Patterns, and home-screen shortcuts for the sleep timer, feed, diaper and Ask.
- Next nap on Home and Today: her last wake-up plus her own awake window (from the log once
  it shows a rhythm, else the age norm), recalculated on every load, with a push about ten
  minutes before the window closes when the often cron runs. A mood tap (four faces) on
  Today, set against sleep day by day on Patterns. Week by week to three years
  (`/lana/weeks`, NHS, AAP and CDC sourced), named on the "what to expect" card, in the
  weekly note and in the helper's age outlook. About 150 play ideas, three a day in rotation.
  A monthly story (`/lana/story`): firsts with photos, the month in numbers, what was tried
  and a paragraph from the helper, written and pushed on her monthly birthday, printable.
  Growth charts on the WHO girls' curves (3rd to 97th percentile band, 2006 standards) for
  weight, length and head, with the approximate percentile of the latest measurement.
- Logging after the fact: every one-tap button on Home and the sleep shortcut has a "When"
  line (now, 15 min to 3 h ago, or a time), so a late tap is still logged at the right
  moment, including "woke up 20 min ago". A "Forgot to log something?" card on Home and on
  each day in the Lana tab writes a finished feed, nappy, nap or pump into the past in a few
  taps (what, started, lasted, the one detail), and nudges when nothing has been fed for
  well past her usual gap. Past days default to that day. The helper's "say it to log"
  takes "at 3" and "an hour ago" too.
- Entry checks: the log flags its own mis-entries (a sleep or feed timer left running, a
  timer that ran across later entries, a one-second tap, two nappies in the same minute, a
  bottle over 240 ml) and offers the fix the data supports: end it at the next entry, trim to
  a normal feed, remove it, or "it was real" so it is never asked again. Home shows the first
  two, Lana's Today shows all; `care_entry_check` is audited like any edit.
- The helper remembers in three ways: facts the family confirmed (`/ask/memory`, or "remember
  that…" in Ask; the ones that matter for the question go into the prompt, with ids so
  `forget_memory` can drop one after a tap), a one-line recap of each of the member's own
  earlier chats (what they asked, where it ended), and the outcome of the last coach plan. The
  coaching rule asks it to offer a memory when something was decided, so the next chat and the
  other carers start from it.
- The helper is built as an agent with skills: what it knows lives in `assistant_skills`
  (sleep, safe sleep, regressions, growth spurts, feeding, pumped milk, solids, teething,
  habits, crying, illness, development, Mama), each with trigger words in three languages,
  sources and an age range. A router picks the skills a question needs before the model is
  called; the always-on ones (how to coach, red flags) are in every call; the model can read
  any other with `load_skill`. Admins edit skills at `/ask/skills` without a deploy. Every
  answer starts from a situation snapshot (asleep or awake, last feed, next due, today's
  counts, phase, active plan) and the screen the member came from. Answers stream to the
  phone; tools of a round run in parallel with a timeout and a size cap; the last round is
  forced to answer in words. `npm run eval:assistant` runs the graded eval set
  (`lib/assistant/evals.ts`) against a running app with the cron secret.
- The helper is also a baby coach: ask about naps, bedtime, teething, a growth spurt or a habit
  and it looks at her real numbers first, says what is usual at her exact age, and can propose a
  short day-by-day plan you start with one tap. Today's step sits on Home with "Done today".
  The grandmas' screen says "probably hungry" or "sleepy soon" in their language and reads
  her day aloud.
- The helper remembers what the family tells it ("remember that…", confirmed with a tap), has a
  hands-free Talk mode (listens, answers out loud, listens again), and there is a Babysitter role
  that sees Lana, the chat and the helper only. Every night the database is backed up to a
  private bucket (newest 8 kept), listed under Audit log.
- Lana timers: one tap to start and stop Sleep, Night wake-up, and Breastfeed left/right
  (the breast option and timer appear only for a member flagged *Breastfeeds Lana* in
  Members). Bottle feeds record which milk: morning pumped, night pumped, freezer, formula.
- Shared calendar: events, plans, reminders, routines (daily/weekly), guests, deliveries,
  contractor visits, appointments. Per-event visibility: *whole household* or *family only*
  (hidden from staff). A guest day blocks contractor bookings and links to the shopping list.
  Each day shows who is in the house and who is working, from presence and work days.
- Shopping: one list across groceries, Lana and supplements, with owner, usual
  shop, product link, quantity left, size (with last-changed date), last bought, last price
  and a "buy again every N days" reminder. Tick an item off and it remembers the date.
- Lilly's screen (`/send`): a shelf of usual items to tap, or a photo with a note. Requests
  wait in a review queue; an admin adds them to the list or marks them not needed.
- Private `photos` bucket for request photos.

**Step 4 — the assistant (this release)**

- **Ask** (`/ask`, and the 💬 button on every screen): type or speak a question — "when did Lana
  last feed", "who's home Thursday", "when is the next vaccination", "how did she sleep this
  week". The answer cites the entries it came from; each citation is a link to that entry,
  event or item. If the data does not say, it says "I don't know".
- **It only sees what you see.** The assistant runs on the server *with your own session*; its
  tools are the same RPCs the screens use, under the same Row Level Security, and a tool is only
  offered when your role has that screen's permission. Lilly's assistant has no Lana tool at
  all, and is told to say plainly that Lana's log is not shared with her role.
- **Logging by chat and voice, one tap to confirm.** "Log a 120 ml formula bottle" prepares a
  card; nothing is written until you tap **Confirm**, and then it goes through the normal
  entry path (offline queue included). Also calendar entries and running-low items.
- **Morning brief / evening digest** on the home screen: written once per member per day the
  first time the screen is opened (from 06:00, and from 17:00 for "today, in short"), then kept.
- **Night** button on Ask: a dark screen for 3 am.
- **Audit:** every agent call is a row in `audit_log` (source `agent`) with the question, the
  tools used, the answer, any proposals, and token usage. Admins see them under Me → Audit log
  with a 🤖.
- Model: Claude Opus 5.5 through the Anthropic API, with the stable part of the system prompt
  cached for an hour and server-side refusal fallback on. Needs `ANTHROPIC_API_KEY` on the
  server (Vercel project env). Cost is roughly a cent or two per question.

**Step 6 — the proactive layer (this release)**

- **Cards on the home screen** that need a decision, not a screen: "Pepsi is probably running
  out" (approve → back on the list), "3 running-low requests to check". Approve or dismiss; dismiss snoozes it a week. Cards are
  per member and only cover what that member may see. They refresh when the home screen opens.
- **Plan the week** (calendar → "Draft the week"): the model reads who is home, what is due,
  what is low, and proposes up to six calendar entries with a reason each. Tick
  the ones you want, approve: only those go on the calendar. Sundays the cron drafts it for you.
- **Push notifications** (Me → Notifications, iPhone: add to Home Screen first): the morning
  brief at 06:55, new cards, an event starting within the hour, and Lilly's requests.
  Sent by a Vercel cron that runs *as each member* (a short-lived member JWT), so the
  same RLS applies to what is pushed. Opt in per phone; nothing is sent to anyone who did not.
- **For the doctor**: `/lana/export` (2 weeks, 4 weeks, 3 months: averages per day, growth,
  firsts, day-by-day table, every entry when 14 days or less). Print → Save as PDF.
- **View as** (Members → “View the app as Dana”): an admin sees every screen exactly as that
  member sees it, read only, with a banner and a “Back to me” button. The database treats the
  session as that member and refuses every write, so nothing can be logged in their name;
  denied attempts are audited with who was previewing. Needs `SUPABASE_JWT_SECRET` on the server.
- **Notes board** (home and `/notes`): short notes for the house. "Just for me" keeps a note
  private to whoever wrote it (a grandmother's own log); admins can pin.
- **Lilly's check-in** (top of her Send screen): "I'm here" / "Leaving". The home screen shows
  "Lilly here since 9:02"; admins can mark her in or out from there.
- **Milk stash** (`/lana/milk`, and the bottle line on the home screen): every bottle in the
  fridge or freezer, oldest first, with how long it keeps (fridge 4 days, frozen 6 months,
  thawed 24 h, warmed 2 h). Thaw, Warmed, Used, Bin are one tap. While Dana is at work the home
  screen counts down to the next bottle (last feed + the household's bottle interval).
- **Simple screen** (Me → Simple screen, with a language: English, Arabic or Russian): what
  Lana is doing and four huge buttons: Bottle (three amounts), Diaper, Asleep / Woke up, Note
  (spoken or typed), plus Ask. Arabic reads right to left. "Full screen" at the
  bottom switches back.
- **Voice helper** (Ask): the microphone listens in the member's language, the assistant
  answers in it, and the speaker button reads answers aloud. Chats save themselves after the
  first answer (the clock icon lists earlier ones; each member sees only their own).
- **Patterns** (Lana → Trends): one thin 24-hour bar per day for two weeks: sleep dark, night
  wake-ups pale, feeds as ticks, diapers as dots. The long night stretch and nap clusters show
  without a number.
- **Work hours** (Members → Work days): out from / back by, per member. The bottle countdown
  uses them; so does the assistant.
- **Large text** (Me): on by default for carers and staff, now a switch for everyone.
- **The bag** (Lana → Handover): a checklist that is ticked as it is packed and emptied for
  the next outing. Admins edit the list.
- **Entry types** (Members → Entry types): admins add, rename, switch off and reorder what
  the logs record, set "due again after N minutes", and edit each type's fields.
- **Due on the calendar**: vaccinations with a date show on their day.
- **Audit log** downloads as CSV.
- **Member photos** (Me → tap the photo): stored in the private photos bucket; shown on
  Members and wherever a member is listed.
- **Household facts** (Members → Household, and a Routine box per member): "Dana works 9 to 5,
  out by 8:30, pumps before leaving", "we aim for 400 ml in the fridge". The assistant, the
  brief and the plan read them; the home screen shows the day's pumped milk against the target.

**Step 5 — the shopping loop (this release)**

- **Receipts** (`/shopping/receipts`): photograph a receipt; it is read line by line by the
  model (structured output, never a guessed line) and each line is matched to a list item —
  first by a remembered printed name, then by name similarity (pg_trgm). Lines it is not sure
  about are flagged, never dropped: match them, add them as a new item, or skip them. *Apply*
  records a purchase per line and updates last bought, last price and the shop; the printed
  name becomes an alias so the next receipt matches without help. Only Mido or Dana can apply.
- **Learned reorder interval**: after two purchases of an item, the median gap between purchase
  dates becomes its interval and "probably running out" uses it instead of the typed number.
  The item page shows both, and the purchase history.
- **Fill a cart** (`/shopping/cart`): pick the shop and the items (needed ones are preselected),
  set the substitution rule per item (same brand only / any brand / exactly this), and the app
  prepares a cart run: a manifest and the instructions for the cart agent (Claude in Chrome, or
  whoever drives the browser). The instructions say stop at checkout, never pay, and report
  found / substituted / missing with prices. Paste the report back; the model turns it into
  per-item results you can correct; "I paid" marks found and substituted items bought today at
  the reported price. The app never reaches a payment page.
- Photos are shrunk on the phone before upload (longest side 1600 px), for every photo type.

## 0. Brand

The app is **elnunu** (النونو, "the little one"): the little one's day, in everyone's
hands. The mark (the Arabic noon as a cradle with the little one above it, on clay), the
colour tokens, the display faces and the voice are described in `docs/BRAND.md`; the
components are in `components/Brand.tsx`, the files in `public/brand/` and `public/icons/`.

## 1. Database (Supabase)

The household's project is **home** (Supabase organization **Lan**, project ref `qjqekazawirrpwnwgbhd`). Two ways to get the
schema in; use one.

**A. GitHub integration (connected to this repo).** In the Supabase dashboard open the
project → Integrations → GitHub and set:

- *Supabase directory path*: `family/supabase`, or the default `supabase`: the repo-root
  `supabase` entry is a link to `family/supabase`, so both resolve to the family migrations.
  (The old sparx pipeline schema now lives in `docs/pipeline-schema/`.)
- *Production branch*: `main`. Migrations in `family/supabase/migrations` are applied when a
  change lands on `main`, so merge PR #10 (or whatever branch carries them). With Branching on,
  each PR also gets a preview database.
- If the "Supabase Preview" check on a `main` commit says *Remote migration versions not found
  in local migrations directory*, the directory the integration reads does not hold the family
  migrations. Migrations applied by hand are recorded in `supabase_migrations.schema_migrations`
  with the file's version and name (`20261010000100` onwards) so both routes agree.

**B. From your machine.**

```bash
cd family
npm install
npx supabase login                      # once
npx supabase link --project-ref qjqekazawirrpwnwgbhd   # project "home" in org Lan
npx supabase db push                    # applies supabase/migrations/* in order
```

What `db push` creates: the tables (`household, roles, modules, permissions, members,
presence_states, presence, work_schedules, audit_log, care_subjects, care_entry_types,
care_entries, care_custody` and the later ones), the RLS policies, the RPC functions the app
calls, and the shared starting data: roles, modules, the permission matrix, presence states
and the child's entry types. Nothing about a particular family is in the migrations; the
household itself comes next.

Auth settings in the Supabase dashboard (Authentication → URL configuration):
- Site URL: `https://elnunu.com`
- Redirect URLs: `https://elnunu.com/auth/callback`, `https://sparx-tsom.vercel.app/auth/callback`
  and `http://localhost:3000/auth/callback`

### Set up the household (once per family)

The household's name, the people and the child come from one file, written to
the project by a script from your machine. Every value can be changed in the app later;
run the script again after editing the file and it updates what changed.

```bash
cp .env.example .env.local        # fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
                                  # and SUPABASE_SERVICE_ROLE_KEY
cp household.example.json household.json   # names, roles, e-mails, the child's name and birthday
npm run setup:household -- household.json --accounts
```

`household.json` is ignored by git. The example file documents every field: roles (`admin`,
`family_carer`, `home_carer`, `sitter`), presence, work days, who breastfeeds, work hours, the
child's name in Arabic and Russian for the simple screen, night window, ambulance number,
blood group, doctor. With `--accounts` the script creates a sign-in account for every member
with an e-mail and links it; each person then uses "Forgot password" on the sign-in screen to
choose their first password. Without it, anyone who creates an account with a listed e-mail is
linked on first sign-in; an e-mail that is not on the list sees "Your e-mail is not on the
household list yet" and nothing else.

The child's log keeps the internal module key `lana` (the first household's name, now just
an id in SQL and permission checks); every screen shows the name from the data.

### Verify the database on its own (optional, any machine with Postgres 16)

```bash
npm run db:test          # creates a scratch DB, runs migrations + supabase/tests/rls_test.sql
```

The same run is the `family` job of the repo's GitHub Actions workflow
(`.github/workflows/ci.yml`): every pull request and every push to `main` applies the whole
migrations folder to a fresh Postgres 16 and runs the RLS checks, after the app's typecheck and
unit tests. Since the Supabase integration applies migrations to the household's project when a
change lands on `main`, a migration that does not apply fails there before it reaches the
project.

Against the real project instead: `SKIP_STUB=1 PSQL="psql '<connection string>'" ./supabase/tests/run-local.sh`
(this writes test rows; use it on a fresh project only).

## 2. App (Vercel)

The Vercel project builds this folder (`rootDirectory = family`). Set two environment
variables in Vercel (Production and Preview) and redeploy:

```
NEXT_PUBLIC_SUPABASE_URL=https://qjqekazawirrpwnwgbhd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_USKFwTlyUZFxansVpZHWFQ_eBjVjJt6
```

Until they are set the app shows a "Not connected yet" screen.

Local: `npm run dev` → http://localhost:3000.

### Domain: elnunu.com

The app lives at `https://elnunu.com`; `sparx-tsom.vercel.app` keeps working as a fallback.
The code never hard-codes the host (sign-in links, callbacks and redirects all use the
request's own origin), so attaching the domain is configuration only:

1. Vercel → project `sparx-tsom` → Settings → Domains → Add `elnunu.com` (Vercel adds
   `www.elnunu.com` as a redirect to it). Vercel then shows the records to set.
2. At the registrar's DNS: an `A` record for `@` → `76.76.21.21`, and a `CNAME` for `www` →
   `cname.vercel-dns.com`. If the domain is registered through Vercel, nothing to do.
   Wait for the Domains page to show "Valid configuration"; the certificate is automatic.
3. Supabase → Authentication → URL configuration: Site URL `https://elnunu.com`, and add
   `https://elnunu.com/auth/callback` to the redirect allow-list (keep the Vercel one). Until
   this is done, e-mail links land on the old site URL.
4. Vercel → Settings → Environment variables: `VAPID_SUBJECT=https://elnunu.com` (optional;
   push subscriptions made on the old host carry on working).
5. On each phone, re-add the app to the home screen from `elnunu.com` so the icon opens the
   new address; the old one still works.

## 3. Adding a household member

1. Members → **+ Add**. Name, e-mail, role, relationship. Save.
2. Tell them to open the app and sign in with that e-mail. That is all; the first sign-in
   links the account. (Or add them to `household.json` and run `npm run setup:household --
   household.json --accounts` again.)
3. For staff, set *Work days* on their member page. For anyone, set *Presence*.

New role: Members → Roles and permissions → *Add a role*, then tick what it may do.
New kind of Lana entry (solids, teething…): insert a row in `care_entry_types` with its
`fields` JSON (a Settings screen for this is in `LATER.md`); no migration is needed.

## 3a. A copy for another family

One deployment serves one household: its own Supabase project, its own Vercel project,
the same code. Data never crosses between families because it is never in the same
database. For a new family:

1. **Supabase.** Create a project. Note its URL, the publishable key, the service-role
   key and the JWT secret (Settings → API). Apply the schema with `npx supabase link
   --project-ref <ref> && npx supabase db push` from `family/`, or connect the GitHub
   integration to a fork of this repo (section 1A).
2. **Household.** `household.json` for that family, then `npm run setup:household --
   household.json --accounts` with that project's values in `.env.local`.
3. **Auth.** Authentication → URL configuration: Site URL and the `/auth/callback`
   redirect for the address the app will live at. Authentication → Providers → Email:
   keep "Confirm email" on, or switch sign-ups off and rely on `--accounts`.
4. **Vercel.** New project from the repo, root directory `family`, the variables in
   `VERCEL_ENV.md` (the two public Supabase values at least; the assistant, push and cron
   ones to taste), then a domain if they want one.
5. **Phones.** Open the address, sign in, Add to Home Screen.

`.env.local` and `household.json` are per family and never committed. The vaccine
schedule shipped is the Abu Dhabi one; a family elsewhere edits it in the app
(Members → Entry types is not it; the vaccine book has its own admin rows in
`vaccine_schedule`).

## 4. Where things are

```
supabase/migrations/   20261010000100_foundation.sql   members, roles, permissions, presence, audit, RLS
                       20261010000200_care_log.sql     subjects, entry types, entries, custody, RPCs
                       20261010000300_seed_household.sql  roles, modules, permission matrix, entry types (no family data)
                       20261010000400_step2.sql        timers, calendar, shopping, requests, photos bucket
                       …                                one file per release since; 3500 = any household
supabase/tests/        rls_test.sql (the database checks), 01_test_household.sql (the household the
                       checks act as), run-local.sh, local auth stub, demo_data.sql
app/(app)/             home, baby/, calendar, shopping/, send, members/, audit, me
components/            EntryForm (renders `fields`), LanaNow (the child's one-tap screen), CustodyToggle…
lib/                   supabase clients, offline queue, names (the child from data), time helpers, types
scripts/               setup-household.mjs, seed-accounts.mjs, make-icons.mjs
household.example.json the household file to copy and fill in
```

## 5. Known limits in this step

- Sign-in is e-mail and password; "e-mail me a link" remains as a fallback. Passkeys are not a primary sign-in method in Supabase Auth
  today (see *Decisions needed* in the PR). On iPhone the link opens in Safari, not inside
  the installed app; signing in once in Safari before "Add to Home Screen" avoids that.
- A denied **direct** table read over the Supabase REST API is blocked by RLS but cannot be
  written to `audit_log` by the database itself (Postgres runs GET requests read-only and
  rolls back a denied write). Everything the app does goes through the RPC functions, which
  do audit denials. Supabase's own API logs record the raw request.
- Family chat: one shared stream of messages and photos for everyone at home (`/chat`); the assistant and photos are on for every role.
- Lana's day page and Trends compare her feeds, diapers and sleep with typical ranges for her exact age and flag a short day.
- Vaccine book (`/lana/vaccines`): the UAE childhood schedule dated from her birthday, record what was given and where, next visit on the home screen and the calendar, and in the doctor's export.
- Paediatrician card (`/lana/doctor`): doctor, hospital, call, book, directions, questions for the next visit, upcoming vaccines and appointments, past visits.
- Screenshot mode: build a local database with `supabase/tests/run-local.sh`, load `supabase/tests/demo_data.sql`, then run the app with `FAMILY_LOCAL_DB=<database>`. Pages read that database through psql as the member named by a `shot_as` cookie (defaults to Mido). Never set in production.
- Every environment variable, what it powers and where to get it: `VERCEL_ENV.md`.
- Lana first: Home is her place (state, one-tap log, next feed, pumping, the handover, her guide), the Lana tab has Today, Patterns, Week, Handover and Ask, plus Emergency and When to call. The rest of the household sits below a divider. Shopping is switched off for the household (`household.hidden_modules`); its data and permissions stay, and taking a module out of that list brings it back. Fanta, the house and the Home Assistant hub were removed from the app; their tables are still in the database.
- A bottle feed takes its milk out of the fridge stash (oldest first); a pump logged from Home goes into the fridge; while Mama is away the fridge plan says how many bottles are coming and whether to thaw a bag.
- Push notifications are not in yet (they need web-push keys and a scheduler; see LATER.md).
