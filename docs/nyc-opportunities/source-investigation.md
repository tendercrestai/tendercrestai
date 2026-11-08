# State and local source investigation

Verified November 8, 2026. Other-source findings are research, not deployed integrations.

| Priority | Official source | Verified access | Remaining checks |
| --- | --- | --- | --- |
| Implemented for preview | [NYC City Record](https://data.cityofnewyork.us/d/dg92-zbpx) | Anonymous Socrata API; PUBLIC_DOMAIN metadata; current notices and original detail verified | Preview review before production |
| Next | [Texas ESBD](https://www.txsmartbuy.gov/esbd) | Official page says sign-in not required; current notices; CSV export control with 20,000-result limit | Test export download, supported automation and reuse rights; filter deadlines as well as status |
| Second | [Massachusetts COMMBUYS](https://www.commbuys.com/bso/) | Anonymous open-bid list with current notices and CSV/Excel/PDF controls | Export download and reuse rights; JSF session-dependent exports are not a documented stable API |
| Candidate | [Austin Finance Online](https://financeonline.austintexas.gov/afo/account_services/solicitation/solicitations.cfm) | Anonymous active solicitation list with November 2026 deadlines | Supported feed/export, automation and reuse terms not established |
| Discovery only | [NY State Contract Reporter](https://www.nyscr.ny.gov/) | Current search results; free account offered; full details require login | Bulk feed and reuse not established; distinguish contractor ads from agency notices |
| Needs clarification | [Virginia eVA](https://eva.virginia.gov/eva-open-data.html) | Official open-data page describes historical procurement data | Current VBO endpoint returns HTTP 403 from this environment; historical data is not a live opportunity feed |
| Unverified | [California Cal eProcure](https://caleprocure.ca.gov/) | Portal returns HTTP 403 from this environment | Access, supported feed and terms need publisher clarification; this does not prove the source is paid |

Texas is the strongest next candidate, followed by Massachusetts. Export controls alone do not establish a supported free API or redistribution permission. No export downloads were verified for those two portals, and no new accounts, subscriptions or integrations were created.

Official Socrata application-token documentation allows simple anonymous queries with lower shared IP throttling limits. NYC dataset licensing is separately established by its PUBLIC_DOMAIN metadata; general NYC website content rights are not a license for copying portal HTML or logos. The implementation consumes selected dataset records and links to original notices.

Catalog searches for Austin, Connecticut, Chicago, New York State and Texas did not establish another comprehensive current bid API. Historical awards, charitable solicitation registrations and federated NYC datasets were excluded. Catalog search absence does not prove a feed does not exist.
