# Feature 1 production rollout

## Current state

The feature branch is prepared for production configuration, but has not been merged or deployed to production. Public client defaults now match the original main branch:

| Setting | Production |
| --- | --- |
| Supabase project URL | https://vfdwaqgfepvoujprtuww.supabase.co |
| Airtable base | appsaqdp3UZdhB2VH |
| Companies table | tbliWnP6ThqA02G5L |
| Proposals Pipeline table | tblkL2ct7mYtUTu9S |

The publishable key is the original public key already used by main. Service-role and Airtable tokens remain server environment variables. The browser Supabase client remains pinned to 2.117.3.

This branch no longer contains the test-project client defaults. A refreshed PR preview will serve production-facing client configuration; do not submit customer or test documents through that preview. Preview function variables may still refer to the test project, so it is not a valid end-to-end environment until configurations are deliberately aligned. Successful preview build status does not prove production readiness.

The tested code was commit 2c6067250a1a30cb2b3380101ec3adbcc6fc04ae with test Supabase project wcrrywzleylmdsqqlise and test Airtable base appsDmtQ1XOE8Gjtr. That commit remains available for reference.

## Evidence from test services

- Automated Node regression tests passed (19 tests before production preparation).
- User tested TXT, PDF, and DOCX upload, extraction review, and successful queueing.
- Airtable confirmed extracted content and the correct company link.
- A new company was created as Trialing with Amount Paid 0 and a 60-proposal allowance.
- Supabase query confirmed a queued ledger row, matching owner metadata, and an existing private source-object entry.
- Ledger and Airtable inspection confirmed one original matching proposal. Concurrent/replayed dispatch protection is additionally covered by mocked automated tests.
- SQL checks denied anonymous table SELECT and foreign-user metadata, ledger, and Storage row visibility.
- A real second-account Storage request returned object-not-found with no download. The successful original submission exercised owner-authenticated source download and content integrity verification in the function.
- User tested review-checkbox enforcement and edited-text delivery; Airtable confirmed the edited sentence.
- User reported empty TXT and fake PDF rejection.
- Login worked after the Supabase browser-client upgrade; logout required login again.
- The original paste submission reached Ready for Review with a generated draft.
- The test automation completed generation successfully; user confirmed receipt of an email containing both sections.
- User reported the mobile/narrow layout looked good.

## Remaining checks and limitations

The oversized-file browser check was explicitly skipped; size boundaries pass automated tests. Actual token-expiry handling, failed-upload retry, scanned-PDF/no-OCR handling, the 100,000-character browser check, and anonymous Storage gateway download were not confirmed in this session. Login worked after the client upgrade, but disappearance of every earlier Firefox console lock error was not explicitly verified. Existing pricing and billing-link checks were not reported complete. These limits must remain visible to the reviewer; they are not marked passed.

No production Supabase SQL, private-bucket configuration, credentials, or actual customer access has been verified by the agent. No production Airtable automations or Stripe configuration were changed.

## Operator steps before merging

1. Open the production Supabase project vfdwaqgfepvoujprtuww.
2. If not already applied, execute supabase/migrations/202610090001_secure_rfp_upload.sql once. A dashboard statement that the test migration succeeded does not establish production setup.
3. Confirm rfp-documents is private, limited to 10,485,760 bytes, and accepts the three documented MIME types. Confirm RLS on both tables.
4. Audit every policy on storage.objects. Broad public/authenticated policies must exclude rfp-documents. Preserve unrelated bucket policies. Do not execute supabase/tests/rfp-isolation.sql in production; it is a disposable-project fixture.
5. Keep email confirmation enabled and the intended production auth.html callback allowed.
6. In Netlify Production/Functions scope, set:
   - SUPABASE_URL=https://vfdwaqgfepvoujprtuww.supabase.co
   - SUPABASE_PUBLISHABLE_KEY to the original production publishable key used by index.html
   - SUPABASE_SERVICE_ROLE_KEY to that production project's legacy service_role JWT
   - AIRTABLE_PAT to a token authorized for appsaqdp3UZdhB2VH with record read/write access
7. Preserve context separation from test credentials. Never commit or share the two secret values.
8. Review this PR and address or explicitly accept the remaining test limitations. Keep the production deploy branch on main.
9. Only after production prerequisites are confirmed, approve and merge during the chosen rollout. Merging main may automatically deploy Netlify.
10. Check deployment logs, then perform one controlled production smoke test using fictional content and an authorized account. Production automations can send emails and consume generation credits.

## Rollback and ambiguous submissions

If rollout fails, use the site's existing rollback process to restore the previous main deployment. Restoring the old endpoint also restores its earlier authentication/duplicate-protection limitations. Do not delete Storage objects, migration tables, or submission reservations as a rollback shortcut.

Before unlocking processing/uncertain submissions, reconcile them with Airtable. If a matching proposal exists, record its ID and mark queued. Only if no proposal exists may a trusted operator mark retryable. Do not reset reservations simply because they are old.
