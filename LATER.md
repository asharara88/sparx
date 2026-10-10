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
