# The side-by-side walk

Opens every route on an old build and a new one, as each person of Lana's demo home and of the four
toddler homes, and compares what each page says. It is how a change is shown to leave a baby's home
alone (see `docs/AGES.md`, "Each step is ... checked the same way").

    scripts/walk/run.sh <label> <old family dir> <new family dir> [who ...]

- The old side is usually a second checkout of `main` (`git worktree add /tmp/base origin/main`,
  then `npm ci` in its `family/`). Each side's database is built from its own checkout's migrations
  and seeds, at the same moment, so the clocks match.
- People: `mido dana wafa lilly` (Lana's home; Wafa is on the simple screen), `noor12 adam18 maya24
  yusuf36` (the parents of `supabase/tests/toddler_homes.sql`), `nohome`. With `DAYS=1` the toddler
  homes also get their saved day (`toddler_days.sql`) and `noorcarer`, `noorsimple` join the list.
- `LANA_DAYS=365` sets Lana's age (on the home's date); `LANA_DAYS=none` takes her birth date away.
  `WALK_ROUTES=/,/baby` limits the routes. `FORCE=1` rebuilds the two apps.
- What is captured, per person and side, under `$WALK_OUT/runs/<label>/` (default
  `/tmp/elnunu-walk`): each route's visible text, each of Home's row sheets opened by a tap, the +
  sheet, and the tab bar on Home, the child's page and Milk.
- `judge.py` prints: for each toddler home, each false alarm found on the old side and whether it
  is gone; for Lana's home, every page that differs (lines that differ only by a "minutes ago"
  count are set aside and counted); any page that failed. `JUDGE_DIFF_ALL=1` diffs the toddler
  homes too. `JUDGE_EXTRA='label=regex;label=regex'` adds alarms.

Needs a local Postgres 16 (`pg_ctlcluster 16 main start`; in a fresh container also
`su postgres -c "psql -c \"alter user postgres password 'postgres'\""`) and Playwright (preinstalled
in cloud sessions). `main` against `main` gives no difference; a full run takes about nine minutes.
