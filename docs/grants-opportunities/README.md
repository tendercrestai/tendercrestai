# Grants.gov opportunity feed

Route `/opportunities/grants`, alongside the existing federal `/opportunities` (SAM.gov) and NYC `/opportunities/nyc` feeds. Grants search, details and pagination follow the SAM.gov/NYC patterns. Existing federal API, billing/auth/trial, demo, bid checker scoring, consent and tracker implementations are unchanged.

## Source verified November 19, 2026

Grants.gov publishes an official keyless REST API with no auth for these endpoints: POST `https://api.grants.gov/v1/api/search2` (search) and POST `https://api.grants.gov/v1/api/fetchOpportunity` (detail). Official guide: https://www.grants.gov/api/api-guide. The newer Simpler.Grants.gov API is NOT used: it needs a key and is early development.

Search takes `keyword` (optional), `oppStatuses` (`posted|forecasted`, pipe-delimited), `rows` (25) and `startRecordNum` (page * 25). The response is checked by `errorcode`, not just HTTP status: failures can return HTTP 200 with a non-zero `errorcode`. Each hit carries `id` (numeric string), `number`, `title`, `agency`/`agencyName`/`agencyCode`, `openDate`/`closeDate` in `MM/DD/YYYY`, `oppStatus` and `docType`. Detail returns `opportunityNumber`, `opportunityTitle`, `owningAgencyCode`, `docType` and a `synopsis` (posted) or `forecast` object with `synopsisDesc` (HTML), `agencyName`, `postingDate`/`postingDateStr`, `responseDate`, `costSharing`, `awardCeiling`/`awardFloor` (strings, can be `"none"`), `applicantTypes`, `fundingInstruments`, `fundingActivityCategories` and `applicantEligibilityDesc`. Detail page URL: `https://www.grants.gov/search-results-detail/{id}`.

The lane is labelled GRANTS throughout (page eyebrow, card label, FAQ, notice) so proposal users do not mistake grants for contracts. Contracts live on the SAM.gov feed. Agency contact name/email/phone are never read into stored data.

## Reliability

Per-query server cache in private `ft_cache` (one hour, same as SAM.gov). Each search and detail call admits under its own `grants` kind: 10 per IP, 50 shared per UTC day. Posted grants with a past close date are filtered at read time; forecasted grants (empty close date) are kept with deadline null. Dates are validated strictly (`MM/DD/YYYY` round-trip for search; `postingDateStr` first, then `MM/DD/YYYY`, then `Date.parse` for detail). Responses over 2 MB fail closed. No scheduled warm-up function is added in this PR; the search POST and detail POST are cheap, and the cache absorbs repeat reads.

`20261119230000_ft_admit_grants_bonfire.sql` adds only the `grants` and `bonfire` admission kinds to `ft_admit`. No new table, cache key family, credential or scheduled function is required. Rollback disables the feed/reverts the PR; the unused kinds can remain or be removed separately.

## Shredder and consent

Cards link to `/tools/shredder?provider=grants&notice=<id>`. The synopsis prefill title/source/text; attachments are not imported and the warning requires checking originals and amendments. Empty/oversized descriptions use paste/upload fallback. Processing requires the existing consent and an explicit submit. No AI calls are made by browsing or handoff. No new tracker, analytics event or consent flow is added.

## Release checks

Build and full npm suite green: 731 tests pass, 0 fail, including 7 new Grants.gov tests (identity, strict dates, money, normalization, search/caching/admission, upstream errorcode, detail, handler). Tests use mocked upstream responses only and never hit the live Grants.gov API.

## Virginia eVA verdict: NOT added

Virginia eVA via the official CKAN API (`https://data.virginia.gov/api/3/action/datastore_search`, free, no key) was checked November 19, 2026. Dataset "eVA Procurement Data 2026 - Virginia" (`eva-procurement-data-2026-virginia` / `e6f7f6ba-23a1-4423-93cd-31697b89a26f`, publisher Virginia Department of General Services) holds 1,977,683 rows described verbatim as "purchase orders for the goods and services." Each row is a purchase-order line item (45 fields: Entity_Code, NIGP_#, Item_Description, Order_#, Quantity_Ordered, Unit_Price, Order_Status, Ordered_Date, Vendor_Name, etc.). It has no solicitation number, bid number, solicitation title, due date, closing date, response deadline or open/closed status field. Sample rows are already-awarded office supplies (office paper $156.96, HON chair $326.40, Xtratuf boots $54.99). Adding it would list already-awarded purchase orders as biddable opportunities. A live Virginia solicitations feed would need eVA's own solicitation listings, not these CKAN datasets. OpenGov Procurement was also not added: keyless but undocumented endpoints, ToS/change risk, needs the owner's decision.
