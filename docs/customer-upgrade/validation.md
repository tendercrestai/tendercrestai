# Validation evidence

Current local results (2026-10-25):

- `npm test`: 253 tests passed, zero failed. Includes billing/webhook, contact/email, uploads, compliance parsing/extraction, knowledge, existing workspace/export and new enhancement/AI-schema/security tests. Provider/network behavior is mocked in unit suites; no real email/card/model call is implied.
- `python scripts/test-customer-upgrade-browser.py`: 28 real Chromium checks passed. Three anonymous scenarios at 390/768/1280; owner/viewer authenticated-UI fixtures at 390/1280. External auth/API traffic is intercepted; these are not hosted-auth passes.
- `bash scripts/test-customer-upgrade-sql.sh`: 53 PASS assertions in a disposable no-network pgvector/Postgres 17 container; existing integrated schema and new additive migration apply successfully. Tests include project/source RLS, revoked membership, role limits, service-only mutation RPCs, source metadata CAS, approval restrictions, retrieval filtering, epoch invalidation and transactional approved-section reuse/idempotency.
- New metadata migration applied and recorded only in TEST Supabase wcrrywzleylmdsqqlise. Production schema was audited read-only; production has not received this migration.
- `node scripts/build-site.mjs`: successful public build; explicit allowlist retained, private files excluded.

Resolved during validation: initial browser assertion incorrectly expected a zero audit score even though the defined literal-consistency component contributed 20 points. Assertion now derives the expected score from the actual scoring fixture. This was a test expectation error, not a claim of semantic consistency.

## Remaining release gates / honest limits

Hosted preview and actual-auth test results are recorded below once run. Full semantic contradiction detection, verified factual coverage of every sentence, global anonymous→signup→paid conversion analytics, organization monetary token ledger, statistically learned outcome recommendations, exhaustive formatting checks and independently verified competitor comparisons are not implemented by this release. Those capabilities must not be advertised as complete.

No new live card charge, customer email, production account creation, production migration, production secret modification or production deployment is permitted by this branch task. Optional new provider drafting is tested using controlled mocked responses; a real provider sandbox call remains a pre-activation gate if desired. Existing contact delivery and Stripe billing are regression-tested with mocks, not a fresh real message/payment. Existing source-upload/extraction edge cases remain covered by existing fixtures; arbitrary scanned PDFs cannot be reliably extracted without OCR and remain review-required.
