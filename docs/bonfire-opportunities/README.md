# Utah Bonfire opportunity feed

Route `/opportunities/utah`, alongside the existing federal `/opportunities` (SAM.gov), NYC `/opportunities/nyc` and federal-grants `/opportunities/grants` feeds. Utah search, details and pagination follow the SAM.gov/NYC patterns. Existing federal API, billing/auth/trial, demo, bid checker scoring, consent and tracker implementations are unchanged.

## Source verified November 19, 2026

Public keyless RSS 2.0 at `https://utah.bonfirehub.com/opportunities/rss`, verified live November 19, 2026. One hub covers the whole State of Utah plus its cities, counties and school districts. Per item: description text starting `Reference #: <ref>. Name: <name> Department: <dept>. Description: ...` and ending with `Project closes <Month> <day>, <year> <h>:<mm> AM/PM MST.` (e.g. `Project closes Nov 19, 2026 5:00 PM MST`), then `pubDate` (RFC 2822), then the portal link `https://utah.bonfirehub.com/opportunities/<numeric id>`.

The close date exists only inside the free-text description, so it is parsed with a regex. The timezone map covers MST/MDT, PST/PDT, EST/EDT, CST/CDT, AKST/AKDT, HST and UTC/GMT; an unknown timezone returns null and is never guessed. Day/month are validated against the calendar month, so impossible dates (e.g. February 30) are rejected. When no close date can be extracted, the card says "close date not stated" instead of guessing. No estimated value is published by this feed; cards say "value not published" and no value is ever invented.

## Reliability

One server-side snapshot in private `ft_cache` (one hour, same as SAM.gov), shared by search, detail and the shredder handoff. Each snapshot refresh admits under its own `bonfire` kind: 10 per IP, 50 shared per UTC day. Past deadlines are filtered at read time; notices with no readable close date are kept with deadline null. Keyword matches title, agency or reference number locally; no keyword is interpolated into an upstream query. RSS responses over 2 MB or with more than 1,000 items fail closed. No scheduled warm-up function is added in this PR; the feed is small and the cache absorbs repeat reads.

`20261119230000_ft_admit_grants_bonfire.sql` adds only the `grants` and `bonfire` admission kinds to `ft_admit`. No new table, credential or scheduled function is required. Rollback disables the feed/reverts the PR; the unused kinds can remain or be removed separately.

## Shredder and consent

Cards link to `/tools/shredder?provider=bonfire&notice=<id>`. The notice description prefills title/source/text; attachments are not imported and the warning requires checking originals and amendments. Empty/oversized descriptions use paste/upload fallback. Processing requires the existing consent and an explicit submit. No AI calls are made by browsing or handoff. No new tracker, analytics event or consent flow is added.

## Release checks

Build and full npm suite green: 749 tests pass, 0 fail, including 8 new Bonfire tests (identity, close-date parsing incl. 12 AM/PM and unknown timezones, RSS parsing, normalization, search/paging/caching/admission, feed failure, detail, handler) plus 5 new Kansas City tests (org-scoped identity, title-carried reference/name normalization, search, detail, handler). Tests use mocked feed responses only and never hit the live Bonfire feed; a live smoke run against both real feeds is recorded in the PR.

## Kansas City Bonfire lane (added in the KCMO + WEBS PR)

Route `/opportunities/kcmo`, alongside `/opportunities/utah`. Same generalized Bonfire module (`netlify/functions/lib/bonfire-opportunities.js`), parameterized by org slug instead of duplicated: Utah keeps its own feed URL, labels, cache keys (`bonfire:utah:*`) and behavior exactly as before; Kansas City uses `https://kcmo.bonfirehub.com/opportunities/rss` with cache keys (`bonfire:kcmo:*`).

Source verified November 19, 2026: public keyless RSS 2.0, 7 items. The KCMO feed shapes its items differently from Utah, which the live smoke test caught before merge: the `<title>` element carries `Reference #: <ref>. Name: <name>`, while the `<description>` holds only the body text starting with `Description: ... Project closes <Month> <day>, <year> <h>:<mm> AM/PM CST.` (Utah puts Reference, Name and Department all inside the description). Normalization therefore reads Reference and Name from the description first and falls back to the title, so both shapes work. Two KCMO-specific behaviors, both covered by tests: descriptions carry no `Department:` field, so the agency falls back to `City of Kansas City, Missouri` (the hub is a single city, not a multi-agency hub); and the name field stops at `Description:` as well as `Department:`, because some descriptions run the name straight into `Description:` with no separator. Reference numbers are read as the first token after `Reference #:` (`EV4880`, not `EV4880 Tax Burden Study`). Close dates use CST/CDT, already covered by the shared timezone map. Shredder handoff is `/tools/shredder?provider=kcmo&notice=<id>` (its own provider value, so the shredder routes to the KCMO detail endpoint; `bonfire` stays Utah-only). Admission reuses the existing `bonfire` kind (10 per IP, 50 shared per UTC day); no new migration is needed for this lane.

## Virginia eVA verdict: NOT added

See `docs/grants-opportunities/README.md`: the Virginia eVA CKAN datasets hold already-awarded purchase-order line items with no solicitation number, due date or open/closed status, so they cannot feed a live opportunities lane.
