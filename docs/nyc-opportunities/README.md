# NYC opportunity feed

Route `/opportunities/nyc`, alongside the existing federal `/opportunities` feed. NYC search, details and all pagination share one server-side snapshot. Existing federal API, billing/auth/trial, demo, bid checker scoring, consent and tracker implementations are unchanged.

## Source verified November 8, 2026

NYC Open Data City Record Online dataset [dg92-zbpx](https://data.cityofnewyork.us/d/dg92-zbpx) identifies its license as PUBLIC_DOMAIN and its publisher as Department of Citywide Administrative Services (DCAS). Metadata reports rows updated November 7 at 13:30:25 UTC. Anonymous source reads require no API key. The original City Record notice title and deadline were verified against a returned notice.

`StartDate` is publication date; `EventDate` is for hearings/meetings. Request IDs are numeric. Supported column types/identifiers and PUBLIC_DOMAIN license are validated on each refresh. Unexpected metadata, invalid responses or over-1,000-record coverage fail closed. Awards are excluded. Individual invalid rows are omitted and counted.

## Reliability

The original server-side sort and individual keyword/detail queries caused intermittent upstream timeouts/503s. A single unsorted query returned 198 upcoming notices with descriptions in about three seconds. The adapter now sorts by publication date/ID and searches title/agency/category locally. It serves 25 rows per page, at most 40 pages, and uses the same snapshot for detail and shredder handoff. No keyword is interpolated into an upstream query.

A native hourly Netlify scheduled function warms the snapshot even without visitors, respecting the same flag, lease and budget. It logs refresh unavailability without source content or secrets. A service-only refresh lease prevents simultaneous visitors from duplicating source calls. Successful snapshots refresh after one hour; failed refreshes back off five minutes. Network failures and brief HTTP 502/503/504 responses get at most one retry within the request time budget. Retry-After is respected; access/quota denials are not retried. Each upstream attempt uses a separate NYC budget of 100/IP and 200 shared/day. The larger NYC-only budget accommodates hourly shared refreshes plus bounded retries without changing federal/shred limits.

The last successful snapshot remains in private `ft_cache` for at most 24 hours. If NYC is temporarily unavailable or refreshing, that snapshot is served with its original timestamp and an explicit warning. Dates earlier than the current New York calendar day are filtered at read time, including in fallback mode. Same-day closing times still require verification on the original source. An invalid schema/license/access response invalidates the old snapshot rather than continuing to display it. No snapshot older than 24 hours is served. A prolonged outage can still make the feed unavailable; no external API availability guarantee is implied.

`20261108090000_nyc_feed_admission.sql` adds only the NYC admission kind. `20261108110000_nyc_feed_snapshot.sql` adds service-only claim/store functions using new `nyc:snapshot:*` cache keys. No existing cache/jobs/leads are overwritten. Existing cache maintenance removes expired snapshots. No new table or credential is required. Rollback disables the flag/reverts the PR; the unused new functions/keys can remain or be removed separately.

## Shredder and consent

Cards link to `/tools/shredder?provider=nyc&notice=<id>`. Source descriptions prefill title/source/text; attachments are not imported and the warning requires checking originals and amendments. Empty/oversized descriptions use paste/upload fallback. Processing requires the existing consent and an explicit submit. No AI calls are made by browsing or handoff. No new tracker, analytics event or consent flow is added.

## Release checks

Build/full npm suite, ten adapter/scheduler tests, fifteen browser checks at 390/768/1280 and real PostgreSQL admission/refresh-lease tests pass. Tests cover shared snapshot keyword/pagination/detail, bounded retry, no retry on denial, refresh contention, 24-hour expiry, expired deadlines and invalid-license fallback rejection. Browser fixtures are explicitly fictional and distinct from real publisher verification.

Live preview and production verification outcomes are recorded in the PR/release record. The source feed uses a feature flag `NYC_OPPORTUNITIES_ENABLED=true` and requires both migrations before activation. Do not copy masked Netlify secrets. Other-source research is in `source-investigation.md`; no other state/local feed is implemented.
