#!/usr/bin/env bash
# Run the migrations + Step 1 checks against a plain local Postgres.
#   PSQL="psql -U postgres" ./supabase/tests/run-local.sh
# Against a Supabase project (local `supabase start` or remote), skip the stub:
#   SKIP_STUB=1 PSQL="psql $DATABASE_URL" ./supabase/tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="${PSQL:-psql}"
DB="${DB:-family_test}"
if [ -z "${SKIP_STUB:-}" ]; then
  $PSQL -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
  PSQL="$PSQL -d $DB"
  $PSQL -v ON_ERROR_STOP=1 -q -f tests/00_local_auth_stub.sql
fi
for f in migrations/*.sql; do
  echo "== $f"
  $PSQL -v ON_ERROR_STOP=1 -q -f "$f"
done
# The household the checks act as (the live project gets its own from scripts/setup-household.mjs).
echo "== tests/01_test_household.sql"
$PSQL -v ON_ERROR_STOP=1 -q -f tests/01_test_household.sql
echo "== tests/rls_test.sql"
$PSQL -v ON_ERROR_STOP=1 -f tests/rls_test.sql
