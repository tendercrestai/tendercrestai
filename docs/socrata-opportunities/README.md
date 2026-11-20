# Socrata Opportunities

Three lanes share one fetcher, `netlify/functions/lib/socrata-opportunities.js`, and one admission kind, `socrata` (10/IP, 50 shared/day, via `ft_admit`).

| Lane | Socrata dataset | Route | Function | Live fields |
| --- | --- | --- | --- | --- |
| Los Angeles RAMP | `hf3r-utnq` on data.lacity.org | `/opportunities/los-angeles` | `la-opportunities` | `rampid`, `title`, `stagename`, `category`, `type`, `bidpost`, `closedate`, `department`, `url` |
| Delaware Open Bids | `2hnj-zwix` on data.delaware.gov | `/opportunities/delaware` | `delaware-opportunities` | `contractnumber`, `contracttitle`, `opendate`, `deadlinedate`, `agencycode`, `unspsc`, `bidurl`, `count` |
| Montgomery County MD Solicitations | `eeq6-nnwe` on data.montgomerycountymd.gov | `/opportunities/montgomery-county` | `montgomery-opportunities` | `status`, `type`, `number`, `description`, `issuancedate`, `closingdate`, `cancelledpostponed`, `construction`, `lsbrpindicator`, `buyer`, `department`, `deptcontact`, `bidtab` |

Source verified Nov 20, 2026 (live fetches): each endpoint returned live rows with the fields above.

## Licences

- Los Angeles: CC0 1.0 Universal (Public Domain Dedication) from the dataset metadata. Fully non-risky.
- Delaware: the dataset metadata carries no licence field. The lane copy says the bids are published by the Office of Management and Budget, Government Support Services, on the state open-data portal, and that no resale prohibition was found. Do not claim a licence that was not published.
- Montgomery County: the dataset metadata carries no licence field. Same note as Delaware.

## Behaviour

- Each lane fetches `$limit=250&$order=<deadline field> DESC`, then filters to open rows client-side by comparing the deadline date part (`YYYY-MM-DD`) with today's date part. Open rows are those whose deadline date is today or later.
- Montgomery County fetches `status='Active'` rows only.
- A per-notice URL is required for every row. Los Angeles uses the `url` field; Delaware uses `bidurl`; Montgomery County has no per-notice link (`bidtab` is not a URL), so every Montgomery result links to the county solicitation search page (`https://www.montgomerycountymd.gov/office-procurement/solicitations-contracts`).
- The search endpoint returns 25 results per page, up to 10 pages. The detail endpoint only resolves IDs that exist in the feed snapshot.
- Fetches time out after 12 seconds and fail closed (the endpoint returns a 502 and the page shows a message, never a cached stale list).
- Results are cached in `ft_cache` for 1 hour under `socrata:<lane>:snapshot:v1`.
- The `reference` shown on each card is the solicitation ID: the RAMP ID (Los Angeles), the contract number (Delaware), or the solicitation number (Montgomery County). The shredder cannot fetch details from a per-notice URL because the URLs do not map back to these IDs.

## Shredder and consent

The three shredder providers `los-angeles`, `delaware`, and `montgomery-county` are prefilled from the lane. The fetcher returns an empty `text` field; the shredder expects the user to paste or upload the full solicitation. Do not invent solicitation text from the listing.

## Release checks

- [ ] `npm test` passes.
- [ ] `node scripts/build-site.mjs` passes.
- [ ] The three lanes are listed in `sitemap.xml`, `/opportunities`, and the nav of the other opportunity pages.
- [ ] The `socrata` and `dc-pass` kinds are in the `ft_admit` allowlist in production before the lanes can serve traffic.
- [ ] Live check on the merged site: each lane loads live results, and one card links to the correct source.
