# TenderCrest AI security readiness — 21 October 2026

This is a source review and implementation checklist, not a security certification
or confirmation of production configuration. No production changes were made.

## Live review findings

Read-only HTTP checks on 21 October 2026 against the Netlify origin
`https://tendercrestai.netlify.app` confirmed:

- Homepage and upload page return 200. Homepage differences from workspace code
  consist of Netlify link rewriting, its injected RUM script, and the locally
  added security link. This supports alignment but is not a commit attestation.
- `/security.html` returns 404: the prepared page is not live.
- `/docs/production-rollout.md`, `/netlify/functions/submit-proposal.js`, and
  `/supabase/tests/rfp-isolation.sql` return 200 with byte-for-byte matches to
  workspace source. Internal file publication is confirmed, not hypothetical.
  This review did not establish exposure of credentials or customer content.
- HSTS, frame denial, MIME-sniffing protection, referrer policy, and permissions
  policy are present. No enforcing Content Security Policy was observed.
- The custom domain was not fetched successfully by the web tool. Results above
  apply to the named Netlify origin, not an independently checked custom host.

Read-only Airtable inspection found the production backend base and deployed
Automation 1. Its draft has no differing deployed version. The workflow has
three built-in `aiGenerate` steps, then updates output fields and sends the draft
through a custom script to a Netlify mail relay described as using Resend.
The exported AI inputs omit the model identifier. The owner reports GPT-4.1;
verify that setting in Airtable before publishing a model-specific claim.
No automation was changed or run. No proposal records were fetched.

### Airtable AI terms review

Official source: https://www.airtable.com/company/ai-terms (reviewed 21 October
2026; page last updated 23 July 2026), sections 5–6. These prohibit generative
model training on customer data. AI-provider input/output retention differs:
Business/Enterprise Scale have no input/output retention under those published
terms; Free/Team/Pro/Plus allow up to 30 days for safety/compliance moderation,
with exceptions for prohibited content and applicable obligations. Metadata is
treated separately. Verify the actual workspace plan and applicable agreement.
These provider rules do not delete Airtable records, Storage files, or emails.
The owner confirmed the Airtable workspace is on the Team plan. The public page
now states the Team-plan moderation retention allowance explicitly.

The public security draft now attributes the training statement to Airtable's
terms and avoids a blanket TenderCrest zero-retention promise.

### Production Supabase metadata review

Read-only queries of the configured production project confirmed `rfp-documents`
is private, capped at 10 MiB, and limited to PDF, DOCX, and TXT MIME types.
RLS is enabled on both RFP tables. The current `storage.objects` policies returned
only owner-read and owner-insert policies for this bucket; no broad competing
Storage policies were returned. Metadata/ledger policies likewise restrict rows
to `auth.uid()`. This confirms configuration, not a two-account gateway test,
operator-access audit, or complete permissions review. No customer rows or files
were read and no settings were changed.

The security advisor warns that leaked-password protection is disabled:
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
Enable it in production Auth settings where the project plan supports it.
The advisor also reports two informational notices for RLS tables without client
policies (`free_trial_claims`, `proposal_credit_reservations`). These tables are
server-managed in the current migrations; do not add public policies merely to
silence notices. No-policy RLS is not evidence of public data exposure.

## Prepared changes

- Netlify build now copies an explicit allowlist of public files to `dist/`.
  The old `publish = "."` configuration could serve internal documentation,
  SQL fixtures, tests, and other repository files as static assets.
  Functions remain in `netlify/functions`; their deployment is separate.
- Added `/security.html` and linked it from the homepage and upload page.
  Copy explains the processing flow and avoids unsupported certification,
  encryption, no-training, fixed retention, and absolute confidentiality claims.
- Upload disclosure names Airtable and explains downstream processing.
- Added a build regression check to keep internal files outside public output.

## Source evidence and its limits

| Area | Source evidence | Production evidence still needed |
| --- | --- | --- |
| Identity | `lib/rfp-security.js` verifies bearer sessions through Auth and requires confirmed email | Confirm production endpoint uses this code and the correct project |
| Source access | Migration makes `rfp-documents` private, enables owner RLS, and restricts writes | Inspect deployed bucket, grants, and **all** Storage policies; test anonymous and two-account download isolation |
| File validation | Server checks owner, path, length, MIME, SHA-256, and basic file signatures | Controlled production smoke test; this is not malware scanning |
| Queue/status | Submission ledger prevents repeated dispatch; status endpoint uses owner JWT/filter | Confirm deployed ledger policies and actual production configuration |
| Data processing | Reviewed text enters Airtable; generation/email happen downstream | Identify actual AI, automation, email providers and all data copies |
| Client dependencies | Browser code loads pinned CDN libraries; extraction runs locally | Review dependency vulnerabilities, vendor executable assets if required, assess third-party scripts |
| Hosting | Existing headers deny framing and MIME sniffing | Check deployed HTTPS, headers, and actual published asset list |

Earlier `docs/production-rollout.md` explicitly distinguishes test evidence from
unverified production configuration. Preserve that distinction.

## Priority 1: before promising confidential-data protection

1. Confirm which repository branch and commit serve tendercrestai.com. Deploy the
   allowlisted build through the existing Netlify workflow only after review.
   Confirm dashboard build settings do not override this file. Build previews
   must not submit to production generation/email automations.
2. Verify the production identity/storage controls above. Existing SQL fixtures
   create test users and belong only in a disposable environment. Do not run
   them against production. Record timestamps and sanitized results.
3. Trace one fictional proposal through Storage, database metadata, Airtable,
   automation, AI request, generated output, and email. List every processor,
   data category, location, access role, retention period, and backup copy.
4. Confirm AI provider account terms and request settings for training use,
   abuse-monitoring retention, and deletion. Do not promise zero retention or
   no training until every relevant provider and workflow supports the claim.
5. Require MFA on operator accounts for hosting, database, Airtable, automation,
   AI, email, and source control. Review least-privilege roles and key scope;
   remove stale access. Keep secrets server-side and out of logs.
6. Agree actual retention periods and a deletion procedure covering original
   files, extracted text, drafts, emails, logs, and backups. Record exceptions
   and backup expiry. Account deletion alone is not complete data deletion.
7. Review the existing prohibition on third-party trade secrets. Procurement
   documents may be covered by an NDA; do not market support for those documents
   until service terms, provider contracts, and the intended use agree.

## Priority 2: operational and contractual evidence

- Privacy policy, subprocessor list, and DPA: legal entity, jurisdictions, purposes,
  legal bases where applicable, transfers, retention, rights, and contact route.
  Obtain qualified legal review; this checklist is not a drafted legal agreement.
- Incident procedure: owner, triage, containment, session/key revocation,
  evidence preservation, recovery, and applicable notification obligations.
  Do not promise a fixed notification deadline without an operational basis.
- Test backup restoration and record recovery targets and responsible operators.
- Add durable submission abuse controls. Contact endpoint throttling is only
  instance-local; Turnstile is optional when no secret is configured.
- Review generation automation prompts and tools: uploaded text is untrusted;
  it must not override system instructions, access other accounts' context,
  retrieve secrets, or authorize external actions. Test these boundaries.
- Assess email delivery of full drafts against customers' confidentiality needs;
  consider authenticated retrieval with short-lived links if required.
- Review executable CDN dependencies and a compatible Content Security Policy
  in preview before enforcing it. Existing inline scripts require deliberate
  migration or hashes; a blanket policy can break sign-in and extraction.
- Arrange an independent penetration test covering authentication, tenant
  isolation, Storage access, APIs, and AI workflow. Track findings to closure.
- Pursue SOC 2 Type II or ISO 27001 when commercially justified. No badges or
  certifications are included in the prepared page.

## Release checks

Run `node --test tests/*.test.*` and `node scripts/build-site.mjs`.
Preview homepage, login, contact form, security page, upload/extraction, and
status tracking. Verify Netlify Functions still resolve under `/.netlify/functions/`.
Check `/docs/security-readiness.md`, `/netlify/functions/submit-proposal.js`,
`/supabase/tests/rfp-isolation.sql`, and `/tests/submit-proposal.test.js` return
404 with no source content on the new deployment. Verify HTTP status, not
only the visible page. Check logs without capturing customer text or tokens.

Review the security page against the **actual deployed** flow before release.
This page is an initial disclosure, not a substitute for the privacy policy,
DPA, production isolation verification, or independent assurance.
