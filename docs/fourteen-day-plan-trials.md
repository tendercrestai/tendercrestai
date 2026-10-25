# Replace the standalone Enterprise offer with plan trials

Status: checkout and formula gates verified after the owner added write permission. Both approved Companies formulas are applied and match the reviewed expressions on readback. Ready for normal application release; no customer subscription, account expiry or SQL migration was changed.

## Approved policy

- Pro: 14 days, payment card required, five proposals total during the trial; then $299 USD/month and five per paid period unless canceled before trial conversion.
- Growth: 14 days, card required, 20 proposals total; then $699 USD/month and 20 per paid period.
- Enterprise: 14 days, card required, 60 proposals total; then $1,299 USD/month and 60 per paid period.
- Keep the current expiry/allowance for existing unlinked legacy free trials. Do not restart/extend them or convert them to an automatically charged subscription.
- Existing expressly approved complimentary operational accounts are separate from the public free-trial offer. This change does not silently cancel them, paid subscriptions or project access.

## Application changes

Remove the standalone free-tier card/form and its client handler. Each paid plan links to its existing Stripe Payment Link with clear card, automatic-conversion, cancellation, billing-email and trial-quota disclosures. Existing monthly prices, link URLs and paid allowances remain unchanged.

New proposal submissions cannot provision a free Enterprise Airtable account. An unknown billing account receives a `subscription_required` response directing it to pricing, without creating a company, claiming a free trial or reserving proposal credits. Retrying after a successful checkout/webhook synchronization can use the existing retryable submission identity.

Stripe-linked Trialing accounts use their explicit selected plan's 5/20/60 allowance, not the old universal 60. Their eligibility interval is Stripe's exact `trial_start`/`trial_end`, not an inferred item monthly period. Expiry is exclusive at the end timestamp. Successful paid conversion uses the paid subscription-item period and a new period allowance; failed payment blocks access. Zero-dollar trial invoices do not set a paid billing date. Existing unlinked legacy trials retain their original fixed-period behavior and never renew as complimentary accounts.

No new SQL migration or environment variable is needed. Existing trial-claim functions/tables are retained for history; the public submission path no longer calls them. Billing remains independent of access to the existing project workspace.

## External readiness gates

Read-only Stripe checks confirmed all three configured live monthly prices match USD 299/699/1299. The connected account listed zero subscriptions (including zero active trials), without pagination, at inspection time. Existing Stripe credentials can read prices/subscriptions, but reading Payment Links returned HTTP 403 `more_permissions_required`. This is a key-permission failure, not evidence of a broken price or trial setting. No Stripe writes were attempted. Airtable schema metadata also returned HTTP 403, so current computed formulas and automation conditions remain unverified.

Before production activation:

1. In Stripe's live dashboard, open **Payment Links** and edit the existing Pro, Growth and Enterprise links used by index.html. Configure each subscription for a **14-day free trial** and **required payment-method collection**, with the existing single monthly plan at quantity one. Do not add setup fees or adjustable quantities. Confirm cancellation before trial conversion prevents the subscription charge. Preserve existing subscriptions and do not create a test/live charge during this configuration task.
2. Give the existing restricted `STRIPE_READ_KEY` **read-only Payment Links** permission so the exact live configuration can be independently checked. The read-only key does not need write permission. Make changes in the Stripe dashboard, never paste keys in chat. If a replacement key is required, save it securely in Netlify using the existing variable; do not replace the webhook signing secret.
3. Run `STRIPE_READ_KEY=<secure environment binding> python scripts/verify-stripe-trials.py` without placing a literal key in command history. In this cloud task the configured key can be read in memory through the Netlify API. All three plans must report ready. The script validates live/active links, required card collection, 14 days, exact plan/price/currency/quantity/interval, no extra items, and no unreviewed promotion-code setting. It does not create a checkout, customer, subscription, payment, email or API write.
4. Review Airtable's billing formulas and deployed generation gate with schema-read access or owner-provided formula text. Trialing must not imply Enterprise or 60 for every plan. Use explicit Subscription Tier and persisted trial boundaries for plan-specific display/eligibility; the backend already enforces the plan limit independently. Preserve UTC timestamps and credit-reservation markers. The existing `Amount Paid` field retains its historical minor-unit plan-price representation for legacy formula compatibility; it is not a reliable ledger of trial payment receipts. Stripe invoices remain the source of actual charges. Changing that schema/formula requires a separate reviewed update, not guessing current formulas.
5. Review duplicate-trial eligibility. Public Payment Links alone do not prove one free trial per verified TenderCrest identity. A coordinated authenticated Checkout entry point and durable per-user/provider identity are required if that restriction must be enforced. Do not claim one trial per customer without such a mechanism. Existing legacy claims are not repurposed as Stripe trial claims in this release.
6. Once these gates pass, merge normally and verify the exact production deployment. Do not publish trial claims while Stripe links still charge immediately. Preserve rollback baseline `6adcda86e0d1eb6090ce4384`; rolling back application code does not roll back provider settings. Reverting Stripe trial configuration is a separate dashboard action and must not change existing customer subscriptions.

## Verification

198 Node regression tests pass, including selected-plan limits, exact expiry/start boundaries, grandfathered legacy trials, no new auto-provisioned free company, concurrent unknown accounts, trial-to-paid conversion, payment failure and invalid Stripe trial dates. Five offline Python release-gate tests pass. Mobile/desktop pricing checks pass at 390 and 1440 pixels: three checkout CTAs, removed free form, card/renewal disclosures, navigation, no horizontal overflow, no browser errors and no real provider calls. No actual Checkout completion, card authorization, charge, customer email or production trial migration was run.

## Permission-update verification

All three live Stripe links now pass the read-only release gate: active/live, exactly 14 days, required card collection, correct single monthly USD price and quantity, no extra items or adjustable quantities. Promotion-code entry is enabled, but an authorized active-promotion-code listing returned no active codes and no pagination. Preserve the existing entry setting; the verifier only permits it automatically when that no-active-code review passes. Newly active promotions still require review.

Airtable schema inspection now works. In the production **Companies** table, `Calculated Tier` still unconditionally maps Trialing to Enterprise, and `Monthly Quota` still unconditionally gives Trialing 60. These are the remaining release blocker. The exact replacements are committed in `docs/airtable-plan-trial-formulas.json`. They retain unlinked legacy trials at Enterprise/60 while assigning Stripe trials their selected 5/20/60, and preserve paid/complimentary fallback logic. The two formulas passed Airtable's read-only query syntax/reference checks without returning any records and three offline formula-policy tests.

A scoped PATCH of Calculated Tier returned HTTP 403 `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`. Neither field was changed; no follow-on PATCH was attempted. The original two formulas are saved in the private workspace release artifacts for rollback. Do not infer write permission from successful schema reads. The owner can paste the two replacements manually into **Companies → field header → Edit field → Formula**, without giving the production service token schema-write access. Re-read both formula definitions and check their validity before merging PR #17. No production application deployment, charge, subscription, customer email, account-expiry change or migration was made during this check.

## Final readiness after schema-write permission

Both scoped formula PATCH requests succeeded with HTTP 200. Fresh schema reads confirm both formulas are valid and exactly match the reviewed expressions after converting Airtable field IDs to names and normalizing string quoting. Original formulas were saved before writes. No customer record, date field or subscription was edited.

All three live Stripe links pass the complete readiness check again. There are no active promotion codes in the reviewed listing. All 198 Node regression tests and five offline verifier tests pass. The application release can proceed through normal PR checks/merge; post-publication verification must attest the exact published commit, correct pricing copy and checkout URLs, absent standalone free form, loaded function routes, private source exclusion and unchanged workspace email flags. A real card checkout, charge or generated proposal is not part of this release verification.

The temporary schema-write permission may be removed from the production Airtable token after formula verification; preserve its existing record read/write and any required schema-read scopes. The rejected read-only attempts above are historical, not current blockers.
