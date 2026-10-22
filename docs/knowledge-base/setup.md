# Setup and review gates

This branch implements Feature 1 only. It is disabled unless KB_ENABLED=true. Do not apply this migration or change live flags as part of code review. Existing billing, trials, reservation accounting, contact forms, Airtable and Resend integrations do not change.

## Reproduce locally

Use Node >=22.13, npm ci, Python Playwright with Chromium, and Docker for SQL integration tests:

```sh
npm ci
npm test
node scripts/build-site.mjs
bash scripts/test-knowledge-sql.sh
python scripts/test-knowledge-browser.py
```

The SQL script starts a disposable pgvector/pgvector:0.8.1-pg17 container, with no published ports and no network, then removes it. It requires local Docker socket access. The harness in tests/sql/knowledge-bootstrap.sql is NOT a Supabase migration; never apply it remotely. Browser/API tests intercept or mock all external calls. They incur no AI charges and send no email or payments. The migration itself is exercised against real PostgreSQL/pgvector, including intentionally permissive existing storage policies.

## Isolated hosted setup (requires separate deployment/usage approval)

1. Use a separate Supabase project and Netlify test site. Do not reuse production service-role keys or customer documents. Disable customer automations, billing and notification integrations there.
2. Review and apply the repository's existing migrations to that test project, then apply 20261022060000_secure_knowledge_base.sql and 20261022090000_kb_business_conflicts.sql in order. Check that vector is available in the extensions schema; this migration fails rather than relocating an existing extension. Supabase roles/storage/auth must already exist. Use the local harness only locally.
3. Configure these private Netlify function variables for the same test project: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY. Verify names against rfp-security.js; do not paste any secret into a browser or source file.
4. Add KB_WORKER_SECRET with at least 32 cryptographically random characters, KB_EMBEDDING_API_KEY with an approved provider key, and KB_EMBEDDING_MODEL=text-embedding-3-small. It is deliberately separate from the compliance key. Set a provider project spending limit before enabling. The fixed embedding dimension is 1536; changing models/dimensions requires a reviewed reindex migration.
5. After consent to provider usage and a hosted preview deployment are explicitly approved, set KB_ENABLED=true for the isolated site only. For branch previews, set KB_WORKER_ORIGIN to that exact HTTPS preview origin (no path); otherwise the server falls back to Netlify DEPLOY_PRIME_URL/URL. This prevents self-dispatch to an unpublished canonical site URL. The worker trusts HTTPS Netlify origins or www.tendercrestai.com only; custom test domains require code review. Keep these variables Functions-only where the account supports it. Never expose the worker secret to client code.
6. Open /knowledge.html, sign in with a verified fictional test account through /auth.html, and create an organization. No existing customer documents are imported. One owner organization per account is permitted. Team invitations/admin are deferred to Feature 4; test additional memberships through a trusted SQL administrator after reviewing exact org/user IDs. Do not grant membership mutation to authenticated clients.
7. Upload fictional PDF/DOCX/TXT files, explicitly consent to provider indexing, and verify saved status becomes Ready. Check the original download and exact page/section quotations. Search sends the query to the embedding provider. Save a cited answer, approve it as owner/reviewer, then edit and confirm approval clears. Archive its source and confirm source/approved-answer retrieval stops.
8. With separate accounts, verify editor/viewer/reviewer restrictions, cross-organization denial, revoked membership, expired sessions, duplicate upload, worker retry, provider outage and quota exhaustion. Confirm existing proposal/trial/Stripe/contact paths behave as before. Record actual hosted results separately from offline results.

## Limits, recovery and retention

Private PDF/DOCX/TXT originals: 10 MiB; extracted text: 100,000 characters; PDF: 500 pages. Citation chunks: at most 80, 1,500 UTF-16 code units with 200 overlap, exact source offsets and parser-supplied page/section. Large sources fail instead of silently truncating. Scanned PDFs require external OCR; OCR and malware scanning are not added. Review parser warnings and originals before approving claims. Extraction normalizes text: citations refer to the saved extracted text, not byte offsets in the file.

Ingestion is a durable database queue dispatched to a Netlify background function. It has a 10-minute lease and three attempts per document, with an idempotent claim/commit and stale-worker rejection. No automatic scheduled sweeper is added. If dispatch is unconfirmed or a worker dies, an owner/editor uses Process / retry; wait for an active lease to expire before takeover. Failed attempts count toward budgets. The document and audit state remain saved on errors.

Budgets are atomic UTC daily org/global limits plus per-user minute limits: ingest 20/100 daily; search 100/2000 daily and 10/minute; registration 50/5000 daily; other mutations 200/5000 per action and 30/minute. These bound application requests, not a currency guarantee; provider spending limits remain necessary. Rate limits do not use or charge existing proposal credits. Server-side reads are bounded; the UI shows latest 100 documents/answers/events. Pagination, quotas by subscription and retention automation are future work.

Archiving is reversible only by a future trusted administrative workflow; this UI does not unarchive. It immediately excludes a source from retrieval, disables original access and invalidates dependent approvals. Originals, chunks and metadata remain stored for audit; there is no hard-delete or automatic retention task. Establish a retention policy before customer rollout. Provider retention follows the approved provider account policy. Audit logs omit document/query text; authorized database administrators retain privileged access. No audit rows can be edited by browser clients.

Approved answers are human-written and source-backed, not generated certifications. All active organization members can read drafts and source excerpts; only owner/reviewer approve. This is not a confidential reviewer-only draft workflow. Owner self-approval is permitted; separation of duties is not enforced. Revoking membership removes future data access but cannot recall already downloaded data.

## Production gate and rollback

Before any production rollout: approve migration/backup/restore plan, deployment and provider costs separately; finish isolated hosted auth/storage/worker/provider tests; review privacy/retention, organization membership and quotas; verify the actual pgvector version and schema compatibility. The migration adds kb_* objects and a new bucket, with KB-only restrictive policies on storage.objects. Other bucket predicates remain true, but real Supabase Storage API compatibility still requires hosted testing.

To stop the feature, set KB_ENABLED=false and redeploy only after approval; API/worker fail closed. Revoke/rotate the dedicated worker and embedding credentials as needed. Preserve the new tables/bucket for recovery and audit; do not drop customer data or vector shared with another application. No automatic production migration runner is introduced. Feature 2 starts only after Feature 1 review.
