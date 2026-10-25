# Private conversion reporting and learning readiness

## Release behavior

First-party, opt-in conversion cohorts are stored in three private RLS tables. No client role gains report access. A new dedicated `ANALYTICS_SIGNING_SECRET` (random 32+ bytes, different for each site) signs visitor sessions, daily IP admission hashes and opaque payment receipts. `ANALYTICS_ENABLED=true` is needed in build and function contexts. No existing provider keys change. Daily `analytics-maintenance` removes older telemetry, including when collection is disabled.

In Supabase production SQL Editor, with an authorized administrator session:

```sql
select * from public.growth_funnel_private
where cohort_date >= current_date - 30
order by cohort_date, channel, campaign;
```

Alternatively run `python scripts/report-conversion-funnel.py --project vfdwaqgfepvoujprtuww --days 30 --spend-usd 20` with existing securely configured management access. The spend argument is optional, manually supplied, and must match the selected cohort window. CAC is null until a verified first payer exists. This is observed cash acquisition cost, not a forecast or guarantee of a $20 customer. No advertising-platform import, ad publishing or spend is introduced.

Counts cover consenting visitors only. Returning accounts are distinct from verified new signups. Upload milestones require an actual stored object; export milestones mean a completed export package, not a confirmed download. First payments require a positive paid Stripe invoice, read access to invoice history and verification that it is the customer's earliest positive invoice; renewals and zero-dollar trial invoices are excluded. Unavailable or paginated invoice history fails closed. Billing and customer workflows continue if telemetry fails. There is no retrospective reconstruction of activity before consent, and no claim of complete financial reconciliation. Let 14-day trials mature before assessing paid conversion.

The protected `analytics` action `health`, authenticated with the existing worker token, performs a read-only invoice-permission check and returns only a status. An HTTP 200 invoice read verifies scope, not a real payment conversion. No test purchase is required or authorized. If invoice read is unavailable, payment cohorts will be incomplete until an existing key's read scope is deliberately corrected; do not label that state as zero paying customers.

## Data and model limitations

The registry is empty. Existing fit and readiness scores remain internal assessments. `learningReadiness` reports missing provenance/rights, verified outcomes and calibration; `winProbability` abstains. No winning-bid model, fine-tune, shared customer-content training or numerical win probability is activated.

`node scripts/prepare-winning-bid-training.mjs reviewed-manifest.json new-private-directory` validates approved full winning responses, exact source hashes, award provenance, anonymized reviewed instruction/target pairs and procurement-separated holdout. It writes no training files for the current guidance-only library. It never uploads data or creates a paid provider job.

`python scripts/train-win-model.py verified-outcomes.json new-private-directory` trains only an offline candidate on independently verified, consented wins AND losses with predictors recorded before submission. It requires a strict temporal procurement-separated holdout, class coverage, comparison to a constant baseline, Brier/log loss and calibration bins. Output is always pending independent approval, never added to the runtime registry. Synthetic tests are permanently ineligible. Sample floors do not prove generalization; independent rights/provenance review, prospective monitoring and concrete provider cost/access review remain mandatory before any real model release.

## Migration and rollback

Apply only `20261025180000_private_conversion_analytics.sql` after local and isolated checks. It adds three empty tables, service-only RPCs, private aggregate view and nonblocking telemetry triggers. Do not replay the older upload migration. Capture the pre-release function/table/trigger inventory and migration-history entry; no existing business data is rewritten.

Rollback collection by setting `ANALYTICS_ENABLED=false` in build/functions and rebuilding. Keep the dedicated signing secret so withdrawals and cleanup continue. Restore the prior application deploy if needed; retain the additive schema initially to preserve deletion and retention. If database trigger removal is required, drop only `growth_uploaded` on storage.objects, `growth_workflow` on public.pw_events and `growth_job` on public.pw_jobs. Do not drop unrelated business tables or restore an old expired AI credential. Full removal of new telemetry should be a separately reviewed privacy deletion, not automatic destructive rollback.

## Incremental cost estimate

No new service subscription or AI calls are introduced. With at most 1,000 new consenting browser IDs/day and 10,000 browser events/day, fixed event types are deduplicated per visitor. At roughly 100 events/customer/month plus 1,000 anonymous visitor sessions/month, 10/50/100 customers imply about 2,000/6,000/11,000 optional analytics requests plus similar private database calls, depending on navigation. Estimated incremental cash cost is $0 while within existing Netlify/Supabase allowances; overage depends on the account's actual plan and visitor traffic and has not been measured. Daily maintenance adds about 30 function runs/month. AI training cost is $0 because no provider training job is launched. Predictive model evaluation runs locally; approved future fine-tuning needs a separate token-based budget.
