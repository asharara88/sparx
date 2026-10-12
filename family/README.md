# Family app — Steps 1 to 5

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

**Step 2 (this release)**

- Lana timers: one tap to start and stop Sleep, Night wake-up, and Breastfeed left/right
  (the breast option and timer appear only for a member flagged *Breastfeeds Lana* in
  Members). Bottle feeds record which milk: morning pumped, night pumped, freezer, formula.
- Shared calendar: events, plans, reminders, routines (daily/weekly), guests, deliveries,
  contractor visits, appointments. Per-event visibility: *whole household* or *family only*
  (hidden from staff). A guest day blocks contractor bookings and links to the shopping list.
  Each day shows who is in the house and who is working, from presence and work days.
- Shopping: one list across groceries, Lana, Fanta, home and supplements, with owner, usual
  shop, product link, quantity left, size (with last-changed date), last bought, last price
  and a "buy again every N days" reminder. Tick an item off and it remembers the date.
- Lilly's screen (`/send`): a shelf of usual items to tap, or a photo with a note. Requests
  wait in a review queue; an admin adds them to the list or marks them not needed.
- Private `photos` bucket for request photos.

**Step 4 — the assistant (this release)**

- **Ask** (`/ask`, and the 💬 button on every screen): type or speak a question — "when did Lana
  last feed", "who's home Thursday", "what's due for Fanta", "how did she sleep this week".
  The answer cites the entries it came from; each citation is a link to that entry, event,
  ticket or item. If the data does not say, it says "I don't know".
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

**Step 6 — the proactive layer and the hub (this release)**

- **Cards on the home screen** that need a decision, not a screen: "Pepsi is probably running
  out" (approve → back on the list), "Fanta: flea drops is overdue", "3 running-low requests to
  check", "🔥 urgent ticket still open". Approve or dismiss; dismiss snoozes it a week. Cards are
  per member and only cover what that member may see. They refresh when the home screen opens.
- **Plan the week** (calendar → "Draft the week"): the model reads who is home, what is due,
  what is low, what is open, and proposes up to six calendar entries with a reason each. Tick
  the ones you want, approve: only those go on the calendar. Sundays the cron drafts it for you.
- **Push notifications** (Me → Notifications, iPhone: add to Home Screen first): the morning
  brief at 06:55, new cards, an event starting within the hour, Lilly's requests and urgent
  tickets. Sent by a Vercel cron that runs *as each member* (a short-lived member JWT), so the
  same RLS applies to what is pushed. Opt in per phone; nothing is sent to anyone who did not.
- **The hub** (House → hub card): read-only Home Assistant. Admins pick which entities to show
  (temperatures, doors, motion, camera stills). The app never switches anything.
- **For the doctor / for the vet**: `/lana/export` (2 weeks, 4 weeks, 3 months: averages per
  day, growth, firsts, day-by-day table, every entry when 14 days or less) and `/fanta/export`
  (profile card, treatments with next due, weights, 90 days of notes). Print → Save as PDF.
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
- **Fanta's routines** (her page, and on the home screen when something is due): "every N
  days" tiles: litter full change, brushing, flea and tick, deworming, weighing. Done logs the
  linked entry. Admins edit them at `/fanta/routines`.
- **Simple screen** (Me → Simple screen, with a language: English, Arabic or Russian): what
  Lana is doing and four huge buttons: Bottle (three amounts), Diaper, Asleep / Woke up, Note
  (spoken or typed), plus Fanta fed and Ask. Arabic reads right to left. "Full screen" at the
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
- **Due on the calendar**: vaccinations and dewormings with a date show on their day.
- **Fanta's weight** curve on her profile card. **Audit log** downloads as CSV.
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
database trigger links it to the member row by e-mail. Anyone can also just create an
account with e-mail and password; if their e-mail matches a member row they are linked on first sign-in, if not
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
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_USKFwTlyUZFxansVpZHWFQ_eBjVjJt6
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
                       20261010000400_step2.sql        timers, calendar, shopping, requests, photos bucket
supabase/tests/        rls_test.sql (Step 1 checks as SQL), run-local.sh, local auth stub
app/(app)/             home, lana/, calendar, shopping/, send, members/, audit, me
components/            EntryForm (renders `fields`), LanaCard, CustodyToggle, PermissionGrid…
lib/                   supabase clients, offline queue, time helpers, types
scripts/               seed-accounts.mjs, make-icons.mjs
```

## 5. Known limits in this step

- Sign-in is e-mail and password; "e-mail me a link" remains as a fallback. Passkeys are not a primary sign-in method in Supabase Auth
  today (see *Decisions needed* in the PR). On iPhone the link opens in Safari, not inside
  the installed app; signing in once in Safari before "Add to Home Screen" avoids that.
- A denied **direct** table read over the Supabase REST API is blocked by RLS but cannot be
  written to `audit_log` by the database itself (Postgres runs GET requests read-only and
  rolls back a denied write). Everything the app does goes through the RPC functions, which
  do audit denials. Supabase's own API logs record the raw request.
- Push notifications are not in yet (they need web-push keys and a scheduler; see LATER.md).
  Fanta's log, maintenance, receipts, the assistant: later steps, per PLAN.md.
