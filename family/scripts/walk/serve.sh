#!/usr/bin/env bash
# Build (if needed) and serve one checkout in screenshot mode, as a production build (taps work):
#   serve.sh <family dir> <port> <database>      FORCE=1 rebuilds
# Stops any next server already running from that directory or on that port first.
set -euo pipefail
TREE="${1:?family dir}"; PORT="${2:?port}"; DB="${3:?database}"
OUT="${WALK_OUT:-/tmp/elnunu-walk}"; mkdir -p "$OUT"
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_localscreenshotsonly000
for pid in $(pgrep -f "next" || true); do
  if [ "$(readlink -f /proc/$pid/cwd 2>/dev/null)" = "$(readlink -f "$TREE")" ]; then kill "$pid" 2>/dev/null || true; fi
done
for pid in $(lsof -t -i :"$PORT" 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
sleep 1
cd "$TREE"
if [ -n "${FORCE:-}" ] || [ ! -f .next/BUILD_ID ]; then
  npx next build > "$OUT/build-$PORT.log" 2>&1 || { tail -30 "$OUT/build-$PORT.log"; exit 1; }
  rm -f AGENTS.md
fi
FAMILY_LOCAL_DB="$DB" nohup npx next start -p "$PORT" > "$OUT/serve-$PORT.log" 2>&1 &
for i in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then echo "serving $TREE on $PORT with $DB"; exit 0; fi
  sleep 1
done
echo "server on $PORT did not answer"; tail -20 "$OUT/serve-$PORT.log"; exit 1
