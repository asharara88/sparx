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
- **Definer functions see one home too.** Supabase's `postgres` role bypasses
  row security, so a function marked `security definer` owned by it would not
  get the policy. Since migration 4000 every definer function in `public`
  belongs to `app_rls`, a role row security applies to: inside them the home
  policy filters every read and write, and a permissive policy for `app_rls`
  gives them, within that home, all the power they had. Four stay with
  `postgres` because they must see across homes: `current_member_id`,
  `has_permission`, `link_current_user`, `household_create`. The helpers in
  `private` (`subject_module`, `entry_module`, `default_subject`,
  `admin_names`, `subject_names`) also answer only for the caller's home.
  **A new definer function must be given to `app_rls`** (`alter function …
  owner to app_rls`); the database suite fails if one is left with `postgres`.
  Composite foreign keys (`household_id, member_id` and `household_id,
  subject_id`) mean a row cannot point at a member or child of another home
  whoever writes it.
- **Shared definitions stay shared**: roles, the permission matrix, modules,
  entry types, presence states, the vaccine schedule, activities, stores and
  the helper's skills are one set for the deployment. Since migration 4100
  only the first home's admins change them (`private.platform_home()`;
  `me().platform` says whether you are there), and the editors say so to
  everyone else. Per-home copies are a later step, if a family ever needs
  its own matrix.
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
3. **The audit** (migration 4000): every definer function owned by `app_rls`;
   each id-taking RPC called from a second home with the first home's ids in
   the suite, all refused; composite home foreign keys. Still open: backups
   and the push cron per home (both use the service role across homes today);
   shared definitions per home or locked.
4. **Running it** (migration 4100): backups per home (`home-<id>/run-<stamp>`
   in the bucket, listed and downloadable by that home's admins only); push
   notifications stamped with the member's home; the four shared-definition
   editors locked to the first home; the photos bucket per home (uploads go
   under `home-<id>/…` and the bucket policies check the folder; photos from
   before many homes are the first home's). The timezone and currency lookups
   written as `from household limit 1` are safe since phase 3: inside an
   `app_rls` function row security leaves exactly the caller's home.
5. **Later:** one account in several homes with a switcher; a home's own
   subdomain or name on the login screen; deleting a home.

## What does not change

Your family's deployment keeps working as it is: the one existing home gets
an id, every row is stamped with it, and nothing moves. The old
`household.json` setup still works against a deployment with one home.
