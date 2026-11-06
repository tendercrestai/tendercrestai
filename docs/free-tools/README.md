# Free tools release review

Routes: `/tools/shredder`, `/opportunities`. This branch stacks on comparison PR #34.

## Reuse and limits

Uses the existing compliance document extractor, source-verified AI analyzer and CSV exporter. Text up to 100,000 characters (existing parser limit), PDF/DOCX up to 2 MB. Basic numbered requirements and five review flags are anonymous. Flags indicate missing response/evidence for human review, not proven violations. No company evidence is supplied to this tool.

Daily UTC admission: 3 shreds/IP and 10 shared pilot shreds; 16 AI calls/IP and 24 shared; 10 uncached SAM queries/IP and 50 shared; 3 matrix leads/IP and 10 shared. These conservative caps protect the shared AI account, but do not replace provider billing controls. Incomplete/failed jobs can consume allowance. No paid allowance changes.

## Isolated deployment only

New additive migration: `supabase/migrations/20261106090000_free_rfp_tools.sql`. Five RLS tables, no browser grants, service-role functions only. Apply only to the isolated test project until owner reviews preview. `FREE_TOOLS_ENABLED=true` enables APIs. Requires existing Supabase service configuration, ANALYTICS_SIGNING_SECRET, KB_WORKER_SECRET/ORIGIN, COMPLIANCE_AI_API_KEY/model; SAM_GOV_API_KEY and RESEND_API_KEY stay server-side.

Test sending is restricted to hello@tendercrestai.com while CUSTOMER_CARE_TEST_MODE=true, and subjects are labeled fictional preview tests. Never use customer addresses for testing. Provider acceptance is displayed separately from delivery confirmation. Failed notification requests remain persisted and scheduled maintenance retries pending leads within 23 hours, with stable provider idempotency. Full CSV remains downloadable after a stored lead even if email is unavailable.

Source jobs expire after 24 hours; hourly maintenance removes expired data. Leads and usage metrics retained 90 days. IP identifiers are purpose-specific daily HMACs. New metrics require existing first-party usage consent; affiliate, Google and OpenAI tracking unchanged. Optional marketing consent is separate from matrix delivery.

## SAM limitations

Official public Opportunities API, fixed upstream host, one-hour private cache. Searches solicitations posted within 364 days, 25/page, max 10 pages. Sorting is explicitly within current page. Notice descriptions are not complete solicitation packages; attachments are never fabricated or silently imported. Missing descriptions fall back to source paste/upload. No commercial listings.

## Verification

Local: parser/security tests; PostgreSQL RLS, quotas, idempotency, cache and lease tests; mocked browser flows at 390/768/1280 widths; existing regression suite. Browser fixtures are fictional and never presented as public opportunities. Re-run hosted extraction, persistence, notifications, rate limit, live SAM filters/handoff, consent and mobile checks before launch. Search generated client files for exact configured API key values without printing them.

As of Nov 6 2026: test database access restored and additive migration applied to test project only. Comparison preview ready. Hosted free-tools checks pending. Earlier SAM API requests returned HTTP 404; live feed verification remains open. Production must not be merged/deployed before owner preview review.
