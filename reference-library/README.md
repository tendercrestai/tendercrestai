# US government IT/consulting reference pilot

Offline research pilot only. Three candidate records remain unapproved. Four source snapshots have been reviewed for offline structural guidance: three US Digital Services Playbook plays and one Acumen technical-documentation example. None is approved for production retrieval or model training. Default production-mode retrieval still returns zero suggestions. There are no verified full winning proposal responses. No private customer evidence belongs in this directory.

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

## Second research pass and reproducible offline preview

SAM.gov and USAspending now return HTTP 200 through this environment; GAO returned HTTP 403. This supersedes the initial access probes above; no GAO access control was bypassed. These portals do not by themselves establish access to full winning proposal text.

Four offline-reviewed snapshots are pinned by commit and SHA-256 in the catalogue:

- USDS Playbook play 1: user needs, research and validation.
- USDS Playbook play 4: iterative delivery and feedback.
- USDS Playbook play 12: measurement and operational review.
- Acumen GSA Agile Prototype README: technical-approach justification and role/responsibility structure. The adjacent MIT notice explicitly covers associated documentation and is retained verbatim. The official agency list contains Acumen Solutions Inc, but the evaluated-document/revision linkage is not verified. This source remains technical documentation, not a full verified winning response. No vendor facts or historical technology choices are transferred into pattern guidance.

USDS's pinned README contains the US Government public-domain/CC0 declaration and is retained. Reference source code, links and assets are never executed or followed automatically. Copied snapshots are internal research artifacts excluded from the static build.

Reproduce with `python scripts/collect-reference-pilot.py`. This uses the existing GitHub CLI for public, pinned repository content only, verifies Git blob integrity, bounds sizes, decodes UTF-8 and records SHA-256. It does not request a model or traverse private repositories. Scope approval is `offline_pilot`, not production. `reference-catalogue.js` rejects changed source/notice bytes and paths escaping the library root.

Run `node scripts/reference-pilot.mjs tests/fixtures/proposal/rfp.txt` to inspect an offline context preview. It returns source-attributed structure suggestions, exact source locators/hashes and explicit evidence/compliance boundaries; it does not repeat the complete input RFP, generate a proposal, send data to a model or mark compliance. It defaults to US federal IT for this initial CLI; the underlying retriever also validates sector/jurisdiction inputs. Current extraction is lexical/tag based, not semantic retrieval or a learned model. No production caller imports the pilot modules.

The fictional development fixture demonstrates capacity/role structure, delivery/feedback structure and user validation. It still requires the bidder's own current ISO certificate, authorized project evidence, capacity assumptions and required attachments. The library cannot supply those. This is a development example, not a held-out benchmark or proof of a quality/time/win-rate improvement.
