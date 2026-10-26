# Coordinated customer continuity release

Baseline: audit PR #24, production commit 635943e8acf641ddb66c69d43c45ceee98cadc6f. User authorized deploying tested fixes and coordinated implementation/testing of all remaining high/medium findings, preserving current commercial terms. Sender and native-auth test recipient: hello@tendercrestai.com. No live card payments or customer email automation activation is authorized here.

## Implemented workstreams and truthful release gates

| Finding | Implementation | Activation / remaining evidence |
|---|---|---|
| G01 signup/reset mail | Production custom Resend SMTP configured with approved sender; native confirmation and recovery requested only for the authorized address. User confirmed both receipt/confirmation and reset form; Auth verified confirmation. | Existing Auth send limit remains 2; capacity must be reviewed against the provider plan before high-volume acquisition. No other reminder/delivery setting enabled. |
| G02 billing identity | Authenticated, server-owned Checkout session creation carries verified user metadata, fixed existing prices/14-day card-required terms; webhook binds verified identity to company/customer; account/submission can reuse binding. Durable checkout keys prevent duplicate sessions; existing/previous subscriptions require review. | Test mode isolated by database/base/key. Live activation requires approved live Checkout write scope plus end-to-end test webhook/account provisioning; live flag stays off until cleared. Existing email-mismatch accounts are not auto-rebound. |
| G03 history/downloads | Account hub lists owned submissions and retained deliveries, protected reconstructed DOCX downloads, expiry notices and pagination. | Copies exist only for deliveries routed through the stable-key v2 relay. No retrospective claim for old email-only artifacts. New copies retained 90 days with private service-only tables. |
| G04 delivery deduplication | Durable SQL claims, payload/recipient consistency, provider idempotency key, accepted/uncertain/failed receipt states; verified provider delivered/bounced endpoint. | Airtable automation needs the reviewed v2 script/payload, and Resend webhook configuration plus signing secret. Send-only API key cannot configure/read provider webhooks. Do not claim Accepted means Delivered. |
| G05 deletion | Owner-scoped requests/status; typed confirmation can remove only unused personal originals. SQL locks/guards block races with new submissions/analyses. Referenced/shared/knowledge sources remain review-required. | Execution is separately gated; test with a fictional isolated file before activation. No customer deletion is performed during release testing. Original-only scope, provider/email/backups separate. |
| G06 commercial clarity | Existing prices/allowances retained; pricing/account clarify emailed credits vs workspace access and same-email checkout guidance. | No new seat/storage/support entitlement, price change, trial reset or retroactive subscription change. |
| G07 operations/backups | Private health view, gated scheduled health/retention checks, external read-only GitHub Actions checks every six hours; encrypted application snapshot + isolated data restore drill. | Off-workspace handoff not confirmed until owner downloads/stores it. Snapshot excludes managed Auth credentials/provider secrets and is not a native PITR/full-service backup. Hosting credit alert/budget policy remains account-operator work. |
| G08 OCR/export | Explicit browser-local English OCR, five-page/10 MiB/resolution/text/time bounds, source hash and physical-page markers, reviewed TXT download. | Real fictional-scan OCR test required. No document/image upload; pinned CDN engine/language GETs. No perfect layout or DOCX-pagination claim. |
| G09 quality limitations | Existing evidence/human-review gates retained; no fabricated training/calibration; benchmark/provider-failure tests retained. | No independent compliance certification or numerical win probabilities. Verified rights/outcomes still required for model release. |
| G10 larger lists | Project search/pagination and authorized paged jobs/files/activity/notifications/assessments/approvals browser; existing revision history paging retained. | RLS/project membership remain mandatory; notification browsing is current-user only. |
| G11 notifications/team | Explicit in-app/manual invitation wording and existing opt-in preferences retained. | Workspace reminder email stays disabled. Organization and project grants remain separate. |
| G12 live financial/provider tests | Mocked/SQL/browser security and failure suites plus isolated actual provider checks where authorized credentials permit. | Do not call real charge/refund, natural 14-day renewal, webhook provisioning or full managed-service restore passed unless actually executed. |

## Configuration and rollout

- `CUSTOMER_CARE_ENABLED` gates new account APIs, durable delivery and bindings; default off.
- `CUSTOMER_DELETION_EXECUTION_ENABLED` separately gates source removal; default off.
- `AUTHENTICATED_CHECKOUT_ENABLED` separately gates new Checkout creation; default off in production until finance tests/scopes clear.
- `CUSTOMER_CARE_TEST_MODE=true` is allowed only with the exact isolated Supabase URL. It selects test Stripe credentials and the fixed isolated Airtable base `appsDmtQ1XOE8Gjtr`, never production credentials.
- `STRIPE_TEST_KEY` and optional test price IDs are isolated only. Test mode can create inline fictional plan prices through Checkout; existing live price IDs are never submitted to test mode.
- Live Checkout uses a separately reviewed `STRIPE_CHECKOUT_KEY`; the existing billing read key is not silently escalated.
- Test billing webhooks require `STRIPE_TEST_WEBHOOK_SECRET` and `AIRTABLE_TEST_PAT`. Test webhook mode cannot use the production database/base. Live webhook remains the existing secret/read key/account base.
- `RESEND_WEBHOOK_SECRET` activates signed delivered/bounced receipt updates; never accept client claims about delivery.
- Public `auth-config` exposes only public auth fields and boolean capabilities, never keys above.

Apply only additive migration `20261026090000_customer_continuity.sql` after local/isolated validation and capture/compare current table counts. Do not replay old upload/billing migrations. It creates six private RLS tables, service-only RPCs, a private operator view, and source-reference guards. Original business data is not rewritten. Test profiles/receipts/files stay in the isolated project.

Rollback: disable new capability flags and rebuild/restore the pre-release application deployment. Existing emailed submissions, billing and original data remain. Keep the new tables initially for receipts/requests; do not automatically drop customer data or delete original sources as rollback. Stop or disable the new scheduled check if needed. Production SMTP change is independently reversible using its non-secret before-settings artifact and securely held provider credential; do not expose credentials in a rollback document.

The v2 Airtable script is `automation-delivery-v2.js`. It requires the triggering proposal's stable record ID and existing credit-reservation submission UUID. Preserve the record-trigger/recipient/generation settings and inspect provider receipts before retry. An intentional resend needs a separately reviewed attempt key, not a random new key after an uncertain send.

## Verification commands

`npm test`; `bash scripts/test-customer-continuity-sql.sh`; `python scripts/test-customer-hub-browser.py`; `python scripts/test-local-ocr-browser.py`; existing offline browser suites. Run actual authenticated isolated history, protected DOCX, owner denial, unused-source removal and Checkout test-mode checks against a ready preview. No customer mail sends or real card charges.

Backup commands: `prepare-encrypted-application-backup.py --project ... --output new-private-directory`; then `verify-application-backup.py directory`. Files encrypt before filesystem persistence; recovery key has mode 0600 and is never printed. The local restore verifies public records/constraints and stored-object hashes, not full managed Auth/security/provider recovery. Hand off ciphertext and recovery key separately. Raw local artifacts are under `/workspace/scratch/customer-continuity/`.

## Cost and retention

No paid OCR/analytics/monitoring vendor added. OCR costs browser CPU/memory and public CDN bandwidth. Native SMTP uses the existing approved sending provider; existing send caps preserved. GitHub availability workflow runs at most four times/day, two-minute job timeout (up to ~240 runner-minutes/month); expected $0 inside an existing allowance, not a guarantee of zero account overage. Netlify scheduled health adds existing-plan requests. No budget/plan upgrade or automatic top-up configured. Stored drafts add up to 150,000 characters/delivery for 90 days; review Supabase storage/database capacity. No provider training job or live payment was created by release testing.
