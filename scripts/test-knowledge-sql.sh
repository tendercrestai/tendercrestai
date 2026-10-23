#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Disposable local-only Docker. No remote URL, credentials or exposed port.
container="tendercrest-kb-test-$$"
local_docker=(docker --host=unix:///var/run/docker.sock)
trap '"${local_docker[@]}" rm -f "$container" >/dev/null 2>&1 || true' EXIT
"${local_docker[@]}" run -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust \
  pgvector/pgvector:0.8.1-pg17 >/dev/null
for attempt in {1..30}; do
  if "${local_docker[@]}" exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
"${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < tests/sql/knowledge-bootstrap.sql
"${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261022060000_secure_knowledge_base.sql
"${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/20261022090000_kb_business_conflicts.sql
"${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < supabase/tests/knowledge-base.sql
