# Washington WEBS opportunity feed

Route `/opportunities/washington`, alongside the existing federal `/opportunities` (SAM.gov), NYC `/opportunities/nyc`, federal-grants `/opportunities/grants`, Los Angeles `/opportunities/los-angeles`, Delaware `/opportunities/delaware`, Montgomery County `/opportunities/montgomery-county`, and DC `/opportunities/dc` feeds. Washington search, details and pagination follow the shared opportunity-lane patterns. Existing federal API, billing/auth/trial, demo, bid checker scoring, consent and tracker implementations are unchanged. (The Bonfire `/opportunities/utah` and `/opportunities/kcmo` feeds were removed in November 2026: Euna's Terms of Service prohibit extracting and rehosting Bonfire data for commercial purposes without a written licence.)

## Source verified November 19, 2026

Public bid calendar HTML at `https://pr-webs-vendor.des.wa.gov/bidcalendar.aspx`, verified live November 19, 2026 (HTTP 200, 25 Ref# entries on page 1). There is no API: the lane scrapes the calendar page. The page is one ASP.NET `DataGrid1` table; each solicitation is a `grid_item` / `grid_item_alt` row with three cells: close date (`MM/DD/YY`, plus an amendment date when one exists) | title linked to `Search_BidDetails.aspx?ID=<numeric>` + `Ref#:<ref>` + short description | contact name. The parser reads exactly that structure (detail link, Ref#, first date in the row, description up to the details panel, contact cell) and drops rows that lack a detail link or Ref#. Rows that state no readable close date are kept with deadline null and shown as "close date not stated" instead of guessing.

The calendar states the close date only, with no closing time. The lane treats the stated date as end of day Pacific time (Washington is Pacific; the date-only value is never given a fabricated clock time on the card, which shows the date only). Day/month are validated against the calendar month, so impossible dates (e.g. February 30) are rejected. No estimated value is published by this feed; cards say "value not published" and no value is ever invented. No agency field is published by the calendar, so cards say "Agency not supplied".

This lane lists the first page of the public bid calendar only (25 soonest-closing notices); later calendar pages need ASP.NET postbacks and are not fetched. The page says so plainly.

## Reliability

One server-side snapshot in private `ft_cache` (one hour, same as SAM.gov), shared by search, detail and the shredder handoff. Each snapshot refresh admits under its own `webs` kind: 10 per IP, 50 shared per UTC day. Past deadlines are filtered at read time; notices with no readable close date are kept with deadline null. Keyword matches title, agency, reference number or description locally; no keyword is interpolated into an upstream query. Calendar responses over 4 MB fail closed (the page is ~1.4 MB today, mostly the organization filter list). If the calendar returns no readable rows, the feed fails closed with a 503 instead of showing an empty list. No scheduled warm-up function is added in this PR; the feed is small and the cache absorbs repeat reads.

`20261120000000_ft_admit_webs.sql` adds only the `webs` admission kind to `ft_admit`. No new table, credential or scheduled function is required. Rollback disables the feed/reverts the PR; the unused kind can remain or be removed separately.

## Shredder and consent

Cards link to `/tools/shredder?provider=webs&notice=<id>`. The detail text is the calendar summary only (title, reference, close date, description, contact); full solicitation documents need a free WEBS login, which the page and the shredder notice both say plainly, so the shredder link may hit a login wall for the full package. Attachments are not imported; paste or upload the full solicitation for a complete review. Processing requires the existing consent and an explicit submit. No AI calls are made by browsing or handoff. No new tracker, analytics event or consent flow is added.

## Release checks

Build and full npm suite green: 749 tests pass, 0 fail, including 8 new WEBS tests (identity, Pacific close-date parsing incl. DST boundaries and invalid dates, calendar HTML parsing incl. Ref# entries and missing-date handling, normalization, search/paging/caching/admission, feed failure, detail, handler). Tests use mocked calendar responses only and never hit the live WEBS calendar; a live smoke run against the real calendar is recorded in the PR.

## Scraping note

WEBS publishes the calendar for public viewing without login, but it is HTML scraping, not a documented API: if DES changes the page markup, the parser fails closed (503) and the lane shows an error instead of stale or wrong data. The daily feed-health check covers this URL and reports a break.
