#!/usr/bin/env bash
# Build one local database for screenshot mode from one checkout's migrations:
#   db.sh <family dir of a checkout> <database name>
# Lana's demo home (Asia/Dubai) and the four toddler homes, put in a zone where it is about 17:00
# now, so their "today" has a day in it. LANA_DAYS=<n> sets Lana's age in days (LANA_DAYS=none
# takes her birth date away). DAYS=1 also loads toddler_days.sql (each toddler home's saved day).
set -euo pipefail
TREE="${1:?family dir}"; DB="${2:?database}"
OUT="${WALK_OUT:-/tmp/elnunu-walk}"; mkdir -p "$OUT"
export PGPASSWORD="${PGPASSWORD:-postgres}"
P="psql -h localhost -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d "$DB" -f "$TREE/supabase/tests/00_local_auth_stub.sql" >/dev/null
for f in "$TREE"/supabase/migrations/*.sql; do $P -d "$DB" -f "$f" >/dev/null; done
$P -d "$DB" -f "$TREE/supabase/tests/01_test_household.sql" >/dev/null
$P -d "$DB" -f "$TREE/supabase/tests/demo_data.sql" >/dev/null
TZ_PICK="$(python3 - <<'PY'
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
now = datetime.now(timezone.utc)
for z in ["Asia/Dubai","Pacific/Auckland","Asia/Tokyo","Asia/Kolkata","Europe/Moscow","Europe/Berlin",
          "Europe/London","America/Sao_Paulo","America/New_York","America/Chicago","America/Denver",
          "America/Los_Angeles","Pacific/Honolulu","Asia/Bangkok","Australia/Brisbane","Asia/Kathmandu",
          "Atlantic/Azores","America/Halifax","Pacific/Fiji","Asia/Karachi","Africa/Nairobi","Asia/Shanghai"]:
    h = now.astimezone(ZoneInfo(z)).hour
    if 16 <= h <= 17:
        print(z); break
else:
    print("Asia/Dubai")
PY
)"
$P -d "$DB" -v tz="$TZ_PICK" -f "$TREE/supabase/tests/toddler_homes.sql" >/dev/null
if [ -n "${DAYS:-}" ] && [ -f "$TREE/supabase/tests/toddler_days.sql" ]; then
  $P -d "$DB" -f "$TREE/supabase/tests/toddler_days.sql" >/dev/null
fi
LANA="00000000-0000-4000-8000-00000000a001"
if [ "${LANA_DAYS:-}" = "none" ]; then
  $P -d "$DB" -c "update public.care_subjects set birth_date = null where id = '$LANA'" >/dev/null
elif [ -n "${LANA_DAYS:-}" ]; then
  $P -d "$DB" -c "update public.care_subjects set birth_date = (now() at time zone 'Asia/Dubai')::date - ${LANA_DAYS} where id = '$LANA'" >/dev/null
fi
echo "built $DB from $TREE (toddler homes in $TZ_PICK${LANA_DAYS:+, Lana: $LANA_DAYS}${DAYS:+, saved days loaded})"
