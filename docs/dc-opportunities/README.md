# DC PASS Opportunities

One lane, `/opportunities/dc`, backed by `netlify/functions/lib/dc-opportunities.js` and the `dc-pass` admission kind (10/IP, 50 shared/day, via `ft_admit`).

## Source

- ArcGIS Open Data layer: `https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Government_Operations/MapServer/19` (Solicitations from PASS).
- Layer metadata confirms the fields `SOLICITATIONNUMBER`, `SOLICITATIONTITLE`, `SOLICITATIONSTATUS`, `AGENCY_NAME`, `DUE_DATE`, `ISSUANCEDATE`, `CLOSEDATE`, `SYNOPSIS`, and `TYPE`.
- The live query is `query?where=(DUE_DATE > TIMESTAMP 'YYYY-MM-DD 00:00:00' OR CLOSEDATE > TIMESTAMP 'YYYY-MM-DD 00:00:00')&outFields=SOLICITATIONNUMBER,SOLICITATIONTITLE,AGENCY_NAME,DUE_DATE,ISSUANCEDATE,CLOSEDATE,SYNOPSIS,TYPE&returnGeometry=false&f=json&resultRecordCount=500&orderByFields=CLOSEDATE DESC`. Source verified Nov 20, 2026 (live query): 39 rows had a close date after 2026-11-20.

## Behaviour

- The operative deadline is `CLOSEDATE`, falling back to `DUE_DATE`. `DUE_DATE` alone is not usable: the latest `DUE_DATE` in the layer is 2026-11-16, so a `DUE_DATE`-only filter returns no open rows.
- The search endpoint returns 25 results per page, up to 10 pages. Rows are deduplicated by solicitation number (the layer has duplicate rows per solicitation).
- `SOLICITATIONSTATUS` is null on sampled rows, so the feed does not filter by status; the date filter is the only openness check.
- `ISSUANCEDATE` is often null, so the card shows "Issued: Not supplied" for those rows instead of guessing.
- The feed publishes no per-solicitation link, so every result links to the DC Office of Contracting and Procurement site (`https://ocp.dc.gov/`); search the solicitation number there.
- The `reference` shown on each card is the solicitation number, e.g. `Doc855545`.
- Fetches time out after 12 seconds and fail closed (the endpoint returns a 502 and the page shows a message, never a cached stale list).
- Results are cached in `ft_cache` for 1 hour under `dc-pass:snapshot:v1`.

## Licence

CC BY 4.0 (attribution required), from the data.gov catalog entry for the dataset. The licence text was not found on the dataset page HTML itself. The lane copy carries the attribution to the District of Columbia Office of the Chief Technology Officer.

## Shredder and consent

The `dc` shredder provider is prefilled from the lane. The fetcher returns an empty `text` field: `SYNOPSIS` is empty on sampled open rows, and a synopsis is not a solicitation, so the shredder expects the user to paste or upload the full solicitation. Do not invent solicitation text from the listing.

## Release checks

- [ ] `npm test` passes.
- [ ] `node scripts/build-site.mjs` passes.
- [ ] The lane is listed in `sitemap.xml`, `/opportunities`, and the nav of the other opportunity pages.
- [ ] The `dc-pass` kind is in the `ft_admit` allowlist in production before the lane can serve traffic.
- [ ] Live check on the merged site: the lane loads live results, and one card links to the correct source.
- [ ] Re-check the ArcGIS query on the merged site; the `DUE_DATE`/`CLOSEDATE` behaviour was verified live before the merge, but the layer is outside TenderCrest's control.
