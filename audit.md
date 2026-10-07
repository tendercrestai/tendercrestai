# TenderCrest AI website audit — 7 October 2026

Reviewed the live desktop website and its frontend and Netlify submission function.

## Changes implemented

- Open on the overview rather than pricing. Add clear plan and sample-input calls to action.
- Replace contract-award and hallucination-free promises with draft-generation and review language.
- Add a three-step workflow, sample explanation, and fictional-demo warning.
- Remove the developer test card and its activation handler. The old handler only prefilled the workspace; account creation actually occurred in the submission function.
- Disable automatic trial creation for unknown billing emails. Existing provisioned accounts retain the current Airtable pipeline schema.
- Add mobile layouts, visible keyboard focus, a skip link, accessible selected navigation states, and status announcements.
- Add hash navigation, metadata, canonical URL, robots file, and sitemap.
- Replace HTML interpolation in success/error messages with textContent to prevent injected markup.
- Correct double decoding of URL prefill values.
- Add matching frontend/server field limits, email/type/sector validation, safe upstream errors, request timeouts, and escaped Airtable formula literals.
- Fail closed when lookup fails or account/quota data is missing. Retain the existing explicit inactive and exhausted quota checks.
- Remove unverified domain-authorization and unlimited-user promises. Label prices in USD and keep existing prices/payment links.
- Add regression tests with mocked Airtable responses; no customer records, emails, or paid generations were created during validation.

## Required follow-up before a full commercial launch

1. Authentication: a billing email is still not proof of identity. Integrate verified sign-in or an email verification flow and bind submissions to the authenticated account.
2. Quota enforcement: Airtable formula state is checked before insertion. Concurrent requests may pass the same remaining allowance. Implement an atomic reservation, idempotent submission key, and request throttling in the service that owns billing quotas.
3. Account lifecycle: confirm Stripe webhooks provision paid accounts and reset allowances. Unknown accounts now receive 403 instead of a free trial; no Stripe-to-Airtable provisioning code exists in this repository.
4. Quota schema: verified the Airtable formula returns ACTIVE for eligible accounts. The patch now requires that exact value and rejects duplicate billing-email matches. Removed the lookup sort on a nonexistent Created field.
5. Stripe configuration: Pro checkout displayed “TenderCrescent Pro.” Rename it in Stripe. Review localized currency behavior; this browser initially saw INR and a conversion fee.
6. Policies: provide approved service terms, refund/credit/revision rules, support contact, privacy disclosures, retention/deletion rules, and subprocessors. No invented legal policy was published.
7. Evidence: add a reviewed sample output and truthful customer evidence. Sample form inputs alone do not demonstrate output quality.
8. End-to-end validation: confirm queue processing, generation quality, delivery, failed-job credit handling, paid account setup, cancellation, and all plan checkout amounts in a dedicated test environment.
9. Mobile and performance: CSS breakpoints were added; verify device screenshots and measure Core Web Vitals. No Lighthouse or real-device performance score is claimed.

## Validation

Run node --test tests/*.test.js with Node 20 or later.
Tests cover frontend parsing/routing and backend invalid inputs, configuration, unknown accounts, upstream failure, inactive/exhausted accounts, insertion fields, and formula escaping.

## Connected-service audit

Read-only inspection of TenderCrest live Stripe and RFP Proposal Engine - Backend Airtable on 7 October 2026:

- Stripe has three active monthly USD prices: $299, $699, and $1,299, matching the website.
- Three enabled Stripe webhook endpoints receive checkout.session.completed: one Airtable workflow and two Make endpoints. Inspect Make scenarios before retiring endpoints to avoid breaking another workflow.
- Airtable Automation 2 always creates a company on checkout completion, without checking payment_status or deduplicating the event. It copies amount_total in minor currency units directly to a currency field and does not persist the subscription ID or plan price ID.
- Its findRecords uses an email substring comparison against customer_details.email for all event types. Subscription events do not have that Checkout Session field. Match by Stripe customer/subscription ID instead.
- customer.subscription.updated always sets Active rather than mapping the actual subscription status; it also references amount_total absent from subscription objects.
- The Airtable endpoint subscribes to charge.succeeded but has no corresponding action branch. invoice.paid and invoice.payment_failed are absent from its event list.
- Automation 1 runs on every created proposal, allows any matched quota result other than QUOTA_EXCEEDED (including inactive or no account), creates an Active company, then generates and emails output. This bypasses payment lifecycle gating and introduces duplicate accounts.
- The separate Gatekeeper workflow can also generate from the same table, uses substring email matching and a truncated QUOTA_EXCEE comparison, and sets Ready for Review before AI generation completes. Consolidate generation to one claimed-job workflow; mark ready only after successful output storage.
- Next Quota Reset Date is Last Billing Date + 30 days, rather than the actual Stripe monthly billing period boundary. Use subscription period data and renewal events.
- No customer records, live invoices, subscriptions, webhook settings, deployed automations, or outgoing emails were changed during this inspection.

Remediation requires a signature-verified Stripe webhook receiver, event deduplication and stable ID matching, explicit subscription-status mapping, price-ID plan mapping, currency conversion, billing-period synchronization, and one generation workflow with exact account eligibility. Do not merely add invoice events to the current Checkout-only webhook schema.
