# NYC opportunity feed: implementation and verification gate

Branch: `feature/nyc-opportunities`. NYC source route: `/opportunities/nyc`; the existing federal source remains `/opportunities`. The source tabs link between them. No SAM backend, billing/auth/trial, bid checker scoring, demo/sample, tracking or consent implementation changes.

## Current status

Live publisher checks passed November 8, 2026. NYC Open Data metadata identifies the dataset as PUBLIC_DOMAIN, attributed to Department of Citywide Administrative Services (DCAS), with rows updated November 7 at 13:30:25 UTC. Anonymous metadata and record queries succeeded without a key. A real list returned 25 upcoming solicitation notices, and the first original City Record page matched its title and deadline. A readable description was retrieved, with attachments explicitly excluded.

`NYC_OPPORTUNITIES_ENABLED` defaults false. Enable only after the admission migration is applied. Unavailable sources produce honest errors, never invented rows. No API key is needed for verified anonymous access. Do not copy masked Netlify secrets.

## Source and behavior

Verified publisher dataset: NYC Open Data City Record Online `dg92-zbpx`, https://data.cityofnewyork.us/d/dg92-zbpx. Metadata is read from the fixed `/api/views/dg92-zbpx.json` endpoint, and selected records from fixed `/resource/dg92-zbpx.json`. Metadata resolves known publisher column names to safe field identifiers instead of guessing transport keys. Unexpected schemas/types fail closed.

List queries require Procurement section and Solicitation/Solicitations notice type, and a listed deadline dated today or later in America/New_York. Same-day results are not presented as confirmed open bids: exact time, amendments and submission status require the original source. Award notices and other sections are excluded. Calendar/floating dates are preserved as NYC source wall-clock values, without treating them as the visitor's timezone. Fixed/offset timestamp schemas need explicit review before support. Dataset row-update metadata and fetch/check time are distinct, with missing update time labeled unknown.

Keyword uses Socrata's separate `$q` parameter, not concatenated user text in SoQL. Identifiers/order/selected fields are server-owned. Only listed source metadata is returned; supplier/vendor names, contact lists and award amounts are not selected. No attachment URLs are fetched. The City Record `/RequestDetail/<id>` source-link contract was verified against a real notice. `StartDate` is publication date; `EventDate` is a hearing/meeting date and is not used. Request IDs are numeric. The metadata license must remain PUBLIC_DOMAIN or the adapter fails closed.

Twenty-five records per page, up to ten pages, with a 26th record used only to signal another page. Sorting is explicitly within the displayed page. A one-hour private cache uses the existing `ft_cache`/`ft_cache_put` path, with day-aware search keys and distinct NYC namespaces. Each upstream request, including metadata, is admitted under the new independent `nyc` budget: 10/IP and 50 shared per UTC day. `20261108090000_nyc_feed_admission.sql` changes only the allowed admission-kind list; all prior limits/logic and browser permissions are unchanged. NYC browsing does not spend anonymous shreds or federal API admission.

## Shredder handoff

NYC cards link to `/tools/shredder?provider=nyc&notice=<id>`. The source selector dispatches to `nyc-opportunities`; legacy links/default selection still use the existing federal endpoint. Available source descriptions prefill the text area, but are not called a full solicitation package. Empty or oversized descriptions use the existing paste/upload fallback. No AI request occurs until the visitor supplies processing consent and submits the shred form. Source text uses the existing extraction pipeline unchanged.

## Verification and deployment

Build, full npm regression suite, seven adapter tests, fifteen browser checks at 390/768/1280 and independent PostgreSQL admission checks pass. Browser fixture tests remain fictional and separate from live-source checks. Live adapter checks verified search, pagination, detail, cache and attachment caveat. Occasional publisher HTTP 503 responses were observed; bounded retries admit each upstream attempt separately and never retry access/quota denials. Cache namespaces are versioned to avoid stale schema entries.

Apply the migration and enable the flag only on the isolated preview first. Review the working preview before any production migration, flag change or merge. No production credential or environment value has changed.

See `source-review.json` for the live check summary and `source-investigation.md` for other sources. Public browsing, document access, machine feeds and reuse rights are separate checks.
