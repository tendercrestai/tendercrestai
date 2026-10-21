# RFP Intelligence & Compliance Matrix preview

## Delivered behavior and architecture

See [architecture assessment](compliance-architecture.md) and
[functional benchmark](compliance-benchmark.md).

Optional /compliance.html workflow:

1. Authenticate with the existing verified Supabase account.
2. Upload one to six PDF/DOCX/UTF-8 TXT sources, 10 MiB each.
3. Server verifies owner, immutable metadata, content hash, MIME, signature and
   size, then parses private original bytes. Review server-extracted text.
4. Explicitly confirm review and analyze in bounded sequential chunks.
5. Review source-backed facts, editable matrix, uncertainties and evidence gaps.
6. Export all saved rows as CSV or actual Excel XLSX (including summary/status).
7. Continue to the existing paste-text proposal form. This only fills the form;
   explicit submission retains existing quotas, trial activation and Airtable.

No preview action creates a company/proposal or sends email. No pricing, Stripe,
quota, submission schema or automation was changed. Server-side verifyDocument
now optionally returns verified bytes; its existing callers/behavior remain.
The browser DOCX archive validator moved into a shared module.

PDF citations are physical file pages, never inferred printed folio labels.
DOCX/TXT page references are unavailable. Section headings come from extracted
text, not AI. Exact source excerpts are required for every requirement/fact.
Facts are source strings, not normalized date guesses. Missing deadline/timezone/
evaluation data produces a warning. Mixed scanned PDFs, images, annotations,
forms and unsupported DOCX supplementary content cause Partial results.
Image-only scans fail with an OCR message; there is no OCR service in this preview.

Requirements start Needs Review with empty company evidence. Compliant reviews
need evidence and an evidence reference. AI cannot set compliance statuses,
owners, reviewer notes or bidder qualifications. Evidence fields are human
assertions requiring verification; the app does not independently certify them.
Review source excerpts after editing a row; original quotations remain immutable.
Owner labels assign responsibility without inviting a user or sharing data.
The existing owner-only security model is retained. Organization membership,
invitations and cross-user sharing are not implemented or implied.

## API and AI engine

POST /.netlify/functions/compliance requires a verified bearer token.
Actions: list, prepare(documentIds), get(analysisId), step(analysisId, reviewed,
reviewHash), update(analysisId, requirementId, revision, changes).
The browser cannot supply source text, owner IDs, model names or provider URLs.
GET compliance-config returns only deployment public Supabase configuration
and the feature enable flag.

Pending -> Processing -> Pending for each saved chunk; final Completed means all
chunks were processed with no detected extraction gaps. Final Partial retains
extraction warnings. Failed retains previous successful chunks. Output hitting
the schema capacity, truncating, refusing or failing source validation is a
failed chunk, never silently saved as complete. Completed is not a guarantee of
semantic completeness or solicitation compliance; human review remains required.

AI drafting currently runs in Airtable's managed aiGenerate nodes, with no
reusable API client/provider credentials exposed in main. This preview adds
a fixed OpenAI Chat Completions structured-output adapter. It requires a new
server-only key and a configured model supporting strict JSON schema,
temperature=0 and max_completion_tokens. It does not alter Airtable AI.
The system prompt separates document data and gives the model no tools.
Requirements are exact quotations, facts must be substrings of their quotes,
and weights must be explicitly quoted scoring data. Validation reduces
hallucination/injection impact but cannot prove correct semantic interpretation.

Each chunk contains at most 10,000 extracted characters; combined source text
is bounded at 100,000 characters / 16 chunks. Maximum output is 8,000 tokens per
call. RPC row locks and lease tokens prevent concurrent dispatch/saving by a
stale worker. A 90-second lease permits bounded recovery after a function dies.
Three attempts per chunk, three new analyses per user/UTC day, 144 actual
attempts per user/day, and 500 globally reserved/actual attempts per day are
durable caps. Set a provider project spend/rate limit as the monetary backstop.
No automatic retries after AI failure; the customer explicitly retries. Failed
saves can require a lease-expiry retry and an additional paid request, within caps.

## New/modified files

- New frontend: compliance.html; assets/compliance.css, compliance.mjs,
  compliance-model.mjs, compliance-export.mjs, compliance-handoff.mjs.
- Modified frontend: index.html and rfp-upload.html (navigation/handoff);
  assets/rfp-document.mjs (shared validator import).
- Shared validator: assets/docx-validation.mjs.
- Backend: netlify/functions/compliance.js, compliance-config.js,
  lib/compliance-document.js, lib/compliance-ai.js;
  lib/rfp-security.js gains optional verified-source return.
- Build: package.json, package-lock.json, .gitignore, netlify.toml.
- SQL: migrations/20261013070336_compliance_matrix_preview.sql;
  supabase/tests/compliance-isolation.sql.
- Tests: tests/compliance-{document,ai,api,export}.test.*;
  fictional fixtures under tests/fixtures; scripts/test.sh.
- Documentation: compliance-architecture.md, compliance-benchmark.md,
  compliance-rollout.md, compliance-validation.md.

## Environment variables (no secret values)

Netlify Functions context:

| Variable | Purpose |
| --- | --- |
| COMPLIANCE_PREVIEW_ENABLED | false/unset by default; true only after preview setup |
| COMPLIANCE_AI_API_KEY | Secret OpenAI project API key with spend/rate limits |
| COMPLIANCE_AI_MODEL | Model supporting the structured-output API options above |
| SUPABASE_URL | Project URL, matching browser auth configuration |
| SUPABASE_PUBLISHABLE_KEY | Public publishable key |
| SUPABASE_SERVICE_ROLE_KEY | Server-only legacy service_role JWT |

Use Netlify Node >=22.13.0. Existing AIRTABLE_PAT, Stripe webhook variables and
pricing remain as currently configured; preview analysis does not need Airtable.
Secrets must be Functions-only scope. Do not put them in build output, GitHub,
browser modules, fixtures or PR bodies. Confirm provider retention/privacy and
authorization to send RFP text before enabling the AI flag.

## Netlify preview setup (operator instructions, not performed)

1. Keep main as production deploy branch. Use this feature branch/deploy preview.
2. Create/use a disposable Supabase project; configure callback URLs, verified
   email auth, private rfp-documents bucket and the original upload migration.
3. Review and apply the additive compliance migration to TEST ONLY, then run the
   upload and compliance isolation SQL suites. Check grants and all Storage
   policies; permissive policies must not expose private sources.
4. Set matching preview function configuration. Compliance uses runtime public
   configuration. Existing index/auth/upload pages still contain production
   public defaults: align their public URL/key in a preview-only checkout before
   signing in or exercising handoff. Do not enable a mismatched auth workflow.
   PR #4 supplies runtime configuration for those existing pages if separately
   reviewed and merged; this PR does not assume it is active.
5. Run npm ci --ignore-scripts, npm audit, and npm test on Node >=22.13.0.
   The refreshed lockfile pins registry-backed versions and integrity hashes.
   PDF.js is pinned to 6.4.299 after resolving the advisory found during the
   connected audit. Keep the audit as a rollout gate; advisory data can change.
6. Netlify uses esbuild with PDF.js/sax external modules so PDF worker/font files
   remain packaged. Confirm dependency/worker/font inclusion in preview logs.
   Ensure the plan supports synchronous requests long enough for the bounded
   extraction/AI step (at least 60 seconds); test worst-case latency.
7. Enable COMPLIANCE_PREVIEW_ENABLED only in the configured preview context.
8. Upload fictional fixtures; verify source review, scanned-page warnings,
   cross-account isolation, interrupted processing, row-save conflicts,
   CSV/Excel, keyboard navigation and mobile/tablet widths.
9. Do NOT submit the proposal form against production in preview: its unchanged
   endpoint targets the production Airtable base. Test handoff by filling the
   form only. Full generation regression is mocked here. Use an isolated cloned
   endpoint/base and disabled email/automation for end-to-end submission checks.
10. Record validation evidence in compliance-validation.md and keep PR draft
    until the unexecuted gates pass. A successful build alone is insufficient.

## Production checklist (requires explicit approval)

- [ ] Clean dependency install/audit, Netlify bundle and worst-case latency pass.
- [ ] Disposable-project SQL/RLS/RPC suites pass, including attempt budgets.
- [ ] Desktop/tablet/mobile, keyboard, downloads and account-change clearing pass.
- [ ] Expert review of synthetic RFP precision/recall/citations and cost completed.
- [ ] Review org/owner access boundary, Storage policy audit and privacy settings.
- [ ] Reconcile integration with open PR #4; no accidental activation of its engine.
- [ ] Confirm backups and migration review; obtain explicit production migration
      approval before running any production SQL.
- [ ] Apply only the additive migration and verify grants/security advisors.
- [ ] Set production secret scopes and provider spend limits; flag remains false.
- [ ] Obtain explicit merge/deployment approval (main merge may auto-deploy).
- [ ] Enable flag after controlled deployment, then authorized fictional smoke test.
- [ ] Monitor safe error counts, Failed/Processing leases, provider cost and source
      accuracy; never log document bodies, model messages or bearer credentials.

## Rollback

Unset COMPLIANCE_PREVIEW_ENABLED first; requests fail closed and saved data stays.
Restore the prior Netlify deployment if needed. Leave added tables and Storage
objects intact; no rollback requires deleting customer data or reservations.
Keep existing upload/submission/Stripe/Airtable functionality unchanged.
Do not reset attempt budgets or processing leases to force unbounded retries.
After lease expiry, resume a saved analysis only within the three-attempt cap.
Any destructive retention cleanup needs a separate approved policy.

## Verification and limitations

See compliance-validation.md for exact executed checks and unexecuted gates.
No production migrations, merge, deployment, Airtable runs, emails or Stripe
operations were performed. SQL CLI generation was unavailable; migration uses
a UTC-generated timestamp and is reviewable before execution.
