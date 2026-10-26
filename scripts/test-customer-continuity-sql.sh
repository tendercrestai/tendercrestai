#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="tendercrest-continuity-test-$$"
local_docker=(env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock)
trap '"${local_docker[@]}" rm -f -v "$container" >/dev/null 2>&1 || true' EXIT
"${local_docker[@]}" run -d --name "$container" --network none -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:0.8.1-pg17 >/dev/null
for attempt in {1..30}; do if "${local_docker[@]}" exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi; sleep 1; done
for sql in tests/sql/knowledge-bootstrap.sql supabase/migrations/20261022060000_secure_knowledge_base.sql supabase/migrations/20261022090000_kb_business_conflicts.sql supabase/migrations/20261023010000_knowledge_discovery_and_team.sql supabase/migrations/20261023160000_integrated_proposal_workspace.sql supabase/migrations/20261025090000_customer_knowledge_metadata.sql tests/sql/proposal-workspace.sql tests/sql/customer-upgrade.sql tests/sql/analytics-bootstrap.sql supabase/migrations/20261025180000_private_conversion_analytics.sql supabase/migrations/20261025190000_analytics_verified_identity.sql tests/sql/growth-analytics.sql tests/sql/customer-care-bootstrap.sql supabase/migrations/20261026090000_customer_continuity.sql tests/sql/customer-care.sql; do
 "${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < "$sql"
done
for sql in supabase/migrations/20261026100000_reminder_email_budget.sql tests/sql/reminder-budget.sql; do
 "${local_docker[@]}" exec -i "$container" psql -q -U postgres -v ON_ERROR_STOP=1 < "$sql"
done
