# Google Ads purchase measurement

Public Google tag AW-18539401980, supplied label 5KPpCP7TuK0dEPylo4hF. Direct gtag.js installation; no GTM container introduced. Google tag loads only after a separate 30-day Google advertising consent on homepage/demo. OpenAI and first-party usage consent never imply this consent. GPC/DNT, unknown URL parameters, private routes, and private homepage hashes block loading. Recognized public attribution parameters include bounded gclid/gbraid/wbraid and UTMs. No enhanced conversions, remarketing audiences, Google Signals or ad personalization enabled. SDK config suppresses page-view events; page visits are not Purchase.

Homepage existing Supabase authentication invokes the exported purchase check. Server verifies token through existing auth, existing admission rate limit, service-only cc_billing_bindings user ownership, production database/mode, and Stripe invoices through STRIPE_READ_KEY. Complete bounded invoice history required (<=100; has_more fails closed). Earliest positive paid live invoice must match bound customer and subscription, currency USD, and paid timestamp after this browser's consent. Zero-dollar trial invoices never convert. Only actual amount_paid/100, USD, and HMAC transaction reference leave the endpoint; no email, account UUID, customer ID, invoice ID or document contents are sent to Google. Current USD pricing only. No subscription payments or invoice mutations performed.

Browser queues exact supplied Google conversion action with actual value. In-memory suppression and stable transaction_id protect repeat calls; persisted suppression occurs after Google's event callback. Callback is SDK processing, not proof of Google receipt. If callback never occurs, another page load may retry with the same deduplication ID. Provider blocking and attribution eligibility can still prevent reporting.

## Limits

This is browser measurement, not Google Ads offline/server-side imports. Customer must opt in before payment and return signed in to a public homepage after payment with consent still valid. No retroactive conversion imports. Trial-to-paid payments made while customer is offline are not sent at the moment of billing. Customers who never return or decline tracking are not counted. New authenticated Checkout billing bindings required; older/unbound email-only identities are not guessed. Google SDK receipt/ad attribution not verified from this network; provider hosts not allowed. No fake Purchase sent to a live Google conversion action.

Keep Purchase as the primary paid outcome in Google Ads. Page view and trial Subscribe definitions need review; this code does not alter Google campaign goals, bidding, budgets, or conversion action fixed-value settings. Use different per-conversion values in Google Ads. Refund retractions and cancellations not imported automatically.

## Validation and release

Node payment-verification tests: ownership, invalid/auth requests, positive amounts, no trials, production/test mode, subscription matching, pre-consent suppression, pagination, deterministic opaque IDs and modern invoice structure. Chromium provider-mocked tests: consent/privacy/routing gates, exact label/value/payload/order, dedup, gclid allowlist, withdrawal and null-event suppression. npm test plus existing customer journey and OpenAI pixel regression. Native Google SDK/ad-account diagnostics require owner verification; there is no Google Ads account connector in this environment.

No schema migrations or new secrets. Existing SUPABASE configuration, STRIPE_READ_KEY, ANALYTICS_SIGNING_SECRET required; verified permissions read-only. Rollback: revert this PR and redeploy; retain Google Ads records, no data schema rollback.
