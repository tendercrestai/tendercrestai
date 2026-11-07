# Free tools release review

Routes: `/tools/shredder`, `/opportunities`. This branch stacks on comparison PR #34.

## Reuse and limits

Uses the existing compliance document extractor, source-verified AI analyzer and CSV exporter. Text up to 100,000 characters (existing parser limit), PDF/DOCX up to 2 MB. Basic numbered requirements and five review flags are anonymous. Flags indicate missing response/evidence for human review, not proven violations. No company evidence is supplied to this tool.

Daily UTC admission: 3 shreds/IP and 10 shared pilot shreds; 16 AI calls/IP and 24 shared; 10 uncached SAM queries/IP and 50 shared; 3 matrix leads/IP and 10 shared. These conservative caps protect the shared AI account, but do not replace provider billing controls. Incomplete/failed jobs can consume allowance. Source-validation rejection retries once per chunk, with each attempt counted against AI limits; rejected output is never published. No paid allowance changes.

## Isolated deployment only

New additive migration: `supabase/migrations/20261106090000_free_rfp_tools.sql`. Five RLS tables, no browser grants, service-role functions only. Apply only to the isolated test project until owner reviews preview. `FREE_TOOLS_ENABLED=true` enables APIs. Requires existing Supabase service configuration, ANALYTICS_SIGNING_SECRET, KB_WORKER_SECRET/ORIGIN, COMPLIANCE_AI_API_KEY/model; SAM_GOV_API_KEY and RESEND_API_KEY stay server-side.

Test sending is restricted to hello@tendercrestai.com while CUSTOMER_CARE_TEST_MODE=true, and subjects are labeled fictional preview tests. Never use customer addresses for testing. Provider acceptance is displayed separately from delivery confirmation. Failed notification requests remain persisted and scheduled maintenance retries pending leads within 23 hours, with stable provider idempotency. Full CSV remains downloadable after a stored lead even if email is unavailable.

Source jobs expire after 24 hours; hourly maintenance removes expired data. Leads and usage metrics retained 90 days. IP identifiers are purpose-specific daily HMACs. New metrics require existing first-party usage consent; affiliate, Google and OpenAI tracking unchanged. Optional marketing consent is separate from matrix delivery.

## SAM limitations

Official public Opportunities API, fixed upstream host, one-hour private cache. Searches solicitations posted within 364 days, 25/page, max 10 pages. Sorting is explicitly within current page. Notice descriptions are not complete solicitation packages; attachments are never fabricated or silently imported. Missing descriptions fall back to source paste/upload. No commercial listings.

## Verification

Local: parser/security tests; PostgreSQL RLS, quotas, idempotency, cache and lease tests; mocked browser flows at 390/768/1280 widths; existing regression suite. Browser fixtures are fictional and never presented as public opportunities. Re-run hosted extraction, persistence, notifications, rate limit, live SAM filters/handoff, consent and mobile checks before launch. Search generated client files for exact configured API key values without printing them.

As of Nov 6 2026: test database access restored and additive migration applied to test project only. Comparison preview ready. Isolated free-tools preview renders both new pages, comparison routes, auth and demo. A complete archived public GSA/18F RFQ produced 83 sourced requirements across three chunks and a five-row review preview; matrix lead persisted and Resend accepted both customer and owner email to hello@tendercrestai.com. Provider acceptance does not prove inbox delivery. Earlier source validation failed, then a bounded manual retry passed; a single automatic source-validation retry now has dedicated pass/fail tests.

Live hosted SAM search returns real federal notices; keyword, NAICS, PSC and set-aside filter requests pass, and real notice details return description text and attachment disclaimer. Earlier local 404 responses do not reproduce on hosted Netlify. Client page-local sorting and missing-attachment fallback are tested with explicit fictional browser fixtures; full-package extraction from SAM attachments is not claimed. A public RFQ excerpt independently produced 13 sourced rows, stored lead, accepted emails. Fictional provider-mail fixture also passed. Actual inbox delivery is unconfirmed.

Mobile screenshots reviewed at 390px, with automated checks at 390/768/1280. Existing customer-journey browser suite passes 16 checks. No existing auth, billing, demo or tracker implementation modified. Production must not be merged/deployed before owner preview review.

## SAM credential deployment

Netlify secret values for deployed contexts are redacted in API responses. Never copy a masked API value between sites or treat matching masked values as proof of matching real keys. The original key must be entered securely on the production project, with the Production context and Functions scope. Keep it marked secret. Netlify documents that production secrets are readable only by code running on its systems; a masked API response cannot be used as a credential.

The SAM fetcher rejects masking characters before any upstream request. A live production search, not a comparison of API-visible masked values, verifies the credential. The Nov 7 incident was caused by copying the preview key’s redacted value into production; replacing the original credential is required to restore search.
