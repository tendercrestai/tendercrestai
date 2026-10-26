# TenderCrest AI customer journey audit

Audit window: 2026-10-25–26 UTC. Production baseline: `c39f360bf290a5cd27781f3b5092dd491301cd0e` (account allowance release). This is a one-time engineering/customer-experience review, with targeted fixes and a prioritized backlog. It is not a claim that every possible failure, legal requirement, browser or future customer dataset has been tested.

## Executive assessment

The integrated product has working private document/evidence handling, proposal editing and review, deterministic fit/readiness scoring, export generation and account allowances. The audit found genuine navigation, recovery and onboarding defects, even though the existing automated suite passed. The most urgent unresolved finding is production signup/reset email configuration: no custom SMTP, no send-email hook, confirmation required, and the Auth API reports `rate_limit_email_sent=2`. A successful public page load does not establish that an external new customer can receive confirmation/reset email.

Production changes in this audit: read-only inspection only. Source fixes are on `audit/customer-journey-hardening`; preview validation and its commit are recorded in the PR/evidence. No production migration, secret change, SMTP configuration, customer-data mutation, email, payment, ad spend or paid AI training is part of this audit. The existing isolated Auth redirect configuration was corrected separately; no messages were sent.

## Confirmed defects addressed in the feature branch

| ID | Priority | Customer pain / evidence | Implemented correction |
|---|---|---|---|
| F01 | High | Auth, uploaded emailed-draft form and homepage embedded the production Supabase project. Staging could authenticate against the wrong environment. | Public, validated `auth-config` endpoint; clients load the deployment configuration, fail closed and offer retry. No service key reaches the browser. |
| F02 | High | `next=rfp-upload` did not actually return customers to upload; compliance and workspace sign-in links lost the workflow. | Internal allowlisted return destinations for upload, compliance, library, workspace and emailed-draft form. External/open redirects rejected. |
| F03 | High | Shared project fragments and compliance-to-draft handoffs could be lost at login; confirmation redirected to a generic account page. | Preserve only validated project/analysis UUIDs and allowed continuation through login, signup confirmation and reset. Unrelated email/token query fields are discarded. |
| F04 | High | My Account's “Open Proposal Workspace” opened the older homepage emailed-draft form; duplicate workspace links added ambiguity. | Main button opens the integrated workspace. Emailed draft and upload are separately labelled. Duplicate link removed. |
| F05 | Medium | Allowance was visible, but subscription cancellation/invoices and billing help required finding the homepage pricing tab. | Direct existing Stripe portal, plans, emailed-draft and account-help links in My Account. No billing policy changes. |
| F06 | Medium | Empty project list plus organization requirement left a new user without a direct next action. | Explicit empty-state explanation and a company Knowledge Library setup link; preserves explicit project sharing. |
| F07 | High | Completed section previews were reachable only through the immediate polling dialog. After reload, there was no UI to reopen one. | Saved section-job list and review action in editor/exports; retrieves the existing authorized job, with no new generation charge. |
| F08 | High | A recovered old preview needs a visible current-revision check before any replacement. | Acceptance disabled for older project/evidence revisions; explanation appears inside the modal. Server's existing stale-preview rejection remains authoritative. |
| F09 | Medium | Expired export jobs still offered download buttons that then failed. | Explain expiry/unavailability and direct regeneration; show available-until date for current files. No retention changes. |
| F10 | Medium | Workspace/library/compliance fetches could leave UI busy indefinitely during a stalled request. Retrying a mutation blindly could duplicate work. | Bounded 90-second browser requests with an explicit uncertain-outcome message; preserve unsaved text and do not automatically retry. |
| F11 | High | Analytics decline deleted the local token before knowing the server deletion succeeded, leaving no retry after an outage. | Retain only the signed deletion token, keep collection off, retry after reload/online, remove it after success. |
| F12 | Medium | A failed emailed-draft job told a customer to contact support without a stable submission reference. | Failure/missing-submission messages include the private submission UUID, without document text or email. |
| F13 | Medium | Compliance requests relied on the provider's default storage behavior while section writing explicitly set `store:false`. | Explicit `store:false` and a request-shape regression assertion. This is not Zero Data Retention and does not alter the accepted provider retention limitation. |
| F14 | Medium | Isolated Auth site/redirects pointed to an old preview and minimum password length differed from the UI/production. | Isolated site URL and allowlist aligned while retaining prior entries; minimum length set to 12. Production Auth unchanged. |
| F15 | Medium | Revision API supports pagination but UI loaded only page zero, hiding revisions older than the first 25 entries. | “Load older revisions” with page advancement and a clear end state. |
| F16 | High | The isolated site's `SUBMISSION_ENABLED=false` variable was not read by the submission handler; missing credentials, rather than the intended switch, prevented dispatch. | Honor an explicit false before any authentication/storage/provider request. Unset production behavior is preserved; no flag is enabled. |

## Unresolved findings and product priorities

### G01 — Signup/password-reset email needs production verification — highest priority

**Confirmed configuration:** production requires confirmation (`mailer_autoconfirm=false`); no custom SMTP host; send-email hook disabled; Auth email limit reported as 2. The default Supabase mail service has restrictive limits and recipient behavior; an external-customer delivery test was deliberately not sent. Treat external signup delivery as unverified, not passed.

**Customer impact:** no confirmation/reset message means a customer cannot reach the product, regardless of how good the demo or proposal engine is. Repeated retries can also exhaust the low email allowance.

**Concrete resolution:** Supabase production → Authentication → Email / SMTP settings → configure an approved mail provider and verified sender. For Resend SMTP, review `smtp.resend.com`, TLS port 465, username `resend`, and a securely supplied sender-scoped API key; first confirm the chosen sender/domain and provider plan. Do not paste keys into chat or assume a send-only API key establishes SMTP/domain readiness. Adjust Auth email limits to the approved provider's limits, then explicitly authorize a controlled external confirmation and reset test. Do not blindly raise limits or enable mail during an audit. The production redirect allowlist already includes the real website wildcard and minimum password length is 12.

### G02 — Paid checkout can use a different email from the signed-in account — high

Account/submission lookup intentionally matches the verified sign-in email to Airtable Billing Email. A customer buying through a public Stripe link using another email can pay successfully yet see “no plan.” The new account panel explains the mismatch but cannot safely decide that two email addresses belong to the same person.

Recommended work: authenticated checkout sessions carrying verified user/org metadata, stable customer/subscription binding, and an explicit verified account-linking procedure for existing mismatches. Migration/backfill requires reviewed identities. Never auto-link unrelated accounts by company name or client-supplied email.

### G03 — Emailed drafts lack a consolidated account history/download vault — high

The separate emailed-draft workflow has status polling and DOCX email attachments, but My Account does not list all prior emailed drafts with protected re-downloads. The integrated team workspace already has revisioned downloadable packages; these are different services.

Recommended work: authenticated proposal history, private retained artifacts, authorized download links, visible delivery status and controlled resend. Define retention, failure/refund and support policies. “Ready for Review” is not proof that the email reached an inbox. Resend acceptance and delivery must remain distinct.

### G04 — Mail relay retry deduplication is incomplete — high

The relay handles uncertain delivery explicitly, but its current payload is recipient/subject/message without a stable submission delivery identifier, and the provider request does not set a submission-bound idempotency key. Retrying a timed-out automation can send duplicates. Hashing all identical content is not a safe universal fix because two legitimate submissions or an intentional resend can be identical.

Recommended work: a stable automation/submission delivery ID, durable delivery receipts and provider idempotency, plus an explicit intentional-resend operation. Do not test by emailing customers or changing live automations during the audit.

### G05 — Personal upload deletion is not self-service — high

Knowledge source archive exists, but archive retains originals, extracted text, embeddings and history. Project deletion is separate and does not delete original personal RFP uploads. The current disclosure states that the upload page has no self-service deletion.

Recommended work: a reviewed organization/personal-data deletion workflow with ownership checks, dependent evidence/approval invalidation, retention rules, provider/email boundaries and an audit receipt. Until then, make the manual deletion process operational and publish an honest response target. No destructive cleanup was attempted here.

### G06 — Workspace commercial access and emailed credits are separate — product decision

The published 5/20/60 allowances cover the emailed AI-draft service. Team-workspace editing/export does not deduct those credits; current access is driven by verified identity, organization/project roles, enabled features and technical quotas. These distinctions are disclosed, but buyers can still interpret a plan as a single unified credit entitlement.

Before increasing ad spend, decide the intended commercial scope of workspace seats, section AI usage, storage and support. Present one clear comparison table. Do not retroactively change paid customers, free access or trial terms without a reviewed policy/migration.

### G07 — Operational continuity remains a customer-experience risk — high

Netlify credit exhaustion already prevented a release in this session's history. Read-only page health does not prove alerting, backups or recovery readiness. This audit did not establish a fresh encrypted off-workspace backup or execute a restore.

Recommended work: Netlify spend/usage alerts and a budget policy, a small uptime/error dashboard, verified private backup destination, scheduled backup checks and an isolated restore drill. Define who handles an outage and its communication path. Do not introduce a paid monitoring service or send notifications without approval.

### G08 — Scanned PDFs and exact Word layout remain limited — medium

PDF/DOCX/TXT parsing and scanned/mixed fixtures are tested. Scanned PDFs do not gain OCR automatically. Word pagination is not measured and perfect Word/PDF fidelity is not claimed. A scan-only buyer document may require OCR or a text-accessible original.

Recommended work: a clearly costed OCR option with consent and source-page traceability, plus a representative buyer-template export test set. Never silently invent text from unreadable pages or label the current exporter as exact-layout preservation.

### G09 — Audit “quality” is a readiness aid, not complete semantic/legal verification — medium

The engine has grounded requirement selection, evidence/revision rules, deterministic coverage scoring and limited literal/numeric conflict checks. It is not exhaustive contractual interpretation, independent certification verification or a statistical chance of winning. The winning-response corpus and calibrated outcome model remain unavailable.

Recommended work: collect reviewed, consented evaluation cases; measure false positives/negatives and missing requirements; keep human approval. Training consent/rights, verified wins AND losses, temporal holdout and paid-provider review remain prerequisites. Do not market untrained “winning-bid AI” or numerical win probabilities.

### G10 — Some long-lived lists remain bounded — medium

The audit fixes history pagination, but project listing is capped at 200, jobs at 30, files/events/notifications at 100 and assessment history at 20 in the current workspace response. These bounds help performance, but very active customers need discoverable pagination/search/archival rather than silent disappearance from lists.

Recommended work: explicit cursors/has-more controls and project search, without weakening tenant filtering. Backend record existence is different from UI visibility.

### G11 — Reminders and invitation delivery are intentionally manual/in-app — medium

Workspace email reminders remain disabled as authorized. Notifications are in-app; organization invitations are privately shared links, and organization membership does not automatically grant project access. A customer who never returns to the app may miss a due item.

Recommended work: make the two-step sharing flow and in-app delivery status clear. Offer opt-in email reminders only after sender configuration, authorization, delivery verification and unsubscribe controls. Do not turn them on silently.

### G12 — Remaining validation boundaries — not passed by this audit

No real card checkout/charge, automatic trial-to-paid renewal, cancellation/refund, new external signup email or reset delivery, customer data deletion, large-scale load test, mobile Safari/Firefox matrix, independent penetration test, live provider-spend dashboard access or disaster-restore test was executed. Existing tests cover simulated billing failures/cancellations/credits and provider failure paths; that is not equivalent to a live financial transaction. Contact tests use mocks; no contact acknowledgment was sent. Authentication CAPTCHA is currently disabled; contact Turnstile has both site/server keys configured. Review Auth abuse controls alongside SMTP capacity, without adding friction blindly.

## Verification and evidence

- Fresh production read-only audit: 30/30 public tables have RLS enabled; `rfp-documents`, `kb-documents`, `proposal-artifacts` private. No anon/authenticated table grants on sensitive analytics/credit tables.
- Public live anonymous sweep: 11 pages × 2 widths (390/1280) returned HTTP 200; no observed JS errors, overflow, duplicate IDs, empty visible buttons or visibly unlabelled inputs. SDK session source was intercepted as signed out, and remote fonts replaced with empty CSS: this validates the anonymous layout, not external font/CDN availability or a full WCAG certification.
- Static internal-link review: 110 links checked; no missing local files/known anchors.
- Local disposable PostgreSQL: 61 knowledge/discovery assertions plus 67 workspace/metadata/analytics assertions = 128 passed. No test SQL was run against production.
- Automated Node and browser results for the exact candidate are recorded in PR/evidence. Original baseline: 284 Node tests; new regressions cover routing/configuration, interrupted mutations and support references. New journey browser suite exercises real app files with every request intercepted, including preview recovery, history pagination and failed-deletion retry.
- The legacy mutating `tests/browser/proposal-workspace.py` runner was not executed successfully: it requires its guarded isolated password/account fixtures and environment variables. It was not counted as a passed suite. Current isolated hosted checks use existing fictional test identities; no new users are created.
- Source build remains an explicit public allowlist; private SQL, docs, models, server files and credentials are excluded. No new dependencies or paid service introduced.

## Suggested sequence

1. Resolve and explicitly test G01 signup/reset delivery before broad customer acquisition.
2. Review/release the tested navigation/recovery fixes. No production migration or secret rotation required; prior application deployment is the rollback.
3. Address G02 paid-identity linking and G03/G04 delivery visibility/deduplication together.
4. Establish G05 deletion operations and G07 backup/monitoring readiness.
5. Prioritize OCR, larger-list navigation and a clear workspace commercial policy from actual customer needs. Keep reminders/training/paid automation disabled until their own release gates are satisfied.

## Final validation status

Application commit `2f2d94a64508b7cdcf4e35764d919acbb39872bb` is available on the isolated preview at https://tendercrestai-pr6-isolated-20261021.netlify.app. All 293 Node tests, 128 local SQL assertions, seven offline browser suites, five separate privacy-browser checks, and 12 actual-SDK hosted preview checks passed. The new customer-journey suite includes 16 checks. The live anonymous sweep covered 22 page/width states and the local link scan covered 110 links. Production remains `c39f360bf290a5cd27781f3b5092dd491301cd0e`; PR #24 is unmerged. Temporary private sessions were removed and isolated automatic builds stopped after validation. Raw local evidence is under `/workspace/scratch/journey-audit/`.
