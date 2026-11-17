# elnunu

A private family app for one household: Lana's day, the shared calendar, shopping, notes and
a voice helper. The app lives in [`family/`](family/README.md); start there.

- `BRIEF.md`, `PLAN.md` and `LATER.md`: the product brief, the build plan and parked scope.
- `family/docs/HANDOVER.md`: the state of play. `family/docs/DESIGN.md`: the design rules.
- `docs/SECURITY_UPDATES.md`: dependency security upgrades, and the weekly audit.
- `vercel.json` deploys `family/` and runs its daily job; `supabase` links to
  `family/supabase`, the path the Supabase GitHub integration reads.
- `CLAUDE.md`: how agent sessions work in this repo.

The repo once also held a YouTube studio pipeline and its dashboard. They were never used and
were removed on 17 November 2026; git history has them.
