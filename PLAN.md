# Family App — Build Plan

Companion to `BRIEF.md` (keep both in the repo root as BRIEF.md and PLAN.md). Each step has a scope, a verification you run yourselves, and what only you can supply. No step starts until the previous one's verification passes in real use.

---

## Step 0 — Decisions (you and Dana, before any code)

Settle these so the agent doesn't guess:

| Decision | Options | Default if unanswered |
|---|---|---|
| Fanta indoor only? | yes / goes out | indoor |
| Wafa's residency | likely / unlikely / unknown | model her as "staying with us" with an end date |
| Cart-fill agent | Claude in Chrome / OpenAI agent mode / self-hosted | Claude in Chrome |
| Lilly's phone | iOS / Android, her own or household device | her own, Android |
| Camera brand (if any planned) | Nest / RTSP-capable / none yet | none yet — don't buy closed-API cameras |
| Who approves Lilly's queue | Mido only / Dana only / either | either |
| Notification channel | push only / push + WhatsApp | push only (WhatsApp is Phase 3) |

**Needs you:** vet clinic name, paediatrician, Fanta's microchip number, the contractors you already use, store accounts you'll link.

---

## Step 1 — Foundation (invisible, must be right)

**Scope**
- Supabase project; Auth with magic link + passkeys.
- Tables: members, roles, permissions (role × module × action), presence states, audit log.
- RLS policies derived from the permission table, not hand-written per table.
- Seed: Mido, Dana (admin); Wafa, Luda (family carer); Lilly (home carer); presence states.
- Repo with BRIEF.md and PLAN.md; Claude Code session convention: "Read BRIEF.md and PLAN.md. We are at Step N. Build only X."

**Verify**
- Log in as each of the five accounts.
- As Lilly, attempt to read a Lana log row via the API directly (not the UI) → denied.
- As Wafa, attempt to read a maintenance cost → denied.
- Change Lilly's working days in the UI → no code change needed.
- Audit log shows every one of the above attempts.

**Needs you:** nothing beyond the Step 0 answers.

---

## Step 2 — The fridge replacement (first thing on phones)

**Scope**
- Lana log: feed, diaper, sleep, medication-given, note. Home screen summary (last feed / nap / diaper / next due). Who-has-Lana toggle. Handover card.
- Shared calendar with presence and Lilly's schedule.
- Lilly's submission screen: camera, optional note, send; plus the tap-to-flag shelf. Admin review queue.
- PWA installed on all five phones. Large-text, high-contrast default for carer role.

**Verify (one real week)**
- Every feed and nap for seven days logged in the app, none on paper or in WhatsApp.
- Wafa logs at least one entry unassisted.
- Lilly submits at least three "running low" items; an admin approves from the queue.
- One plan that would have been a fridge note goes on the calendar instead.
- Offline test: airplane mode, log a feed, reconnect → entry present with correct timestamp.
- Readability check: Wafa and Lilly each explain what every button on their home screen does.

**Needs you:** daily use. This step produces the information that reshapes the rest.

---

## Step 3 — Fanta and the home

**Scope**
- Fanta log, profile card, due-date reminders.
- Maintenance tickets, asset register (photograph every appliance label once), contractor book.
- Photo attachments on every entry type; OCR into searchable notes.

**Verify**
- Pull up Fanta's profile card from Luda's phone in under five seconds.
- Photograph an appliance label → model number lands in the asset register correctly.
- Open a ticket from Lilly's phone with a photo → appears for admins with the asset pre-filled.
- Vaccination reminder fires on the right date (set one for tomorrow to test).

**Needs you:** an afternoon photographing appliance labels; Fanta's vet record; contractor numbers.

---

## Step 4 — The assistant, read then write

**Scope**
- Anthropic API, tool use over the household data, prompt caching of the system context.
- Read-only first: "when did Lana last feed", "who's home Thursday", "what's due for Fanta".
- Then logging by chat and voice with one-tap confirm.
- Morning brief at 7am; "what happened today" digest.
- Audit log of every agent call.

**Verify**
- Ask the same ten questions from Mido's, Wafa's, and Lilly's accounts; Lilly's assistant refuses every Lana health question and says why in plain English.
- Every factual answer cites the log entry; one deliberately unanswerable question gets "I don't know", not a guess.
- Voice-log a feed one-handed in the dark; correct entry, correct time.
- Morning brief matches the calendar and presence state for that day.

**Needs you:** an Anthropic API key (paid); judging whether the brief is useful or noise after a week.

---

## Step 5 — Shopping loop

**Scope**
- Full shopping list with owner, store, link, quantity on hand, size tracking, price memory.
- Receipt capture with OCR → last-bought, quantity, price.
- Adult consumables seeded; Royal Canin seeded as recurring.
- Cart manifest schema and "Fill cart" handoff to the chosen agent; stops at checkout.

**Verify**
- Photograph three real receipts (Carrefour, Talabat, Amazon) → at least 80% of line items matched to list items without manual fixing; the rest flagged, not silently dropped.
- Fill one Amazon.ae cart via handoff; summary lists found / substituted / missing; agent never reaches payment.
- One item's reorder interval computed from two receipts rather than typed by hand.

**Needs you:** doing the actual checkout and payment; deciding substitution rules per item.

---

## Step 6 — Proactive layer and smart home (only after 1–5 are in daily use)

- Reorder predictions, weekly plan drafts, overdue vet items as approve/dismiss cards.
- Home Assistant hub; cameras chosen for API access; app reads the hub only.
- WhatsApp notifications if push proves insufficient for Lilly or the mothers.
- Exports: Lana's log as PDF for the paediatrician; Fanta's for the vet.

---

## Rules for every step

- The agent ends each session with a verification checklist you can run, not a claim that it works.
- Nothing is marked done until used for real by the people it's for.
- Any scope the agent proposes beyond the current step goes into a `LATER.md` list, not into the build.
- If a step's verification fails, fix that step; don't start the next one to compensate.
