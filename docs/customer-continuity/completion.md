# Continuity completion release

Build on PR #25 and the subsequently enabled authenticated card-required trial flow. Preserve prices, allowances, legacy expiries, data isolation and existing integrations. No paid training/infrastructure purchase or customer source deletion is part of release verification.

## Changes

- Owner-authenticated recovery of older queued submissions with an exact stored Airtable record, matching recipient/reservation when present, ready non-stale text, strict size/XML validation and frozen private retained copy. No AI call/email/send-status invention. Sources absent from the database or provider remain unrecoverable. Original attachment bytes are not reconstructed exactly.
- Account controls for organization owners to list managed knowledge sources, explicitly archive them using the existing approval-invalidating RPC, and request permanent deletion for dependency/retention review. Shared referenced data is never silently hard-deleted.
- Dedicated Netlify scheduled entry points for quarter-hour health/cleanup, daily analytics retention, and hourly future-only opt-in workspace reminders. Normal operator HTTP routes remain protected; scheduled endpoints must be HTTP-inaccessible after deployment. Scheduled health writes explicit provenance so a real scheduler run can be distinguished from an operator test.
- Future-only reminder activation (`PROPOSAL_EMAIL_START_AT`) excludes old backlogs. Verified recipients, current access and opt-in are checked before sending; the approved sender is hello@tendercrestai.com. Stable provider idempotency/retry limits are preserved. Provider acceptance is labelled accurately in the workspace.
- Private atomic reminder admission caps distinct notifications at five per UTC day. No content or addresses in the new budget table; retrying the same admitted notification consumes no second slot. Cleanup retains admission metadata for at most 90 days.
- Correct environment-context selection in encrypted snapshot generation and a local downloaded-copy verifier that decrypts only in memory and reports non-secret integrity results.

## Provider configuration and costs

User confirmed Resend Free: 100 emails/day, 3,000/month. Set Auth SMTP limit to three/hour (previously two). This is a modest capacity increase, not unlimited signup scale. Auth, proposal deliveries, contact acknowledgments and reminders share the provider limit; contact forms can send two messages. Five reminder admissions/day limits this channel's additional usage. Other clients of the same provider account and monthly consumption must still be monitored. Provider caps can reject requests at capacity. No paid plan, auto top-up or sending-limit guarantee is introduced.

Production delivery events use a distinct owner-configured `RESEND_WEBHOOK_SECRET` and the existing signed endpoint. Owner approved one fictional Word delivery to hello@tendercrestai.com for actual native-event validation. Sending access alone cannot inspect provider account settings. A verified event must arrive before calling automatic delivery status passed.

Quarter-hour health produces up to 2,880 scheduled invocations per 30-day month plus internal checks; reminder/analytics wrappers add existing-plan usage. Cash cost depends on current hosting allowance; no additional service subscription is created.

## Schema and rollout

Apply only `20261026100000_reminder_email_budget.sql`, recording its exact source in migration history, after local/isolated checks and a fresh encrypted backup/restore drill. This adds one empty service-only RLS table and RPC; existing business data is not rewritten. Stage first with reminder emails disabled. Verify scheduled endpoints return 404, normal operator routes deny anonymous calls, account recovery/ownership and existing journeys pass. Deploy the reviewed commit, then verify native provider and scheduler evidence. Owner explicitly authorized future opt-in reminders, with no backlog campaign.

Rollback: set `PROPOSAL_EMAIL_LIVE=false`, restore the prior application deployment and disable the new scheduler registrations if necessary. Preserve receipt, admission and request history. Existing Checkout activation and all plan terms remain unchanged. Do not drop customer tables or restore an expired key.

## Verification

Local: 328 Node tests and 93 SQL assertions passed. Account-hub browser regression passed. Fresh pre-migration encrypted snapshot: 36 public tables, seven private objects; isolated public-data/object integrity restore passed and its temporary volume was removed. Hosted, provider-event and actual scheduler results belong in the release artifact after execution; configuration alone is not a pass.

## Unavoidable remaining evidence

The owner must download and separately store ciphertext and key outside this workspace. Run `verify-downloaded-backup.py --backup application-backup.enc --key recovery-key.txt --manifest manifest.json` on that computer with Python's cryptography package installed; do not share keys or decrypted data. A cloud-only verifier run cannot establish an off-workspace copy.

Supabase currently reports zero native backup entries and PITR disabled; runtime TCP grants are empty. The application snapshot excludes managed Auth credentials and complete provider/platform recovery. Enabling paid native backup/PITR or establishing a separately reviewed native dump/restore path remains necessary for full-service recovery.

The winning-response training pipeline and calibrated-model gates already exist. The present library has no eligible verified full winning responses with reuse approval, and no approved calibrated model. Customer-reported outcomes are not independent award/loss evidence. Actual training/prediction release still requires the eligible corpus, verified pre-submission win/loss dataset, independent evaluation and a concrete provider-cost review. No numerical probability or shared customer-content training is invented for this release.
