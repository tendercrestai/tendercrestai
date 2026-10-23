# Integrated proposal workflow release

## Release state

This branch adds four coordinated capabilities to the existing knowledge base and compliance analysis. It is not evidence of a production launch. Production was audited at commit `53d3416f4bf92a1a4a3c3eab5ca8300f39a12a93` (PR #12). The release must remain disabled in production until backup, staging, review, and controlled production verification gates pass.

Existing live features are retained: authentication, private user-owned uploads, compliance analysis/review and CSV/XLSX, organization knowledge and approved answers, invitations, existing submission/Airtable/email delivery, billing, subscriptions, trials, credit reservations, and duplicate protection. Open PRs #4 and #7 were inspected; their obsolete user-owned evidence schema was not merged over the current organization knowledge base.

## Customer workflow

1. Sign in. Choose **Open team proposal workspace** on the account page. Existing upload/delivery remains available separately.
2. Create a project in an existing knowledge organization. Only the creator has project access initially. An organization owner can select existing members and grant project roles in **Reviews**. Organization invitations still use Knowledge base → Team.
3. In **RFP**, upload up to six private PDF/DOCX/TXT files. Review extracted source text and limitations before consenting to the existing AI analysis. Resume saved analyses by ID. Explicitly share the owned snapshot and private source copies with the project. Importing an amendment invalidates prior mappings and reviews. Exact unchanged requirement wording keeps its workspace identity and edited response text even when a new analysis has new server IDs. Removed/changed responses remain in a read-only amendment archive and immutable history for safe reuse.
4. In **Requirements**, inspect each original source quotation and classify compliance separately from evidence support. In **Evidence**, match approved current organization answers and accept/reject/replace suggestions with a rationale. Possible conflicting structured company facts require an explicit recorded resolution; an explicitly expired source cannot be accepted as current evidence. An authorized reviewer can record a not-applicable/extraction-error disposition without deleting the original requirement.
5. In **Bid assessment**, supply evidence references or explicit human inputs, adjust weights, run the assessment, and record a human decision/override. Unknown factors contribute zero; coverage is shown separately. A mandatory non-compliance finding forces **pass**, irrespective of the weighted score. The fit score is not a win probability.
6. In **Proposal editor**, choose a requirement-linked section. Edits autosave with revision checks. A stale edit remains visible for reconciliation. Section generation assembles accepted approved source-backed answers verbatim; it does not invent qualifications. Inspect the preview and explicitly accept it. Procedural instructions and evidence gaps require human input.
7. In **Reviews**, assign real project members, due dates, comments and mentions. Authors request review; authorized reviewers request changes or approve a saved section. Manual text requires explicit factual verification against eligible evidence. Changed text, evidence or source status invalidates affected approvals. Review snapshots and assessment inputs are immutable audit records.
8. In **Exports**, map ready organization documents as private attachments. Resolve extraction warnings with a recorded source review. Render a draft ZIP to measure actual PDF pagination. Resolve the checklist, obtain authorized final sign-off, then create the final ZIP. DOCX, PDF, XLSX and CSV use the same saved revision. The manifest records file hashes, revision, exclusions, unresolved items, PDF pages and DOCX pagination uncertainty. Internal comments and review rationale are not included in customer documents by default.

## Architecture and security

`pw_projects` contains a bounded versioned aggregate. Explicit `pw_members` authorization is intersected with live organization roles. User-owned RFP records are never reassigned. No customer billing or legacy submission tables are changed. Project access is required for revisions, jobs, citations, files and notifications.

All mutation RPCs are service-only. Authenticated database clients have read-only RLS access; a restrictive storage policy prevents pre-existing broad policies from exposing `proposal-artifacts`. Source files and exports use server-authorized 60-second download links. Removing project/organization membership denies subsequent requests. Previously issued links can remain valid for their short lifetime.

Every mutation checks the project revision and evidence epoch. Sections additionally check their revision. Immutable revision, approval and assessment tables retain provenance and human decisions. Answer changes, approval removal and source archive/status changes bump dependent project evidence epochs, including projects referencing a supporting attachment. Explicit expiry dates are also checked on access. Missing dates and physical pages remain unknown.

Documents are untrusted data. New drafting and bid scoring are deterministic and do not call an additional AI model. Existing RFP extraction and knowledge ingestion retain their bounded provider calls, validation and consent. Approved-answer candidates use organization-scoped full-text ranking; the existing knowledge base still provides semantic retrieval. Suggestions can miss semantically relevant answers and require human review.

Background draft/export jobs have a saved revision, evidence epoch, idempotency key, private lease, ten-minute lease period and three-attempt ceiling. Claim and completion recheck current membership and revision. Completed request retries do not create another job. Deterministic artifact identity makes storage retries recoverable. Generation does not consume legacy proposal credits or replace existing proposal email delivery.

Notifications are in-app by default. Email requires per-member opt-in and server configuration. Removed members and viewers without a project grant cannot receive content. Email bodies contain a generic sign-in link, never proposal text. Delivery uses a stable Resend idempotency key; after 23 hours or three attempts uncertain notifications are not automatically resent. The hourly scheduled maintenance job also deletes expired generated packages. HTTP invocation requires the private worker secret. Test mode permits only explicitly allowlisted sandbox recipients.

Bounds: 200 active projects per organization; 500 requirements/sections per project; aggregate state 3 MB; section text 60,000 characters; 1,000 comments; ten supporting attachments totaling 20 MiB in a package; individual source 10 MiB; ZIP 50 MiB. Server admission limits bound per-user minute and organization/global daily usage independently of existing billing. Projects with more than these limits must be split. Maintenance admits up to 500 previously unqueued due-item notifications per run across active projects; daily idempotency lets subsequent runs continue through the remaining workload.

## Migration and configuration

Apply only `supabase/migrations/20261023160000_integrated_proposal_workspace.sql`, after the existing migrations. It adds nine RLS tables, privileged RPCs, evidence invalidation triggers and one private storage bucket. It does not reset, drop or migrate legacy ownership. Register version `20261023160000` with the migration workflow in the same transaction. Test project: `wcrrywzleylmdsqqlise`; production: `vfdwaqgfepvoujprtuww`. Never infer the target from an environment default.

Existing required server settings: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `KB_WORKER_SECRET`, `KB_WORKER_ORIGIN`, knowledge embedding and compliance AI settings. The worker origin must be a trusted HTTPS Netlify alias or `https://www.tendercrestai.com`.

New flags (exact string `true`; absent means disabled):

- `PROPOSAL_WORKSPACE_ENABLED`
- `PROPOSAL_EVIDENCE_ENABLED`
- `PROPOSAL_BUILDER_ENABLED`
- `PROPOSAL_COLLABORATION_ENABLED`
- `PROPOSAL_BID_ENABLED`

Enable the four component flags together after staging acceptance, then the workspace switch. Existing production behavior is preserved with the switch absent/false. `proposal-config` exposes only public Supabase configuration and booleans.

Email: existing `RESEND_API_KEY`; `PROPOSAL_PUBLIC_ORIGIN` set to the exact trusted deployment origin; `PROPOSAL_EMAIL_LIVE=false` in test, with comma-separated `PROPOSAL_EMAIL_TEST_RECIPIENTS` for explicitly authorized sandbox recipients. Set `PROPOSAL_EMAIL_LIVE=true` only after the live sandbox flow has passed and per-member opt-in is verified. No pricing change, paid service, account creation or customer announcement is part of this change.

Exports expire after seven days. Source copies, attachment records, comments and immutable snapshots remain until the creator explicitly deletes the project through the authenticated API (`delete`, exact confirmation `DELETE <project UUID>`). Delete removes private objects first, then cascades the project records. KB originals and legacy RFPs remain owned by their existing owners. Define a separate legally appropriate organization retention policy before promising automated customer record deletion.

## Backup, release and rollback gates

1. Capture the current production commit/deploy, flags and migration versions. Confirm repository protections and review the final PR diff.
2. Obtain a fresh private custom-format database dump and perform a restore into a disposable PostgreSQL database. `pg_restore --list` alone is archive inspection, not a restore test. Keep customer data and credentials private. The owner can use the [Windows backup and restore procedure](private-backup-windows.md). Verify storage object recovery separately; `pg_dump` does not back up object bytes.
3. Apply the exact additive migration in the separate test project. Run unit, SQL, browser and full hosted acceptance checks. Record observed results separately from procurement-completeness claims.
4. Review migration order and rollback. Apply the production migration only after the backup gate. Deploy via the existing Netlify/GitHub production workflow with all new flags off. Enable all four together only when checks pass.
5. Verify the actual deployed commit and applied migration, then run the controlled production journey with authorized accounts and fictional content. Check login, legacy upload/contact/delivery and billing configuration without a real charge or unsolicited message. Verify canonical/social URLs, sitemap and redirects use `https://www.tendercrestai.com`. Public marketing claims must match verified behavior.
6. Roll back by setting `PROPOSAL_WORKSPACE_ENABLED=false` and all component flags false, then redeploy the previous verified production commit. Preserve the additive tables and bucket; do not run destructive down migrations or erase customer projects. Disable live proposal email first if notification delivery is affected. Re-enable only after fixing and repeating the affected checks.

## Validation and limits

Run `npm test`, `node scripts/build-site.mjs`, and the disposable SQL harness plus `tests/sql/proposal-workspace.sql`. Bootstrap SQL is for a fresh local container only, never Supabase. The integration tests use fictional organizations and documents, current/expired dates, contradictory facts, instructions embedded in uploaded text, an amendment, two tenants and multiple roles.

Node tests check factual assembly/citation preservation, expiry, conflict resolution, independent compliance review, stale approvals, optimistic concurrency, explicit generation acceptance, bid scoring/unknowns/disqualifiers, DOCX/PDF/XLSX/ZIP, and notification idempotency. SQL checks RLS, privileged RPCs, immutable history, explicit membership, role downgrades, leases, retries, approved-only retrieval, source invalidation, notification preferences and restrictive storage access. Hosted and browser results are recorded separately in the release evidence report.

DOCX contains editable headings, tables, company name/color, page fields and a linked table of contents. Page-number fields update in Word. DOCX pagination is not measured. PDF pagination is measured from the actual rendered output. Ambiguous/section-specific page limits remain blocked for manual clarification; do not promise automatic page-limit validation for those cases. PDF/DOCX layouts may differ, but their response text derives from the same saved state.

The tool does not certify procurement completeness, verify real company certification authenticity, infer missing dates/pages, predict win probability, guarantee eligibility, or submit the package to a buyer. Human reviewers remain responsible for instructions, attachments, legal terms, source accuracy and final submission.
