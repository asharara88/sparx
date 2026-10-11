# LATER — scope noticed while building, parked per PLAN.md "Rules for every step"

Not built. Each line is a candidate for the step named, or for a decision.

## Step 2 (remaining after the Step 2 build)
- Push notifications for calendar reminders and Lilly's requests: needs VAPID keys, a
  `push_subscriptions` table, an Edge Function and a schedule. Decide push vs. WhatsApp first.
- Handover card: "what's in the bag" checklist (needs a small `bag_items` table).
- Calendar: monthly repeat, per-event edit of a single occurrence, "visitor mode" prompt that
  pre-fills a shopping list from a template.
- Shopping: reorder interval learned from purchase history (today it is typed), receipt capture (Step 5).
- Settings screen to add / rename / deactivate Lana entry types and edit their `fields`
  JSON and `due_after_min` (today: a row in `care_entry_types`).
- Magic link sign-in: add 6-digit code entry as an alternative so sign-in can finish inside
  the installed PWA on iPhone (needs the Supabase e-mail template to include `{{ .Token }}`).
- Feed/nap interval ("next due") per time of day rather than one number per type.
- Per-member large-text toggle (today: automatic for carer and staff roles).

## Step 3+
- Fanta: entry types (`fanta.food`, `fanta.litter`, …) and profile card. The tables exist.
- Photos on entries (Supabase Storage bucket + `attachments` table + OCR text).
- Audit log export / retention policy.

## Decisions
- Passkeys: Supabase Auth offers WebAuthn as an MFA factor, not as the first factor.
  Keep magic link, add passkey as second factor later, or move to another auth provider?
- Separate Supabase project for the household vs. reusing the connected "sparx studio" project.

## Step 3 (remaining after the Step 3 build)
- Reminders that *fire*: today a due vaccination/deworming shows on the home screen and the
  profile card from its due date (and in amber when overdue). Pushing it to a phone needs the
  same push plumbing as Step 2's reminders. Decide push vs. WhatsApp.
- Due items on the calendar (`calendar_list` could merge `care_due_list`).
- Receipt capture for shopping (Step 5) can reuse the attachment + on-phone OCR path.
- Assets: warranty-expiry nudge, service history per asset (today: its tickets).
- Fanta: feeding amounts per day summary and a weight curve like Lana's trends.
- Lilly's Send screen: a third section for "I used the last of X" could reuse the shelf.
- Text-reading on the phone loads tesseract.js from a CDN the first time (a few MB); consider
  bundling it, or an edge function, if that is slow on the house wifi.

## Step 4 (remaining after the Step 4 build)
- The brief is written when the home screen is first opened after 06:00 / 17:00, not pushed
  at 07:00: a 7 am delivery needs the push plumbing (Step 2 note) or WhatsApp. A cron on Vercel
  could pre-write every member's brief at 06:50 if we sign a per-member JWT with the project's
  JWT secret (keeps RLS); decide push first.
- Streaming the answer word by word (today the whole answer arrives after a few seconds).
- Proposals cover care entries, calendar entries and shopping; not presence, tickets, custody
  or edits of existing entries ("change that feed to 90 ml").
- Voice: uses the phone's built-in speech recognition (Chrome, Safari); no server transcription,
  no wake word. Arabic/Russian for Wafa and Luda would need `lang` per member.
- The assistant does not read photos or OCR text yet (attachments_search exists).
- Conversation memory is per phone and per session (session storage); nothing is stored
  server-side except the audit row.

## Step 5 (remaining after the Step 5 build)
- The cart agent is hand-driven: copy the instructions, run Claude in Chrome on the shop, paste
  its report back. A direct handoff (the app opening the agent with the manifest) needs the
  agent to expose an entry point; revisit when Claude in Chrome has one.
- Receipt reading uses the model on the server; the on-phone OCR path (tesseract) is not used
  for receipts because it mis-reads columns. A fallback for "no API key" would need it.
- Quantity on hand is not updated from receipts (we do not know what was used up).
- Store detection is by name only; a receipt from an unknown shop gets no `store_id` (pick it
  on the review screen). Stores are a table; add Spinneys, Waitrose… from SQL for now.
- Price alerts ("more than 50% above last paid") are in the agent's instructions, not enforced
  in the app; a report with a high price is shown as is.
- Learned interval uses purchase *dates*, not quantities; buying two packs at once still
  counts as one purchase date.
