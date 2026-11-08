# NYC opportunity feed: implementation and verification gate

Branch: `feature/nyc-opportunities`. NYC source route: `/opportunities/nyc`; the existing federal source remains `/opportunities`. The source tabs link between them. No SAM backend, billing/auth/trial, bid checker scoring, demo/sample, tracking or consent implementation changes.

## Current status

Implementation is a draft based on the public City Record catalog and documented Socrata API patterns. Direct access to NYC is currently blocked by the research environment's network policy. The saved network-domain draft must be reviewed/saved and the environment published before source schema, freshness, terms and original-notice routing can be verified. Do not enable or publish this feed as live until those checks pass. Mocked tests are not evidence that the live dataset is current or usable.

`NYC_OPPORTUNITIES_ENABLED` defaults false. The API returns a clear unavailable response and never fabricates rows when disabled or when upstream/schema validation fails. Existing federal search remains available. No NYC API key is assumed or required by this draft; free anonymous endpoint access still needs live verification. Do not copy masked Netlify secret values.

## Source and behavior

Candidate publisher dataset: NYC Open Data City Record Online `dg92-zbpx`, https://data.cityofnewyork.us/d/dg92-zbpx. Metadata is read from the fixed `/api/views/dg92-zbpx.json` endpoint, and selected records from fixed `/resource/dg92-zbpx.json`. Metadata resolves known publisher column names to safe field identifiers instead of guessing transport keys. Unexpected schemas/types fail closed.

List queries require Procurement section and Solicitation/Solicitations notice type, and a listed deadline dated today or later in America/New_York. Same-day results are not presented as confirmed open bids: exact time, amendments and submission status require the original source. Award notices and other sections are excluded. Calendar/floating dates are preserved as NYC source wall-clock values, without treating them as the visitor's timezone. Fixed/offset timestamp schemas need explicit review before support. Dataset row-update metadata and fetch/check time are distinct, with missing update time labeled unknown.

Keyword uses Socrata's separate `$q` parameter, not concatenated user text in SoQL. Identifiers/order/selected fields are server-owned. Only listed source metadata is returned; supplier/vendor names, contact lists and award amounts are not selected. No attachment URLs are fetched. The City Record `/RequestDetail/<id>` source-link contract must be verified against a real returned notice before activation.

Twenty-five records per page, up to ten pages, with a 26th record used only to signal another page. Sorting is explicitly within the displayed page. A one-hour private cache uses the existing `ft_cache`/`ft_cache_put` path, with day-aware search keys and distinct NYC namespaces. Each upstream request, including metadata, is admitted under the new independent `nyc` budget: 10/IP and 50 shared per UTC day. `20261108090000_nyc_feed_admission.sql` changes only the allowed admission-kind list; all prior limits/logic and browser permissions are unchanged. NYC browsing does not spend anonymous shreds or federal API admission.

## Shredder handoff

NYC cards link to `/tools/shredder?provider=nyc&notice=<id>`. The source selector dispatches to `nyc-opportunities`; legacy links/default selection still use the existing federal endpoint. Available source descriptions prefill the text area, but are not called a full solicitation package. Empty or oversized descriptions use the existing paste/upload fallback. No AI request occurs until the visitor supplies processing consent and submits the shred form. Source text uses the existing extraction pipeline unchanged.

## Verification needed before review completion

1. Confirm current NYC metadata, real field types, notice-type values and row-update time; inspect current solicitation dates. Confirm API access without payment/key and current reuse/attribution terms from official sources.
2. Test a genuine listed notice's original URL and description, including missing attachments. Validate no awards/expired dates in displayed results, and source timestamps and cache behavior.
3. Run build, full npm tests, browser regressions and NYC source tests; review mobile widths. Apply the admission-kind migration only to the isolated test project first.
4. Enable only the isolated preview flag after source verification, then exercise real API queries there. Never use a generic proxy or an arbitrary-URL fetcher to bypass the research environment's denied destinations.
5. Share preview and findings before production migration, flag change or merge. No production credentials or environment values have changed in this draft.

Other state sources are research only. Their basic public portals must not be advertised as free bulk APIs without current evidence. See `source-investigation.md` for the investigation log.

## Local checks recorded November 8

Build and full npm regression suite pass. Five adapter tests cover source IDs, metadata mapping, date/type checks, award exclusion, safe full-text query parameters, source caching, pagination, description/attachment fallback and the disabled guard. Fifteen browser checks pass at 390/768/1280, including provider switching without an AI submission, legacy federal handoff and honest empty/unavailable states. PostgreSQL admission checks prove independent NYC/federal counters and no new browser permissions. The existing free-tool browser suite also passes.

All NYC records in these tests are explicitly fictional fixtures. No live source data, current license, freshness or original-notice URL has yet been verified. No API key, production migration or production environment value has been changed. Do not interpret these test results as a completed live integration.
