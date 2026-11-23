#!/usr/bin/env bash
# One side-by-side walk:  run.sh <label> <old family dir> <new family dir> [who ...]
# Builds both databases at the same moment (each from its own checkout's migrations), serves the
# old build on :3100 and the new on :3200 (built once; FORCE=1 rebuilds), walks, judges.
# LANA_DAYS and DAYS are passed on to db.sh. Results: $WALK_OUT/runs/<label>/, the report on stdout.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${WALK_OUT:-/tmp/elnunu-walk}"; mkdir -p "$OUT"
LABEL="${1:?label}"; OLD="${2:?old family dir}"; NEW="${3:?new family dir}"; shift 3
"$HERE/db.sh" "$OLD" tod_before > "$OUT/db-before.log" 2>&1 & a=$!
"$HERE/db.sh" "$NEW" tod_after > "$OUT/db-after.log" 2>&1 & b=$!
# A bare "wait" answers 0 whatever the two did: a side with no toddler homes would read as a pass.
wait "$a" || { tail -3 "$OUT/db-before.log"; echo "the old side's database did not build"; exit 1; }
wait "$b" || { tail -3 "$OUT/db-after.log"; echo "the new side's database did not build"; exit 1; }
tail -1 "$OUT/db-before.log"; tail -1 "$OUT/db-after.log"
"$HERE/serve.sh" "$OLD" 3100 tod_before
"$HERE/serve.sh" "$NEW" 3200 tod_after
node "$HERE/walk.cjs" "$LABEL" "$@" > "$OUT/walk-$LABEL.log" 2>&1
python3 "$HERE/judge.py" "$LABEL"
