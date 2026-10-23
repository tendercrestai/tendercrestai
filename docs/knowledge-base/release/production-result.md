# Feature 1 production release result

Feature 1 is live at https://www.tendercrestai.com/knowledge.html. Use an existing verified TenderCrest account, then create or select a knowledge organization. The workspace remains unlinked from the existing navigation; billing, proposals and contact flows retain their existing UI. Features 2–5 are not part of this release.

## Released version

- PR #9: https://github.com/tendercrestai/tendercrestai/pull/9 — merged through GitHub at the exact checked feature head 4c39a5c15e74f33d640a54ca42856db34c174777.
- Main merge commit: cd39f7da692048710f82f5b1b0eca02f3fa108a8. Its file tree matches the checked feature revision.
- Active production Netlify deploy: 6adaa9eddcafce608c23a551; site tendercrestai (7eda7e3f-b48d-48b6-8fea-3af646ea6851), context Production. Builds are restored to their original enabled setting.
- KB_ENABLED=true only in Production. KB origin, model, worker secret and embedding key also have only the Production context. Existing variable contexts were preserved. The owner accepted the existing site-default credential scopes; no plan upgrade was made. The working embedding credential is reused from the isolated site; the production worker secret is distinct.
- Production Supabase project: vfdwaqgfepvoujprtuww. Exactly migrations 20261022060000 and 20261022090000 were applied with transactional history records, an advisory release lock and bounded timeouts. pgvector 0.8.2 is in extensions. No old migration or disposable test harness was applied.
- The owner explicitly approved the production migrations, temporary build hold, PR merge, deployment, activation and limited fictional smoke tests after automatic review requested specific approval. The earlier rejected command made no changes.

## Validation

- Prior local evidence remains 114 Node tests, 30 named SQL assertions plus negative checks, 12 offline browser scenarios, public build and function packaging. The migration wrapper was additionally exercised in a disposable database: transaction/history records, PT409 updates, lifecycle behavior and duplicate-application rejection passed.
- Prior isolated testing completed 31 final live assertions. Real TXT/PDF/DOCX extraction and embeddings were tested there. This production smoke used one small fictional TXT document; it does not claim a separate production PDF/DOCX exercise.
- All 18 disabled-deployment assertions passed before activation: exact public artifact hashes, all application functions, existing pages, disabled KB, internal path exclusion, headers and published deployment.
- All 47 active production smoke assertions passed: confirmed fictional users, actual password Auth, organization bootstrap, private upload, real background extraction/embedding, semantic search and citations, saved draft, exact-revision approval, live approved retrieval, edit invalidation/draft exclusion, exact private original download, audit, mobile layout, logout, stale-revision 409, foreign-organization API denial, direct database RLS, foreign/public Storage denial, archival invalidation and cleanup.
- All 18 final integrity assertions passed. The active deployment matches main and all 22 allowlisted public file hashes; all 11 functions remain present, including existing integrations, with no temporary diagnostic. The extra Netlify configuration manifest entry is not publicly served. SQL, docs and diagnostic routes returned 404.
- All nine KB tables have RLS and deny anonymous/authenticated direct writes. All 13 mutation/search/job RPCs are service-only. The KB bucket is private, limited to 10 MiB and the three supported MIME types. The existing RFP bucket remains private with its prior size limit.
- Existing public function hashes, public/Storage policy hashes, eight customer-table RLS/ACL/owner configurations and the custom trigger hash match the pre-release baselines. The feature does not use existing proposal credits, free trials or billing tables. No proposal, contact, Stripe/payment, Airtable or Resend endpoint was invoked during smoke testing. No signup/reset email was sent: fictional users were administratively confirmed and auth.users has no custom triggers.
- Smoke AI usage: one ingestion attempt, one citation chunk and four successful query embeddings — five provider embedding requests total. This is bounded verification, not a guarantee of future provider availability or a currency spending cap. Provider account spending limits were not independently inspected.

## Test-fixture cleanup and retained limits

The fictional source is archived, so it and its dependent answer are excluded from retrieval; original access is denied. Its original/chunk/audit records are retained according to the documented KB archive behavior. Both fictional memberships are inactive, sessions revoked and account logins banned for one year. No customer accounts were modified or deleted.

Fresh backup evidence was owner-reported: 2026-10-22T23:49:22.8187204Z, 436383 bytes, pg_dump exit 0, archive-inspection exit 0, SHA256 5B60F0CA914F16DE407A3296AEB91D7EA01E93CC27665674EFA6430D8E858A92. The archive stays private on the owner's Windows computer. The agent did not independently inspect or restore it. A full restore test was not performed and Storage object files are not included. Production backup listing had no managed backups and PITR was disabled at preflight; no paid backup/subscription service was introduced.

Main reported protected=false and no active branch rules. PR #9 had no GitHub reviews; no independent human approval is claimed. Exact-head Netlify status succeeded and check runs completed with success/neutral outcomes; the integration could not access the dedicated protection endpoint, but the branch/rules APIs were available. No required check or reviewer rule was bypassed.

## Operations and rollback

Use /auth.html to sign in, then /knowledge.html for the workspace. Provider processing requires the per-upload consent checkbox; review exact quotations and originals before approval. Manual queue retry, three durable attempts, UTC org/global budgets, no OCR, no malware scanner, no automatic retention/hard delete, and manually provisioned extra memberships remain the documented Feature 1 limits. Team invitations and the remaining four features are deferred.

To disable KB, set KB_ENABLED=false only for Production and redeploy the same reviewed source. The verified disabled deployment is 6adaa9737f5b2e7cb165a1f7; the pre-feature rollback deployment is 6ad9a2726206627bbfb30be0. Preserve new KB tables, audit data, private originals and vector; do not drop data or restore a whole database over live writes as an automatic rollback step. No rollback was needed.

This report is a documentation-only follow-up to the released main commit; it does not change the live application or activate another deployment.
