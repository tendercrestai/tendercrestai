# Add secure organization knowledge base behind a disabled flag

TenderCrest currently stores user-owned RFPs but has no shared, organization-scoped evidence library. This adds Feature 1: private PDF/DOCX/TXT uploads, bounded background extraction and embeddings, pgvector search, and human-written approved answers with exact source citations. Editing an answer clears approval; archiving its source removes dependent answers from retrieval.

The additive migration introduces organization roles, RLS, immutable private storage, durable jobs, usage admission and metadata-only audit logs. A separate /knowledge.html workspace is disabled by default and unlinked from existing navigation. Existing billing, trial, reservations, submissions, contact forms, Airtable and Resend behavior are unchanged. Features 2–5 remain a documented incremental roadmap.

Validation: 112 Node tests pass (95 existing +17 KB); local PostgreSQL/pgvector migration and isolation/lifecycle suite pass (30 named assertions plus negative checks); 12 offline Chromium scenarios pass; static build, local packaging of all 11 functions and diff whitespace checks pass. The owner subsequently authorized isolated hosted tests: the test migration and deployment, real Auth/Storage, worker dispatch/integrity/retry limits, natural session expiry and browser refresh passed. OpenAI rejects the configured embedding model with 403 model_not_found; real indexing/search and approval retrieval remain blocked. No production changes were made.

Before enabling production: complete the remaining hosted provider/indexing/retrieval checks and approve provider costs, migration/backup plan and deployment. Review retention, manual queue retry recovery, membership provisioning and plan quotas. Setup and limits: docs/knowledge-base/setup.md. Architecture and validation: docs/knowledge-base/architecture.md and validation.md.

This commit intentionally includes [skip ci] to prevent an unapproved automatic Netlify deployment. Run required CI separately in an approved non-deploying context before merge. Do not merge, apply production migrations or activate the feature as part of this review.
