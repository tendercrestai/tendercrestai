# Reditus affiliate integration — draft, not released

Customer ID 52151d93-4c26-4a39-9346-e17eb42d38b4. Shared static build injects one module in the head of every HTML page with a body, including auth.html (/auth). The module queues the supplied initCustomer and pageview only after distinct, current affiliate consent. Signup success queues conversion using returned user.email, not the submitted form value. Existing-account obfuscated responses with empty identities, failed signup, login, missing data and repeat callbacks do not emit conversion. No email is cached for later forwarding. Storage contains only a processed user-ID marker, never email. SDK queueing is not proof of provider receipt. If script is blocked, queueing can still occur; attribution not guaranteed. No real referral test performed.

## Consent blocker

Existing usage consent explicitly covers first-party metrics only. Google/OpenAI measurement consent is provider-specific and excludes emails. None authorizes disclosing actual signup emails to Reditus or Reditus pageview tracking on signed-in product pages. Reusing those choices would expand consent silently. The user explicitly forbids consent UI and copy changes. Consequently this branch has no opt-in UI and is NOT production enabled or merged. No existing consent flags are reused, so normal browsers never request Reditus. Existing UI/copy/auth/billing/checkout preserved apart from isolated signup-success hook.

The concrete proposed exception: add a separate “Affiliate attribution” consent choice, disclosing Reditus page visits/cookies (including signed-in pages) and signup email sharing for affiliate referral attribution. Add the matching privacy disclosure. Wire accepted/declined choice to setReditusConsent(boolean), with withdrawal reload. Do not expose a console command as a substitute for informed visitor consent. Preferences expire after 30 days; provider's 90-day cookie configuration is unchanged. GPC/DNT prevents loading. Sensitive credential/callback URL parameters prevent loading. Third-party SDK data/cookie deletion is not performed by this module.

## Verification after consent UI exception and release

1. Open https://www.tendercrestai.com/?red=test, accept affiliate attribution, verify v2.js loads, then Refresh status in Reditus. No consent means no request, as intended.
2. Use an explicitly authorized test signup. Verify returned signup user's exact email is used in gr conversion, not a dummy placeholder, and conversion fires once. Refresh status and inspect Reditus Referrals. Signup event is not a paid conversion; existing Stripe connection handles paid commissions.
3. Do not send real customer emails in tests or create referrals/commissions merely to clear pending status. Normal login and existing signup attempts do not fire.

No migrations, new secrets, provider settings, pricing, checkout or Billing Portal changes. Rollback: revert branch. Native provider receipt and installation status not verified; external SDK mocked in local tests.
