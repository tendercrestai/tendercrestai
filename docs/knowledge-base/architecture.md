# Feature 1: secure organization knowledge base

## Existing architecture audit

Audited main 2737c465a946ce207c68324c562709bdbf90ae17. Static HTML/ES modules are explicitly copied to dist by scripts/build-site.mjs. Netlify functions own trusted API calls. Supabase Auth verifies users; PostgreSQL/Storage isolate existing RFPs by user. Compliance extraction shares bounded PDF/DOCX/TXT parsers; it uses exact source references and durable chunk leases/budgets. Existing submit-proposal, credits, Stripe webhook, contact/Turnstile and Airtable-to-Resend relay implement independent customer workflows.

Read-only production schema metadata lists rfp_uploads, rfp_submissions, free_trial_claims, proposal_credit_reservations and four rfp_compliance_* tables. No organization/membership/knowledge-base tables or vector extension were found. No customer rows were read. No production migration, environment or deployment changes are part of this work.

## Feature 1 boundary

New kb_* tables, private kb-documents bucket, API, background ingestion worker and optional /knowledge.html workspace. A minimal organization/membership foundation supports owner/reviewer/editor/viewer permissions; organization owners are provisioned by a verified-user bootstrap RPC. Membership invitations and team administration remain Feature 4. Existing user-owned RFPs and all billing/trial/contact paths remain unchanged. No legacy records are automatically assigned to organizations.

Uploads are immutable originals. Server-registered metadata determines organization/document paths. A customer JWT uploads bytes directly; storage RLS requires active organization membership and matching immutable metadata. The worker downloads verified original bytes, checks size/hash/signature/MIME, reuses existing extraction, preserves warnings/page/section and embeds bounded citation chunks. Explicit processing consent is required before any provider transmission. The durable queue has admission budgets, leases, bounded retries and stale-worker protection. Background invocation uses a separate high-entropy server-only secret; no host/header/client URL chooses a provider or worker destination.

Semantic retrieval uses pgvector (fixed 1536 dimensions, cosine distance) and organization filtering before returning a bounded result set. Search results are source excerpts, never generated bidder claims. Human-written answers cite ready chunks; only owner/reviewer roles can approve a particular revision. Editing invalidates approval; archiving a source removes it and its dependent approved answers from retrieval. Citations and audit events preserve actor, organization, revision and source identity. Audit events contain metadata, not document text, credentials or query contents.

Use existing OpenAI infrastructure only; no new paid vendor/account is introduced. Default model text-embedding-3-small must be explicitly configured and usage-approved before enabling KB_ENABLED. No live paid provider calls or remote migrations are run for this PR. pgvector storage/compute and Netlify background processing consume existing quotas. The feature is off by default and is not advertised in existing production navigation.

## Incremental roadmap

1. This PR: KB upload/extraction/vector search, approved answers and citations; membership/RLS/job/audit foundation.
2. Evidence mapping into the existing compliance matrix, gaps and reviewer overrides.
3. Proposal builder with editable DOCX, XLSX and PDF artifacts.
4. Organization administration/invitations, assignments/comments/versioned approvals and Resend notifications.
5. Explainable bid/no-bid scoring grounded in approved evidence.

No later feature is claimed implemented by this PR. No email notifications, proposal dispatch, payment, free-trial or credit-reservation changes are introduced.
