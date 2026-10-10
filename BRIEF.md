You are building a private family-operations app for one household. Produce a build-ready product spec and phased implementation plan, then implement Phase 1. Ask me clarifying questions only where an answer changes architecture; otherwise make a reasonable call, state it, and proceed.

## Household and users
- Mido and Dana — admins. Full access to every module; manage members and roles.
- Wafa (Mido's mother, b. 1956) and Luda (Dana's mother, b. 1956) — "family carer" role. Can log and view Lana's and Fanta's entries, view the shared calendar and add events to it, add items to the shopping list. Cannot see home-maintenance costs, finances, or member management. Neither lives in the household: Wafa lives in Egypt and is currently on a ~3-month visit staying with us (residency under consideration); Luda lives in Dubai and stays over for stretches when needed.
- Every member has a **presence state** — "lives here", "staying with us", "visiting today", "away" — with dates, set by an admin or the member. Presence drives the calendar (who is in the house), the handover card (who to brief), shopping (extra consumption while staying), and the assistant's answers to "who's home".
- Lilly — household staff, "home carer" role. Works Tue/Wed/Fri/Sat/Sun; off Mon/Thu (encode as her schedule, not a hardcoded rule). Can: add items to the shopping list with a photo (she is the primary source of "we're running out of X"); open and update home-maintenance tickets with photos; view the day's household calendar for events that affect her (guests, deliveries, contractor visits). Cannot: see Lana's or Fanta's health/medication logs, costs, finances, or members. Her submissions go to a review queue an admin approves before they join the list. Her submission screen is the simplest in the product: camera, optional note, send — plus a shelf of the usual household items she can tap once to flag as running low.
- Lana: daughter, 4 months old (born 5 June 2026). Fanta: cat.
- Permission matrix is role × module × action (view / add / edit / delete), enforced in Supabase RLS, not only in the UI. Roles editable by an admin without a code change.
- Language: English only. Wafa, Luda, and Lilly are literate in English but not fluent — write all UI copy and assistant replies in plain, short sentences; no idioms, no jargon. Timezone Asia/Dubai. Currency AED.

## Core modules (Phase 1 unless marked)
1. **Lana log** — timestamped entries for feeding, diapers, sleep, medication given (name, dose as entered, time, who gave it — a record, not advice), routine/milestones, growth (weight/length), appointments entered from the clinic's card, free notes. Daily and weekly views; "last feed / last nap / last diaper / next due" summary on the home screen. "Who has Lana" toggle so entries attribute correctly. **Handover card**: one auto-generated screen for whoever takes over — last feed, nap, diaper, anything given today, what's in the bag. Entry types must be addable later without migration — solids and allergen introduction (~6 months), teething, toddler routines.
2. **Fanta log** — female ginger cat, ~3 years old, spayed, indoor. Eats Royal Canin; seed it as a recurring shopping item. Track food (amount, times), treats, litter changes, weight, vet visits, and vaccination/deworming/flea-treatment due dates with reminders. Profile card (clinic, microchip number, spayed, insurance if any) that any permitted member can pull up at the vet.
3. **Shared calendar** — household events, plans, reminders, recurring routines, staff schedule, member presence; per-event visibility and assignment to a member; replaces fridge notes. Push notifications. Visitor mode: a guest event informs Lilly, prompts shopping, and blocks contractor visits that day.
4. **Shopping** — one shared list across groceries, baby, cat, home, and adult consumables. Each item carries an owner, preferred store (Amazon.ae, Noon, Talabat, Carrefour, etc.), product link, last-bought date, last price per store, quantity on hand, size (nappies, clothing) with last-changed date, and reorder interval learned from purchase history. Receipt capture: photograph a store receipt, OCR updates last-bought, quantity, and price for every item on it. Lilly's queue and receipt capture are Phase 1; cart handoff (below) is Phase 2.
   Adult consumables seed: Mido — creatine monohydrate, hydrolysed protein, electrolytes. Dana — collagen, probiotics, plus items she adds herself; each owner edits their own list. Plain inventory only: no dosing, no health guidance anywhere in the app.
5. **Home maintenance** — ticket per issue (AC, plumbing, appliance), status, assigned contractor, photos, cost, history per asset. Asset register: each appliance with photo, model number from the label, purchase date, warranty end, who services it; tickets pre-fill from it. Contractor book with rating after each job and last invoice attached.
6. **Photo capture** — any entry in any module can attach a photo from camera or gallery (product label, prescription, receipt, broken fixture, vet card), visible to all permitted members. Thumbnails; OCR text into the item's searchable notes.
7. **Household assistant** — a conversational LLM agent available to every member, in chat and voice-to-text, in plain English.
   - Context: it answers from the household's live data via tool calls (read logs, calendar, shopping, maintenance, member schedules and presence), never from a static dump pasted into the prompt. It sees only what the asking member's role is permitted to see; the same RLS applies to the agent as to the UI. Lilly's assistant cannot answer questions about Lana's medication.
   - Phase 1: read and log. "When did Lana last feed?", "What's due for Fanta this month?", "Who's home Thursday?", "Log a 120ml bottle now", "Add wipes to the list", "Create a maintenance ticket, AC in the bedroom is leaking, here's a photo." Writes are confirmed in one tap before they commit. Hands-free voice logging for night feeds.
   - Morning brief (Phase 1): a 7am card to admins — today's calendar, who's in the house and who's working, what's due (Fanta, Lana, orders, maintenance visits), open approvals from Lilly's queue. "What happened today" digest for whichever parent was out.
   - Phase 2: proactive proposals — reorder predictions, weekly plan drafts, overdue vet items, patterns in Lana's sleep — delivered as cards a member approves, never silent actions.
   - Profile memory: a per-member and per-household notes layer the agent can read and, with approval, append to (e.g. "Luda prefers morning visits"). Admins can view and delete any of it.
   - Model: Anthropic API with tool use and prompt caching for the household system context. The agent must say when it does not know rather than guess; every factual answer about a log cites the entry it came from.
   - Guardrails: no medical, veterinary, or dosing advice — it reports what was logged and points to the clinic or vet on the profile card. Audit log of every agent read and write, visible to admins.

## Shopping fulfilment — cart-handoff model (Phase 2)
No UAE store (Amazon.ae, Noon, Talabat, Carrefour) exposes a consumer ordering API, so do not attempt direct ordering. Instead:
1. The app compiles a **cart manifest** per store from the shopping list: item name, product URL (or last-bought product ID), quantity, substitution rule (exact only / same brand any size / any brand), max unit price, delivery window preference.
2. "Fill cart" hands the manifest to an agentic browser session — Claude in Chrome, OpenAI's agent mode, or a self-hosted Playwright worker, selectable in settings — signed in to the store as the admin who triggered it.
3. The agent fills the cart and **stops at the checkout page**. It never enters payment details, never confirms an order, and never solves a CAPTCHA or OTP; those are the human's. It returns a summary (items found, substituted, missing, cart total) to the app.
4. The admin reviews in the store app, pays, and photographs the receipt; receipt OCR closes the loop.
Build the manifest format and the handoff first; the choice of agent is pluggable. Expect store UIs and bot-detection to change — treat every fill as best-effort with a clear "could not add" list, not as a guaranteed order. Before building, confirm the current state of each store's terms and any API or deep-link support, with sources; do not fabricate endpoints.

## Smart home (Phase 3, design for it now)
Cameras and sensors integrate through a hub (Home Assistant or equivalent) that the app reads from, never device by device. Note for device selection: Google Nest has an official API; RTSP/ONVIF cameras work with any hub; Ring, Eufy, Arlo, and Nanit have no public API (Nanit has only an unofficial community integration).

## Technical defaults (override with justification)
- Next.js (App Router) PWA, installable on iOS and Android home screens; Tailwind. Native app out of scope for Phase 1, but keep the data layer independent of Next.js so one can be added.
- Supabase: Postgres, Auth (magic link / passkeys), Row Level Security per role, Storage for photos, Edge Functions for notifications and agents.
- Offline-tolerant logging (queue entries when connectivity drops; one-handed 3am logging is the norm).
- Data stays in the household's own Supabase project; no third-party analytics.

## Deliverables, in order
1. Spec: data model (tables, relations, RLS policy summary), permission matrix by role × module × action, screen list with one-line purpose each, notification rules, cart-manifest schema, integration findings with sources.
2. Phased plan: Phase 1 (modules 1–3, 5, 6, 7 read + log + morning brief, shopping list with Lilly's queue and receipt capture); Phase 2 (cart handoff, proactive assistant); Phase 3 (smart-home hub, anything you propose beyond this brief). Each phase lists what is verifiable at its end, including a plain-English readability check of carer and staff screens.
3. Implementation of Phase 1 with seed data for all members and presence states, Lana, Fanta, and the consumables; README covering setup and adding a household member.

## Constraints
- Mobile-first; every logging action reachable in ≤2 taps from the home screen.
- Accessibility: Wafa and Luda are 70. Large default text, high contrast, generous tap targets, no gesture-only actions; the carer role gets a simplified home screen with the three or four things they actually do.
- Everything named in this brief (members, roles, presence states, Lana's entry types, Fanta's care items, consumables, stores, Lilly's working days, assets, contractors) is seed data. Admins add, edit, and remove all of it from the UI; none of it requires a code change or migration.
- No invented timelines or effort estimates; give scope and verification criteria instead.
- Flag anything requiring my decision or a paid service in a single "Decisions needed" list at the end.
