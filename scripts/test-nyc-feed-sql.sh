#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="tendercrest-nyc-feed-test-$$"
local_docker=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
trap '"${local_docker[@]}" rm -f -v "$container" >/dev/null 2>&1 || true' EXIT
"${local_docker[@]}" run -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:0.8.1-pg17 >/dev/null
for attempt in {1..30};do if "${local_docker[@]}" exec "$container" pg_isready -U postgres >/dev/null;then break;fi;sleep 1;done
"${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 <<'SQL'
create role anon;create role authenticated;create role service_role bypassrls;
SQL
for sql in supabase/migrations/20261106090000_free_rfp_tools.sql supabase/migrations/20261108090000_nyc_feed_admission.sql supabase/migrations/20261108110000_nyc_feed_snapshot.sql tests/sql/free-tools.sql tests/sql/nyc-opportunities.sql;do
 "${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < "$sql"
done
