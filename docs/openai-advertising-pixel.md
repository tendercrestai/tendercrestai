# OpenAI advertising pixel

Public pixel EXKpttMHWwqpN1QAmAU1eP initializes only after separate, 30-day advertising consent on homepage/demo. First-party analytics consent is insufficient. GPC/DNT block loading. No authenticated-product-page injection. Unknown URL parameters/hashes block initialization; only fixed public hashes and bounded simple UTM values are allowed. Debug disabled. Withdrawal reloads to unload the SDK. Third-party collected data/cookies cannot be deleted by this loader.

No custom conversion commands are guessed: only the supplied init API is used. Confirm pixel receipt and supported conversion-event API in the advertiser dashboard before claiming trial/paid conversion attribution. SDK actual network behavior/provider receipt are not verified by local mocked tests. The environment currently does not allow bzrcdn.openai.com, so no real provider request is made for testing. Public visitors' browsers use their own network policy.

Validation: npm test; node scripts/build-site.mjs; python scripts/test-openai-pixel-browser.py (7 browser scenarios, provider mocked; zero actual third-party requests). Deployment rollback: revert this PR; no migrations, secret changes or campaign spend.
