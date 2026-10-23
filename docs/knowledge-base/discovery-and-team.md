# Knowledge Base discovery and team access

This additive change extends Feature 1. The production Knowledge Base and its account-entry button already exist; this change needs its own reviewed migration and deployment. It does not implement Feature 4 assignments, comments, approval workflows, or Resend notifications.

## Customer workflow

1. Sign in and use **Open Knowledge Base** on My account. Choose/create an organization, or accept an owner's invitation using the invited verified email address.
2. Follow **Get started**. Its counts cover the whole organization. Owners/editors upload sources; reviewers/viewers receive instructions appropriate to their role.
3. Use **Search everything** for document filenames, ready extracted text, independent draft/approved answer text, and permitted audit activity. Text search uses literal case-insensitive substring matching and makes no embedding request. Leave the query empty to browse. Choose **Meaning of ready evidence — AI search** for semantic retrieval through the existing embedding provider.
4. Open **Advanced filters** for document status/type, answer approval status, activity action, and inclusive UTC dates. Document dates mean upload time; answer dates mean last update; activity dates mean event time. Filters apply to their relevant result groups. Semantic search supports source file type and upload dates, filtering before ranking; archived or failed sources never become reusable quotations.
5. Use Previous/Next to reach older records. Documents, answers, activity, team lists, and grouped search use server pagination, 25 records per category per page by default. The API accepts at most 50 per page (25 for semantic search), with bounded offsets. Search groups share a page number; a smaller group can be empty while another group has more pages.
6. Verify originals before selecting up to ten citations. Save a human-written draft and have an owner/reviewer approve its exact revision. Draft badges remain distinct from approved answers. Saving an edit and archiving a source retain their existing approval-invalidation behavior.

## Team access

Only owners can open/manage Team access. They can invite a verified account as editor, reviewer, or viewer; search members/invitations; change non-owner roles; deactivate/reactivate non-owner access; and revoke pending invitations. Owner/creator access is protected. All active members can read drafts; there are no confidential reviewer-only drafts.

Invitation creation returns a random 256-bit token once, persisted only as SHA-256 in the database. Owners copy and share links themselves. No email is sent, and no Resend, Airtable, billing, or payment integration is invoked. Links expire after seven days and require the invited **verified** email. Reissuing a pending invitation for the same email revokes the older link. At most 50 unexpired pending invitations are allowed per organization.

Links put the token in the URL fragment. The client immediately removes it from the address bar and retains it in tab-scoped sessionStorage for the sign-in return, for at most seven days. It is cleared after acceptance/dismissal. Tokens are submitted only to the same-origin authenticated API and are not included in audit records. Existing account sign-in behavior changes only for the fixed `?next=knowledge` return path; arbitrary redirect destinations are unsupported.

Preview does not grant membership. Acceptance is explicit and preserves an already active member's current role. Replaying an accepted invitation does not restore revoked access. An owner can intentionally restore access using a new invitation or the member controls. Revocation blocks future API, database and private Storage requests; it cannot recall information already downloaded.

## Migration and security

Apply `supabase/migrations/20261023010000_knowledge_discovery_and_team.sql` **after** both original KB migrations and **before** deploying the new UI/functions. Do not reapply old migrations. The new migration adds `kb_invitations`, organization/time browse indexes, and service-only RPCs. It changes no existing customer, trial, credit, Stripe, contact, or proposal tables/policies and has no production auto-runner.

The invitation table has RLS and no anon/authenticated table grants. All new RPCs revoke PUBLIC/anon/authenticated execution. Verified server identity supplies actor IDs; the server and database both enforce current organization membership/roles. Three narrowly scoped Auth-email readers (`kb_team`, `kb_invite_create`, `kb_invite_access`) use SECURITY DEFINER with empty search_path and explicit actor checks. Do **not** grant service_role SELECT on auth.users to make these work.

Discovery reads and pre-membership invite lookups use atomic admission: 60/user/minute, 10,000/org/day where applicable, 50,000/global/day. Semantic queries keep the existing paid-search budget and admission before embedding. Team writes use the existing mutation budget and organization advisory lock. Invalid page/filter/date/email/token values are rejected; service-role/AI keys remain server-side. Role and invitation actions are added to the existing immutable audit trail without query/document text or invitation tokens.

No new credentials, subscriptions, paid services, or automatic notification delivery are required. Text queries currently scan matching organization records rather than using language-aware full-text indexing; monitor latency with substantially larger organizations. Page offsets are bounded, not unbounded archival cursors. Invitations and audit metadata have no automatic retention/deletion task.

## Validation and setup

```sh
npm ci --ignore-scripts
npm test
bash scripts/test-knowledge-sql.sh
python scripts/test-knowledge-browser.py
python scripts/test-knowledge-discovery-browser.py
node scripts/build-site.mjs
```

The SQL harness uses a disposable local pgvector/PostgreSQL container with no network/published ports. Its fake auth bootstrap is local-only. The browser scripts intercept every request; no service/AI calls occur. Existing tests run alongside new cases, including 121 documents/answers/activity entries, pagination beyond 100, literal queries, XSS-safe rendering, cross-organization denial, verified-email invitation binding, expiry/revocation, owner protection, draft/approved separation, rate limits, and mobile/sign-in journeys.

Local results for this change: **126 Node tests, 61 named SQL assertions, 12 existing plus 19 new offline browser scenarios passed**. Static build, JavaScript syntax, and whitespace checks passed. Separate authorized live validation is recorded below; offline checks are not substitutes for hosted validation.

## Rollout gate

This branch has not been merged or deployed to production. After review and explicit approval: obtain a current private backup, apply only the additive migration to the verified production project, deploy the reviewed commit through the production pipeline, then verify the new search/team flows plus existing account/proposal/contact/billing behavior. No production migration or deployment is part of these tests.

If a rollback is required, redeploy the preceding application version and preserve the additive table/functions and audit data. Existing KB endpoints remain available; rolling back the application does not require dropping customer or invitation records. Pending invitation links need the new UI to be accepted.

## Isolated hosted result — 2026-10-23

The approved separate test project `wcrrywzleylmdsqqlise` received only this new migration. Test site `tendercrestai-pr6-isolated-20261021`, actual branch `kb1`, deployed the source build `6adab41577f50c82e24f9f2a`. The preview has only KB functions and compliance configuration; proposal submission, contact email, Stripe webhook and Airtable mail relay endpoints remain absent.

**42 hosted API/service checks passed**, using three newly provisioned, admin-confirmed fictional users (no signup emails), one small fictional TXT source, one real embedding ingestion, and one real semantic query. Coverage included verified password authentication, anonymous/foreign-org denial, whole-org onboarding counts, hashed email-bound invitation creation, no membership on preview, explicit acceptance, owner-only team access, private upload/worker completion, exact text/semantic retrieval, independent draft search, owner protection, role changes, immediate hosted/RLS revocation, accepted-link replay denial, audit search and file-type exclusion.

**17 real hosted browser checks passed** at a mobile viewport: explicit Knowledge Base login return, actual onboarding state, universal quotation/draft search, advanced answer filters, exact-revision approval, combined answer filters, membership audit search, protected owner controls, filtered source viewing and byte-identical private download, mobile layout, invitation fragment removal/tab storage, logged-out sign-in round trip, explicit viewer acceptance/token clearing, restricted viewer controls, and logout. A browser harness initially submitted before the navigated auth module finished loading; waiting for that page's load completed the remaining journey. No application workaround was needed. No browser JavaScript errors or production/email/payment host requests occurred.

Local/private evidence is retained under `/workspace/scratch/knowledge-discovery/`: `all-node-results.log`, `sql-results.log`, `browser-regression.log`, `browser-discovery.log`, `hosted-results.json`, `hosted-browser-results.json`, and `cleanup-results.json`. Credential-bearing fixture files stay private outside the repository and public build.

After validation, the fictional source was archived, test memberships disabled, fictional accounts banned, and their Auth sessions removed. Test data/audit history remains in the separate test project. The production published deployment remains `6adaad7c2e398f36f18246be` at main `383a3880f133131a17fa116382df6a7d73372958`; a read-only schema check confirmed the new production invitation table is absent. No production migration, merge, deployment, activation, subscription change, email or payment was performed.
