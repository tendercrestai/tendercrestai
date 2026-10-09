# Secure RFP upload — Feature 1

## Behavior

The new /rfp-upload.html page supports PDF, DOCX, and UTF-8 TXT
documents up to 10 MiB. Text is extracted in the browser and reviewed
before upload/submission. Scanned PDFs require OCR before uploading.

Original documents remain in private Supabase Storage. Reviewed text
uses the existing Airtable RFP Text Content field. No new Airtable fields
or public document links are introduced.

Supabase bearer sessions are verified server-side. Billing and delivery
are bound to the signed-in verified email.

The existing automatic $0 Trialing account creation is preserved.
No Stripe payment or manual activation is required for the free trial.

## Supabase setup

1. Apply supabase/migrations/202610090001_secure_rfp_upload.sql once.
2. Confirm rfp-documents is private and capped at 10,485,760 bytes.
3. Confirm its allowed MIME types are application/pdf,
   application/vnd.openxmlformats-officedocument.wordprocessingml.document,
   and text/plain.
4. Confirm rfp_uploads and rfp_submissions have Row Level Security enabled.
5. Audit ALL existing storage.objects policies. Permissive policies
   combine with OR. Any broad public/authenticated policy must exclude
   rfp-documents or it can bypass the new isolation policies.
6. Keep email confirmation enabled and retain the existing auth.html
   callback configuration.
7. For preview/test hosts, configure the exact auth.html callback URL.
8. Run supabase/tests/rfp-isolation.sql only in a disposable test project.

The code defaults to the existing Supabase project. When using a
separate test project, update the public URL and publishable key
consistently in index.html, auth.html, and assets/rfp-upload.mjs.
Set matching function configuration in Netlify.

## Netlify setup

Retain the existing publish directory "." and functions directory
"netlify/functions". Use Node.js 20 or newer.

Set these environment variables in Functions-only scope:

- SUPABASE_SERVICE_ROLE_KEY: the project's legacy service_role JWT.
- AIRTABLE_PAT: the existing Airtable token.
- SUPABASE_URL: optional override of the existing project URL.
- SUPABASE_PUBLISHABLE_KEY: optional override of the public key.

Never put the service-role key or Airtable token in GitHub, HTML,
browser JavaScript, screenshots, or PR descriptions.

Use a branch/deploy preview. Keep the production deploy branch on main.
Do not merge until configuration and integration testing are complete.

The function retains the existing Airtable base/table IDs. A cloned
test base requires updating those IDs in the preview function and
using an appropriate test token. Do not accidentally send preview
submissions to the production generation/email automation.

Static hosting alone does not run the submission function. Preserve
the existing Git-connected Netlify workflow.

## Validation

Run:

    node --test tests/*.test.*

All 19 individual Node regression tests passed during implementation.
These tests use mocked services and do not generate real proposals.

The implementation workspace could not execute Chromium because socket
operations were restricted. Browser/CDN extraction, SQL execution,
real Storage gateway behavior, and live generation/email delivery
require validation in a configured test environment.

Manual checks:

1. Test selectable-text PDF, DOCX, and UTF-8 TXT extraction.
2. Confirm extraction alone uploads nothing.
3. Edit extracted text and confirm review before submission.
4. Confirm reviewed text enters Airtable with the existing fields.
5. Test empty, corrupt, renamed, oversized, and scanned documents.
6. Test failed upload retry, session expiry, and sign-out.
7. Confirm duplicate/replayed calls create one Airtable proposal.
8. With two real users and an anonymous client, verify foreign source
   downloads, metadata reads, and state reads fail.
9. Confirm public Storage URLs expose no source documents.
10. Confirm source overwrite and metadata/state updates are denied.
11. Confirm a new verified email receives an immediate automatic trial.
12. Confirm existing quota rejection, login, paste/sample workflows,
    pricing links, and billing links still work.
13. Verify generation and email delivery in the test automation.
14. Check mobile and desktop layouts.

## Duplicate handling and reconciliation

Unique submission IDs and document IDs reserve each submission.
Queued replays return the original Airtable record ID.
Modified inputs cannot reuse a reserved ID/document.

Failures before proposal dispatch become retryable. An ambiguous
response after Airtable dispatch becomes uncertain. If saving state
fails, processing remains locked. These requests never blindly requeue.

For processing/uncertain records, a trusted operator must inspect
Airtable first:

- If the proposal exists, set status to queued and record_id to its ID.
- Only after confirming no proposal was created may the operator set
  status to retryable and record_id to null.
- Never bulk reset locks based only on age.

This ledger does not make Airtable quota formulas atomic across distinct
proposals. Existing billing and trial quota behavior is retained.

## Privacy and retention

Customer source access uses the customer's JWT and Storage RLS.
Privileged operators and the existing generation pipeline still have
authorized access to submitted data.

The browser retains only retry IDs and hashes in sessionStorage.
Document text is not persisted there. Existing Supabase Auth session
behavior remains in place.

PDF.js 4.10.38 and Mammoth 1.9.0 are loaded from pinned jsDelivr URLs.
Extraction happens locally, without sending documents to a conversion
service. Deployments requiring self-hosted executable assets should
vendor the reviewed libraries and PDF worker and update the URLs.

Customers cannot overwrite or delete sources through this feature.
Define an approved retention/deletion policy before rollout.
Failed uploads can leave metadata rows; failed submissions can leave
private sources. Reconcile processing/uncertain submissions before
privileged cleanup. The functions do not log document content.

## Rollout

No production deployment or remote SQL/configuration was performed.
Apply production configuration and merge/deploy only after review,
integration validation, and rollout approval.
