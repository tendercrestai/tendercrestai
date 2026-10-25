# US government IT/consulting reference pilot

Research metadata only. No source in catalogue.json is approved for model context, training or production retrieval. `retrieve()` currently returns zero suggestions for this catalogue. There are no verified full winning proposal responses in the initial collection. No private customer evidence belongs in this directory.

## Sources inspected

- **Official agency evidence:** [18F Agile BPA awardees](https://github.com/18F/ads-bpa/blob/e92fd50019b83d65396cf347c48e5fd9a7fcb81c/_pages/awardees.md), rendered from its [vendor list](https://github.com/18F/ads-bpa/blob/e92fd50019b83d65396cf347c48e5fd9a7fcb81c/data/vendors.yml). This is an agency awardee list, not the bidders' technical proposals. The repository's LICENSE.md states US public-domain/CC0 terms for that repository, not linked third-party works. Repository content was read through the GitHub API; web rendering was not inspected.
- **NCI candidate:** [technical submission documentation](https://github.com/empowerai/agile-bpa/blob/0e6eaf50ec802416ffbd3fe8e0aaf928467e84a0/README.md). An agency-listed vendor and self-described prototype provide a source lead. The observed licence notice identifies NCI and uses ISC-style terms; the current GitHub owner differs. Exact evaluated-artifact/award linkage, applicable documentation reuse scope, historical relevance and attribution still require review. Do not transfer the vendor's claims, staffing, past performance or technology commitments into a customer proposal.
- **Applied Information Sciences candidate:** [prototype repository](https://github.com/ais-open/AgileBPA). README identifies the vendor and RFQ 4QTFHS150004; the agency list includes that vendor. Repository metadata did not identify a licence. Do not ingest it without a suitable reuse basis. No submitted revision or full proposal has been verified.

These are historical Agile BPA materials, not a representative contemporary federal bid corpus. Public release and vendor award listing do not prove that a particular paragraph, method or source revision caused an award.

## Initial code

`netlify/functions/lib/reference-patterns.js` validates review/reuse/award metadata and returns bounded, attributed **structure-only** pattern suggestions. It never creates company evidence, buyer requirements, compliance statuses or proposal text. Market and sector must match; no-match returns empty; exact procurement holdout exclusions are supported. Award lists/notices and solicitations cannot be returned as response-structure guidance. A prototype document can never be labelled a full winning proposal response.

This is a deterministic offline foundation, not a trained LLM or a complete ingestion/retrieval service. It has no API route, production imports, database, embedding calls or UI. Metadata flags require accountable human verification; this validator does not independently establish copyright permission or award truth. Source-byte verification, near-duplicate grouping, admin review persistence and engine integrations remain future work. The explicit static-site build excludes this directory and server modules.

## Next source work

SAM.gov and USAspending identify opportunities, vendors and award context; they do not automatically provide full winning proposal text. GAO bid-protest decisions can provide evaluation reasoning with redactions; treat them as evaluation reports, not proposals. GSA directories and state/local procurement/public-records portals can identify further candidates. Only ingest documents actually public and appropriate for reuse; do not bypass authentication, make public-records requests/contact vendors automatically or treat restricted bids as open data.

Direct HTTP probes of SAM.gov, USAspending, GAO, GSA eLibrary and Austin procurement were blocked/unavailable under this environment's current network policy. A draft preserves existing destinations and adds sam.gov, www.usaspending.gov, api.usaspending.gov, www.gao.gov, www.gsaelibrary.gsa.gov and www.austintexas.gov. Saving the draft is not publication/application: the owner must review/save and publish the environment before direct-source research can proceed. GitHub API access enabled the limited initial research above without bypassing those restrictions.

A stronger public USP should follow verified response coverage and a held-out benchmark against the current engine. Until then, do not publish 'trained on winning bids', measured uplift, win-rate or compliance guarantees.
