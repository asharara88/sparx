# Many homes in one deployment

Until migration 3900 a deployment served one family: one `household` row, one
member list, one Supabase project per family. From 3900 one deployment holds
many homes. A person signs up, creates a home or is invited into one, and sees
nothing of any other.

## The model

- **A home is a row in `household`** (uuid id). Everything a family writes
  carries `household_id`: members, the child, entries, milk, medicines, calendar,
  notes, chat, shopping, maintenance, the helper's chats and memories, audit
  rows, push subscriptions. 42 tables.
- **One account, one home** (v1). `members.user_id` is unique and an e-mail is
  listed in one home only. A grandmother helping two families needs two
  accounts for now; a home switcher is a later step.
- **Who you are decides which home you see.** `private.current_household_id()`
  is the home of the signed-in member (or of the previewed member in "view as").
  Every home-scoped table has one extra *restrictive* row-security policy,
  `household_id = private.current_household_id()`, on top of its existing
  permission policies. Restrictive policies AND with the others, so nothing
  that was forbidden is now allowed, and nothing from another home is visible.
- **Definer functions scope themselves.** Supabase's `postgres` role bypasses
  row security, so functions marked `security definer` do not get the policy for
  free. The helpers they trust (`private.subject_module`, `private.entry_module`,
  `private.default_subject`, `private.admin_names`, `private.subject_names`) only
  answer for the caller's home, which closes the common path (a subject or entry
  id from another home comes back as "not found"). Phase 3 tries every definer
  function from a second home and fixes what is left.
- **Shared definitions stay shared** for now: roles, the permission matrix,
  modules, entry types, presence states, the vaccine schedule, activities,
  stores and the helper's skills are one set for the deployment. An admin
  editing them edits them for every home. Phase 3 decides between per-home
  copies and locking those screens to the first home.
- **New rows know their home.** `household_id` defaults to the caller's home.
  While a deployment has exactly one home, a script writing with the service
  role (which has no member) lands there too; with two or more homes a script
  must say which, and `setup-household.mjs` does.

## Joining

- **Create a home:** a signed-in account with no member row calls
  `household_create(name, timezone, child name, birth date, sex, your name)`.
  It becomes the home's first admin, the child is made, and `me()` works from
  then on. If the e-mail is already on some home's list, that home wins and no
  second home is made.
- **Be invited:** exactly as before. An admin adds a name, e-mail and role on
  the Members screen; the first sign-in with that e-mail links the account to
  that row (`link_current_user`, and the auth trigger). The invitee lands in the
  inviter's home because the member row carries its `household_id`.

## Phases

1. **Schema and scoping** (migration 3900, this PR): the model above, `me()`
   by home, `household_create`, the test suite with a second home and
   cross-home checks, the setup script explicit about the home.
2. **The screens:** "Create your home" for an account that is in no home;
   login copy; README and handover for self-serve.
3. **The audit:** every definer RPC called from another home with the first
   home's ids, fixed as found; backups and the push cron per home; shared
   definitions per home or locked.
4. **Later:** one account in several homes with a switcher; a home's own
   subdomain or name on the login screen; deleting a home.

## What does not change

Your family's deployment keeps working as it is: the one existing home gets
an id, every row is stamped with it, and nothing moves. The old
`household.json` setup still works against a deployment with one home.
