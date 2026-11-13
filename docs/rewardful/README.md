# Rewardful installation

Public browser identifier: bbbf92. No npm package, new secret, migration, campaign/commission change, or Stripe write is introduced.

The shared HTML decorator places the owner's exact two-script snippet in an inert template in every marketing/application page head, including generated teardowns. The Rewardful module recreates those scripts verbatim, in order, only after a new provider-specific opt-in. Scripts in a template do not execute or fetch before consent. The former affiliate provider was removed from the codebase; Rewardful uses its own provider-specific opt-in, and no other vendor's consent authorizes it. Rewardful uses the same granular pattern: 30-day purpose choice, GPC/DNT and credential-URL guards, withdrawal reload and independent settings. The owner-configured 90-day provider cookie is separate from consent duration.

## Customer association

The existing account/checkout-return callback makes a non-blocking optional call into the Rewardful module. It does not change sign-in, signup, navigation, checkout creation, prices, trial duration or payment behavior. Logout invalidates the optional callback. A blocked SDK or missing consent sends no conversion/email and never prevents account access.

A new protected read-only rewardful-customer function resolves the signed-in user's existing private Stripe billing binding, or verifies their completed owned Checkout session before the webhook arrives. It retrieves the real Stripe customer, checks identity/live mode/creation time, and returns that object's email unchanged plus an opaque HMAC deduplication reference. No client email or customer ID is accepted. Existing Stripe read/checkout credentials are used only for GET verification. Historical customers predating the Rewardful consent are excluded. Test/isolated deployments return no live conversion. Only after successful SDK load and current consent does the browser call the requested `rewardful('convert', {email: ...})`. No email or bearer token is persisted for later forwarding.

This associates a newly created Stripe customer, including a trial customer. It is not a purchase or commission event. Rewardful's existing Stripe connection/campaign determines eligible paid commissions. No zero-dollar invoice, signup, demo, synthetic charge or payment event is fabricated. A consenting signed-in return is required; browser blocking/refusal/no return can prevent attribution. A queued SDK call is not a commission/delivery acknowledgement.

## Verification

Build and full npm suite; eight server tests (read-only verified email, ownership, completion, consent, history, live/test separation) and browser coverage for all-page exact snippet, no pre-consent requests, single injection/conversion, withdrawal, GPC/DNT, credential URLs, expiration and blocked SDK. Existing account-upgrade browser regressions also run. Vendor SDK/conversion responses are mocked in these tests; no real referral email or Stripe write is sent.

Deploy an isolated preview first, then merge through GitHub to production. Verify public production markup and a real consenting SDK visit separately from fixture tests. The affiliate portal and authenticated dashboard must be checked directly; website deployment alone does not prove Rewardful enabled a portal or completed its checklist. No Rewardful setting is changed to force that state.

The managed research environment initially does not permit Rewardful domains. A preserving domain draft adds r.wdfl.co, api.getrewardful.com, app.getrewardful.com and tendercrest-ai.getrewardful.com. It must be reviewed/saved and published by the owner before real vendor checks can run. Dashboard checklist verification additionally requires authenticated Rewardful access; no password/API key should be pasted into chat. Do not claim either check passed from mocked tests.

Rollback: revert this PR. No database or secret rollback is needed.
