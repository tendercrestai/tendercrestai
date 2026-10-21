# Billing-period credits and coordinated rollout

Monthly plans include 5, 20, or 60 proposals. A successful renewal opens the
exact Stripe subscription-item interval `[current_period_start,
current_period_end)`. Usage from the prior interval remains auditable but does
not reduce the new allowance. Upgrading or downgrading within the same interval
changes the limit without clearing usage. Scheduled cancellation retains access
until Stripe ends the subscription; failed payment, collection pause, cancellation,
or an expired interval prevents new reservations.

Free trials include 60 proposals for one fixed 30-day interval. They do not renew
automatically. Existing Trialing records retain their original creation time.
Owner-approved complimentary accounts instead retain their existing plan allowance
and renew on calendar-month boundaries anchored to their original creation date.
Month-end dates clamp shorter months without permanently drifting the anchor.
Only the explicit Complimentary Access checkbox grants this path; a linked Stripe
subscription still uses Stripe's periods and status. Paid synchronization clears
the checkbox so a canceled paid plan cannot regain complimentary access.
New trial creation is claimed once per verified Supabase owner before the Airtable
write; a timed-out or ambiguous creation requires reconciliation.

## Changes already applied on 13 October 2026

- Installed `billing_period_credits` in the production Supabase project
  `vfdwaqgfepvoujprtuww` and separate test project `wcrrywzleylmdsqqlise`.
  The tracked migration uses the production-generated version
  `20261013073847`. The test project's generated version is `20261013073303`.
  Do not rerun the CREATE statements on either project.
- Added exact Billing Period Start/End and Credit Reservation ID fields to the
  production Airtable base `appsaqdp3UZdhB2VH`, plus quota-boundary helpers.
- Updated existing Airtable formulas to use synchronized periods when present,
  explicit subscription tiers, and exclude Failed/Quota Exceeded proposals.
  Unsynchronized paid accounts retain their previous rolling fallback pending
  reconciliation and deployment. New server code requires exact periods for
  paid accounts and does not accept that fallback.
- Marked the eight existing Active legacy accounts as Complimentary Access,
  explicitly authorized by the owner. Their record IDs and current allowances
  are preserved; no Stripe subscription was created or charged.
- Saved validated drafts for Automation 1 and Gatekeeper. Their published
  versions are unchanged until an operator clicks **Update**. Automation 1
  requires a server-issued reservation marker and Uploaded state, and no longer
  tests the remaining allowance after the current proposal already consumed it.
  Gatekeeper no longer generates proposals; its draft rejects unreserved direct
  inserts. Automation 1's pre-existing unpublished AI revision changes were
  preserved; review them before publishing the combined draft.
- Did not change Stripe payments, subscription objects, webhook endpoints,
  payment links, Netlify settings, or historical account/proposal links.

## Credit ownership and failure handling

The verified server reserves a credit through a service-only Postgres function.
A company-wide transaction lock serializes distinct concurrent submission UUIDs.
The existing submission ledger separately prevents replayed submissions and
document reuse. A reservation is persisted before Airtable dispatch and its UUID
is written to the proposal's Credit Reservation ID field.

Historical proposals without that marker are counted from their linked company
and original creation timestamp. Marked proposals are counted only in Postgres,
so the Airtable record and database reservation never charge twice. A failed or
quota-rejected historical job is excluded. Marked terminal failures are refunded
idempotently when the next submission reads account history. A successful draft
continues to consume its credit even if email delivery fails. An uncertain queue
write retains its credit until its record is reconciled; it is never automatically
refunded or blindly retried. No scheduled job is needed to reset usage.

The reservation tables intentionally have RLS enabled with no customer policies,
and EXECUTE/table access is revoked from PUBLIC, anon, and authenticated. Only
the server's service_role can grant or refund credits. The Supabase advisor's
RLS-with-no-policy informational notices reflect this deliberate restriction:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Validation

- `node --test tests/*.test.js tests/*.test.mjs` passes. Individual test execution
  confirms 62 tests across eight files.
- `supabase/tests/billing-credits.sql` passed against the test project using
  service_role. Fixtures were rolled back. It checks the fifth/sixth credit,
  replay, upgrade/downgrade, expiry, renewal, failure refunds, ownership, trial
  reuse, and customer-role denial.
- Two actual concurrent test-database calls competed for the final credit:
  one returned `reserved`, one `quota_exceeded`, and exactly one row was held.
  Those fixtures were removed from the test project.
- Production privilege checks confirmed that service_role can reserve and
  authenticated cannot. No production reservations or paid generations were
  created during validation.
- All updated Airtable formulas passed validation. Numeric UTC helper fields
  preserve seconds across lookups; date-only lookup formatting cannot truncate
  billing boundaries. Existing trial balances were read and verified.

## Complete the rollout in this order

1. Confirm the complimentary account mapping. The connected live Stripe
   account `acct_1UJqLUFinOspVJZ4` lists zero subscriptions. The owner explicitly
   authorized keeping the eight Active legacy/demo accounts complimentary;
   their checkbox is now set. New unverified Active rows without that checkbox
   must not receive paid-plan access. Duplicate emails and historical proposals
   linked to multiple companies also require review before production smoke
   tests. New code rejects ambiguous email matches. Existing Trialing accounts
   retain their fixed allowance and original expiry.
2. Review and merge this change during a short submission-maintenance window.
   Wait for Netlify's production deployment. New code and the Automation 1
   draft must be activated together: the old generator can reject the last
   allowed credit, while the new generator requires markers absent from old code.
   Let in-flight jobs finish before publishing drafts.
3. In Netlify's Production/Functions environment, preserve the current
   AIRTABLE_PAT and SUPABASE_SERVICE_ROLE_KEY for the production services.
   Configure STRIPE_READ_KEY as a restricted live Stripe key with read access
   to customers, subscriptions, invoices, and prices. Never put keys in source
   control or send them in chat.
4. Register the Stripe webhook endpoint:
   `https://tendercrestai.netlify.app/.netlify/functions/stripe-webhook`.
   Use API version `2026-08-26.dahlia` and these events:
   - checkout.session.completed
   - checkout.session.async_payment_succeeded
   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
   - customer.subscription.paused
   - customer.subscription.resumed
   - invoice.paid
   - invoice.payment_failed
   Copy that endpoint's signing secret directly into Netlify's
   STRIPE_WEBHOOK_SECRET. Redeploy to make the function settings effective.
   Do not use the old Airtable endpoint's signing secret for the new endpoint.
5. Disable the obsolete direct Airtable billing webhook
   `we_1UKoMtFinOspVJZ49IZ15w5Q` and turn off Automation 2. It still creates
   duplicate companies and uses Checkout-only fields for subscription events.
   Inspect the two Make scenarios before deciding whether they should also be
   retired; their purpose has not been verified.
6. In Airtable, review and click Update for Automation 1 and Gatekeeper:
   https://airtable.com/appsaqdp3UZdhB2VH/wflnDbTiFkkyVdmTY
   https://airtable.com/appsaqdp3UZdhB2VH/wfl6cUlfDvdzHgIi3
   Do not publish the new gate while old unmarked submissions are still being
   accepted. Do not populate Credit Reservation ID manually.
7. If a verified subscription already exists by rollout time, replay a supported
   real Stripe event for it to synchronize its company and exact period. Review
   duplicate accounts rather than blindly replaying through ambiguous mappings.
   The webhook fetches current Stripe state; replaying an older event does not
   reset credits twice or reactivate a canceled subscription.
8. Verify webhook deliveries return 200 and Airtable receives the exact
   item-period timestamps and price-derived tier. Then perform a controlled
   authorized smoke test with fictional content. Real submission automations
   can generate and send email. Confirm its reservation, proposal marker, and
   output. No live renewal/end-to-end payment test was performed by this patch.

Netlify settings access and Airtable's manual Update controls are required to
finish activation. The connector can save automation drafts but cannot publish
them. The repository has no Netlify credential available to this session.

## Reconciliation and rollback

Before changing an uncertain/processing submission, search Airtable by its
Credit Reservation ID and reconcile it with the original submission inputs.
If a record exists, set the reservation to queued with that exact record ID
and reconcile the submission ledger. Only release a held credit after confirming
that no queued job exists, or after reading its terminal Failed/Quota Exceeded
status. A failed trial create likewise needs an account search before its
provisioning claim can be cleared. Do not clear locks merely because they are old.

Keep schema additions and reservations during rollback. Restoring old server
code requires restoring its compatible generation gate as part of the same
maintenance window; the new gate rejects unmarked old-code jobs. Keep billing
sync active or pause new submissions rather than re-enabling the unsafe old
Checkout-only billing automation. Original automation snapshots and formula
definitions were retained in the task workspace for review and recovery.
