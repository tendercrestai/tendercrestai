# Incremental cost model

Estimates, not measured invoices or currently verified provider prices. No new paid service or subscription is introduced. Existing Netlify and Supabase capacity may accommodate initial traffic, but plan limits, storage growth, bandwidth and function usage must be checked in the owner's billing dashboard. No quoted plan upgrade is assumed.

## Assumptions

Per active customer/month: 10 proposals, six optional AI writing requests per proposal, 6,000 input tokens plus 2,000 output tokens per request. Sixty AI calls/customer/month; no automatic model call for demo, scoring, strategy, quality audits or whole-proposal assembly. Illustrative model rates ONLY: $0.40/million input tokens and $1.60/million output tokens (confirm configured model and current account pricing before budgeting). Formula: 60 × (6000 × 0.40 + 2000 × 1.60) / 1,000,000 = $0.336/customer/month; an estimate, not a binding price. Up to three charged attempts could triple this amount in a worst-case retry scenario.

| Active customers | Optional writing requests/month | Estimated incremental AI | Three-attempt ceiling illustration |
|---:|---:|---:|---:|
| 10 | 600 | $3.36 | $10.08 |
| 50 | 3,000 | $16.80 | $50.40 |
| 100 | 6,000 | $33.60 | $100.80 |

Existing RFP extraction, embedding, email, payment fees and external Airtable/automation costs are excluded from incremental AI estimates; they already exist and vary with actual usage. Account-level enforced $5 provider limits, if still configured, can cause requests to fail well before these larger scenarios; do not raise limits silently.

## Infrastructure and storage assumptions

No extra database/vector service, queue, paid analytics collector or hosting subscription. Added static assets are small plain JS modules; demo runs entirely in the browser. Existing versioned JSON project snapshots retain enriched strategy/audit metadata and optional AI job results. At an illustrative 100 KB per saved revision × 200 revisions/customer/month, additional storage could be roughly 20 MB/customer/month: 0.2 GB for 10, 1 GB for 50, 2 GB for 100, before indexes, exports and existing source documents. Real audit-rich snapshots can be much larger (aggregate bound 3 MB). Measure actual state/job/export sizes and establish retention policy before scaling; never promise unlimited history for free.

Incremental infrastructure bill: $0 if workloads remain within already paid allowances; otherwise unknown until actual Netlify/Supabase plan quotas and overage rates are reviewed. This is not a zero-cost guarantee. Anonymous traffic adds hosting/bandwidth, not model charges. New semantic writing uses background invocations; exports keep existing function costs.

## Measured versus unmeasured

Tests exercise deterministic logic and mocked AI usage. Hosted fictional draft/export tests measure job completion and validate artifacts. One live optional writing test used gpt-4.1-mini: 403 input + 79 output = 482 provider-reported tokens, provider duration 2,381 ms. At the illustrative rates above, this would be about $0.00029, not an independently verified invoice. Two small fictional RFP analyses also called the existing extraction provider; that legacy path does not retain token usage. Initial knowledge embedding/search attempts were denied. After the key was corrected, fresh indexing, the full reviewed export/reuse journey and production fictional-query embedding passed. The legacy embedding path does not retain provider token usage, so its measured dollar cost is unknown. Returned usage records provider-reported token counts on real optional requests; duration includes provider time. Project metrics show queue-inclusive processing times and status counts. Aggregate organization token-cost dashboard and monetary budget ledger are not implemented; existing admission, fixed token caps, bounded retries and provider account spending controls remain the enforcement mechanisms.
