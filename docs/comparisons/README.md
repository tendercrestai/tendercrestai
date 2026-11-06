# Comparison pages

Routes /compare/responsive and /compare/loopio rewrite to static allowlisted HTML. Existing public design system, consent modules and static build injection are reused. FAQ JSON-LD matches visible questions and answers.

Official pricing pages retrieved November 6, 2026: https://www.responsive.io/pricing and https://loopio.com/pricing/. Responsive lists Emerging Edition from $10,000, an annual platform fee, user licenses and add-ons. Loopio lists 10 seats in Foundations but no starting dollar amount in the retrieved official page. Therefore the supplied $20,000/year claim is not published. Quotes and feature scope should be reconfirmed before purchase.

Other corrections: fictional demo is not a visitor's real-bid trial; card-required trial automatically bills selected plan unless canceled; 5/20/60 allowances apply to the existing emailed-draft service, not all workspace actions; no unlimited reviewer claim or feature-parity claim. Honest competitor-fit sections retained. No schema, pricing, billing, signup, demo or tracker changes.

Validation: npm test; node scripts/build-site.mjs; python scripts/test-comparisons-browser.py; existing customer-upgrade browser regression. Static pages have no new runtime dependency, images or data requests. Mobile table scrolling is keyboard focusable and keeps readable type. FAQ schema validity does not guarantee Google's rich-result eligibility.

Review deploy preview before merging. Rollback: revert this PR; no migrations or secret changes.
