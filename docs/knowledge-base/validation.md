# Review evidence (2026-10-22)

Base: main 2737c465a946ce207c68324c562709bdbf90ae17. Branch: feature/secure-ai-knowledge-base.

- Read-only audit of function/source architecture and production schema metadata completed; no customer rows were read. Existing schema has user-scoped RFP/compliance/trial/reservation tables, no organization/KB schema or vector extension.
- npm test: 112 passing tests, including 17 new KB API/worker/provider-adapter tests and 95 existing regressions. Provider responses, authenticated sessions and HTTP requests are mocked. This is not a live AI evaluation.
- Disposable PostgreSQL 17 + pgvector 0.8.1: migration and integration suite pass (30 named assertions plus negative privilege/validation blocks). Includes anonymous/foreign-org denial, immutable original storage despite broad pre-existing policy, other-bucket compatibility, actual vector retrieval, draft exclusion, approval/edit/archive invalidation, leases/revocation/takeover/attempt ceiling and transactional admission caps. Local auth/storage tables model Supabase; hosted Supabase API behavior remains to be verified.
- Chromium: 12 offline UI scenarios pass at mobile viewport, including availability, organization selection, literal citation rendering/XSS, citation selection, draft/approval/edit invalidation, source viewer, audit, role isolation and sign-out clearing. These fixtures do not test live Auth, Storage or Netlify dispatch.
- node scripts/build-site.mjs succeeds; public output allowlist includes the new workspace and excludes internal SQL/runbooks.
- Local Netlify zip-it-and-ship-it/esbuild packaging succeeds for all 11 functions. The background bundle includes PDF/DOCX extraction dependencies and docx-validation.mjs; public API bundles do not include parser dependencies. The packager warns about a pre-existing duplicate Follow-up Due key in contact-email.js, which this branch does not change.
- git diff --check succeeds. Existing billing/trial/credit/contact handlers and prior migrations are unchanged.

The local SQL tests found two issues before completion: missing service-role USAGE on the extensions schema and anonymous storage-policy subqueries that required direct metadata-table access. The migration now grants only the required service-role schema access and uses narrowly scoped, current-user boolean policy helpers. Fixtures also now serialize pgvector inputs using JSON vector syntax.

## Remaining gates

No production deployment/migration, notification, payment, customer import or production configuration change has been performed. Isolated hosted deployment/migration were subsequently authorized; actual results and the unresolved provider blocker are in hosted-validation.md. Finish the isolated hosted checks in setup.md after explicit deployment/provider approval, then review production migration/backup/restore and rollback. The UI is deliberately unlinked from existing navigation and the feature flag defaults off. Netlify background function plan/quota availability must be confirmed on the chosen test site. No paid plan upgrade is authorized by this branch.

GitHub GraphQL and REST access currently return Forbidden from this managed environment. The branch and PR text can be prepared, but an actual review PR cannot be opened through those APIs here. A [skip ci] commit marker is used to prevent a feature push triggering an unapproved automatic Netlify deployment; required CI must be explicitly run in an approved non-deploying context before merge. No merge is performed.
