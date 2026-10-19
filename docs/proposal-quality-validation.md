# TenderCrest AI — expanded test results and pending work

Test date: 19 October 2026. Scope: draft PR #7, proposal-quality integration.
Status: local and test-database checks pass; production release is pending live integration and output-quality validation.

## Verified results

| Area | Result | Scope |
|---|---|---|
| Automated application tests | 160 passed, zero failed | Auth, ownership, source validation, request limits, retries, duplicate submissions, billing, exports, retrieval and evaluation |
| Browser scenarios | 20 passed | Installed Edge; mocked auth/API; 320, 390, 768 and 1280 px |
| Live SQL suites | Five passed | Test project only; evidence isolation, compliance isolation, processing budgets/leases, billing credits and upload/storage isolation |
| SQL cleanup | Passed | Zero test fixture users remain after rollback |
| Source checks | Passed | 47 JS/module scripts and three inline scripts parse; all six Netlify function handlers load |
| Independent Excel validation | Passed | openpyxl opened both sheets; 18 matrix columns; zero formulas and external links |
| Retrieval stress | Passed limits | 200 approved records and 100 requirements; eight excerpts selected, within 12,000 characters; approximately 1.19 seconds on this machine |
| Malformed archive corpus | Rejected safely | 160 deterministic malformed DOCX inputs, in addition to real PDF/DOCX/TXT extraction fixtures |
| Preview build | Previously successful at 9f46be0 | Netlify status verified; runtime access requires team login. Fixes from this test round need the next preview build. |

Browser checks cover source verification with keyboard interaction, editing, missing-evidence validation, CSV/XLSX downloads after filtering, unsafe-looking text rendered as text, 401/403/404/409/503 responses, malformed handoffs, account switches, sign-out and unavailable services. These use mocked services; they do not establish a working deployed integration.

## Defects found and fixed

1. A delayed compliance handoff could restore private text after sign-out or switching accounts. The handoff now verifies the current user/session before updating the form.
2. Previously loaded source/context and review notices were not fully cleared on account switching. Private form fields, linked context and notices now clear immediately on sign-out or a different account.
3. A malformed handoff could partially modify the form before failing. Response shape, status, source length and digest are checked before rendering.
4. Conditional wording such as “when requested”, “where applicable”, “subject to approval” and “provided that” could be classified as unconditionally mandatory. These cases now remain uncertain and require review.
5. Malformed evaluation records could produce incidental JavaScript errors. They now fail with explicit validation errors, and invalid review-check lists cannot complete an evaluation.

Regression tests reproduced the handoff and classification failures before the fixes and pass afterwards. The full automated suite passed after all changes. The 20 browser cases passed after the browser-related fixes; the later evaluation-only change did not alter browser code.

## Test-environment changes

The evidence-library table was missing from the existing test project. The prepared private_proposal_evidence migration was applied there, then all five SQL suites passed. RLS is enabled; anonymous evidence reads and client reads of budget/credit ledgers are denied. Test fixtures rolled back and their absence was checked.

No production migration, merge, production deployment, published automation change, customer email or live AI generation was performed. Production received only a schema-metadata read. That read confirmed billing-credit tables exist, while evidence and compliance tables are absent.

## Still pending, in order

1. **Access and configure the isolated preview.** Netlify returns HTTP 401 and the browser shows “This site is private — sign in with an invited Netlify account.” Use an invited login. The workspace has no Netlify token, AI API key or Supabase service-role key. Configure those securely, with test-only Supabase/Airtable settings and all three feature flags. Do not paste secrets into chat or commit them.
2. **Run the real deployed workflow.** Verify real authentication, private uploads, extraction, live AI calls, saved review, handoff, queued proposal, completion status and controlled test delivery. Before any automation run, inspect/remove delivery nodes or explicitly use a controlled test mailbox. Local browser mocks and SQL tests cannot replace this step.
3. **Finish dependency/build assurance.** A clean npm install was attempted in a separate directory. It could not complete because registry.npmjs.org TLS negotiation failed; the offline attempt also lacked a cached pinned package. Certificate checks were not disabled. A clean install and vulnerability audit still need a working registry connection or CI logs. The application tests ran with matching bundled pdfjs-dist 5.6.205 and sax 1.6.1 dependencies. Recheck the new preview build after these fixes.
4. **Measure actual AI quality.** Generate baseline and candidate outputs for all 20 holdout cases under matched conditions, then have a tender expert score accuracy, completeness, relevance, specificity, evidence support and editing time. The four editorial examples and benchmark also need expert validation. No actual quality uplift, time saving, bid-readiness guarantee or win-rate improvement has been established.
5. **Approve production rollout after those checks.** Evidence/compliance migrations are still required in production. Review/approve the PR, production database changes, prompt publication and deployment as a coordinated release. Production remains unchanged; keep the PR in draft until release gates pass.

## Additional security observation

The test-project advisor warns that leaked-password protection is disabled. Review this configuration before release: [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Four informational “RLS enabled, no policy” notices concern backend-only credit/budget tables. Client SELECT privileges were checked and are denied; these notices do not imply those tables are publicly readable. [RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Reproduction

Run npm test for the application suites. Run npm run test:browser with Playwright available in the development runtime; the optional PLAYWRIGHT_CHANNEL variable selects the browser and defaults to installed Edge. The harness serves local files and blocks/mocks all external service requests. SQL suites live under supabase/tests and must run only on the test project. Do not run their fixture transactions in production.

This report does not claim exhaustive testing, full security certification, load capacity for concurrent customers, or validated AI answer quality. The remaining gates above are explicit.
